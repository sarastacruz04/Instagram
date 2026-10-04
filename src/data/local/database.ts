import * as SQLite from 'expo-sqlite';

import { Mutex } from '@/core/concurrency/Mutex';

// Base de datos embebida (SQLite) = fuente de verdad LOCAL.
// Todas las llamadas *Async se ejecutan en un hilo nativo de fondo: el hilo JS
// solo recibe la Promise y sigue atendiendo la UI mientras SQLite trabaja.
const DB_NAME = 'instagram.db';

// Migraciones versionadas con PRAGMA user_version. Solo se AGREGAN al final;
// nunca se edita una que ya corrió en algún dispositivo.
const MIGRATIONS: string[] = [
  // v1 — Cola de sincronización (outbox)
  `CREATE TABLE outbox (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,  -- orden cronológico estricto
     user_id      TEXT    NOT NULL,                   -- dueño: nunca se ejecutan ops de otra sesión
     type         TEXT    NOT NULL,
     payload      TEXT    NOT NULL,                   -- JSON de la operación
     coalesce_key TEXT,                               -- p. ej. like:<postId>
     status       TEXT    NOT NULL DEFAULT 'pending', -- pending | inflight | failed
     attempts     INTEGER NOT NULL DEFAULT 0,
     last_error   TEXT,
     created_at   INTEGER NOT NULL
   );
   CREATE INDEX outbox_next_idx ON outbox (user_id, status, id);
   CREATE INDEX outbox_coalesce_idx ON outbox (user_id, coalesce_key, status);`,

  // v2 — Caché del feed: la primera página se guarda para mostrarla sin red (offline-first).
  `CREATE TABLE feed_cache (
     user_id   TEXT    NOT NULL,
     position  INTEGER NOT NULL,
     post_json TEXT    NOT NULL,
     cached_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, position)
   );`,

  // v3 — Índice del caché de imágenes en DISCO (nivel L2). Los bytes están en archivos;
  // aquí va la metadata para aplicar la política LRU sin listar el directorio.
  `CREATE TABLE image_cache (
     cache_key   TEXT    PRIMARY KEY,   -- ruta del bucket o URL pública del avatar
     file_name   TEXT    NOT NULL,      -- SHA-256 de la llave
     bytes       INTEGER NOT NULL,
     last_access INTEGER NOT NULL
   );
   CREATE INDEX image_cache_lru_idx ON image_cache (last_access);`,

  // v4 — Estado "visto" de las historias: LOCAL, por dispositivo (como pide el enunciado).
  // Se guarda expires_at para poder borrar las marcas cuando la historia ya no existe.
  `CREATE TABLE story_seen (
     story_id   TEXT    PRIMARY KEY,
     seen_at    INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX story_seen_expires_idx ON story_seen (expires_at);`,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Conexión única compartida. Se guarda la PROMISE (no la conexión): si dos módulos
 * llaman a getDb() a la vez durante el arranque, ambos esperan la misma apertura
 * en vez de abrir dos conexiones y correr las migraciones dos veces.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= open();
  return dbPromise;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL: los lectores no bloquean al escritor ni viceversa.
  // busy_timeout: si la BD está ocupada, esperar hasta 5 s en vez de fallar al instante.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    const next = version + 1;
    // Migración + subida de versión en la misma transacción: o se aplican ambas o ninguna.
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}

// Todas las ESCRITURAS pasan por este mutex. Motivo: withTransactionAsync no es
// exclusiva (otra query async puede colarse dentro de la transacción entre dos await),
// y withExclusiveTransactionAsync abre OTRA conexión que hace fallar las escrituras
// concurrentes con "database is locked". Serializar las escrituras en JS evita ambos.
const writeMutex = new Mutex();

export function write<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  return writeMutex.run(async () => task(await getDb()));
}

/** Escritura atómica: varias sentencias que deben aplicarse todas o ninguna. */
export function writeTransaction(task: (db: SQLite.SQLiteDatabase) => Promise<void>): Promise<void> {
  return writeMutex.run(async () => {
    const db = await getDb();
    await db.withTransactionAsync(() => task(db));
  });
}
