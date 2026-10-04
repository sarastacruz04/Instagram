# Guía de defensa técnica — Instagram Clone

> Documento de estudio. Se actualiza al cerrar cada fase.
> Cada sección responde: **qué se hizo, dónde está, por qué así, en qué hilo corre, cómo se maneja el estado, y qué preguntará el profe.**

## Índice

- [⭐ Resumen de estudio (léelo primero)](#-resumen-de-estudio-léelo-primero)
- [Parte 0 — Fundamentos que aplican a TODO el proyecto](#parte-0--fundamentos-que-aplican-a-todo-el-proyecto)
  - [0.1 Stack tecnológico y por qué](#01-stack-tecnológico-y-por-qué)
  - [0.2 Los hilos en React Native](#02-los-hilos-en-react-native-la-pregunta-más-importante)
  - [0.3 Nueva Arquitectura: JSI, Fabric, TurboModules](#03-nueva-arquitectura-jsi-fabric-turbomodules)
  - [0.4 Hermes y el bytecode](#04-hermes-y-el-bytecode)
  - [0.5 React Compiler](#05-react-compiler)
  - [0.6 Clean Architecture en este proyecto](#06-clean-architecture-en-este-proyecto)
  - [0.7 Gestión de estado: los 4 tipos de estado](#07-gestión-de-estado-los-4-tipos-de-estado)
- [Fase 1 — Setup, backend (Supabase) y autenticación](#fase-1--setup-backend-supabase-y-autenticación)
- [Fase 2 — Navegación: tabs con pilas independientes y deep linking](#fase-2--navegación-tabs-con-pilas-independientes-y-deep-linking)
- [Fase 3 — Base de datos local y cola de sincronización offline (Módulo 3)](#fase-3--base-de-datos-local-y-cola-de-sincronización-offline-módulo-3)
- [Fase 4 — Feed, publicaciones, likes, comentarios y privacidad (Módulo 1)](#fase-4--feed-publicaciones-likes-comentarios-y-privacidad-módulo-1)
- [Fase 5 — Motor de caché de imágenes y rendimiento 60 FPS (Módulo 2)](#fase-5--motor-de-caché-de-imágenes-y-rendimiento-60-fps-módulo-2)
- [Fase 6 — Mensajería directa en tiempo real (Módulo 4)](#fase-6--mensajería-directa-en-tiempo-real-módulo-4)
- [Fase 7 — Historias efímeras de 24 h (Módulo 5)](#fase-7--historias-efímeras-de-24-h-módulo-5)
- [Fase 8 — Auditoría final y preparación de la defensa](#fase-8--auditoría-final-y-preparación-de-la-defensa)
- [Problemas encontrados y cómo se resolvieron](#problemas-encontrados-y-cómo-se-resolvieron)
- [Estado de verificación](#estado-de-verificación)

---

# ⭐ Resumen de estudio (léelo primero)

## Cómo responder para sacar 100 %

La rúbrica pide: *funcionamiento interno, decisiones arquitectónicas, hilos (UI vs background), gestión de estado y contrapreguntas.* Responde **siempre** en este orden (≈ 1 minuto):

1. **Qué hace y dónde está:** "Está en `data/sync/SyncEngine.ts`; es el patrón Transactional Outbox…"
2. **Cómo funciona por dentro:** el flujo paso a paso (2–4 pasos).
3. **Hilos:** qué corre en el UI thread, qué en el JS thread y qué en hilos nativos de fondo.
4. **Estado:** dónde vive (useState / Zustand / SharedValue / SQLite / Postgres) y por qué ahí.
5. **Por qué así y no de otra forma:** nombra la alternativa y su desventaja.
6. **Caso borde que manejaste:** fallo de red, carrera, memoria, seguridad.

Si no recuerdas un detalle, **razona en voz alta con estos 6 pasos**: el profe califica el entendimiento, no la memoria literal.

## Las 10 ideas que cruzan todo el proyecto

1. **JS es un solo hilo con event loop.** "Background" = trabajo delegado a hilos nativos (SQLite, red, archivos, decodificación) que devuelven Promises. `await` no bloquea el hilo.
2. **UI thread ≠ JS thread.** Las animaciones (historias) y los gestos corren en el UI thread con Reanimated y Gesture Handler; React no se entera de cada frame.
3. **Clean Architecture:** `domain` (puro) ← `data` (Supabase/SQLite) y `presentation` (UI). Solo `di/container.ts` une interfaces con implementaciones.
4. **La seguridad vive en Postgres (RLS),** no en la app. El cliente se puede manipular; el servidor no.
5. **Optimista + cola offline:** la UI cambia en 0 ms; la intención se guarda en SQLite y el `SyncEngine` la envía en orden (FIFO, una a la vez).
6. **Idempotencia:** UUIDs del cliente + `ON CONFLICT DO NOTHING` + likes como estado deseado → reintentar nunca duplica ni corrompe.
7. **Estado normalizado + selectores:** cada post existe una vez (`byId`); cada componente se suscribe solo a lo que usa → re-renders mínimos.
8. **Memoria nativa se libera a mano** (`release()`); el GC de JS no la ve. Presupuestos en bytes + LRU + decodificación al tamaño de pantalla.
9. **Todo lo que se abre se cierra** en el cleanup del `useEffect`: canales Realtime, timers, AbortControllers, handles de imagen.
10. **El WebSocket es una optimización; la verdad es la base de datos.** Tras reconectar, se vuelve a consultar.

## Un párrafo por módulo (para abrir la respuesta)

**Módulo 1 — Feed y publicaciones.** El feed es una RPC `get_feed` con paginación por cursor (`created_at <`), mostrada en FlashList. Los posts viven en un store **normalizado** (`postsStore`: `byId` + `lists`). Like y comentario son **optimistas** y pasan por la cola offline. Los comentarios son anidados (`parent_id`, un nivel) y llegan **en tiempo real** por `postgres_changes`, deduplicados por el UUID del cliente. Compartir: por DM (referencia interna `[post:<id>]`) o enlace (deep link). Cuentas privadas: `follows.status` (`pending`/`accepted`) decidido por un **trigger**; la función `can_view()` se usa en RLS de posts, historias, follows y del **bucket privado** de imágenes (URLs firmadas).

**Módulo 2 — Caché de imágenes y 60 FPS.** Motor propio (`ImageCacheEngine`): **L1 RAM** = LRU (sobre un `Map`, O(1)) de `ImageRef` (bitmaps decodificados en memoria nativa) con presupuesto de 64 MB y `release()` al desalojar; **L2 disco** = archivos en `Paths.cache` + índice SQLite con LRU por `last_access` (150 MB); **red** = URL firmada + descarga nativa con `AbortSignal`, a `.part` y rename atómico. Se decodifica **al tamaño de pantalla**. Cancelación: reciclaje de FlashList, desmontaje, salida del viewport (`onViewableItemsChanged`) y pérdida de foco. Deduplicación con conteo de interesados. Medido: **UI 59 / JS 57 fps**.

**Módulo 3 — UI optimista y offline-first.** Patrón **Transactional Outbox**: la UI cambia el estado en memoria y encola la intención en la tabla `outbox` (SQLite). El `SyncEngine` drena en **orden estricto** (`ORDER BY id`, un solo consumidor, se detiene ante fallo transitorio), con **backoff exponencial + jitter**, disparado por NetInfo, AppState y nuevos encolados. Errores clasificados: transitorio (reintentar), permanente (apartar + **rollback**), duplicado (éxito). Escrituras SQLite serializadas con un **mutex**. Coalescencia de likes. Reconciliación de la respuesta del servidor con lo pendiente.

**Módulo 4 — Mensajería directa.** Supabase Realtime por **WebSocket**: una sola suscripción global `postgres_changes` a `messages` (INSERT/UPDATE), filtrada por **RLS**. Enviar = optimista + cola. "Escribiendo…" = **Broadcast** en canal **privado** (políticas sobre `realtime.messages`), con throttle (2 s) y timeout (3.5 s). Entregado/Visto = `delivered_at`/`read_at` vía RPCs; el remitente recibe el UPDATE en vivo. Bandeja ordenada por trigger + `bumpConversation` (O(n)). Recuperación tras reconexión.

**Módulo 5 — Navegación, deep linking, historias.** Cada pestaña es un **Stack independiente** gracias a *shared routes* `(home,explore,activity,profile)`; las pestañas no se desmontan. Deep link `instagramclone://post/<id>` (en Expo Go `exp://…/--/post/<id>`), interceptado en `+native-intent.tsx` para abrirlo en la pila de Home y **recordarlo si no hay sesión**. Historias: barra de avatares, visor a pantalla completa, barras de progreso con **Reanimated en el UI thread**, pausa con **LongPress worklet** (`cancelAnimation`) y reanudación con el tiempo restante, "visto" **local en SQLite**, vencimiento de 24 h puesto por el **servidor** y exigido por RLS.

## Mapa rápido: ¿dónde está cada cosa?

| Te preguntan por… | Abre este archivo |
|---|---|
| Arquitectura / inyección de dependencias | `src/di/container.ts`, `src/domain/repositories/*` |
| Seguridad, privacidad, RLS, triggers | `supabase/schema.sql` (`can_view`, políticas) |
| Login / sesión / navegación protegida | `src/presentation/stores/sessionStore.ts`, `src/app/_layout.tsx` |
| Pilas por pestaña | `src/app/(tabs)/(home,explore,activity,profile)/_layout.tsx` |
| Deep linking | `src/app/+native-intent.tsx`, `src/presentation/navigation/pendingDeepLink.ts` |
| Cola offline | `src/data/sync/SyncEngine.ts`, `src/data/local/OutboxDao.ts`, `src/data/sync/syncErrors.ts` |
| Idempotencia de cada operación | `src/data/sync/operationHandlers.ts` |
| Mutex / concurrencia SQLite | `src/core/concurrency/Mutex.ts`, `src/data/local/database.ts` |
| UI optimista + rollback de likes | `src/presentation/stores/postsStore.ts` (`toggleLike`, `revertLike`) |
| Reconciliación | `src/domain/sync/reconcile.ts` |
| LRU | `src/core/cache/LruCache.ts` |
| Motor de caché de imágenes | `src/data/imageCache/ImageCacheEngine.ts` |
| Cancelación de imágenes | `src/presentation/components/CachedImage.tsx`, `src/presentation/stores/viewportStore.ts` |
| Comentarios en tiempo real | `src/presentation/stores/commentsStore.ts`, `src/data/repositories/SupabaseCommentRepository.ts` |
| Chat, typing, visto | `src/presentation/stores/dmStore.ts`, `src/data/repositories/SupabaseDirectMessageRepository.ts` |
| Historias (animación, gestos) | `src/app/stories/[userId].tsx` |
| Estado "visto" local | `src/data/local/StorySeenDao.ts` |

## Números que conviene saber

| Dato | Valor |
|---|---|
| Presupuesto de bitmaps en RAM (L1) | 64 MB |
| Presupuesto de disco (L2) | 150 MB |
| Foto de 1080 px decodificada | ≈ 4.6 MB (1080 × 1080 × 4 bytes) |
| Compresión al subir | 1080 px, JPEG 80 % (avatar 320 px) |
| Backoff de la cola | 1 s, 2 s, 4 s… máx. 60 s, con jitter |
| Throttle / timeout de "Escribiendo…" | 2 s / 3.5 s |
| Duración de cada historia | 5 s; pausa con LongPress de 200 ms |
| Vida de una historia | 24 h (`expires_at` del servidor) |
| URL firmada | 1 h (se re-firma con 5 min de margen) |
| Frame a 60 FPS | 16.6 ms |
| Rendimiento medido | UI 59 fps · JS 57 fps (scroll de 200 posts) |

## Glosario exprés

- **JSI:** interfaz C++ que permite a JS llamar objetos nativos directamente, sin serializar JSON (reemplazó al Bridge).
- **Fabric / TurboModules:** renderizador y módulos nativos de la Nueva Arquitectura.
- **Hermes / `.hbc`:** motor JS de RN; el bundle se precompila a bytecode.
- **Worklet:** función que corre en el runtime JS del **UI thread** (Reanimated).
- **SharedValue:** valor compartido entre UI thread y JS thread.
- **RLS:** Row Level Security, políticas por fila en Postgres evaluadas con `auth.uid()`.
- **`security definer` / `invoker`:** la función corre con permisos del creador / del que la llama.
- **WAL:** registro de cambios de Postgres que lee Realtime.
- **Outbox:** tabla local de operaciones pendientes de enviar.
- **Idempotente:** ejecutar N veces = ejecutar 1 vez.
- **LRU:** desalojar lo usado hace más tiempo.
- **Throttle / debounce:** máximo 1 vez cada X / solo tras X sin actividad.
- **Microtarea / macrotarea:** Promises (se vacían antes) / timers y eventos.
- **Stale closure:** función que captura un valor de estado viejo.

---

# Parte 0 — Fundamentos que aplican a TODO el proyecto

## 0.1 Stack tecnológico y por qué

| Pieza | Elección | Justificación |
|---|---|---|
| Framework | **Expo SDK 57** (React Native 0.86, React 19.2) | Requisito: correr en Expo Go. Expo es el framework recomendado por la documentación oficial de React Native. |
| Lenguaje | **TypeScript** (modo `strict`) | Los contratos entre capas (interfaces de repositorio) se verifican en compilación. |
| Navegación | **expo-router** (basado en React Navigation) | Rutas basadas en archivos + deep linking automático: cada archivo en `src/app/` ES una URL. |
| Backend | **Supabase** (Postgres + Auth + Storage + Realtime) | Requisito del Módulo 4 (Supabase Realtime). Postgres permite seguridad por filas (RLS). |
| Estado global | **Zustand** | Mínimo, explícito, vive fuera del árbol de React (lo pueden usar servicios no-React como el motor de sincronización). |
| BD local | **expo-sqlite** | Requisito del Módulo 3 (SQLite para la cola offline). Incluido en Expo Go. |
| Listas | **@shopify/flash-list v2** | Reciclaje de celdas → 60 FPS en listas largas (Módulo 2). |
| Archivos | **expo-file-system** (API nueva `File`/`Paths`) | Caché de imágenes en disco con descargas cancelables por `AbortSignal` (Módulo 2). |
| Red | **@react-native-community/netinfo** | Detectar pérdida/recuperación de conexión (Módulo 3). |
| Animaciones | **react-native-reanimated 4** + **gesture-handler** | Animaciones en el UI thread (Stories, Módulo 5). |

**Restricción clave de Expo Go:** Expo Go es una app ya compilada que trae un conjunto FIJO de módulos nativos. No se puede agregar código nativo propio (Java/Kotlin/Swift). Por eso **todas** las librerías con código nativo se eligieron de la lista incluida en Expo Go, y siempre se instalan con `npx expo install <paquete>`, que elige la versión compatible con el SDK (no `npm install` a secas, que podría traer una versión cuyo código nativo no coincide con el de Expo Go).

Las librerías 100% JavaScript (Zustand, supabase-js) sí se pueden instalar libremente porque no tienen parte nativa.

## 0.2 Los hilos en React Native (LA pregunta más importante)

Una app React Native tiene **varios hilos**. Hay que saber qué corre en cada uno:

| Hilo | Qué hace | Si se bloquea… |
|---|---|---|
| **UI Thread / Main Thread** (hilo principal del SO) | Dibuja las vistas nativas, procesa toques y gestos, ejecuta animaciones nativas. Android exige que solo este hilo toque las vistas. | La app se "congela" visualmente: se pierden frames (bajan los FPS), y si dura >5 s Android muestra **ANR** (App Not Responding). |
| **JS Thread** (motor Hermes) | Ejecuta TODO nuestro código TypeScript: componentes React, lógica, stores, casos de uso, callbacks de red. **Es un único hilo** con un *event loop*. | La UI sigue dibujándose (scroll nativo sigue), pero la app no responde a eventos: toques no hacen nada, estados no se actualizan. |
| **Hilos nativos de fondo** (background threads) | Red (OkHttp en Android), SQLite, lectura/escritura de disco, decodificación de imágenes. | No afectan a la UI: están diseñados justamente para trabajo pesado. |
| **Hilo de layout / render de Fabric** | Calcula el layout (Yoga) y prepara el árbol de vistas. | — |

### Conceptos clave para explicar

- **JavaScript es single-threaded.** No hay "hilos" en nuestro código TS. Cuando decimos que algo corre "en background", significa que **JS le pide el trabajo a un módulo nativo**, el módulo lo ejecuta en un hilo nativo de fondo, y JS recibe una **Promise** que se resuelve después. Mientras tanto el event loop de JS queda **libre** para procesar otros eventos.
- **`await` NO bloquea el hilo.** `await fetch(...)` suspende solo esa función asíncrona; el event loop sigue atendiendo toques, renders, timers. Por eso la pantalla de login sigue respondiendo mientras espera a Supabase.
- **Lo que SÍ bloquea el hilo JS:** cálculos síncronos pesados (ordenar 100.000 elementos, `JSON.parse` de un JSON gigante, loops largos), o APIs síncronas nativas (p. ej. `openDatabaseSync` con consultas pesadas).
- **Regla de oro:** trabajo pesado → hilo nativo (vía API async). Animaciones → UI thread (Reanimated). JS thread → solo coordinar.

## 0.3 Nueva Arquitectura (JSI, Fabric, TurboModules)

Desde React Native 0.76 la Nueva Arquitectura está activa por defecto, y en RN 0.86 (nuestro SDK 57) **la arquitectura antigua ya no existe**.

- **Arquitectura antigua ("el Bridge"):** JS y nativo se comunicaban mandando mensajes **JSON serializados**, **asíncronos** y en lotes por un "puente". Cada llamada costaba serializar/deserializar, y nunca se podía llamar a nativo de forma síncrona.
- **JSI (JavaScript Interface):** una capa en C++ que permite que JS tenga **referencias directas a objetos C++/nativos** y llame a sus métodos **sin serializar**, incluso de forma síncrona si hace falta.
- **Fabric:** el nuevo renderizador. Puede renderizar de forma síncrona cuando es necesario (p. ej. medir layout), soporta las características concurrentes de React 18/19.
- **TurboModules:** los módulos nativos se cargan **perezosamente** (solo cuando se usan por primera vez), lo que acelera el arranque.

Relevancia en el proyecto: `expo-sqlite`, `expo-file-system` y Reanimated usan JSI. FlashList v2 aprovecha que Fabric puede **medir el layout de forma síncrona**, por eso ya no necesita la propiedad `estimatedItemSize` que requería la v1.

## 0.4 Hermes y el bytecode

Hermes es el motor JavaScript de React Native (optimizado para móviles). Al compilar la app (`npx expo export`), el JS se convierte en **bytecode Hermes (`.hbc`)** en el computador. Consecuencia: el celular **no tiene que parsear ni compilar JavaScript al arrancar** → arranque más rápido y menos memoria. (Comprobado: nuestro bundle de Android es `entry-*.hbc` de 4.6 MB.)

En desarrollo con Expo Go el código se sirve desde Metro (el servidor de desarrollo) y se ejecuta igualmente sobre Hermes.

## 0.5 React Compiler

En `app.json` está activo `"experiments": { "reactCompiler": true }`.

- Sin compilador: en cada render de un componente, React re-crea todas las funciones y objetos, y re-renderiza a todos los hijos aunque sus props "no hayan cambiado de verdad". Para evitarlo se usaba `React.memo`, `useMemo` y `useCallback` **a mano**.
- **Con React Compiler:** un plugin de Babel analiza cada componente **en tiempo de compilación** y le inserta memoización automática. Callbacks y objetos mantienen la misma referencia entre renders si sus dependencias no cambian, y los hijos no se re-renderizan sin necesidad.
- **Por qué importa para los 60 FPS:** a 60 FPS cada frame dura **16.6 ms**. Si durante el scroll el hilo JS re-renderiza celdas innecesariamente, se come ese presupuesto. Menos renders = más margen.
- Contrapregunta posible: *"¿entonces nunca usas `memo`?"* → El compilador cubre la mayoría de los casos; donde necesitemos garantizarlo explícitamente (p. ej. celdas de la lista) lo documentaremos en esa fase.

## 0.6 Clean Architecture en este proyecto

```
src/
├── domain/          ← NÚCLEO. TypeScript puro. No importa React, Supabase ni SQLite.
│   ├── entities/        Profile, (Post, Comment, Message… en fases siguientes)
│   ├── repositories/    INTERFACES (contratos): AuthRepository, ProfileRepository
│   └── errors.ts        AppError: error de dominio con mensaje para el usuario
├── data/            ← IMPLEMENTACIONES de los contratos del dominio
│   ├── remote/          supabaseClient.ts (único lugar que crea el cliente)
│   ├── mappers/         fila de Postgres (snake_case) → entidad (camelCase)
│   └── repositories/    SupabaseAuthRepository, SupabaseProfileRepository
├── di/
│   └── container.ts     COMPOSITION ROOT: único archivo que conecta interfaz ↔ implementación
├── presentation/    ← UI que NO es una ruta
│   ├── components/      PrimaryButton, TextField, Placeholder
│   ├── stores/          sessionStore (Zustand)
│   └── theme.ts         colores, espaciados, tipografía
└── app/             ← RUTAS de expo-router (cada archivo = una pantalla/URL)
```

### Regla de dependencia

Las dependencias apuntan **hacia adentro**: `app/presentation → domain ← data`. El dominio no conoce a nadie.

Ejemplo real — flujo del login:
```
login.tsx  ──usa──▶  authRepository (tipo: AuthRepository, interfaz del DOMINIO)
                              ▲
                              │ implementa
               SupabaseAuthRepository (capa DATA) ──▶ supabase-js
```
La pantalla **no sabe que existe Supabase**. Si cambiáramos a Firebase, solo se escribe `FirebaseAuthRepository` y se cambia una línea en `di/container.ts`.

### Principios SOLID que aparecen

- **D — Inversión de Dependencias:** la UI depende de una abstracción (`AuthRepository`), no de una concreción.
- **S — Responsabilidad Única:** el repositorio habla con la red; el mapper transforma datos; la pantalla solo pinta y reacciona.
- **O — Abierto/Cerrado:** se agregan implementaciones nuevas sin modificar la UI.

### Mappers (`data/mappers/profileMapper.ts`)

Postgres usa `snake_case` (`full_name`, `is_private`); el dominio usa `camelCase` (`fullName`, `isPrivate`). El mapper `toProfile(row)` es la **frontera**: si mañana cambia una columna, solo se toca el mapper. `ProfileRow` (la forma de la fila) es un tipo **privado de la capa de datos**.

### Traducción de errores (`AppError`)

`SupabaseAuthRepository.toAppError()` convierte errores del proveedor ("Invalid login credentials") en `AppError` con mensaje en español y un `code` (`network`, `auth`, `validation`…). La UI solo muestra `e.message`; nunca interpreta errores de Supabase.

## 0.7 Gestión de estado: los 4 tipos de estado

Distinguir **dónde vive cada estado** es una pregunta típica:

| Tipo | Dónde vive | Ejemplo en el proyecto |
|---|---|---|
| **Estado local de UI** | `useState` dentro del componente | Campos del formulario de login (`email`, `password`, `loading`). Solo le importan a esa pantalla. |
| **Estado global de cliente** | **Zustand** (`presentation/stores`) | Sesión: `status`, `userId`, `profile`. Lo necesitan muchas pantallas y servicios. |
| **Estado de navegación** | expo-router / React Navigation | Qué pantallas hay en cada pila, parámetros de ruta (`useLocalSearchParams`). |
| **Estado persistente / servidor** | Postgres (remoto) y SQLite (local, desde la Fase 3) | Posts, likes, mensajes. SQLite será la fuente de verdad local (offline-first). |

### ¿Por qué Zustand y no Context o Redux?

- **Context de React:** cuando cambia el valor, **re-renderiza a TODOS los consumidores**, aunque solo usen una parte. Además solo es accesible desde componentes.
- **Redux Toolkit:** potente, pero mucho boilerplate (slices, actions, reducers, Provider).
- **Zustand:**
  - El store es un objeto **fuera del árbol de React**. Se lee con `useSession.getState()` desde **cualquier módulo** (clave para el motor de sincronización offline, que no es un componente).
  - Los componentes se suscriben con **selectores**: `useSession((s) => s.status)`. Internamente usa `useSyncExternalStore` de React; compara el resultado del selector con `Object.is`, y **solo re-renderiza si ese valor cambió**. Ej.: `RootLayout` selecciona solo `status`, así que cuando llega el `profile` NO se re-renderiza.
  - No necesita Provider.

---

# Fase 1 — Setup, backend (Supabase) y autenticación

## 1.1 Creación del proyecto

- Comando: `npx create-expo-app@latest instagram-clone --template default@sdk-57`.
- Se eliminaron los ejemplos de la plantilla (componentes, hooks, `scripts/reset-project.js`).
- `app.json`: `name: "InstagramClone"`, `scheme: "instagramclone"` (para deep links), `userInterfaceStyle: "light"`.
- Variables de entorno en `.env.local` (ignorado por git):
  - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  - El prefijo `EXPO_PUBLIC_` hace que Metro las **incruste en el bundle en tiempo de compilación** (por eso se leen como `process.env.EXPO_PUBLIC_X` literal).
- Entorno: el proyecto vive en WSL. WSL usa red NAT, el celular no alcanza su IP, por eso Metro se arranca con `--tunnel` (`scripts/start-phone.sh`).

## 1.2 Esquema de la base de datos (`supabase/schema.sql`)

Se creó el esquema **completo** de todos los módulos de una vez.

### Tablas

| Tabla | Propósito | Detalles importantes |
|---|---|---|
| `profiles` | Datos públicos del usuario | `id` = `auth.users.id`. `username` UNIQUE con CHECK `^[a-z0-9._]{3,30}$`. `is_private` para cuentas privadas. |
| `follows` | Relación seguidor → seguido | PK compuesta `(follower_id, following_id)`. `status` ∈ {`pending`, `accepted`}. CHECK que impide seguirse a sí mismo. |
| `posts` | Publicaciones | `image_path` (ruta en el bucket, NO URL). Contadores `like_count`, `comment_count` desnormalizados. |
| `likes` | Likes | PK `(post_id, user_id)` → **un like por usuario**, y reintentar el mismo like no duplica. |
| `comments` | Comentarios | `parent_id` referencia a otro comentario → **comentarios anidados** (respuestas). |
| `stories` | Historias | `expires_at` default `now() + 24 horas`. |
| `conversations` | Chat 1-a-1 | `user_a < user_b` (CHECK) + UNIQUE → **par canónico**, evita tener A-B y B-A duplicadas. `last_message_at` para ordenar la bandeja. |
| `messages` | Mensajes | `delivered_at`, `read_at` para "Entregado" y "Visto". |

### IDs generados en el cliente (clave para el Módulo 3)

Los posts, comentarios y mensajes aceptan un `id` UUID que genera **la app**. Así, si la cola offline reintenta enviar el mismo comentario dos veces (p. ej. se cayó la red justo después de que el servidor lo guardó pero antes de recibir la respuesta), el segundo intento choca con la PK y se ignora (`on conflict do nothing`). Esto se llama **idempotencia**: ejecutar la operación N veces tiene el mismo efecto que ejecutarla 1 vez.

### Índices

- `posts (author_id, created_at desc)` → perfil de un usuario ordenado por fecha.
- `posts (created_at desc)` → feed/explorar.
- `comments (post_id, created_at)`, `messages (conversation_id, created_at)` → cargar los hilos en orden.

Sin índice, Postgres haría un *sequential scan* (recorrer la tabla completa) en cada consulta.

### Triggers (lógica que corre DENTRO de Postgres)

| Trigger | Cuándo | Qué hace | Por qué en el servidor |
|---|---|---|---|
| `on_auth_user_created` → `handle_new_user()` | Después de insertar en `auth.users` (registro) | Crea la fila en `profiles` con el `username` y `full_name` que llegaron como metadata del registro. | Registro + perfil quedan **atómicos**: nunca hay un usuario sin perfil. |
| `follows_before_insert` → `follows_set_initial_status()` | ANTES de insertar un follow | Pone `status = 'pending'` si la cuenta destino es privada, `'accepted'` si es pública. **Sobrescribe** lo que mande el cliente. | Un cliente malicioso no puede auto-aprobarse enviando `status='accepted'`. |
| `likes_counter` / `comments_counter` → `bump_counters()` | Después de insert/delete en `likes`/`comments` | Suma o resta 1 en `posts.like_count` / `comment_count`. | **Desnormalización:** el feed lee el número directamente, en vez de hacer `COUNT(*)` por cada post (sería N consultas extra). |
| `messages_touch` → `touch_conversation()` | Después de insertar un mensaje | Actualiza `last_message_at`, `last_message_preview`, `last_sender_id` de la conversación. | La bandeja se ordena con un simple `ORDER BY last_message_at DESC`. |

### Funciones (RPC)

- `can_view(owner)`: **la regla central de privacidad.** Devuelve `true` si: el dueño eres tú, **o** la cuenta no es privada, **o** existe un follow tuyo hacia él con `status='accepted'`.
- `is_member(conv)`: ¿el usuario actual es parte de la conversación?
- `get_or_create_conversation(other)`: obtiene o crea el chat 1-a-1 (usa `least/greatest` para el par canónico).
- `mark_delivered(conv)` / `mark_read(conv)`: el **destinatario** marca mensajes como entregados/leídos. Solo toca mensajes que **no** son suyos.
- `get_feed(p_before, p_limit)`: el feed con **paginación por cursor** (keyset): "dame 20 posts con `created_at < cursor`". Se prefiere sobre `OFFSET` porque si llegan posts nuevos mientras scrolleas, `OFFSET` repetiría o saltaría posts; el cursor no.

#### `security definer` vs `security invoker`

- **`security invoker`** (por defecto; lo usa `get_feed`): la función corre con los permisos **del usuario que la llama** → se aplican sus políticas RLS.
- **`security definer`** (lo usan `can_view`, triggers, `mark_read`…): corre con los permisos **del creador** (admin), saltándose RLS. Se usa cuando la función necesita leer/escribir cosas que el usuario no puede ver directamente, **pero valida internamente** (`auth.uid()`, `is_member`).
  - `can_view` DEBE ser `security definer`: consulta `follows`, cuya política a su vez llama a `can_view` → sin `definer` habría **recursión infinita de RLS**.
- `set search_path = ''`: buena práctica de seguridad; obliga a escribir `public.tabla` y evita que alguien "secuestre" nombres de tablas creando objetos en otro esquema.
- `stable`: indica que la función no modifica datos y devuelve lo mismo para los mismos argumentos dentro de una consulta → Postgres la puede optimizar.

## 1.3 Row Level Security (RLS) — la seguridad vive en Postgres

**Idea central:** la app móvil **no es confiable**. Cualquiera puede descompilar la app, sacar la publishable key y llamar a la API de Supabase directamente. Por eso **todas** las reglas de acceso están en Postgres con RLS: cada consulta se filtra fila por fila según `auth.uid()` (el usuario del token JWT).

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | Todos los autenticados (ficha básica visible, como en IG) | (trigger) | Solo el dueño | — |
| `follows` | Si eres parte de la relación, o si está aceptada y puedes ver a alguna de las cuentas | Solo como `follower_id = tú` | **Solo el dueño de la cuenta seguida** y solo para poner `accepted` (aprobar) | Cualquiera de los dos (dejar de seguir / cancelar / **rechazar**) |
| `posts` | `can_view(author_id)` | Solo como autor | — | Solo el autor |
| `likes`, `comments` | Si puedes ver el post (el subselect a `posts` también pasa por RLS) | Como tú, sobre posts que puedes ver | — | Solo los tuyos |
| `stories` | `expires_at > now()` **y** `can_view(author_id)` | Como autor | — | Autor |
| `conversations`, `messages` | Solo participantes | Mensajes: solo como remitente y si eres miembro | Solo vía RPC `mark_*` | — |

### Flujo formal de solicitud / aprobación / rechazo (Módulo 1)

1. **Solicitud:** B pulsa "Seguir" en la cuenta privada de A → `insert into follows (follower_id=B, following_id=A)`. El trigger fuerza `status='pending'`.
2. **Mientras está pendiente:** `can_view(A)` es `false` para B → RLS oculta posts, historias, imágenes y la lista de seguidores/seguidos de A.
3. **Aprobación:** A (y solo A, por la política `follows_update`) hace `update follows set status='accepted'`.
4. **Rechazo:** A borra la fila (`follows_delete` lo permite porque A es `following_id`).

### Storage (imágenes)

- Bucket **`media` PRIVADO**: posts e historias en `<uid>/posts/<uuid>.jpg`. La política de SELECT usa `can_view(<uid de la carpeta>)`. Para mostrar una imagen, el cliente pide una **URL firmada** (temporal); Supabase solo la firma si la política lo permite. → **las imágenes de cuentas privadas están protegidas en el backend**, no solo ocultas en la UI.
- Bucket **`avatars` PÚBLICO**: las fotos de perfil se ven siempre (como en IG).
- Solo puedes subir a tu propia carpeta (`foldername[1] = auth.uid()`).
- Consecuencia importante para el Módulo 2: como las URLs firmadas **cambian** cada vez, **la llave del caché de imágenes será la ruta (`image_path`), no la URL**.

### Realtime

`alter publication supabase_realtime add table ...` para `messages`, `conversations`, `comments`, `follows`. Supabase lee el WAL (registro de cambios) de Postgres y emite los cambios por **WebSocket**. **Realtime respeta RLS**: cada suscriptor solo recibe las filas que tiene permiso de ver.

## 1.4 Cliente de Supabase (`src/data/remote/supabaseClient.ts`)

- `import 'expo-sqlite/localStorage/install'`: instala un `localStorage` global respaldado por **SQLite**. supabase-js guarda ahí el **token de sesión** (JWT + refresh token) → la sesión sobrevive a cerrar la app. La escritura ocurre en el hilo nativo de SQLite.
- `autoRefreshToken: true`: el JWT dura ~1 h; supabase-js lo renueva con un timer.
- **AppState listener:** cuando la app pasa a segundo plano, el SO puede congelar el hilo JS → los timers no son confiables. Se hace `stopAutoRefresh()` al salir y `startAutoRefresh()` al volver (`active`), que además refresca inmediatamente si el token ya venció.
- `detectSessionInUrl: false`: esa opción es para web (OAuth con redirect en la URL); en móvil no aplica.
- Si faltan las variables, se lanza un error claro al arrancar (*fail fast*).

## 1.5 Flujo de autenticación completo

### Registro (`src/app/(auth)/register.tsx`)

1. Validación local del username con la **misma regex** que el CHECK de Postgres → feedback inmediato.
2. `profileRepository.isUsernameAvailable()` → consulta `count` con `head: true` (solo pide el número, no filas).
3. `authRepository.signUp()` → envía `username` y `full_name` como **metadata** del usuario.
4. En Postgres, el trigger `handle_new_user` crea el perfil en la misma transacción.
5. Supabase devuelve una sesión → `onAuthStateChange` → store → navegación (ver abajo).

**Condición de carrera:** si dos personas piden el mismo username a la vez, ambas pasan el paso 2. La garantía real es el **UNIQUE** de Postgres: el segundo insert falla y el registro completo se revierte. El paso 2 es solo UX.

### Login (`src/app/(auth)/login.tsx`)

Estado local con `useState` (email, password, loading). `onSubmit` llama a `authRepository.signIn()`. **No hay `router.push()` después del login** — ver 1.6.

### Qué hilo hace qué durante el login

| Paso | Hilo |
|---|---|
| El dedo toca "Entrar"; feedback visual del `Pressable` | UI thread |
| `onSubmit()`, `setLoading(true)`, re-render de React | JS thread |
| Petición HTTPS a Supabase | Hilo de red nativo (OkHttp). JS queda libre esperando la Promise. |
| Guardar el token en `localStorage` (SQLite) | Hilo nativo de SQLite |
| Resolución de la Promise, `onAuthStateChange`, actualización del store | JS thread |
| Montar las nuevas pantallas (tabs) | JS calcula el árbol → Fabric → commit al UI thread |

## 1.6 Store de sesión y navegación derivada del estado

Archivo: `src/presentation/stores/sessionStore.ts`.

```ts
status: 'loading' | 'signedOut' | 'signedIn'
userId: string | null
profile: Profile | null
```

### `bootstrapSession()`

- Se llama **una vez** desde el `useEffect` del layout raíz.
- Tiene un flag `started` → **idempotente**. En desarrollo, React StrictMode ejecuta los efectos dos veces; sin el flag tendríamos dos suscripciones.
- Se suscribe a `authRepository.onAuthStateChange`. supabase-js emite **`INITIAL_SESSION`** apenas te suscribes (con la sesión restaurada desde el disco, o `null`) y luego `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`… Por eso no hace falta llamar aparte a `getSession()`.

### El `setTimeout(0)` en `SupabaseAuthRepository.onAuthStateChange`

supabase-js ejecuta el callback de `onAuthStateChange` **mientras mantiene un lock interno** de la sesión. Si dentro del callback se llama a otra función de Supabase que también necesita ese lock (p. ej. consultar el perfil), **se queda esperando para siempre → deadlock**. `setTimeout(listener, 0)` agenda el trabajo en el **siguiente turno del event loop**, cuando el lock ya se liberó.

### `refreshMyProfile()` y la condición de carrera

Después de `await profileRepository.getById(userId)` se comprueba `if (useSession.getState().userId === userId)`. Si durante la espera el usuario cerró sesión (o cambió de cuenta), la respuesta vieja se **descarta** en vez de sobrescribir el estado nuevo. Es un patrón general: **tras un `await`, el mundo pudo haber cambiado**.

### Navegación derivada del estado (`src/app/_layout.tsx`)

```tsx
<Stack.Protected guard={status === 'signedIn'}> (tabs), inbox, chat, stories </Stack.Protected>
<Stack.Protected guard={status === 'signedOut'}> (auth) </Stack.Protected>
```

- `Stack.Protected`: si el `guard` es `false`, esas rutas **no existen**; si estás en una de ellas, el router te redirige a la primera ruta disponible.
- Login exitoso → store pasa a `signedIn` → cambian las rutas disponibles → aparecen las tabs. **Nadie llama a `router.push`.** La UI es una **función del estado**: `UI = f(estado)`.
- Ventajas: imposible quedar en una pantalla protegida sin sesión; si el token expira o se revoca, Supabase emite `SIGNED_OUT` y el usuario vuelve al login automáticamente; el botón "atrás" no puede regresar al login estando logueado.
- Mientras `status === 'loading'` el layout devuelve `null` y el **splash screen** sigue visible (`preventAutoHideAsync` / `hideAsync`) → no hay "parpadeo" del login antes de restaurar la sesión.
- `(auth)/_layout.tsx` tiene `unstable_settings = { initialRouteName: 'login' }` → al cerrar sesión se llega al login y no a registro.

---

# Fase 2 — Navegación: tabs con pilas independientes y deep linking

## 2.1 Árbol de navegación

```
Stack RAÍZ (src/app/_layout.tsx)
├── (auth)          [solo si signedOut]  → Stack: login, register
├── (tabs)          [solo si signedIn]   → Tabs (barra inferior)
│   ├── (home)      → Stack propia: index (feed), post/[id], user/[id], comments/[postId]
│   ├── (explore)   → Stack propia: explore, post/[id], user/[id], comments/[postId]
│   ├── create      → pantalla simple (nueva publicación)
│   ├── (activity)  → Stack propia: activity, post/[id], user/[id], comments/[postId]
│   └── (profile)   → Stack propia: profile, post/[id], user/[id], comments/[postId]
├── inbox           → bandeja de DMs (encima de las tabs)
├── chat/[id]       → conversación
└── stories/[userId] → visor de historias (modal a pantalla completa, animación fade)
```

**¿Por qué DMs e historias están en la pila RAÍZ y no dentro de una tab?** Porque se apilan **encima** del navegador de tabs → la barra inferior queda oculta (igual que en Instagram). Y al cerrarlas vuelves exactamente a la tab y pila donde estabas.

## 2.2 Conceptos de expo-router

- **Rutas basadas en archivos:** cada archivo en `src/app/` es una pantalla y una URL. `post/[id].tsx` → `/post/123`, y `useLocalSearchParams()` devuelve `{ id: '123' }`.
- **`_layout.tsx`:** define el **navegador** (Stack, Tabs) que envuelve a las pantallas de esa carpeta.
- **Grupos `(nombre)`:** carpetas entre paréntesis organizan rutas **sin aparecer en la URL**. `(tabs)/(home)/index.tsx` es la URL `/`.
- **Typed routes** (`experiments.typedRoutes`): expo-router genera tipos de TS para todos los `href`; un link a una ruta inexistente es error de compilación.

## 2.3 Barra inferior (`src/app/(tabs)/_layout.tsx`)

- `Tabs` de expo-router (**tabs JavaScript**, basadas en `@react-navigation/bottom-tabs`, incluidas en expo-router desde SDK 56).
- **¿Por qué no `NativeTabs`?** (la plantilla traía `NativeTabs`, que usa la barra nativa del SO): está marcado como `unstable` y da poco control visual. Con `Tabs` replicamos Instagram: 5 íconos, sin texto (`tabBarShowLabel: false`), ícono relleno si está activo y contorno si no.
- Íconos: `Ionicons` de `@expo/vector-icons` (fuente de íconos). `icon(activo, inactivo)` es una *factory* que devuelve un componente con nombre (`TabIcon`) por la regla de lint `react/display-name`.
- **Comportamiento:**
  - Cada pestaña se monta **perezosamente** (la primera vez que la visitas) y luego **queda montada** → su estado y su pila se conservan al cambiar de tab.
  - Tocar la pestaña que ya está activa hace **pop-to-top** de su pila (comportamiento por defecto de React Navigation).

## 2.4 Pilas independientes por pestaña — *Shared Routes*

Archivo: `src/app/(tabs)/(home,explore,activity,profile)/_layout.tsx`.

### El problema

Desde cualquier pestaña se puede abrir un post, un perfil o los comentarios. Si esas pantallas estuvieran en una sola pila global, abrir un post desde Explorar "contaminaría" el historial de Home, y al cambiar de tab se perdería dónde estabas.

### La solución

- El nombre de carpeta **con comas** `(home,explore,activity,profile)` es la sintaxis de **shared routes**: expo-router **duplica** ese layout y sus pantallas (`post/[id]`, `user/[id]`, `comments/[postId]`) dentro de **cada** grupo.
- Resultado: **4 instancias distintas de `Stack`**, una por pestaña, cada una con su propio historial y estado de navegación.
- Las pantallas raíz de cada pestaña están en carpetas separadas: `(home)/index.tsx`, `(explore)/explore.tsx`, `(activity)/activity.tsx`, `(profile)/profile.tsx`.
- Los links **relativos** (`<Link href="/post/123">`) navegan dentro de la pila de la pestaña actual. La pantalla del post muestra `Pila: (home)` o `Pila: (explore)` (con `useSegments()`) para demostrarlo.

### `unstable_settings` y `anchor`

```ts
export const unstable_settings = {
  anchor: 'index',
  explore: { anchor: 'explore' },
  activity: { anchor: 'activity' },
  profile: { anchor: 'profile' },
};
```

`anchor` define la **pantalla raíz** de cada pila. Si se entra directo a `/post/123` (por ejemplo, por un deep link), el router monta **primero la raíz debajo** y luego el post encima → el botón "atrás" lleva al feed en vez de cerrar la app.

### Prueba realizada (✅ funcionó en el dispositivo)

Home → abrir post → cambiar a Explorar → abrir otro post → volver a Home: Home sigue mostrando su post, Explorar el suyo. Cada pila es independiente.

### Estado de navegación ≠ estado global

Cambiar de pestaña **no** toca el store de Zustand. El estado de navegación lo maneja React Navigation (un objeto con las rutas de cada navegador). El estado de sesión vive en Zustand. Así se cumple "sin corromper el estado global" del enunciado.

## 2.5 Deep Linking

### Cómo funciona

1. `app.json` declara `"scheme": "instagramclone"`. En un build propio, esto registra en Android un **intent-filter**: el SO sabe que los links `instagramclone://...` abren nuestra app.
2. Cuando llega un link, expo-router lo convierte en una ruta: `instagramclone://post/<uuid>` → pantalla `post/[id]` con `id = <uuid>`.
3. **Link en frío** (app cerrada): el link llega como *intent* inicial y la app arranca directo en esa pantalla. **Link en caliente** (app abierta): llega como evento y se navega.

### `+native-intent.tsx` — interceptar el link antes del router

Archivo: `src/app/+native-intent.tsx`. Exporta `redirectSystemPath({ path, initial })`, que recibe **todo** link del sistema antes de que el router lo resuelva, y devuelve la ruta a abrir.

**¿Por qué hace falta aquí?** `post/[id]` existe en **4 pilas** (shared routes). En un link en frío no hay "pestaña actual", y la documentación de expo-router dice que se elige **la primera coincidencia en orden alfabético** → sería `(activity)`. Instagram abre los posts compartidos en Home, así que se reescribe a `/(tabs)/(home)/post/<uuid>`.

- Se usa una **regex** que acepta cualquier prefijo (`instagramclone://` o `exp://.../--/`) y valida formato UUID (36 caracteres hex/guiones).
- `try/catch` que devuelve `/`: un link malformado **nunca** debe tumbar la app.
- También intercepta `user/<uuid>` → perfil.

### ⚠️ Limitación de Expo Go (saber explicarla)

En Expo Go, la app instalada en el celular es **Expo Go**, no la nuestra. El SO no conoce el scheme `instagramclone://` porque ese intent-filter solo se registra al compilar **nuestra propia app** (development build o APK con `eas build`). Expo Go usa su propio scheme: el link equivalente es

```
exp://<host-de-metro>/--/post/<uuid>
```

(el `/--/` separa la dirección del servidor de la ruta de la app). **El código de ruteo es el mismo**; lo único que cambia es el prefijo. `+native-intent.tsx` acepta ambos.

### Cómo probarlo

```bash
adb shell am start -a android.intent.action.VIEW -d "exp://<host-del-tunnel>/--/post/00000000-0000-4000-8000-000000000001"
```

Con una development build: `adb shell am start -a android.intent.action.VIEW -d "instagramclone://post/<uuid>"`.

---

# Preguntas probables del profe — Fases 1 y 2

> Intenta responder tú antes de leer la respuesta.

### Arquitectura

**P1. Explícame la arquitectura de tu proyecto.**
Clean Architecture en 4 zonas: `domain` (entidades e interfaces de repositorio, TS puro), `data` (implementaciones con Supabase y SQLite, mappers), `presentation` + `app` (UI, stores, rutas) y `di/container.ts` (composition root). Las dependencias apuntan hacia el dominio. La UI usa `authRepository` tipado como la interfaz `AuthRepository`, sin saber que por debajo está Supabase.
- *Contrapregunta: "¿Qué ganas con eso, si solo usas Supabase?"* → Testabilidad (puedo inyectar un repositorio falso en pruebas), cambiar de backend tocando una línea, y separar responsabilidades: el repositorio maneja red y errores, el mapper transforma, la pantalla solo pinta.
- *Contrapregunta: "¿Dónde está la inyección de dependencias?"* → `di/container.ts` instancia las implementaciones concretas y las exporta tipadas como interfaces. Es inyección manual (sin framework); el contenedor es el único lugar que conoce las clases concretas.

**P2. ¿Para qué sirve el mapper?**
Traduce la fila de Postgres (`snake_case`, `ProfileRow`) a la entidad de dominio (`camelCase`, `Profile`). Aísla al dominio del esquema de la base de datos.

### Hilos

**P3. Cuando haces login, ¿qué pasa en cada hilo?**
Toque y feedback visual → UI thread. `onSubmit` y render → JS thread. La petición HTTP la ejecuta OkHttp en un hilo nativo de red; JS queda libre porque solo espera una Promise. El token se guarda en SQLite en su hilo nativo. Al resolverse la Promise, el callback vuelve al JS thread, actualiza el store y React calcula el nuevo árbol, que Fabric aplica en el UI thread.
- *Contrapregunta: "¿`await` bloquea el hilo?"* → No. Suspende esa función async; el event loop sigue atendiendo otros eventos.
- *Contrapregunta: "¿Entonces JS es multihilo?"* → No, es single-threaded. La concurrencia la da el event loop + el trabajo delegado a hilos nativos.

**P4. ¿Qué es JSI y qué cambió respecto al Bridge?**
El Bridge mandaba mensajes JSON serializados y asíncronos entre JS y nativo. JSI es una interfaz C++ que da a JS referencias directas a objetos nativos: sin serialización y con posibilidad de llamadas síncronas. En RN 0.86 el Bridge ya no existe.

### Estado

**P5. ¿Cómo manejas el estado?**
Cuatro niveles: local (`useState`, p. ej. el formulario), global de cliente (Zustand: sesión), navegación (React Navigation) y persistente (Postgres/SQLite).
- *Contrapregunta: "¿Por qué Zustand y no Context?"* → Context re-renderiza a todos los consumidores cuando cambia el valor; Zustand usa selectores y solo re-renderiza si cambia lo seleccionado. Además el store es accesible fuera de React con `getState()`, lo que necesita el motor de sincronización offline.
- *Contrapregunta: "¿Cómo sabe Zustand cuándo re-renderizar?"* → Usa `useSyncExternalStore`; en cada cambio ejecuta el selector y compara con `Object.is` contra el valor anterior.

**P6. ¿Por qué no hay un `router.push` después del login?**
Porque la navegación se deriva del estado. `Stack.Protected` con `guard={status === 'signedIn'}` hace que las rutas existan o no según la sesión. Cambia el store → cambian las rutas.
- *Contrapregunta: "¿Y si el token expira mientras uso la app?"* → supabase-js intenta refrescarlo; si falla emite `SIGNED_OUT`, el store pasa a `signedOut` y el guard te manda al login sin código extra.

**P7. ¿Para qué es el `setTimeout(0)` en `onAuthStateChange`?**
supabase-js ejecuta ese callback con un lock interno tomado. Llamar a Supabase dentro (p. ej. cargar el perfil) espera ese mismo lock → deadlock. `setTimeout(0)` difiere la ejecución al siguiente turno del event loop, cuando el lock ya se liberó.

**P8. En `refreshMyProfile`, ¿por qué comparas el `userId` después del `await`?**
Porque mientras se esperaba la red, el usuario pudo cerrar sesión o cambiar de cuenta. Si no se compara, la respuesta vieja sobrescribiría el estado nuevo (condición de carrera). Regla: después de un `await`, verificar que el contexto sigue siendo válido.

### Seguridad y backend

**P9. Tu publishable key está dentro de la app. ¿No es inseguro?**
Es pública por diseño; solo identifica el proyecto. La seguridad la dan las políticas RLS en Postgres, evaluadas con el JWT del usuario (`auth.uid()`). Aunque alguien use la key directamente, solo verá las filas que RLS le permita.
- *Contrapregunta: "¿Qué llave NO debe estar en la app?"* → La `service_role` / secret key: salta RLS.

**P10. ¿Cómo funcionan las cuentas privadas?**
`profiles.is_private` + tabla `follows` con `status`. La función `can_view(owner)` decide el acceso y la usan las políticas de `posts`, `stories`, `likes`, `comments`, `follows` y del bucket `media`. Un trigger fuerza `pending` si la cuenta destino es privada. Solo el dueño puede aprobar (`follows_update`), y rechazar es borrar la fila.
- *Contrapregunta: "¿Y si el cliente manda `status: 'accepted'` al seguir?"* → El trigger `BEFORE INSERT` lo sobrescribe según la privacidad real.
- *Contrapregunta: "¿Y las imágenes? Alguien podría adivinar la URL."* → El bucket es privado: sin URL firmada no hay acceso, y Supabase solo firma si `can_view` lo permite. Las URLs firmadas además caducan.

**P11. ¿Qué es `security definer` y por qué `can_view` lo usa?**
La función corre con los permisos de su creador y salta RLS. `can_view` consulta `follows`, y la política de `follows` llama a `can_view`: sin `definer` habría recursión infinita. Es seguro porque la función solo devuelve un booleano calculado con `auth.uid()`.

**P12. ¿Qué pasa si dos usuarios se registran con el mismo username al mismo tiempo?**
Los dos pasan la verificación previa (es solo UX), pero el `UNIQUE` de Postgres hace fallar el segundo insert del trigger, y el registro completo se revierte porque va en la misma transacción.

**P13. ¿Por qué los contadores de likes están en `posts` y no se calculan con COUNT?**
Desnormalización para lectura: el feed muestra N posts y sería caro hacer N `COUNT(*)`. Un trigger mantiene el contador sincronizado dentro de la misma transacción del insert/delete.

**P14. ¿Por qué el feed pagina con cursor y no con OFFSET?**
Con OFFSET, si entran posts nuevos mientras scrolleas, la página siguiente se desplaza y se repiten posts. El cursor (`created_at < último visto`) es estable y además usa el índice (no recorre las filas saltadas).

### Navegación

**P15. ¿Cómo logras que cada pestaña tenga su propia pila?**
Con shared routes: la carpeta `(home,explore,activity,profile)` hace que expo-router duplique el layout Stack y sus pantallas en cada grupo, así que son 4 navegadores Stack distintos. El navegador de Tabs mantiene montadas las pestañas visitadas, así que cada pila conserva su historial.
- *Contrapregunta: "¿Qué pasa en memoria si las 4 pilas están montadas?"* → Las pantallas de pilas no visibles siguen montadas en memoria. react-native-screens desprende sus vistas nativas de la jerarquía visible, así que no se dibujan ni cuestan frames, pero su estado React se conserva. Es el trade-off para conservar el estado; en la Fase 5 el caché con LRU limita la memoria de las imágenes.
- *Contrapregunta: "¿Qué pasa si toco la pestaña donde ya estoy?"* → Pop-to-top de esa pila.

**P16. ¿Qué es `anchor`?**
La pantalla raíz de cada pila. Si entras por deep link directo a un post, se monta la raíz debajo y "atrás" funciona.

**P17. ¿Cómo funciona el deep linking? ¿Por qué no funciona `instagramclone://` en Expo Go?**
El scheme de `app.json` se registra como intent-filter al compilar nuestra app. En Expo Go la app instalada es Expo Go, que solo responde a `exp://`. Por eso el link es `exp://host/--/post/<uuid>`. El ruteo (la parte que escribimos) es idéntico; con una development build funciona `instagramclone://`.
- *Contrapregunta: "¿Para qué es `+native-intent.tsx`?"* → Recibe el link antes que el router. Como `post/[id]` existe en 4 pilas, en frío se abriría en `(activity)` (orden alfabético); lo reescribimos a la pila de Home. También valida el formato con regex y ante un link malformado va a `/` en vez de fallar.
- *Contrapregunta: "¿Qué pasa si llega un deep link y no hay sesión?"* → `Stack.Protected` no deja entrar a las tabs y redirige al login. Pero `+native-intent` **recuerda** el destino (`pendingDeepLink.ts`) y, cuando la sesión pasa de `signedOut` a `signedIn`, el layout raíz lo abre (Fase 8, sección 8.2).

### Rendimiento / plataforma

**P18. ¿Qué es el archivo `.hbc`?**
Bytecode de Hermes: el JS se precompila al empaquetar, así que el celular no parsea JS al arrancar, lo que da un inicio más rápido y usa menos memoria.

**P19. ¿Qué hace el React Compiler?**
Memoiza componentes, callbacks y valores automáticamente en tiempo de compilación, lo que evita renders innecesarios. Con 16.6 ms por frame a 60 FPS, cada render ahorrado da margen al hilo JS.

---

# Fase 3 — Base de datos local y cola de sincronización offline (Módulo 3)

## 3.1 Qué pide el enunciado y cómo se cumple

| Requisito | Cómo se cumple |
|---|---|
| "Las peticiones de red deben encapsularse en una cola de sincronización local utilizando una base de datos embebida (SQLite)" | Tabla `outbox` en SQLite (`expo-sqlite`). La UI nunca llama a Supabase para likes/comentarios: **encola una intención**. |
| "Si el dispositivo pierde la conexión, las acciones se almacenan" | La operación se escribe en SQLite **antes** de intentar la red. Sobrevive a no tener internet y a que la app se cierre. |
| "…y se procesan en segundo plano" | El `SyncEngine` drena la cola sin bloquear la UI: todo su trabajo es I/O delegado a hilos nativos (SQLite y red). Ver 3.8 sobre los límites del "segundo plano" en Expo Go. |
| "…en riguroso orden cronológico" | `ORDER BY id` (AUTOINCREMENT), **una operación a la vez**, y si una falla por red **la cola se detiene** (no se salta a la siguiente). |
| "…tan pronto como la conectividad se restablezca" | NetInfo avisa el cambio de red → `kick()` → drenado inmediato. También al volver la app a primer plano. |
| "…resolviendo conflictos de estado sin corromper la base de datos remota" | Operaciones **idempotentes** (IDs del cliente + `ON CONFLICT DO NOTHING`, likes como estado deseado), **coalescencia** de likes, **clasificación de errores** (transitorio / permanente / duplicado), y las reglas del servidor (RLS, FK, UNIQUE) como última defensa. |

## 3.2 Archivos de esta fase

```
src/
├── core/
│   ├── concurrency/Mutex.ts        Mutex asíncrono (cadena de Promises)
│   ├── network/networkMonitor.ts   Envoltura de NetInfo: online/offline sin ruido
│   └── ids.ts                      newId(): UUID v4 con expo-crypto
├── domain/
│   ├── sync/SyncOperation.ts       Unión discriminada de operaciones + coalesceKeyOf()
│   └── repositories/SyncQueue.ts   Contrato de la cola (enqueue, onStatusChange, onPermanentFailure, clearFailed)
├── data/
│   ├── local/database.ts           Conexión única, PRAGMAs, migraciones, write()/writeTransaction()
│   ├── local/OutboxDao.ts          Todo el SQL de la tabla outbox
│   └── sync/
│       ├── syncErrors.ts           RemoteError, ensureOk(), classifyError()
│       ├── operationHandlers.ts    Un ejecutor idempotente por tipo de operación
│       └── SyncEngine.ts           El motor: drenado, orden, reintentos, backoff, eventos
├── di/container.ts                 syncEngine (singleton) expuesto como SyncQueue
└── presentation/
    ├── stores/syncStore.ts         Puente motor → Zustand (estado reactivo para la UI)
    └── components/
        ├── SyncBanner.tsx          Píldora "Sin conexión · N pendientes" / "Sincronizando…"
        └── SyncDiagnostics.tsx     Panel de demostración en el perfil
```

## 3.3 El patrón: *Transactional Outbox*

```
  Usuario toca ♥
       │
       ▼
  [UI optimista]  ── actualiza el estado en memoria al instante (0 ms)   ← Fase 4
       │
       ▼
  syncQueue.enqueue({ type: 'SET_LIKE', payload: { postId, liked: true } })
       │
       ▼
  SQLite: INSERT INTO outbox …        ← DURABLE: ya no se pierde aunque se cierre la app
       │
       ▼
  syncEngine.kick()  ──(¿online? ¿app activa? ¿no hay otro drenado?)──▶  drain()
       │
       ▼
  loop: nextPending() → markInflight() → executeOperation() → Supabase
             │                                   │
             │                ┌──────────────────┼────────────────────┐
             │                ▼                  ▼                    ▼
             │            éxito / duplicado   permanente          transitorio
             │            remove(id)          markFailed(id)      markRetry(id)
             │                                + evento rollback   + backoff + BREAK
             └──────────────── siguiente ◀──────────┘
```

**Idea central:** separar **"lo que el usuario quiere"** (la intención, guardada localmente al instante) de **"cuándo se entera el servidor"** (cuando haya red). Por eso la UI puede responder en 0 ms: no espera a la red para nada.

## 3.4 La base de datos local (`src/data/local/database.ts`)

### Conexión única con la *Promise* memorizada

```ts
let dbPromise: Promise<SQLiteDatabase> | null = null;
export function getDb() { dbPromise ??= open(); return dbPromise; }
```
Se guarda la **Promise**, no la conexión. Si durante el arranque el motor y una pantalla llaman a `getDb()` al mismo tiempo, ambos esperan **la misma** apertura. Si se guardara la conexión (que solo existe después del `await`), las dos llamadas verían `null` y abrirían dos conexiones y correrían las migraciones dos veces.

### PRAGMAs

| PRAGMA | Qué hace | Por qué |
|---|---|---|
| `journal_mode = WAL` | *Write-Ahead Logging*: las escrituras van a un archivo aparte (`-wal`) y luego se integran. | Los **lectores no bloquean al escritor** ni viceversa. La UI puede leer mientras la cola escribe. |
| `busy_timeout = 5000` | Si la BD está bloqueada, SQLite espera hasta 5 s en vez de devolver `SQLITE_BUSY` al instante. | Robustez ante bloqueos breves. |
| `foreign_keys = ON` | SQLite ignora las FK por defecto; esto las activa. | Integridad para las tablas de caché de las próximas fases. |

### Migraciones versionadas (`PRAGMA user_version`)

- `MIGRATIONS` es un arreglo; la posición `i` lleva la BD de la versión `i` a la `i+1`.
- Al abrir: se lee `user_version` y se aplican **solo las que faltan**, cada una en una transacción **junto con** la actualización de `user_version` → o se aplican ambas o ninguna. Si la app muere a mitad de una migración, al reabrir se repite limpia.
- Regla: **nunca editar una migración que ya corrió** en algún dispositivo; siempre agregar una nueva al final.

### Tabla `outbox` (migración v1)

| Columna | Para qué |
|---|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` | **Orden cronológico.** AUTOINCREMENT garantiza que los ids nunca se reutilizan y siempre crecen. |
| `user_id` | Dueño de la operación. Si cierras sesión y entra otra persona, **nunca** se ejecutan las operaciones de la sesión anterior con el token de la nueva. |
| `type`, `payload` | La operación serializada (JSON). |
| `coalesce_key` | Para fusionar operaciones de estado (`like:<postId>`). |
| `status` | `pending` → `inflight` → (se borra al tener éxito) / `failed`. |
| `attempts`, `last_error` | Diagnóstico y backoff. |
| `created_at` | Informativo (NO se usa para ordenar, ver P-orden). |

Índices: `(user_id, status, id)` para que `nextPending` sea una búsqueda por índice, no un recorrido de toda la tabla.

### ¿Por qué ordenar por `id` y no por `created_at`?

`created_at` viene del **reloj del dispositivo**, que puede cambiar (el usuario lo ajusta, sincronización NTP, cambio de zona horaria). Dos operaciones podrían quedar con el orden de reloj invertido. El `id` AUTOINCREMENT es un **contador monotónico** que asigna SQLite: refleja el orden real de inserción.

## 3.5 Concurrencia en SQLite: el Mutex de escrituras

### El problema (encontrado leyendo los tipos de `expo-sqlite` instalados)

- `withTransactionAsync` **no es exclusiva**: la documentación advierte que "otras consultas async pueden ejecutarse dentro de la transacción". Motivo: entre dos `await` de la transacción, el event loop puede ejecutar código de otra tarea que use la misma conexión → esa escritura "ajena" queda dentro de nuestra transacción (y se revierte si la nuestra falla).
- `withExclusiveTransactionAsync` abre **otra conexión**, y mientras escribe, **cualquier otra escritura async falla con `database is locked`**.

Ninguna de las dos es segura si la UI y el motor escriben a la vez.

### La solución: serializar todas las escrituras en JS

`core/concurrency/Mutex.ts`:
```ts
run(task) {
  const result = this.tail.then(task);   // espera a que termine la tarea anterior
  this.tail = result.catch(() => undefined); // un fallo no traba la cola
  return result;
}
```
- Es una **cadena de Promises**: cada tarea se engancha al final de la anterior. Orden FIFO de llegada.
- **No bloquea el hilo JS**: esperar el mutex es esperar una Promise; el event loop sigue libre.
- `.catch(() => undefined)` en la cola: si una tarea lanza error, la siguiente se ejecuta igual (si no, el mutex quedaría "envenenado" para siempre). El error sí le llega a quien llamó (`result` conserva el rechazo).
- `database.ts` expone `write(task)` y `writeTransaction(task)`, y **toda** escritura del DAO pasa por ahí. Las **lecturas** van directo (WAL permite leer mientras se escribe).

**Pregunta trampa:** *"¿Para qué un mutex si JS tiene un solo hilo?"* → Porque la atomicidad en JS solo dura hasta el siguiente `await`. Un solo hilo evita que dos líneas se ejecuten en el mismo instante, pero no que dos **tareas asíncronas** se intercalen. El mutex es sobre tareas, no sobre hilos.

## 3.6 Operaciones del dominio (`src/domain/sync/SyncOperation.ts`)

### Unión discriminada

```ts
type SyncOperation =
  | { type: 'SET_LIKE';    payload: { postId; liked } }
  | { type: 'ADD_COMMENT'; payload: { id; postId; parentId; body } };
```
El campo `type` es el **discriminante**: si `op.type === 'SET_LIKE'`, TypeScript sabe que `op.payload` tiene `liked`. En `operationHandlers.ts` un **tipo mapeado** obliga a tener un ejecutor por cada `type`: agregar una operación nueva al dominio sin su ejecutor **no compila**.

Las operaciones son **intenciones serializables** (JSON), no llamadas HTTP. Se pueden guardar y ejecutar horas después.

### Idempotencia por diseño

| Operación | Por qué es idempotente |
|---|---|
| `SET_LIKE { liked: true }` | Es un **estado deseado**, no un toggle. `upsert … ignoreDuplicates` = `INSERT … ON CONFLICT DO NOTHING` sobre la PK `(post_id, user_id)`. Repetirla no crea otro like. |
| `SET_LIKE { liked: false }` | `DELETE` de algo que ya no existe afecta 0 filas: no es error. |
| `ADD_COMMENT` | El `id` (UUID) lo genera el cliente con `expo-crypto` **al encolar**. Si el reintento llega dos veces, la PK lo ignora. |

**¿Por qué un toggle NO sería idempotente?** Si la operación fuera "invertir el like" y el primer envío llegó al servidor pero la respuesta se perdió (timeout), el reintento lo invertiría otra vez → estado corrupto. Con "estado deseado", repetir es inofensivo.

### Coalescencia (`coalesceKeyOf`)

Sin red, el usuario toca el corazón 5 veces: like, unlike, like, unlike, like. Solo importa el **estado final**. Al encolar un `SET_LIKE`, dentro de la misma transacción se **borran los `SET_LIKE` pendientes del mismo post** y se inserta el nuevo → queda **1** operación. Menos tráfico, y el servidor solo ve la última intención (*last-intent-wins*).

- Solo se borran las `pending`, **nunca la `inflight`** (esa ya va camino al servidor). Si llega un `unlike` mientras el `like` está en vuelo, quedan en cola [`like` (inflight), `unlike` (pending)] → el servidor termina en el estado correcto.
- Los comentarios **no** se fusionan: cada uno es una creación distinta (`coalesceKeyOf` devuelve `null`).
- Borrado + inserción van en `writeTransaction` → nunca queda un estado intermedio sin ninguna operación.

## 3.7 El motor (`src/data/sync/SyncEngine.ts`)

### Ciclo de vida atado a la sesión

- `sessionStore` llama a `syncEngine.start(userId)` al iniciar sesión y a `stop()` al cerrarla.
- `TOKEN_REFRESHED` también llega con el mismo usuario → solo se reinicia el motor si **cambió** el `userId`.
- `start()`:
  1. `resetInflight(userId)`: si la app murió en medio de un envío, esa operación quedó `inflight`. **No sabemos si llegó** al servidor → vuelve a `pending` y se reenvía. Es seguro **porque todas las operaciones son idempotentes** (esta es la razón práctica de exigir idempotencia).
  2. Se suscribe a **NetInfo** (red) y **AppState** (primer/segundo plano).
- `stop()` cancela suscripciones y el timer de reintento. Las operaciones **se quedan** en SQLite con su `user_id` y se retoman cuando ese usuario vuelva a entrar.

### Disparadores del drenado (`kick()`)

1. Se encola una operación nueva.
2. La red vuelve (`online: false → true`). Además resetea el backoff: si la red volvió, no tiene sentido esperar 60 s.
3. La app vuelve a primer plano.
4. Vence el timer de backoff.

`kick()` no drena si: no hay sesión, no hay red, o la app no está activa.

### Un solo consumidor y el "wakeup perdido"

- `this.draining` guarda la Promise del drenado en curso → **nunca hay dos drenados en paralelo** (dos consumidores podrían tomar la misma operación, o procesar la 2ª antes de que termine la 1ª → se rompería el orden).
- **Wakeup perdido:** el drenado lee la cola, la ve vacía y está por terminar; justo entonces se encola algo y `kick()` ve `draining != null` y no hace nada → la operación quedaría esperando hasta el siguiente disparador. Solución: `kick()` deja la marca `drainRequested = true`, y al terminar el drenado (`finally`) si la marca está puesta, se vuelve a llamar a `kick()`.

### El bucle de drenado

```ts
while (this.online && this.userId === userId) {
  const next = await outboxDao.nextPending(userId);   // la más antigua
  if (!next) break;
  await outboxDao.markInflight(next.id);
  try {
    await executeOperation(next.operation, userId);   // llamada a Supabase
    await outboxDao.remove(next.id);
  } catch (error) {
    switch (classifyError(error)) { … }
  }
}
```
- La condición del `while` se **re-evalúa en cada vuelta**: entre dos `await` pudo caerse la red o cerrarse la sesión.
- **Una operación a la vez** (no `Promise.all`): el orden es más importante que la velocidad. Si "comentar" y "responder a ese comentario" se enviaran en paralelo, la respuesta podría llegar primero y fallar por FK (el padre aún no existe).

### Clasificación de errores (`syncErrors.ts`)

supabase-js **no lanza** excepciones: devuelve `{ error, status }`. Se confirmó en el código instalado de `postgrest-js` que cuando la petición ni siquiera sale (sin red) devuelve **`status: 0`**. `ensureOk()` convierte eso en un `RemoteError(message, code, status)`.

| Resultado | Condición | Acción del motor |
|---|---|---|
| **duplicate** | `code === '23505'` (unique violation) | Se trata como **éxito**: `remove()`. |
| **transient** | `status 0` (sin red), `401` (JWT vencido; supabase-js lo refresca), `408`, `429`, `5xx`, o un error que no es `RemoteError` | `markRetry()` (vuelve a `pending` **en su misma posición**), backoff, y **`break`: la cola se detiene**. |
| **permanent** | Cualquier otro 4xx: `42501` RLS (p. ej. la cuenta se volvió privada y perdí acceso), `23503` FK (el post fue borrado), `23514` CHECK, `22xxx` dato inválido | `markFailed()` (sale de la cola, *dead letter*), se emite `onPermanentFailure` para que la UI **revierta** el cambio optimista, y **se continúa** con la siguiente. |

### *Head-of-line blocking*: decisión consciente

Si la operación #1 falla por red, #2 y #3 esperan aunque quizás podrían enviarse. Es un **trade-off deliberado**: el enunciado exige orden cronológico riguroso. Y si la #1 falla por red, lo más probable es que las demás también fallen. En cambio, un fallo **permanente** no bloquea: se aparta y se sigue (si no, una operación imposible trabaría la cola para siempre).

### Backoff exponencial con *jitter*

```
retraso = min(60 s, 1 s × 2^(fallos-1))   → 1, 2, 4, 8, 16, 32, 60, 60… s
real    = retraso/2 + aleatorio(0, retraso/2)
```
- **Exponencial:** si el servidor está caído, no martillarlo cada segundo (y ahorrar batería).
- **Jitter (aleatoriedad):** si el servidor cae y vuelve, miles de clientes reintentarían **en el mismo instante** (*thundering herd*) y lo tumbarían otra vez. El jitter los reparte.
- Se reinicia a 0 con un éxito o cuando NetInfo avisa que volvió la red.

## 3.8 Hilos en la Fase 3 (qué corre dónde)

| Trabajo | Hilo |
|---|---|
| Detección del cambio de red | Hilo nativo (ConnectivityManager de Android) → evento a JS |
| `subscribeToConnectivity`, `kick()`, lógica del bucle, clasificación | JS thread (lógica ligera, microsegundos) |
| `INSERT/UPDATE/SELECT` en SQLite (`runAsync`, `getFirstAsync`) | **Hilo nativo de SQLite** (JSI). JS solo recibe la Promise. |
| Petición HTTPS a Supabase | **Hilo de red nativo** (OkHttp) |
| `setTimeout` del backoff | El timer lo gestiona el lado nativo; el callback corre en JS |
| Re-render del `SyncBanner` | JS (React) → Fabric → UI thread |

**Clave:** el motor pasa casi todo su tiempo **esperando** I/O nativo. Entre cada `await` el hilo JS queda libre, por eso la UI no se traba aunque se estén sincronizando 100 operaciones.

### Honestidad sobre el "segundo plano" (contrapregunta segura)

- El motor corre **mientras el proceso de la app está vivo**: en primer plano y durante un tiempo tras minimizarla. Cuando la app está en segundo plano, `kick()` no inicia drenados nuevos (se reanuda al volver, con `AppState 'active'`).
- Procesar la cola **con la app cerrada** requiere que el SO despierte la app: en Android, **WorkManager**; en iOS, **BGTaskScheduler**. Expo lo expone con `expo-background-task`, pero el SO decide cuándo ejecutarlo (intervalo mínimo ~15 min, restricciones de batería/Doze) y requiere una build propia para funcionar de forma confiable, no Expo Go.
- **Lo importante:** la **durabilidad no depende de eso**. Aunque la app se cierre, las operaciones están en SQLite y se envían en el próximo arranque (`start()` → `resetInflight` → drenado).

## 3.9 Gestión de estado en la Fase 3

| Estado | Dónde vive | Quién lo cambia |
|---|---|---|
| Operaciones pendientes (la verdad) | **SQLite** (`outbox`) | `OutboxDao`, a través del mutex |
| `online`, `pending`, `failed`, `syncing` | Campo privado `status` del `SyncEngine` | El motor |
| Copia reactiva para la UI | **Zustand** `useSyncStatus` | `syncStore.ts` se suscribe a `syncQueue.onStatusChange` |

- **Patrón observador:** el motor (capa *data*, sin React) emite eventos; `syncStore` los traduce a estado de Zustand. Así la capa de datos **no importa nada de la presentación** (respeta la regla de dependencia).
- `SyncBanner` usa **dos selectores de primitivos** (`s.online`, `s.pending`) → no se re-renderiza cuando solo cambia `syncing` o `failed`.
- Los contadores se recalculan con **una sola consulta** SQL (`SUM(status IN (...))`) después de cada cambio.

## 3.10 Cómo demostrarlo en la defensa (panel en Perfil)

`SyncDiagnostics` (en **Perfil → Editar perfil**, al final) muestra `pendientes / fallidas / en línea` y tiene 3 botones. Los posts de prueba **no existen** a propósito:

1. **Coalescencia:** activa **modo avión** → "5 likes al mismo post" → pendientes = **1**, no 5. La píldora roja dice "Sin conexión · 1 acción pendiente".
2. **Persistencia:** en modo avión toca "Comentario" 3 veces → pendientes = 4 (1 like + 3 comentarios). Quita el modo avión **y en ese mismo momento** cierra la app por completo (o recárgala). Al abrirla, el motor arranca, lee la cola **desde SQLite** y la procesa. Las operaciones aparecen como fallidas (paso 4), lo que prueba que **sobrevivieron al cierre** del proceso.
   - ⚠️ En Expo Go **no** se puede abrir la app en modo avión: el código JS se descarga desde Metro (el servidor de desarrollo) a través del tunnel. En una build de producción el bundle va dentro del APK y la app abre sin red. Si el profe lo pregunta, esa es la explicación.
3. **Reconexión:** quita el modo avión con la app abierta → la píldora cambia a "Sincronizando…" → procesa **en orden** de encolado.
4. **Errores permanentes:** como los posts no existen, el servidor rechaza cada operación (RLS: el `with check` exige que el post exista) → pasan a **fallidas** en lugar de reintentarse para siempre. "Limpiar fallidas" las borra.

(En la Fase 4 los likes y comentarios reales usarán esta misma cola.)

## 3.11 Preguntas probables del profe — Fase 3

**P20. ¿Cómo funciona tu cola offline?**
Patrón *Transactional Outbox*. La UI no llama a la red: encola una intención en la tabla `outbox` de SQLite y actualiza su estado en memoria de inmediato. El `SyncEngine` drena la cola: toma la operación más antigua (`ORDER BY id`), la marca `inflight`, la ejecuta contra Supabase y según el resultado la borra, la reintenta o la aparta.
- *Contrapregunta: "¿Y si se cierra la app en medio del envío?"* → Queda `inflight`. Al arrancar, `resetInflight` la devuelve a `pending` y se reenvía. Como es idempotente, si ya había llegado no pasa nada.

**P21. ¿Cómo garantizas el orden cronológico?**
Tres cosas: (1) `id` AUTOINCREMENT como orden, no el reloj; (2) un solo consumidor (`draining` como candado) que procesa de una en una; (3) ante un fallo transitorio la cola **se detiene** (`break`) en vez de saltar a la siguiente.
- *Contrapregunta: "¿Por qué no ordenas por `created_at`?"* → El reloj del dispositivo puede cambiar; AUTOINCREMENT es monotónico.
- *Contrapregunta: "¿Por qué no envías en paralelo, sería más rápido?"* → Rompería el orden: una respuesta podría llegar antes que su comentario padre y fallar por FK.

**P22. ¿Cómo resuelves conflictos sin corromper la BD remota?**
Idempotencia: IDs del cliente + `ON CONFLICT DO NOTHING`, y likes como estado deseado en vez de toggle. Coalescencia: solo viaja la última intención de like. Clasificación de errores: los duplicados cuentan como éxito, los rechazos permanentes se apartan y disparan rollback, y los transitorios se reintentan. Además el servidor tiene la última palabra (RLS, FK, UNIQUE, triggers atómicos): el cliente nunca puede dejarlo inconsistente.
- *Contrapregunta: "Usuario A da like offline, mientras tanto el dueño borra el post. ¿Qué pasa?"* → Al reconectar, el insert falla (RLS/FK) → permanente → `markFailed` + evento `onPermanentFailure` → la UI revierte el like. La cola sigue con las demás.
- *Contrapregunta: "¿Qué estrategia de resolución es esa?"* → *Server-authoritative* (el servidor manda) con *last-intent-wins* para estados del mismo usuario. No hay conflicto entre usuarios distintos porque cada like es una fila propia `(post_id, user_id)`.

**P23. ¿Qué es la idempotencia y por qué es obligatoria aquí?**
Ejecutar N veces = ejecutar 1 vez. Es obligatoria porque en redes móviles **no se puede saber** si una petición que dio timeout llegó o no al servidor. La única estrategia segura es reintentar, y reintentar solo es seguro si la operación es idempotente.

**P24. ¿Por qué un mutex si JavaScript es de un solo hilo?**
Porque cada `await` cede el control al event loop y otra tarea asíncrona puede intercalarse. `withTransactionAsync` de expo-sqlite no es exclusiva: una escritura ajena podría quedar dentro de nuestra transacción. `withExclusiveTransactionAsync` usa otra conexión y hace fallar las escrituras concurrentes con `database is locked`. El mutex (cadena de Promises) serializa las escrituras sin bloquear el hilo.
- *Contrapregunta: "¿El mutex bloquea la UI?"* → No. Esperar el mutex es esperar una Promise; el event loop sigue procesando toques y renders.
- *Contrapregunta: "¿Y las lecturas?"* → No pasan por el mutex: con WAL los lectores no se bloquean con el escritor.

**P25. ¿En qué hilo corre la sincronización?**
La lógica del motor corre en el hilo JS, pero es ligera. El trabajo pesado es I/O que corre en hilos nativos: SQLite en su hilo, la red en OkHttp. El hilo JS solo espera Promises, y entre `await` queda libre para la UI.
- *Contrapregunta: "¿Se sincroniza con la app cerrada?"* → No en Expo Go. Mientras el proceso vive sí. Con la app cerrada haría falta `expo-background-task` (WorkManager / BGTaskScheduler) en una build propia, y el SO decide cuándo corre (mínimo ~15 min). Pero no se pierde nada: todo queda en SQLite y se envía al siguiente arranque.

**P26. ¿Cómo detectas que volvió internet?**
NetInfo: el SO notifica los cambios de red desde un hilo nativo. Uso `isConnected === true && isInternetReachable !== false`, porque `isConnected` solo indica que hay Wi-Fi/datos (podría ser un portal cautivo) e `isInternetReachable` puede ser `null` mientras no se sabe. Solo aviso al motor cuando el booleano cambia, para filtrar ruido. Además, si NetInfo dice "online" pero la petición falla con status 0, el error se clasifica como transitorio y entra el backoff.

**P27. ¿Qué es el backoff exponencial y el jitter?**
Esperar 1, 2, 4… hasta 60 s entre reintentos para no saturar un servidor caído ni gastar batería. El jitter agrega aleatoriedad para que miles de clientes no reintenten en el mismo instante (*thundering herd*).

**P28. ¿Qué es la coalescencia?**
Fusionar operaciones de estado sobre el mismo recurso: 5 toques al like offline se convierten en 1 operación con el estado final. Se hace en una transacción (borrar las pendientes con la misma `coalesce_key` + insertar la nueva). Nunca se borra la `inflight`.

**P29. ¿Qué pasa con las operaciones si cierro sesión y entra otra persona?**
Cada operación tiene `user_id`. El motor solo procesa las del usuario actual, así que nunca se envían con el token de otra persona. Las de la sesión anterior esperan a que ese usuario vuelva.

**P30. ¿Qué es el "wakeup perdido" y cómo lo evitas?**
Si se encola algo justo cuando el drenado está por terminar (ya leyó la cola vacía), `kick()` ve que hay un drenado en curso y no hace nada, y la operación queda esperando. La marca `drainRequested` hace que al terminar se vuelva a revisar la cola.

**P31. ¿Cómo se migra el esquema de SQLite en una actualización de la app?**
`PRAGMA user_version` + un arreglo de migraciones. Al abrir se aplican solo las que faltan, cada una en una transacción junto con el cambio de versión. Nunca se edita una migración ya publicada.

---

# Fase 4 — Feed, publicaciones, likes, comentarios y privacidad (Módulo 1)

## 4.1 Qué pide el enunciado y cómo se cumple

| Requisito | Cómo se cumple |
|---|---|
| Barra inferior persistente, jerarquía visual de perfiles, publicaciones y comentarios | Tabs de la Fase 2. `PostCard` (cabecera → imagen cuadrada → acciones → likes → descripción → comentarios → tiempo). `ProfileView` (avatar, contadores, nombre, bio, botón, grilla). Comentarios con avatar, respuestas indentadas. |
| Creación y publicación de posts con imágenes estáticas | Pestaña **Crear**: galería con recorte 1:1 → compresión nativa → `CREATE_POST` en la cola offline → aparece en el feed al instante con "Publicando…". |
| Sistema dinámico de Likes | `toggleLike` optimista (0 ms) + `SET_LIKE` en la cola + rollback si el servidor lo rechaza. Contador desnormalizado por trigger. |
| Sección anidada de comentarios en tiempo real | `parent_id` en la BD + `buildThreads()` (1 nivel, como Instagram) + **Supabase Realtime** (`postgres_changes` filtrado por `post_id`). |
| Compartir enlaces o referencias internas | Botón avión de papel → `Share.share` con `Linking.createURL('post/<id>')` → deep link que abre la app en ese post (Fase 2). En la Fase 6 se podrá compartir por DM. |
| Perfiles públicos y privados con flujo formal de solicitud / aprobación / rechazo | Switch "Cuenta privada" en Editar perfil. Botón Seguir → `Solicitado` (pending). Pestaña **Actividad** → "Confirmar" / "Eliminar". Todo validado por **RLS + triggers** (Fase 1). |
| Acceso a multimedia y a la lista de seguidores/seguidos protegido en el backend | RLS en `posts`, `follows` y en el bucket privado `media` (URLs firmadas solo si `can_view`). La UI muestra el candado, pero **aunque se saltara la UI el servidor no entrega los datos**. |

## 4.2 Archivos de esta fase

```
supabase/002_fase4.sql                 get_post, get_user_posts, get_explore, get_profile_stats,
                                       get_activity, política media_update, trigger accept_pending_on_public
src/
├── core/
│   ├── format.ts                      timeAgo(), plural()
│   └── media/imageProcessing.ts       pickSquareImage(), compressForUpload() (+ release() de memoria nativa)
├── domain/
│   ├── entities/Post.ts               Post, Comment, ActivityItem
│   ├── entities/Profile.ts            + ProfileStats, canViewContent()
│   ├── comments/threads.ts            buildThreads(), rootIdOf()  (funciones puras)
│   ├── sync/SyncOperation.ts          + CREATE_POST
│   ├── sync/reconcile.ts              applyPendingIntents(), pendingPostsFrom()  (funciones puras)
│   └── repositories/                  PostRepository, CommentRepository, ActivityRepository,
│                                      MediaRepository, ProfileRepository (ampliado), SyncQueue (ampliado)
├── data/
│   ├── local/database.ts              + migración v2: feed_cache
│   ├── local/FeedCacheDao.ts          caché de la 1ª página del feed
│   ├── mappers/postMapper.ts          PostRow/CommentRow/ActivityRow → entidades
│   ├── remote/supabaseClient.ts       + currentUserId()
│   ├── repositories/                  SupabasePost/Comment/Activity/Media/ProfileRepository
│   └── sync/operationHandlers.ts      + CREATE_POST (upload idempotente + insert)
├── presentation/
│   ├── stores/postsStore.ts           ESTADO NORMALIZADO: byId + lists, acciones optimistas, rollback
│   ├── stores/commentsStore.ts        comentarios por post, dedupe por id, Realtime
│   └── components/                    Avatar, MediaImage (provisional), PostCard, PostGrid,
│                                      ProfileView, UserRow, SmallButton
└── app/(tabs)/…                       feed, explorar (+búsqueda), crear, actividad, perfil,
                                       editar perfil, post/[id], user/[id], comments/[postId], follows/[id]
```

> ⚠️ Para que funcione hay que ejecutar **`supabase/002_fase4.sql`** en el SQL Editor de Supabase.

## 4.3 Estado normalizado (`postsStore.ts`) — la decisión de estado más importante

```ts
byId:  { [postId]: Post }                       // cada post existe UNA vez
lists: { feed: {ids, cursor, hasMore, …},
         explore: {…},
         'user:<id>': {…} }                     // las listas solo guardan ids
```

**¿Por qué normalizar?** El mismo post aparece en el feed, en la grilla del perfil, en Explorar y en su detalle. Si cada pantalla tuviera su **copia**, un like en el feed dejaría las otras copias desactualizadas (corazón vacío en el detalle). Con `byId`, todas leen el **mismo objeto**: se actualiza una vez y todas lo ven. Es el mismo principio que la normalización en bases de datos (no duplicar datos).

### Selectores y re-renders (rendimiento)

- `HomeScreen` selecciona **la lista** (`s.lists.feed`), no los posts.
- `PostCard` recibe **solo el id** y selecciona **su post** (`s.byId[postId]`).
- Dar like cambia `byId[postId]` → Zustand compara cada selector con `Object.is` → **solo re-renderiza esa tarjeta**. El feed no se re-renderiza (sus `ids` no cambiaron).
- Las actualizaciones son **inmutables** (`{ ...post, likedByMe }`): se crea un objeto nuevo, así la comparación por referencia detecta el cambio. Mutar el objeto en sitio no cambiaría la referencia y la UI no se enteraría.

### Paginación por cursor en el cliente

- `loadList(key, 'refresh' | 'more')`. `refresh` pide sin cursor y **reemplaza** los ids; `more` pide con `cursor` (el `created_at` del último) y **agrega** sin duplicar.
- Guardas contra peticiones duplicadas: si ya está `loading`/`refreshing`, no hace nada. `onEndReached` de FlashList puede dispararse varias veces seguidas al llegar al final.
- `hasMore = nextCursor !== null` (si la página llegó incompleta, no hay más).

## 4.4 UI optimista — flujo completo de un like

```
Toque ♥ (UI thread) ──▶ onPress (JS) ──▶ toggleLike(postId)
   1. patchPost: likedByMe = !likedByMe, likeCount ± 1   ← el corazón se pinta en el mismo frame
   2. syncQueue.enqueue({ SET_LIKE, liked })             ← SQLite (hilo nativo); no espera red
   ...
   SyncEngine (Fase 3) ──▶ Supabase
        ├─ éxito: nada que hacer (la UI ya estaba bien)
        └─ rechazo permanente ──▶ onPermanentFailure ──▶ revertLike()
```

- **Latencia percibida 0 ms**: el paso 1 es síncrono en memoria. El usuario nunca espera a la red, con o sin internet.
- **Rollback seguro** (`revertLike`): solo se revierte si el estado actual **sigue siendo** la intención que falló. Si el usuario ya volvió a tocar el corazón, su intención más nueva manda y no se toca.
- Un post `pending` (creado offline, aún no existe en el servidor) no se puede likear ni comentar: la FK fallaría.

## 4.5 Reconciliación con la cola (`domain/sync/reconcile.ts`)

**Problema:** das like sin internet (queda en la cola) y haces *pull-to-refresh* cuando vuelve la red pero antes de que la cola lo envíe. El servidor responde `liked_by_me = false`. Si se pinta tal cual, **el like "desaparece"** frente al usuario.

**Solución:** `applyPendingIntents(postsDelServidor, operacionesPendientes)`:
- Recorre las operaciones pendientes **en orden** y se queda con la **última** intención de like por post.
- Si difiere de lo que dice el servidor, aplica la intención local encima (y ajusta el contador).
- Suma los comentarios pendientes al `commentCount`.

Regla: **la intención local pendiente es más reciente que la foto del servidor**. Es una **función pura** (sin I/O ni estado): recibe datos y devuelve datos, así que es trivial de probar y no tiene efectos secundarios.

`pendingPostsFrom()` reconstruye los posts creados offline a partir de las operaciones `CREATE_POST` de la cola, así que siguen visibles en el feed **aunque se reinicie la app**.

## 4.6 Offline-first del feed (`SupabasePostRepository.getFeed` + `feed_cache`)

- **Con red:** RPC `get_feed` → se **reemplaza** la tabla `feed_cache` (migración v2 de SQLite) con la primera página, en **una transacción** (nunca queda mitad vieja, mitad nueva).
- **Sin red** (`status === 0` en la primera página): se devuelve lo guardado en SQLite con `fromCache: true` → el feed muestra "Sin conexión · mostrando publicaciones guardadas".
- Los posts se guardan como JSON porque siempre se leen completos y en orden.
- La caché está separada por `user_id`: si otra persona inicia sesión en el mismo celular, no ve el feed ajeno.

## 4.7 Crear publicación — pipeline de la imagen y cola offline

```
Galería (recorte 1:1)  →  compressForUpload()             →  persistPendingImage()          →  CREATE_POST en la cola
 expo-image-picker        resize 1080 px + JPEG 80 %          copia a Paths.document/          (id UUID del cliente)
                          (hilo nativo) + release()           pending-uploads/<id>.jpg
                                                                        │
     el post aparece en el feed al instante ("Publicando…", imagen local) ◀┘
                                                                        │
SyncEngine → upload a media/<uid>/posts/<id>.jpg (upsert) → insert posts (on conflict do nothing) → borra la copia local
     → onOperationCompleted → getPost(id) reemplaza el borrador por el post real
```

### Por qué cada paso

- **Compresión** (`core/media/imageProcessing.ts`): una foto de cámara (~4000×3000, ~5 MB) queda en ~200–400 KB. Decodificada en RAM, 1080×1080×4 bytes ≈ **4.6 MB** en vez de ~48 MB. Menos datos, subidas más rápidas y **menos memoria para todos los que la vean** (Módulo 2).
- **Hilo:** decodificar, escalar y codificar un JPEG es CPU pesada → corre en un **hilo nativo** de `expo-image-manipulator`. JS solo espera la Promise.
- **`image.release()`**: `renderAsync()` devuelve un `ImageRef`, un **SharedRef**: un objeto JS pequeño que apunta a un **bitmap en memoria nativa**. El recolector de basura de JS no sabe cuánto pesa ese bitmap y podría tardar en liberarlo. `release()` en un `finally` lo libera en el acto → evita picos de memoria y **OutOfMemory** si se procesan varias fotos.
- **`Paths.document` y no `Paths.cache`:** el SO puede vaciar el caché cuando le falta espacio. Si la subida está esperando que vuelva la red, la imagen **no puede desaparecer**. Documentos persiste hasta desinstalar la app.
- **Idempotencia en dos pasos:** la ruta del archivo depende del `id` del post y se sube con `upsert: true` (sobrescribe el mismo archivo); el insert usa `ON CONFLICT DO NOTHING`. Si la app muere entre subir y crear la fila, el reintento repite ambos pasos sin duplicar nada. Por eso se agregó la política `media_update` (upsert necesita permiso de UPDATE).
- **Error permanente especial:** si la copia local ya no existe, se lanza un `RemoteError` 400 → `permanent` → el borrador se quita del feed y se muestra una alerta.

## 4.8 Imágenes privadas: URLs firmadas con *batching* (`SupabaseMediaRepository`)

- El bucket `media` es privado. Para mostrar una imagen hace falta una **URL firmada** (temporal, 1 h) que Storage solo emite si la política `media_select` (que usa `can_view`) lo permite.
- **Memoización:** una URL válida se reutiliza hasta que le quedan menos de 5 min.
- **Agrupamiento (batching):** al abrir el feed se montan ~10 celdas en el mismo frame y cada una pide su URL. En vez de 10 peticiones HTTP, las solicitudes se acumulan y se envían en **una sola** llamada a `createSignedUrls(paths)`.
  - `queueMicrotask(flush)` agenda el envío para **justo después** del código síncrono actual. Todas las celdas que se montan en ese mismo render ya registraron su ruta cuando corre `flush`.
  - Si dos celdas piden la **misma** ruta, esperan la misma respuesta (lista de `waiters` por ruta).
- La **llave** de la imagen es la **ruta** (`image_path`), no la URL, porque la URL cambia en cada firma. Esto será la llave del caché en la Fase 5.
- `MediaImage` era **provisional** en esta fase; en la Fase 5 se reescribió sobre el motor de caché propio (ver sección 5).

### Estado derivado en `MediaImage` (regla del React Compiler)

Se guarda `{ path, url }` y se calcula en el render `uri = resolved.path === path ? resolved.url : null`. Si FlashList **recicla** la celda para otro post, la ruta cambia y la imagen vieja **no** se muestra ni un frame. Además el flag `cancelled` del cleanup descarta la respuesta tardía de la firma anterior. El lint del compilador (`react-hooks/set-state-in-effect`) prohíbe `setState` sincrónico dentro de un efecto porque provoca **renders en cascada**; la solución correcta es derivar en el render.

## 4.9 Comentarios anidados en tiempo real

### Modelo y agrupado (`domain/comments/threads.ts`)

- BD: `comments.parent_id` (NULL = comentario raíz).
- Igual que Instagram, **un solo nivel** de anidación: responder a una respuesta cuelga del **mismo comentario raíz** (`rootIdOf`). Evita hilos infinitamente profundos que no caben en una pantalla de celular.
- `buildThreads()` convierte la lista plana en filas `{comment, depth}`: ordena por fecha (O(n log n)) y agrupa las respuestas con un `Map` (O(n)). Una respuesta cuyo padre no está cargado se muestra como raíz para no perderla.
- En la pantalla, `useMemo(() => buildThreads(comments), [comments])` → los hilos no se recalculan en cada tecla del input.

### Tiempo real (`SupabaseCommentRepository.subscribe`)

- `supabase.channel('comments:<postId>').on('postgres_changes', { event: 'INSERT', table: 'comments', filter: 'post_id=eq.<id>' })`.
- Por detrás: Supabase Realtime lee el **WAL** (registro de cambios) de Postgres y empuja cada INSERT por un **WebSocket** ya abierto. No hay polling.
- **Realtime respeta RLS:** solo llegan comentarios de posts que puedo ver.
- El evento trae la fila cruda (sin el username del autor), así que se pide la fila con el join del autor.
- El `useEffect` de la pantalla devuelve `subscribeToComments(postId)`, que es la función de limpieza → `removeChannel` al salir. **Un canal abierto sin pantalla es una fuga** (memoria + tráfico).

### Optimista + deduplicación (`commentsStore.ts`)

1. `addComment`: crea el comentario con **UUID del cliente** y `syncState: 'pending'` (se ve semitransparente, "Enviando…"), suma 1 al `commentCount` del post y encola `ADD_COMMENT`.
2. Cuando el servidor lo guarda, **Realtime lo devuelve a mí mismo** con el **mismo id** → `mergeComment` **reemplaza** por id en vez de agregar → **no hay duplicado**. Esta es la razón práctica de generar el id en el cliente.
3. `onOperationCompleted` limpia `pending`; `onPermanentFailure` lo marca `failed` ("No se pudo publicar") y resta 1 al contador.
4. Un comentario **de otra persona** que llega por Realtime sí suma 1 al contador.

¿Por qué un **store global** y no `useState` en la pantalla? Porque la confirmación o el rechazo del SyncEngine pueden llegar **después de cerrar la pantalla**. Con estado local, ese evento no tendría dónde aplicarse.

## 4.10 Privacidad: flujo de seguimiento en la app

| Paso | Qué hace la app | Qué garantiza el servidor |
|---|---|---|
| Ver un perfil privado sin seguirlo | `canViewContent()` = false → candado; **no pide** la grilla (ahorra una consulta). Contadores visibles (RPC `get_profile_stats`, `security definer`: los **números** son públicos, como en IG). | Aunque se pidiera, RLS no devuelve posts; Storage no firma imágenes; `follows` no devuelve la lista. |
| Tocar **Seguir** | `profileRepository.follow()` **sin** enviar `status`. Botón pasa a **Solicitado**. | El trigger `follows_set_initial_status` decide `pending`/`accepted` según la privacidad **real**. |
| Aprobar / rechazar (pestaña Actividad) | "Confirmar" = `update status='accepted'`; "Eliminar" = `delete`. Optimista local con reversión si falla. | Política `follows_update`: solo el **dueño** de la cuenta seguida puede aprobar. |
| Nueva solicitud en vivo | Canal Realtime sobre `follows` con `filter: following_id=eq.<yo>` → recarga la lista. | Realtime respeta RLS. |
| Volver la cuenta pública | Switch en Editar perfil. | Trigger `accept_pending_on_public`: las solicitudes pendientes se aceptan solas. |
| Dejar de seguir una cuenta privada | Confirmación: "tendrás que volver a enviar una solicitud". | `can_view` pasa a false → todo se oculta de nuevo. |

**¿Por qué seguir NO es optimista (a diferencia del like)?** Porque el resultado depende de una **decisión del servidor** (la privacidad real de la cuenta, que pudo cambiar). Un like tiene un resultado predecible (`liked = true`); un follow puede terminar en `pending` o `accepted`. Mostrar "Siguiendo" y luego corregir a "Solicitado" sería peor experiencia que esperar ~200 ms con un spinner.

`canViewContent()` en el dominio es **la misma regla** que `can_view()` en SQL. En el cliente **solo decide qué pintar**; la seguridad está en el servidor.

## 4.11 Otras decisiones técnicas de la fase

- **Búsqueda con *debounce*** (Explorar): se busca 300 ms después de la última tecla (`setTimeout` + `clearTimeout` en el cleanup). El flag `active` descarta respuestas que llegan **tarde y desordenadas**: la de "an" no debe pisar la de "ana". Además se quitan `%` y `_` del texto para que el usuario no inyecte comodines en el `ILIKE`.
- **`useFocusEffect`** en Perfil y Actividad: recarga cada vez que la pantalla vuelve a estar visible (al regresar de Editar perfil o tras aprobar una solicitud), no solo al montarse. Recuerda que las pantallas de las tabs **no se desmontan**.
- **Avatar con `?v=<timestamp>`**: la ruta del archivo es siempre la misma (`<uid>/avatar.jpg`). Sin el parámetro, las cachés (el CDN de Supabase y la de imágenes) seguirían mostrando la foto vieja (*cache busting*). El avatar se comprime a 320 px.
- **Imagen de alto fijo** en `PostCard` (cuadrada, `width × width`): la lista conoce el tamaño **antes** de que la imagen cargue → no hay saltos de layout ni re-mediciones durante el scroll.
- **Detalle del post** (`post/[id]`): usa `ensurePost` (memoria primero, red si falta). Si RLS no lo devuelve, muestra "Esta publicación no está disponible" (mismo mensaje para "borrado" y "privado", para no revelar cuál es).
- **Compartir:** `Linking.createURL('post/<id>')` genera `exp://…/--/post/<id>` en Expo Go e `instagramclone://post/<id>` en una build propia.

## 4.12 Hilos en la Fase 4

| Trabajo | Hilo |
|---|---|
| Toque en el corazón, animación del `Pressable`, scroll de FlashList | UI thread |
| `toggleLike`, reconciliación, `buildThreads`, renders de React | JS thread |
| Escribir la operación en SQLite, `feed_cache` | Hilo nativo de SQLite |
| Selector de fotos (galería del sistema) | Activity nativa del SO |
| Decodificar/escalar/comprimir la foto (`expo-image-manipulator`) | Hilo nativo de fondo |
| Copiar el archivo a documentos, `arrayBuffer()` | Hilo nativo de E/S de archivos |
| Subida a Storage, RPCs, firmas de URL | Hilo de red nativo (OkHttp) |
| WebSocket de Realtime | Socket nativo; los mensajes se entregan como eventos al hilo JS |
| Decodificar las imágenes del feed para pintarlas | Hilos nativos del cargador de imágenes (Fase 5 lo controla) |

## 4.13 Preguntas probables del profe — Fase 4

**P32. ¿Cómo manejas el estado de los posts?**
Store normalizado en Zustand: `byId` con cada post una sola vez y `lists` con ids y paginación por pantalla. Un like actualiza `byId[id]` y todas las pantallas que muestran ese post se actualizan.
- *Contrapregunta: "¿Y por qué no se re-renderiza todo el feed al dar like?"* → La tarjeta se suscribe a `s.byId[postId]` y el feed a `s.lists.feed`. Al dar like solo cambia la referencia del post, y Zustand re-renderiza solo los componentes cuyo selector cambió (`Object.is`).
- *Contrapregunta: "¿Qué pasa si mutas el post en vez de copiarlo?"* → La referencia no cambia, `Object.is` dice "igual" y la UI no se entera. Por eso las actualizaciones son inmutables.

**P33. Explícame la UI optimista del like.**
(1) Se cambia el estado en memoria de forma síncrona, así que el corazón se pinta en el mismo frame. (2) Se encola `SET_LIKE` en SQLite. (3) El SyncEngine lo envía cuando puede. Si el servidor lo rechaza de forma permanente, `onPermanentFailure` → `revertLike`, que solo revierte si el estado actual sigue siendo el de esa intención.
- *Contrapregunta: "¿Qué ve el usuario si el servidor rechaza el like?"* → El corazón vuelve a su estado anterior. Pasa si, por ejemplo, el post fue borrado o la cuenta se volvió privada.

**P34. Si doy like sin internet y refresco el feed, ¿se pierde el like?**
No. `applyPendingIntents` aplica encima de la respuesta del servidor las intenciones que siguen en la cola. La intención local pendiente es más reciente que la foto del servidor. Es una función pura del dominio.

**P35. ¿Cómo funcionan los comentarios en tiempo real? ¿Por qué no se duplica el mío?**
Supabase Realtime (WebSocket): Postgres → WAL → servidor Realtime → canal filtrado por `post_id`. Mi comentario se muestra al instante con un UUID generado en el cliente; cuando vuelve por Realtime trae el mismo id y se reemplaza en vez de agregarse.
- *Contrapregunta: "¿Qué pasa con la suscripción al salir de la pantalla?"* → El cleanup del `useEffect` llama a `removeChannel`. Sin eso, el canal seguiría abierto: fuga de memoria y de tráfico.
- *Contrapregunta: "¿Cómo implementaste el anidamiento?"* → `parent_id` en la BD y `buildThreads` agrupa con un Map en O(n). Hay un solo nivel, como en Instagram: responder a una respuesta cuelga de la raíz.

**P36. ¿Cómo funciona la creación de un post sin internet?**
Se comprime en un hilo nativo, se copia a `Paths.document` (no al caché, que el SO puede borrar), se muestra de inmediato con la imagen local y se encola `CREATE_POST`. El motor sube la imagen con upsert a una ruta fija y crea la fila con `ON CONFLICT DO NOTHING`: ambos pasos son idempotentes.
- *Contrapregunta: "¿Y si la app se cierra después de subir la imagen pero antes de crear la fila?"* → La operación queda `inflight`, al reabrir vuelve a `pending` y se reintentan ambos pasos. La imagen se sobrescribe a sí misma y la fila se crea una sola vez.

**P37. ¿Qué haces para no gastar memoria con las fotos?**
Redimensiono a 1080 px y comprimo a JPEG 80 %: de ~48 MB a ~4.6 MB decodificada. El `ImageRef` es un SharedRef con el bitmap en memoria nativa, y lo libero con `release()` en un `finally`, sin esperar al GC. El avatar se comprime a 320 px.
- *Contrapregunta: "¿Por qué el GC no alcanza?"* → El GC de JS solo ve un objeto JS pequeño; no sabe que detrás hay megabytes de memoria nativa, así que no siente presión para recolectarlo pronto.

**P38. ¿Cómo proteges las imágenes de las cuentas privadas?**
El bucket `media` es privado y solo se accede con URLs firmadas que caducan. Storage evalúa la política `media_select` con `can_view(dueño)` antes de firmar. Aunque alguien se salte la UI, sin firma no hay imagen.
- *Contrapregunta: "¿No es lento pedir una firma por imagen?"* → Se agrupan: las celdas que se montan en el mismo tick se resuelven con una sola llamada `createSignedUrls` (`queueMicrotask`). Además las firmas se memoizan hasta 5 minutos antes de caducar.

**P39. Explícame el flujo de solicitud de seguimiento.**
Ver la tabla 4.10. El punto clave es que el estado `pending`/`accepted` lo decide un trigger en el servidor, solo el dueño puede aprobar (política `follows_update`) y rechazar es borrar la fila.
- *Contrapregunta: "¿Por qué el follow no es optimista como el like?"* → Porque el resultado depende de una decisión del servidor (la privacidad real), no es predecible en el cliente.
- *Contrapregunta: "¿Por qué puedo ver cuántos seguidores tiene una cuenta privada pero no quiénes son?"* → `get_profile_stats` es `security definer` y solo devuelve números. La lista pasa por RLS de `follows`, que exige `can_view`.

**P40. ¿Cómo funciona el feed sin conexión?**
La primera página se guarda en `feed_cache` (SQLite) en una transacción cada vez que llega del servidor. Si la RPC falla con `status 0`, el repositorio devuelve la caché con `fromCache: true` y la UI lo indica. La caché va separada por usuario.

**P41. ¿Qué es el debounce de la búsqueda y qué problema adicional resuelve el flag `active`?**
El debounce evita una petición por tecla: se busca 300 ms después de la última. El flag `active` resuelve respuestas fuera de orden: si la de "an" llega después de la de "ana", se descarta.

**P42b. En el perfil cargas tres cosas a la vez. ¿Qué pasa si una falla?**
Uso `Promise.allSettled`, no `Promise.all`. `Promise.all` rechaza en cuanto una falla y se pierden los resultados de las otras; `allSettled` espera a las tres y devuelve el resultado de cada una (`fulfilled` o `rejected`). Así, si fallan los contadores, el perfil igual se muestra. Si falla el perfil, se muestra el error con un botón "Reintentar", nunca una pantalla vacía.

**P42. ¿Por qué `useFocusEffect` y no `useEffect` en el perfil?**
Las pantallas de las tabs no se desmontan al cambiar de pestaña o al volver atrás. `useEffect([])` solo corre al montar. `useFocusEffect` corre cada vez que la pantalla gana foco, por ejemplo al volver de "Editar perfil".

---

# Fase 5 — Motor de caché de imágenes y rendimiento 60 FPS (Módulo 2)

## 5.1 Qué pide el enunciado y cómo se cumple

| Requisito | Cómo se cumple |
|---|---|
| "Prohibido el uso de librerías automáticas de carga de imágenes sin control" | Nuestro motor (`ImageCacheEngine`) decide **cuándo** descargar, **dónde** guardar, **a qué tamaño** decodificar, **cuánto** ocupa y **qué** se desaloja. expo-image solo **pinta** un bitmap que ya le entregamos (`ImageRef`); **nunca le pasamos una URL remota**, así que su caché automático de red no interviene. |
| "Caché de dos niveles: Memoria RAM y Disco Local" | **L1 RAM:** `LruCache` de bitmaps decodificados con presupuesto de 64 MB. **L2 Disco:** archivos en `Paths.cache/img` + índice SQLite, presupuesto de 150 MB. |
| "Política de desalojo LRU" | L1: `LruCache` O(1) sobre un `Map` (orden de inserción). L2: `ORDER BY last_access` con índice en SQLite. |
| "60 FPS en scroll continuo de listas largas" | FlashList (reciclaje), selectores por celda, React Compiler, alto de celda fijo, decodificación en hilo nativo y **reducida al tamaño de pantalla**, bitmaps listos en RAM al volver a una celda. |
| "Cancelación automática cuando una celda sale del viewport" | Cada celda tiene un `AbortController`. Se aborta: (1) cuando FlashList **recicla** la celda para otro post, (2) cuando se **desmonta**, (3) cuando `onViewableItemsChanged` indica que **salió del viewport** antes de cargar. El `AbortSignal` cancela la descarga **en el sistema operativo** (expo-file-system). |
| "Evitar memory leaks y cierres por OutOfMemory" | Presupuesto en bytes, `release()` explícito de bitmaps nativos, conteo de uso (*pinning*), liberación ante `memoryWarning` y al pasar a segundo plano, decodificación reducida, cleanup de todos los efectos. |

## 5.2 Archivos de esta fase

```
src/
├── core/cache/LruCache.ts                     LRU genérica con peso, pin (canEvict) y onEvict
├── data/
│   ├── local/database.ts                      + migración v3: tabla image_cache
│   ├── local/ImageCacheDao.ts                 índice del disco (get, upsert, touch, oldest, totalBytes…)
│   └── imageCache/ImageCacheEngine.ts         EL MOTOR: L1 + L2 + red, dedupe, cancelación, presupuestos
├── di/container.ts                            imageCache (singleton)
└── presentation/
    ├── stores/viewportStore.ts                qué celdas del feed salieron de pantalla
    └── components/
        ├── CachedImage.tsx                    componente base: acquire/abort/release según ciclo de vida
        ├── MediaImage.tsx                     (reescrito) imagen de post → CachedImage kind="media"
        ├── Avatar.tsx                         (reescrito) avatar → CachedImage kind="url"
        └── ImageCacheDiagnostics.tsx          panel en vivo (Perfil → Editar perfil)
```

## 5.3 La pregunta clave: ¿qué se guarda en la RAM?

**Contrapregunta segura del profe:** *"JavaScript no puede tener bitmaps. ¿Qué guardas en tu caché de memoria, las URLs?"*

**No.** Se guardan **`ImageRef`**, obtenidos con `Image.loadAsync()` de expo-image:
- `loadAsync` lee el archivo, **decodifica** el JPEG a un bitmap (píxeles RGBA) **en un hilo nativo** y devuelve un `ImageRef`.
- `ImageRef` es un **SharedRef**: un objeto JS pequeño que **apunta** a ese bitmap que vive en **memoria nativa** (en Android, un `Bitmap`). Gracias a JSI, JS puede tener la referencia sin copiar los píxeles.
- `<Image source={ref}>` pinta ese bitmap **directamente**, sin volver a leer el archivo ni decodificar. Eso es lo que hace instantáneo un acierto en L1.
- `ref.release()` libera el bitmap **en ese momento**. Sin esto, el bitmap solo se liberaría cuando el recolector de basura de JS recoja el objeto JS pequeño, y **el GC no sabe que detrás hay megabytes nativos** → no siente presión → la RAM nativa crece → OutOfMemory.

Por eso el presupuesto de L1 se mide en **bytes de bitmap** (`ancho × alto × escala² × 4`), no en número de imágenes: una foto de 1080 px pesa ~4.6 MB y una miniatura de 360 px ~0.5 MB.

## 5.4 Flujo completo de `acquire(key, resolveUrl, anchoPx, signal)`

```
1. ¿signal ya abortado? → rechazar.
2. Ancho discreto: múltiplo de 256 px (256…2048) → memKey = "<ruta>@<ancho>".
3. L1 RAM: memory.get(memKey) ─ hit ─▶ pin() ─▶ ImageHandle   (stats.memoryHits++)
4. ¿Ya hay una carga en curso de memKey? → unirse a ella (stats.deduplicated++)
   si no → startJob():
      a. L2 DISCO: ¿fila en image_cache y el archivo existe?
            sí → touch(last_access) → usar el archivo              (stats.diskHits++)
            fila pero sin archivo (el SO purgó el caché) → borrar fila y seguir
      b. RED: nombre = SHA-256(llave) → resolveUrl() (URL firmada) →
              File.downloadFileAsync(url, "<hash>.img.part", { signal }) →
              move("<hash>.part" → "<hash>.img") → upsert índice → enforceDiskBudget()   (stats.networkLoads++)
      c. DECODIFICAR: Image.loadAsync(archivo, { maxWidth: ancho })  (hilo nativo)
      d. Insertar en L1 con reserva (users = 1) → liberar la reserva en setTimeout(0)
5. Cada interesado recibe pin() → { ref, release() }
```

### Por qué cada detalle

- **La llave es la ruta, no la URL firmada.** La URL firmada cambia en cada firma (Fase 4); si fuera la llave, nunca habría aciertos.
- **Ancho discreto (múltiplos de 256):** 360 px y 380 px comparten la entrada de 512 px → más aciertos entre pantallas parecidas, a cambio de un poco más de memoria por imagen.
- **SHA-256 para el nombre del archivo** (`expo-crypto`, hilo nativo): la ruta tiene `/` y las URLs de avatar tienen `?` y `=`, caracteres inválidos o peligrosos en nombres de archivo. El hash da un nombre fijo, seguro y sin colisiones prácticas.
- **Descarga a `.part` + rename:** si la descarga se cancela o la app muere a mitad, nunca queda un archivo **incompleto con el nombre final** (se leería como imagen corrupta). Renombrar dentro del mismo directorio es **atómico** en el sistema de archivos. Si falla, se borra el `.part`.
- **`Paths.cache`** (no documentos): es el lugar correcto para datos **regenerables**; el SO lo puede purgar si falta espacio. El motor lo tolera: si la fila existe pero el archivo no, se trata como miss.
- **`touch` sin `await`** (`void imageCacheDao.touch(key)`): actualizar `last_access` no debe retrasar la imagen.

## 5.5 Decodificación reducida (*downsampling*) — la mayor defensa contra OOM

`Image.loadAsync(file, { maxWidth })` decodifica el JPEG **directamente** al ancho que se va a mostrar:

| Uso | Ancho en pantalla | Ancho decodificado (px) | RAM del bitmap |
|---|---|---|---|
| Foto del feed | ~392 pt × 2.75 | 1280 | ~6.5 MB |
| Miniatura de la grilla (3 columnas) | ~130 pt × 2.75 | 512 | ~1 MB |
| Avatar 32 pt | 32 pt × 2.75 | 256 | ~0.26 MB |

`PixelRatio.getPixelSizeForLayoutSize(width)` convierte **puntos de layout** a **píxeles físicos** según la densidad de la pantalla: nunca se decodifica más resolución de la que la pantalla puede mostrar. La grilla de Explorar con 30 miniaturas ocupa ~30 MB en vez de ~140 MB.

## 5.6 La LRU (`core/cache/LruCache.ts`)

**LRU = *Least Recently Used*:** cuando no hay espacio, se desaloja lo que lleva **más tiempo sin usarse**. Supone *localidad temporal*: lo que viste hace poco es lo más probable que vuelvas a ver (hacer scroll hacia arriba).

### Implementación O(1) con un `Map`

El `Map` de JavaScript **conserva el orden de inserción**:
- `get(k)`: `delete(k)` + `set(k, v)` → la clave pasa al **final** (= más reciente). O(1).
- Desalojo: se recorre desde el **principio** (= menos reciente). O(1) por elemento desalojado.
- La implementación clásica (tabla hash + lista doblemente enlazada) es exactamente lo que el `Map` hace por dentro, así que no hace falta escribirla.

### Con peso y con *pin*

- `maxWeight` + `weigh(v)`: el límite es una **suma de bytes**, no una cantidad.
- `canEvict(k, v)`: el motor pasa `e.users === 0` → **nunca se desaloja un bitmap que una celda está mostrando**. Liberarlo dejaría la celda pintando memoria ya liberada. Por eso el total puede quedar **temporalmente** por encima del presupuesto; se corrige apenas la celda lo suelta (`unpin` → `trim()`).
- `onEvict`: el motor llama `ref.release()` → la memoria nativa se libera en el acto.
- `set` protege la clave recién insertada en su propia pasada de desalojo.

### LRU del disco

- Tabla `image_cache` con índice en `last_access`. Tras cada descarga, `enforceDiskBudget()` suma `bytes` y, si pasa de 150 MB, toma las 20 más viejas (`ORDER BY last_access ASC LIMIT 20`), borra archivos y filas, y repite.
- Flag `diskTrimRunning`: una sola pasada de desalojo a la vez.
- **Diferencia honesta con L1:** un acierto en **RAM** no actualiza `last_access` del disco (sería una escritura en SQLite en cada frame de scroll). El orden del disco refleja el último acceso **servido desde disco o red**. Es una **aproximación de LRU** deliberada para no penalizar el camino rápido.

## 5.7 Conteo de uso (*pinning*) y la carrera de la reserva

- Cada `MemoryEntry` tiene `users`. `pin()` suma 1 y devuelve un `ImageHandle` cuyo `release()` resta 1. `release()` es **idempotente** (un flag `released`): llamarlo dos veces no descuadra el conteo.
- **Carrera detectada al revisar el código:** la carga termina, la entrada se inserta en la LRU con `users = 0`, y **antes** de que las celdas que la esperaban ejecuten su `.then(pin)`, otra carga podría insertar y desalojar esta entrada (con `release()` del bitmap). La celda recibiría un bitmap **ya liberado**.
- **Solución — reserva:** la entrada nace con `users = 1`. Un `setTimeout(0)` suelta esa reserva. ¿Por qué funciona? Los `.then` de los interesados son **microtareas**, que corren **antes** que cualquier **macrotarea** (`setTimeout`). Cuando se suelta la reserva, todas las celdas ya fijaron la entrada.

**Microtareas vs macrotareas (saber explicarlo):** el event loop ejecuta una macrotarea (un evento, un timer) y después **vacía toda la cola de microtareas** (callbacks de Promises, `queueMicrotask`) antes de pasar a la siguiente macrotarea.

## 5.8 Deduplicación de cargas

`inflight: Map<memKey, Job>` con `{ promise, controller, waiters }`:
- Si 3 celdas piden la misma imagen a la vez (el mismo post en el feed y en la grilla, o avatares repetidos), hay **una sola** descarga y **una sola** decodificación; las 3 esperan la misma Promise.
- `waiters` cuenta los interesados. **Solo cuando el último cancela** se aborta el `AbortController` del Job. Si una celda sale de pantalla pero otra sigue esperando la misma imagen, la descarga **continúa**.
- El Job se borra de `inflight` en el `finally` (tanto si termina bien como si falla o se cancela).
- `promise.catch(() => {})` en el Job: cada interesado recibe el error por su lado. Sin esto, un Job cancelado sin interesados generaría un *unhandled promise rejection*.

## 5.9 Cancelación al salir del viewport — tres mecanismos

### 1. Reciclaje de FlashList

FlashList **no crea una celda por item**: mantiene un conjunto pequeño y, cuando una sale por arriba, **la reutiliza** para el item que entra por abajo, cambiándole las props (otro `postId`).

En `CachedImage`, las dependencias del `useEffect` son `[cacheKey, kind, px, shouldLoad]`. Al cambiar `cacheKey` (otro post), React ejecuta el **cleanup** del efecto anterior: `controller.abort()` + `handle?.release()`, y luego el efecto nuevo con otro `AbortController`.

### 2. Desmontaje

Al salir de la pantalla, o si FlashList decide destruir la celda, el mismo cleanup cancela y libera.

### 3. Viewability (`viewportStore.ts`)

- `onViewableItemsChanged` de FlashList informa qué items **entraron o salieron** del viewport (`changed[].isViewable`).
- El store guarda los **ocultos**, no los visibles. Por defecto todo cuenta como visible, así que las celdas que FlashList pre-renderiza fuera de pantalla (buffer de `drawDistance`) **precargan** su imagen. Solo se cancela cuando una celda que **estuvo** visible deja de estarlo.
- `PostCard` selecciona **un booleano** (`s.hidden[postId]`) → solo se re-renderiza la celda que cambió.
- En `CachedImage`: `shouldLoad = visible || isLoaded`. Si sale antes de cargar → `shouldLoad` pasa a `false` → cleanup → **abort**. Si ya había cargado, sigue mostrándose (ya no cuesta red).
- Config y callback están definidos **a nivel de módulo** (estables): FlashList no admite cambiar `viewabilityConfig` en caliente.

### 4. Pantalla sin foco (`useIsFocused`)

Las pestañas **no se desmontan** al cambiar de pestaña (así conservan su pila, Fase 2). Sin este mecanismo, mientras estás en Perfil, las celdas del feed y de Explorar **siguen montadas y fijando** sus bitmaps: la LRU no los puede desalojar y 4 pestañas podrían retener cientos de MB que nadie está viendo.

- `CachedImage` usa `useIsFocused()` (expo-router): `shouldLoad = !localUri && focused && (visible || isLoaded)`.
- Al perder el foco → cleanup → `abort()` + `release()` + `setLoaded(null)`. El bitmap queda **desalojable**.
- `setLoaded(null)` es importante: después de soltar la referencia, el bitmap puede liberarse en cualquier momento, así que **nunca** se debe volver a pintar.
- Al volver a la pestaña → el efecto pide la imagen otra vez: normalmente es un **acierto en RAM** (si no se desalojó) o en **disco** (milisegundos). No vuelve a la red.
- *(Encontrado en la prueba: "Vaciar RAM" no liberaba casi nada porque el feed y Explorar, en segundo plano, fijaban sus imágenes.)*

### ¿Qué cancela el `AbortSignal` realmente?

`File.downloadFileAsync(url, dest, { signal })` → el módulo nativo **cancela la petición HTTP en el sistema operativo** (deja de recibir bytes, libera el socket) y la Promise rechaza con `AbortError`. No es solo "ignorar el resultado en JS". Si la cancelación llega después de la descarga pero antes de terminar la decodificación, el bitmap recién decodificado se **libera** en vez de guardarse.

### Estado derivado: nunca se pinta la imagen de otro post

`loaded = { key: "<ruta>@<px>", ref }` y en el render: `isLoaded = loaded.key === requestKey`. Si la celda se recicla, la llave ya no coincide y **no se pinta el bitmap anterior** ni un frame. Además, el bitmap anterior pudo ser liberado en el cleanup, así que pintarlo sería un error.

## 5.10 Protección contra OutOfMemory (resumen para la defensa)

1. **Decodificación reducida** al tamaño real en pantalla (5.5).
2. **Presupuesto en bytes** para los bitmaps (64 MB) con **LRU**.
3. **`release()` explícito** al desalojar: no se depende del GC.
4. **Pinning:** nunca se libera algo visible; se desaloja apenas deja de verse. Las **pantallas sin foco** (pestañas en segundo plano) sueltan sus bitmaps (`useIsFocused`).
5. **`AppState 'memoryWarning'`** → `trimMemory(0)`: si el SO avisa que queda poca RAM, se sueltan todos los bitmaps que no están en pantalla (el disco los recupera en milisegundos).
6. **Paso a segundo plano** → `trimMemory(presupuesto / 2)`: en segundo plano el SO mata primero a las apps que más memoria usan.
7. **Cancelación** de descargas y decodificaciones que ya nadie necesita (no se gasta memoria ni red en celdas que ya no se ven).
8. **Cleanup de efectos:** cada `useEffect` que abre algo lo cierra (canales Realtime, timers, AbortControllers, handles de imagen).
9. **Compresión antes de subir** (Fase 4): nadie descarga fotos de 5 MB.

## 5.11 Técnicas para 60 FPS en el feed

A 60 FPS cada frame tiene **16.6 ms**. Durante el scroll, el UI thread mueve la lista (scroll nativo) y el hilo JS debe tener margen para renderizar las celdas que entran.

| Técnica | Dónde | Efecto |
|---|---|---|
| **Reciclaje de celdas** | FlashList | No se crean ni destruyen vistas nativas en cada scroll, solo se reasignan props. |
| **Selectores por celda** | `PostCard` → `s.byId[postId]`, `s.hidden[postId]` | Un like o un cambio de visibilidad re-renderiza **una** celda, no la lista. |
| **React Compiler** | `app.json` | Memoización automática de componentes y callbacks. |
| **Alto fijo** | imagen cuadrada `width × width` | FlashList conoce el tamaño antes de cargar la imagen → sin re-mediciones ni saltos. |
| **Decodificación fuera del UI thread** | `Image.loadAsync` (nativo) | Decodificar un JPEG grande en el hilo principal costaría decenas de ms → frames perdidos. |
| **Bitmaps listos en L1** | LRU en RAM | Al volver arriba, la imagen se pinta sin leer disco ni decodificar. |
| **Decodificación reducida** | `maxWidth` | Menos píxeles que copiar y dibujar por frame. |
| **Batching de firmas** | `SupabaseMediaRepository` | Una petición para 10 celdas, no 10. |
| **Sin trabajo pesado en JS** | Todo el I/O es async/nativo | El hilo JS solo coordina. |

**Cómo medirlo:** en Expo Go, sacude el celular → **"Toggle Performance Monitor"**. Muestra FPS de **UI** y de **JS** por separado. Durante el scroll los dos deben mantenerse cerca de 60. Si baja el de JS, hay demasiado trabajo en React. Si baja el de UI, hay trabajo pesado en el hilo principal (p. ej. decodificación síncrona).

**Resultado medido (Android, scroll continuo por la grilla de Explorar con 200 posts): UI 59 fps · JS 57 fps.**

**¿Y los "RAM 506 MB" del monitor?** Es la memoria **de todo el proceso**, no la de nuestro caché: incluye Expo Go completo (su propia UI y todos los módulos nativos que trae para cualquier proyecto), Hermes con el bundle de desarrollo sin optimizar, las herramientas de depuración y la conexión con Metro. En una build de producción la cifra es mucho menor. Lo que controla nuestro código se ve en el panel de caché (L1 ≤ 64 MB). Para evaluar fugas lo que importa es la **tendencia**: si al hacer scroll largo y volver la cifra crece sin parar, hay una fuga; si sube y se estabiliza, el presupuesto está funcionando.

## 5.12 Hilos en la Fase 5

| Trabajo | Hilo |
|---|---|
| Scroll de FlashList, pintar el bitmap | UI thread (nativo) |
| `acquire`, LRU, conteos, dedupe, callbacks de viewability | JS thread (lógica ligera, O(1)) |
| Descarga HTTP (cancelable) | Hilo de red nativo |
| Escribir el `.part`, `move`, `delete`, leer `size` | Hilo nativo de E/S |
| SHA-256 del nombre | Hilo nativo (`expo-crypto`) |
| Consultas al índice `image_cache` | Hilo nativo de SQLite |
| **Decodificar el JPEG** (`Image.loadAsync`) | **Hilo nativo de fondo** de expo-image (Glide en Android) |
| `ref.release()` | Libera memoria nativa (llamada síncrona por JSI) |

## 5.13 Cómo demostrarlo (panel en Perfil → Editar perfil)

`ImageCacheDiagnostics` se actualiza cada segundo y muestra: RAM usada/presupuesto, bitmaps y cuántos están en pantalla; disco usado/presupuesto y archivos; aciertos RAM/disco/red, deduplicadas, canceladas, en curso y desalojos.

1. **Vaciar disco** + **Vaciar RAM** → abre el feed → sube **red**.
2. Baja y vuelve arriba → sube **RAM** (aciertos L1, instantáneo).
3. **Vaciar RAM** (sin vaciar disco) → vuelve al feed → sube **disco**: la imagen **no se volvió a descargar**.
4. Con muchos posts, scroll **muy rápido** con el caché vacío → sube **canceladas**.
5. Abre Explorar (grilla) y luego el feed → la misma foto aparece con dos anchos distintos (dos entradas en RAM, un solo archivo en disco).

**Posts de prueba para scroll largo** (SQL Editor; duplica tus últimos 5 posts 40 veces = 200 posts):
```sql
insert into public.posts (author_id, image_path, caption, created_at)
select p.author_id, p.image_path, 'Post de prueba #' || g, now() - (g || ' minutes')::interval
from (select author_id, image_path from public.posts order by created_at desc limit 5) p,
     generate_series(1, 40) g;
```
(Comparten 5 imágenes, así que casi todo serán aciertos de caché. Sirve para medir FPS y reciclaje; para ver muchas descargas reales hace falta subir más fotos distintas.)

## 5.14 Preguntas probables del profe — Fase 5

**P43. ¿Cómo funciona tu caché de imágenes?**
Dos niveles propios. L1 en RAM: una LRU de `ImageRef` (bitmaps decodificados en memoria nativa) con presupuesto de 64 MB. L2 en disco: archivos en `Paths.cache` con un índice SQLite, 150 MB, desalojo por `last_access`. Si falla todo, red: URL firmada y descarga nativa cancelable. La llave es la ruta del archivo, no la URL.
- *Contrapregunta: "¿Qué guardas en RAM si JS no puede tener bitmaps?"* → `ImageRef`: un SharedRef que apunta al bitmap nativo por JSI. Se pinta directo con `<Image source={ref}>` y se libera con `release()`.
- *Contrapregunta: "¿Entonces sí usas una librería de imágenes?"* → expo-image solo pinta y decodifica lo que le doy. Nunca le paso una URL remota, así que su caché automático de red no participa. El cuándo, el dónde, el cuánto y el qué se desaloja lo controla nuestro motor.

**P44. ¿Cómo implementaste la LRU? ¿Qué complejidad tiene?**
Con un `Map` de JS, que conserva el orden de inserción. `get` hace delete + set para mover la clave al final, y el desalojo recorre desde el principio. Todo es O(1). Es la misma idea que hash map + lista doblemente enlazada, que el Map ya implementa. Tiene peso (bytes) y `canEvict` para no desalojar lo que está en pantalla.
- *Contrapregunta: "¿Y la del disco?"* → `ORDER BY last_access` con índice en SQLite. Es aproximada a propósito: los aciertos en RAM no actualizan el disco, para no escribir en SQLite durante el scroll.

**P45. ¿Cómo cancelas las descargas cuando una celda sale de pantalla?**
Cada celda crea un `AbortController` en su `useEffect`. El cleanup (por reciclaje de FlashList, desmontaje o salida del viewport vía `onViewableItemsChanged`) llama a `abort()`. El `signal` llega a `File.downloadFileAsync`, que cancela la petición HTTP en el lado nativo. Con deduplicación, la descarga solo se aborta si nadie más espera esa imagen.
- *Contrapregunta: "¿Qué es el reciclaje de FlashList y por qué complica esto?"* → FlashList reutiliza la misma instancia de celda para otro item cambiándole las props. Si no se cancelara, la respuesta tardía de la imagen vieja podría pintarse en la celda del post nuevo. Por eso el efecto depende de la llave, y el estado guarda `{ key, ref }` y solo pinta si la llave coincide.

**P46. ¿Cómo evitas OutOfMemory?**
Ver 5.10: decodificación reducida al tamaño en pantalla, presupuesto en bytes con LRU, `release()` explícito, pinning, respuesta a `memoryWarning` y a segundo plano, cancelación, y compresión al subir.
- *Contrapregunta: "¿Por qué no basta con el garbage collector?"* → El GC de Hermes solo ve el objeto JS pequeño (el SharedRef). No conoce los megabytes nativos detrás, así que no siente presión para recolectar. Hay que liberar a mano.

**P47. ¿Qué pasa si dos celdas piden la misma imagen al mismo tiempo?**
Deduplicación: un solo Job en `inflight` con un contador `waiters`. Hay una descarga y una decodificación, y las dos reciben el mismo bitmap y lo fijan (users = 2). Se desaloja solo cuando ambas lo sueltan.

**P48. ¿Por qué el nivel de RAM nace con `users = 1` y lo sueltas con `setTimeout(0)`?**
Para evitar una carrera: entre insertar en la LRU y que las celdas ejecuten su `.then(pin)`, otra inserción podría desalojar y liberar el bitmap. Los `.then` son microtareas y `setTimeout` es una macrotarea; el event loop vacía todas las microtareas antes de la siguiente macrotarea, así que la reserva se suelta cuando ya todas las celdas la fijaron.

**P49. ¿Por qué descargas a `.part` y luego renombras?**
Atomicidad. Si la descarga se cancela o la app muere a mitad, un archivo incompleto con el nombre final se leería como caché válido y daría una imagen corrupta. El rename dentro del mismo directorio es atómico.

**P50. ¿Por qué el caché de disco va en `Paths.cache` y los posts pendientes en `Paths.document`?**
El caché es regenerable (se vuelve a descargar), así que va donde el SO puede purgarlo si falta espacio. Una imagen que espera subirse no es regenerable, así que va en documentos, que persiste. El motor tolera la purga: si la fila existe pero el archivo no, se trata como miss.

**P51. ¿Cómo sabes que el feed va a 60 FPS? ¿Qué lo hace posible?**
Se mide con el Performance Monitor de Expo Go, que muestra los FPS de UI y de JS por separado. Lo hacen posible el reciclaje de FlashList, los selectores por celda, el React Compiler, el alto fijo, la decodificación nativa y reducida, y los bitmaps listos en RAM (tabla 5.11).
- *Contrapregunta: "¿Qué significa si bajan los FPS de JS pero no los de UI?"* → El scroll nativo va bien, pero el hilo JS está saturado (demasiados renders o cálculos): las celdas nuevas tardan en aparecer.

**P52. ¿Por qué decodificas a múltiplos de 256 px?**
Tamaños discretos para aumentar los aciertos: pantallas o celdas de tamaños parecidos comparten la misma entrada. El costo es algo más de memoria por imagen (se redondea hacia arriba), pero nunca más de lo que la pantalla puede mostrar.

**P53. Las pestañas no se desmontan. ¿No retienen memoria las imágenes de las pestañas que no estás viendo?**
Lo harían, y lo detecté en la prueba: "Vaciar RAM" no liberaba nada porque el feed y Explorar, montados en segundo plano, fijaban sus bitmaps. `CachedImage` usa `useIsFocused`: al perder el foco suelta el bitmap y olvida la referencia (`setLoaded(null)`), y al volver lo pide otra vez, normalmente con un acierto en RAM o disco. Así la pila de navegación se conserva sin retener memoria de imágenes.

**P54. El Performance Monitor dice 500 MB de RAM. ¿Tu app gasta eso?**
No: es la memoria de todo el proceso de Expo Go en modo desarrollo (Expo Go completo, Hermes con el bundle sin optimizar, herramientas de depuración). Nuestro caché de bitmaps está limitado a 64 MB y se ve en el panel. Para detectar fugas se mira la tendencia: si al hacer scroll largo la memoria se estabiliza, el presupuesto funciona; si crece sin parar, hay fuga.

---

# Fase 6 — Mensajería directa en tiempo real (Módulo 4)

## 6.1 Qué pide el enunciado y cómo se cumple

| Requisito | Cómo se cumple |
|---|---|
| Chat privado bidireccional mediante WebSockets (Supabase Realtime) | Una suscripción global `postgres_changes` a la tabla `messages` (INSERT y UPDATE) por el WebSocket de Supabase Realtime. Enviar = insertar una fila (vía la cola offline); recibir = evento INSERT en el socket. |
| Indicador "Escribiendo…" | **Broadcast** por un canal **privado** `chat:<id>`: eventos efímeros que no tocan la base de datos, con **throttle** al enviar (1 cada 2 s) y **timeout** al recibir (se apaga a los 3.5 s). |
| Confirmación de entrega | `delivered_at`: el celular del destinatario llama `mark_delivered` apenas recibe el evento (o `mark_all_delivered` al abrir la app / reconectar). |
| Confirmación de lectura ("Visto") | `read_at`: `mark_read` cuando el chat está abierto y enfocado. El remitente recibe el **UPDATE** por Realtime y cambia a "Visto". |
| Reordenamiento automático de la bandeja según el último mensaje | Trigger `touch_conversation` (servidor) + `bumpConversation` (cliente): cada mensaje nuevo sube su conversación al primer lugar en vivo. |

## 6.2 Archivos de esta fase

```
supabase/003_fase6.sql                       get_inbox, mark_all_delivered, can_access_chat_topic,
                                             políticas de realtime.messages (canal privado)
src/
├── domain/
│   ├── entities/Message.ts                  Message, InboxItem, statusOf(), postReference/parsePostReference, previewOf
│   ├── repositories/DirectMessageRepository.ts   contrato: bandeja, mensajes, confirmaciones, suscripción, typing
│   └── sync/SyncOperation.ts                + SEND_MESSAGE
├── data/
│   ├── repositories/SupabaseDirectMessageRepository.ts   Realtime (postgres_changes + broadcast privado), RPCs
│   └── sync/operationHandlers.ts            + SEND_MESSAGE (upsert idempotente)
├── presentation/
│   ├── stores/dmStore.ts                    bandeja, mensajes por chat, typing, no leídos, eventos en vivo, resync
│   └── components/MessageBubble.tsx         burbuja + tarjeta de post compartido (referencia interna)
└── app/
    ├── _layout.tsx                          startDirectMessages(userId) mientras haya sesión
    ├── inbox.tsx                            bandeja (orden en vivo, no leídos, "Escribiendo…")
    ├── chat/[id].tsx                        chat (FlatList invertida, estados, typing, paginación)
    └── share/[postId].tsx                   "Enviar a…" (compartir post por DM)
+ botón "Mensaje" en ProfileView, insignia de no leídos en el avión de papel, menú "Compartir" en PostCard
```

> ⚠️ Hay que ejecutar **`supabase/003_fase6.sql`** en el SQL Editor.

## 6.3 ¿Cómo funciona Supabase Realtime por dentro?

```
App A ──INSERT (HTTP/PostgREST)──▶ Postgres ──WAL──▶ Servidor Realtime ──WebSocket──▶ App B
                                      │                    │
                             trigger touch_conversation    evalúa RLS de B sobre la fila
                             (actualiza la bandeja)        antes de entregarla
```

- **WebSocket:** conexión TCP **persistente y bidireccional**. El servidor puede **empujar** datos al cliente en cualquier momento, sin que el cliente pregunte.
- **Frente a polling** (preguntar cada N segundos): el polling tiene latencia de hasta N segundos, gasta batería y datos aunque no haya nada nuevo, y multiplica las peticiones al servidor. El WebSocket entrega en ~100 ms y solo transmite cuando hay algo.
- **WAL (*Write-Ahead Log*):** registro donde Postgres anota cada cambio antes de aplicarlo. Realtime lo lee por **replicación lógica** (por eso las tablas se agregan a la publicación `supabase_realtime` en el esquema de la Fase 1) y lo convierte en eventos.
- **Seguridad:** antes de entregar un evento, Realtime verifica que el suscriptor pueda ver esa fila según **RLS** (`messages_select → is_member`). Nadie recibe mensajes de conversaciones ajenas.
- **Hilos:** el socket vive en el lado nativo (red); cada mensaje entrante se entrega como evento al **hilo JS**, que actualiza el store; React re-renderiza solo lo que cambió.

## 6.4 Tres mecanismos de Realtime y por qué cada uno

| Mecanismo | Se usa para | Por qué |
|---|---|---|
| **Postgres Changes** (`postgres_changes`) | Mensajes (INSERT) y confirmaciones (UPDATE de `delivered_at`/`read_at`) | Son datos que **deben persistir**: se guardan en la BD y el evento es la notificación del cambio. |
| **Broadcast** | "Escribiendo…" | Evento **efímero** cliente → cliente. No tiene sentido guardar en Postgres cada pulsación de tecla: sería carga inútil en la BD y en el WAL. |
| (Presence) | No se usa | Serviría para "en línea"; no lo pide el enunciado. |

## 6.5 Una sola suscripción global (no una por chat)

`SupabaseDirectMessageRepository.subscribe(userId)` abre **un** canal `dm:<userId>` con `postgres_changes` sobre **toda** la tabla `messages`, **sin filtro**:
- **RLS hace el filtro:** solo llegan filas de mis conversaciones.
- La **bandeja se actualiza aunque el chat no esté abierto** (subir la conversación, contar no leídos, insignia).
- **Menos canales** multiplexados en el WebSocket que uno por conversación.
- Se inicia en el layout raíz mientras haya sesión (`startDirectMessages`) y el **cleanup** lo cierra al cerrar sesión.
- ¿Por qué no filtrar por conversación? El filtro de `postgres_changes` solo admite una columna con `eq` (p. ej. `conversation_id=eq.X`): serviría para **un** chat, no para "todos los míos".

## 6.6 Enviar un mensaje (optimista + cola offline + eco)

```
Tocar "Enviar"
  1. Message con UUID del cliente, syncState: 'pending' → aparece YA (semitransparente, "Enviando…")
  2. bumpConversation → la conversación sube al primer lugar de la bandeja
  3. syncQueue.enqueue(SEND_MESSAGE)          ← SQLite; funciona sin red (Fase 3)
  …
  SyncEngine → upsert en messages (ON CONFLICT DO NOTHING) → trigger touch_conversation
  4. onOperationCompleted → quita 'pending' → "Enviado"
  5. Realtime devuelve el INSERT (eco) con el MISMO id → mergeMessages lo REEMPLAZA (no duplica)
```

- **Idempotente** como todo lo de la cola: si el reintento llega dos veces, la PK del `id` lo ignora.
- Si la app se reinicia con mensajes en cola, `loadMessages` los reconstruye desde `syncQueue.pendingOperations()` y siguen visibles como "Enviando…".
- Rechazo permanente (p. ej. ya no soy miembro) → `syncState: 'failed'` → ícono rojo "No se envió".

## 6.7 Estados del mensaje: Enviando → Enviado → Entregado → Visto

`statusOf(message)` **deriva** el estado de los datos (no se guarda aparte, así nunca queda inconsistente):

| Estado | Condición | Quién lo produce |
|---|---|---|
| Enviando | `syncState = 'pending'` | Cliente (optimista) |
| No se envió | `syncState = 'failed'` | Cola: rechazo permanente |
| Enviado | en el servidor, `delivered_at` nulo | Servidor aceptó el INSERT |
| **Entregado** | `delivered_at` no nulo | El **celular del destinatario** recibió el evento y llamó `mark_delivered` (RPC) |
| **Visto** | `read_at` no nulo | El destinatario tenía **el chat abierto y enfocado** → `mark_read` (RPC) |

- `mark_delivered` / `mark_read` son **RPC `security definer`** que solo tocan mensajes **del otro** (`sender_id <> auth.uid()`) y verifican `is_member`. Así el cliente no necesita permiso general de UPDATE sobre `messages` (no podría editar el texto de nadie).
- El `UPDATE` que hacen dispara un evento Realtime → el **remitente** recibe `onUpdate` → su burbuja pasa a "Entregado" o "Visto".
- Como Instagram, el estado se muestra solo **bajo mi último mensaje**.
- **Entregado sin la app abierta:** si el destinatario tenía la app cerrada, al abrirla (o al reconectar) llama `mark_all_delivered` (una sola consulta para todas sus conversaciones).

### ¿Cuándo cuenta como "Visto"?

`activeConversationId` en el store se pone **solo mientras la pantalla del chat tiene el foco** (`useFocusEffect` → `setActiveConversation(id)` / `null` al salir) **y** la app está en primer plano (`AppState.currentState === 'active'`). Si llega un mensaje con el chat abierto → `mark_read` inmediato. Si el chat está en segundo plano → solo "Entregado" y suma a no leídos.

## 6.8 "Escribiendo…" (Broadcast en canal privado)

- Al abrir el chat: `joinTypingChannel(id)` → canal `chat:<id>` con `config: { private: true, broadcast: { self: false } }`.
  - `self: false`: no recibo mis propios eventos.
  - `private: true`: Realtime verifica las políticas sobre **`realtime.messages`** (`dm_channel_read` / `dm_channel_write` de `003_fase6.sql`). La función `can_access_chat_topic(topic)` valida el formato con regex **antes** de convertir a UUID (un topic malformado no debe dar error) y llama `is_member`. **Solo los dos participantes** pueden escuchar y emitir.
- **Enviar con *throttle*:** `notifyTyping()` se llama en cada tecla, pero el repositorio envía **como máximo 1 evento cada 2 s**. Throttle = "como máximo una vez cada X" (a diferencia del *debounce* de la búsqueda = "solo cuando dejas de teclear X ms").
- **Recibir con *timeout*:** `peerTyping(id)` enciende el indicador y (re)inicia un timer de 3.5 s. Si no llega otro evento, se apaga solo. Si llega un **mensaje** del otro, se apaga de inmediato.
- ¿Por qué timeout y no un evento "dejé de escribir"? Porque ese evento se puede **perder** (el otro cierra la app, se cae la red). Con timeout el indicador **nunca queda pegado**.
- Se ve en la cabecera del chat, como burbuja al final de la conversación y en la bandeja (en cursiva).
- Al salir del chat, `leave()` cierra el canal (cleanup).

## 6.9 Reordenamiento de la bandeja

- **Servidor:** trigger `touch_conversation` (Fase 1) actualiza `last_message_at`, `last_message_preview` y `last_sender_id` en la misma transacción del INSERT. `get_inbox()` ordena por `last_message_at desc` y cuenta no leídos (`read_at is null` de mensajes del otro) en **una sola consulta**.
- **Cliente, en vivo:** `bumpConversation(id)` saca la conversación y la pone **al frente**. Como un mensaje nuevo **siempre** es el más reciente, no hace falta reordenar toda la lista: basta moverla, **O(n)** en vez de O(n log n).
- Si llega un mensaje de una conversación **que no está** en la bandeja (alguien me escribe por primera vez), se recarga la bandeja completa para traer el perfil del otro.
- La insignia del avión de papel suma los no leídos con un **selector** (`selectUnreadTotal`) → solo se re-renderiza el botón.

## 6.10 Reconexión y eventos perdidos (contrapregunta segura)

**Problema:** si el WebSocket se cae (sin red, el SO suspende la app en segundo plano), supabase-js **se reconecta solo**, pero **los eventos emitidos mientras estaba caído NO se reenvían**.

**Solución (`resync`):**
- El callback de `subscribe((status) => …)` recibe `SUBSCRIBED` cada vez que el canal se (re)establece. El primero es la suscripción normal; **cualquier `SUBSCRIBED` posterior significa que hubo una reconexión** → `onResubscribed` → `resync()`.
- También al volver a **primer plano** (`AppState 'active'`).
- `resync()`: recarga la bandeja (orden y no leídos correctos), `mark_all_delivered`, recarga los mensajes del chat abierto y lo marca como leído.
- Principio: **el WebSocket es una optimización de latencia; la fuente de verdad es la BD.** Ante cualquier duda, se vuelve a consultar.

## 6.11 Lista del chat: `FlatList` invertida

- `inverted`: la lista se dibuja **de abajo hacia arriba**. El índice 0 queda abajo, así que los datos van del más nuevo al más viejo (`[...messages].reverse()`).
- Ventajas: arranca **pegada al último mensaje** sin calcular offsets ni hacer `scrollToEnd`; los mensajes nuevos aparecen abajo sin mover lo que estás leyendo; `onEndReached` (que en una lista invertida está **arriba**) carga los mensajes más viejos (**paginación por cursor**: `created_at < el más viejo`).
- ¿Por qué `FlatList` y no FlashList aquí? FlashList v2 **no tiene** la prop `inverted` (verificado en sus tipos instalados); la reemplazó por `maintainVisibleContentPosition: { startRenderingFromBottom: true }`. Para un chat, `FlatList` invertida es el patrón probado, y una conversación se carga de a 30 mensajes, así que el reciclaje de FlashList no es crítico aquí como en el feed de imágenes.
- `useMemo` para invertir la lista solo cuando cambian los mensajes, no en cada tecla del input.

## 6.12 Referencias internas: compartir un post por DM

- Menú "Compartir" del post: **"Enviar por mensaje"** (referencia **interna**) o **"Compartir enlace"** (deep link **externo**, Fase 2).
- El mensaje guarda el texto `[post:<uuid>]` (`postReference`). `parsePostReference` lo detecta y `MessageBubble` muestra una **tarjeta** con autor, imagen (motor de caché) y descripción. Al tocarla navega a `/post/<id>` **dentro** de la app.
- **La privacidad se respeta:** la tarjeta carga el post con `ensurePost` → RLS. Si el destinatario no puede ver esa cuenta privada, ve "Publicación no disponible". Compartir un enlace **no** salta la privacidad.
- La vista previa de la bandeja muestra "Envió una publicación" (`previewOf`).
- Viaja por la **misma cola offline** que cualquier mensaje.

## 6.13 Hilos en la Fase 6

| Trabajo | Hilo |
|---|---|
| Mantener el WebSocket abierto, recibir y enviar frames | Red nativa |
| Procesar el evento, actualizar el store, reordenar la bandeja, timers de typing | JS thread |
| Escribir `SEND_MESSAGE` en la cola | Hilo nativo de SQLite |
| RPCs (`mark_read`, `get_inbox`…) | Hilo de red nativo |
| Scroll de la lista del chat, teclado | UI thread |

## 6.14 Preguntas probables del profe — Fase 6

**P55. ¿Cómo funciona tu chat en tiempo real?**
Supabase Realtime sobre WebSocket. Enviar es insertar en `messages` (por la cola offline, con UUID del cliente). Postgres escribe en el WAL, el servidor Realtime lo lee por replicación lógica, verifica RLS y empuja el evento por el socket al otro participante. Tengo una sola suscripción global a `messages` y RLS filtra para que solo me lleguen mis conversaciones.
- *Contrapregunta: "¿Por qué WebSocket y no polling?"* → Latencia de ~100 ms contra hasta N segundos, y sin gastar batería ni peticiones cuando no hay nada nuevo. El servidor empuja; el cliente no pregunta.
- *Contrapregunta: "¿Cómo evitas que alguien escuche mensajes ajenos?"* → Realtime evalúa RLS (`is_member`) antes de entregar cada evento.

**P56. ¿Cómo implementaste "Escribiendo…"? ¿Por qué no lo guardas en la BD?**
Con Broadcast en un canal privado `chat:<id>`: son eventos efímeros cliente a cliente que no pasan por Postgres. Guardar cada pulsación sería carga inútil en la BD y el WAL. Envío con throttle (1 cada 2 s) y recibo con timeout (se apaga a los 3.5 s sin eventos).
- *Contrapregunta: "¿Por qué timeout y no un evento de 'dejé de escribir'?"* → Porque ese evento se puede perder (red caída, app cerrada) y el indicador quedaría pegado.
- *Contrapregunta: "¿Qué diferencia hay entre throttle y debounce?"* → Throttle: como máximo una vez cada X ms (typing). Debounce: solo después de X ms sin actividad (búsqueda).
- *Contrapregunta: "¿Quién puede escuchar ese canal?"* → Es privado: Realtime evalúa las políticas sobre `realtime.messages` con `can_access_chat_topic`, así que solo los dos miembros.

**P57. ¿Cómo funcionan "Entregado" y "Visto"?**
Son columnas `delivered_at` y `read_at`. Cuando el celular del destinatario recibe el evento, llama `mark_delivered`; si tiene el chat abierto y enfocado, `mark_read`. Ese UPDATE genera un evento Realtime que llega al remitente y actualiza su burbuja. El estado se deriva con `statusOf()`.
- *Contrapregunta: "¿Y si el destinatario tenía la app cerrada?"* → Al abrirla o reconectar se llama `mark_all_delivered`.
- *Contrapregunta: "¿Por qué RPC y no un UPDATE directo?"* → Para no dar permiso general de UPDATE sobre `messages`: la RPC solo toca `delivered_at`/`read_at` de mensajes del otro y verifica membresía.

**P58. ¿Cómo se reordena la bandeja?**
En el servidor, el trigger `touch_conversation` actualiza `last_message_at` en la misma transacción del mensaje, y `get_inbox` ordena por esa columna. En el cliente, cada evento mueve la conversación al frente (O(n)), porque un mensaje nuevo siempre es el más reciente y no hace falta ordenar todo.

**P59. ¿Qué pasa si se cae la conexión mientras te escriben?**
supabase-js reconecta el socket solo, pero los eventos de ese intervalo no se reenvían. Detecto la reconexión porque el callback de `subscribe` vuelve a dar `SUBSCRIBED`, y también resincronizo al volver a primer plano: recargo la bandeja y el chat abierto, y marco como entregado. El socket es una optimización; la verdad está en la BD.

**P60. ¿Qué pasa si envío un mensaje sin internet?**
Aparece al instante como "Enviando…" (UUID del cliente, optimista) y se encola `SEND_MESSAGE` en SQLite. Al volver la red, el SyncEngine lo envía en orden. El eco de Realtime trae el mismo id y reemplaza al optimista, sin duplicados.

**P61. ¿Por qué `FlatList` invertida en el chat?**
Arranca pegada al último mensaje sin calcular posiciones, los nuevos aparecen abajo sin mover lo que lees, y el final de la lista (arriba) carga los mensajes viejos con paginación por cursor. En FlashList v2 `inverted` ya no existe; para un chat paginado de a 30, FlatList invertida es el patrón probado.

**P62. ¿Cómo compartes un post por mensaje sin romper la privacidad?**
El mensaje lleva una referencia `[post:<uuid>]`, no la imagen. La tarjeta carga el post con las credenciales del destinatario, así que RLS decide: si no puede ver la cuenta privada, ve "Publicación no disponible".

---

# Fase 7 — Historias efímeras de 24 h (Módulo 5)

## 7.1 Qué pide el enunciado y cómo se cumple

| Requisito | Cómo se cumple |
|---|---|
| Visualización horizontal de avatares | `StoriesBar`: `ScrollView` horizontal como **cabecera del feed**. "Tu historia" primero (con botón +), luego autores con historias sin ver, luego los ya vistos. Anillo de colores (`expo-linear-gradient`) si hay sin ver; gris si ya se vieron todas. |
| Apertura a pantalla completa | Ruta `stories/[userId]` en la pila raíz con `presentation: 'fullScreenModal'`, fondo negro, barra de estado oculta. Recorre todas las historias del autor y sigue con el siguiente autor. |
| Barras de progreso de reproducción automática | Una barra por historia. La activa se llena en 5 s con **Reanimated** (`withTiming` sobre un `SharedValue`) **en el UI thread**. Al terminar, avanza sola. |
| Pausa interactiva al mantener presionado | `Gesture.LongPress` (200 ms) cuyo callback es un **worklet en el UI thread**: `cancelAnimation(progress)` detiene la barra en el mismo frame. Al soltar, se **reanuda con el tiempo restante**. Los controles se ocultan mientras está en pausa. |
| Persistencia local del estado "visto" | Tabla **`story_seen` en SQLite** (migración v4). Se marca al empezar a reproducir cada historia. Define el anillo gris y dónde se retoma (primera no vista). |
| Efímeras (24 h) | `expires_at = now() + 24 h` lo pone el **servidor**; la política RLS `stories_select` exige `expires_at > now()`. El cliente también filtra por si la app queda abierta pasadas las 24 h, y purga las marcas locales vencidas. |

## 7.2 Archivos de esta fase

```
supabase/004_fase7.sql                      get_story_feed(), índice stories(expires_at)
src/
├── core/media/imageProcessing.ts           + pickStoryImage() (recorte 9:16)
├── domain/
│   ├── entities/Story.ts                   Story, StoryGroup, groupStories(), stepStory(), peekNext(),
│   │                                       firstUnseenIndex(), isExpired()   (funciones PURAS)
│   ├── repositories/StoryRepository.ts
│   └── sync/SyncOperation.ts               + CREATE_STORY
├── data/
│   ├── local/database.ts                   + migración v4: story_seen
│   ├── local/StorySeenDao.ts               seenIds, markSeen (INSERT OR IGNORE), purgeExpired
│   ├── local/pendingFiles.ts               persistPendingFile() (compartido con posts)
│   ├── repositories/SupabaseStoryRepository.ts
│   └── sync/operationHandlers.ts           + CREATE_STORY (upload idempotente + insert)
└── presentation/
    ├── stores/storiesStore.ts              historias, "vistos", grupos calculados, crear (optimista)
    ├── components/StoriesBar.tsx           fila de avatares con anillo
    └── app/stories/[userId].tsx            VISOR: Reanimated + Gesture Handler
```

> ⚠️ Ejecutar **`supabase/004_fase7.sql`** en el SQL Editor.

## 7.3 UI thread vs JS thread — el corazón de esta fase

### El problema que resuelve Reanimated

Si la barra de progreso se animara desde JavaScript (p. ej. `setInterval` + `setState` cada 16 ms):
1. Cada frame: el timer corre en el **hilo JS** → `setState` → React re-renderiza → Fabric manda el nuevo ancho al **UI thread**.
2. Si el hilo JS está ocupado (decodificando la respuesta de la red, recalculando el feed, recolectando basura), **ese frame se pierde** → la barra da saltos.
3. Además, 60 re-renders por segundo de React solo para una barra es trabajo inútil.

### La solución: animación en el UI thread

- **`useSharedValue(0)`** crea un valor que vive en **los dos hilos** (sincronizado por JSI). El UI thread lo puede leer y escribir sin pasar por JS.
- **`withTiming(1, { duration, easing: linear })`** describe la animación; Reanimated la **ejecuta en el UI thread**, calculando el valor en cada frame (vsync).
- **`useAnimatedStyle(() => ({ width: progress.get() * 100 + '%' }))`** es un **worklet**: una función que Reanimated copia al **runtime de JS del UI thread** y ejecuta en cada frame. El ancho cambia **60 veces por segundo sin un solo re-render de React**.
- **Resultado:** la barra avanza fluida **aunque el hilo JS esté bloqueado**.

### ¿Qué es un *worklet*?

Una función marcada con `'worklet'` (o los callbacks de `useAnimatedStyle`, gestos, etc., que lo son automáticamente). El plugin de Babel de Reanimated/Worklets la **serializa** al compilar y la ejecuta en un **segundo runtime de JavaScript que vive en el UI thread**. Por eso puede leer `SharedValue`s y llamar `cancelAnimation` sin ir al hilo JS.

- `runProgress(progress, ms, onDone)` está marcado `'worklet'` → se llama **desde el hilo JS** (en el `useEffect` al empezar una historia) **y desde el UI thread** (en el gesto al soltar la pausa).

### Volver del UI thread al hilo JS: `scheduleOnRN`

Cuando la animación termina, hay que **cambiar de historia**, y eso es estado de React (hilo JS). El callback de `withTiming` corre en el UI thread → `scheduleOnRN(goNext)` **agenda** `goNext` en el hilo JS (RN = React Native runtime). En Reanimated 4 esta API reemplaza a `runOnJS` (verificado en los tipos de `react-native-worklets` instalados).

- `withTiming(..., (finished) => { if (finished) scheduleOnRN(onDone) })`: `finished` es `false` si la animación se **canceló** (pausa, cambio de historia, cierre) → no avanza por error.

### Tabla de hilos de la Fase 7

| Trabajo | Hilo |
|---|---|
| Avance de la barra de progreso (`withTiming`, `useAnimatedStyle`) | **UI thread** (worklet) |
| Detectar pulsación larga / toque / arrastre | **UI thread** (Gesture Handler nativo + worklets) |
| **Pausar** (`cancelAnimation`) y **reanudar** al soltar | **UI thread** (worklet en `onStart`/`onFinalize`) |
| Ocultar controles en pausa, arrastrar para cerrar (`translateY`, opacidad) | **UI thread** (`useAnimatedStyle`) |
| Cambiar de historia (`setPos`), marcar como vista, cerrar el visor | **JS thread** (vía `scheduleOnRN`) |
| Descargar y decodificar la imagen, precargar la siguiente | Hilos nativos (motor de caché, Fase 5) |
| Escribir en `story_seen` | Hilo nativo de SQLite |

## 7.4 Gestos (`react-native-gesture-handler`)

```ts
const gesture = Gesture.Race(pan, Gesture.Exclusive(longPress, tap));
```

| Gesto | Configuración | Acción | Hilo del callback |
|---|---|---|---|
| **LongPress** | `minDuration(200)`, `maxDistance(30)` | `onStart`: `paused = true` + `cancelAnimation`. `onFinalize`: reanudar con el tiempo restante | UI (worklet) |
| **Tap** | — | `x < ancho/3` → anterior; si no → siguiente (`scheduleOnRN`) | UI → JS |
| **Pan** (abajo) | `activeOffsetY(20)`, `failOffsetX([-20,20])` | Pausa; sigue el dedo; si baja > 120 px cierra, si no vuelve con animación y reanuda | UI → JS (cerrar) |

- **`Exclusive(longPress, tap)`**: el long press tiene prioridad; el tap solo se reconoce si el long press **falla** (el dedo se levantó antes de 200 ms). Sin esto, al soltar una pausa también se dispararía "siguiente".
- **`Race(pan, …)`**: el primer gesto que se active gana y cancela a los demás (si empiezas a arrastrar hacia abajo, no cuenta como toque ni pausa).
- Gesture Handler reconoce los gestos **en el lado nativo** (no con el sistema de toques de JS), por eso responden aunque el hilo JS esté ocupado.

### Reanudar con el tiempo restante

`remaining = (1 − progress) × 5000 ms`. Si pausas al 60 %, al soltar faltan **2 s** (no 5). Así la duración total de la historia es siempre 5 s de visualización real.

### Pausa por segundo plano

`AppState` (hilo JS): al salir de la app → `cancelAnimation`; al volver (si no estaba pausada a mano) → reanuda con el tiempo restante. Se puede leer `progress.get()` desde JS (lectura síncrona por JSI).

## 7.5 `get()` / `set()` en vez de `.value`

Con el **React Compiler** activo, Reanimated recomienda `sv.get()` / `sv.set(v)` en lugar de leer/asignar `sv.value`. El compilador asume que lo que devuelve un hook no se **muta** directamente; `.set()` es una llamada a método, no una mutación de propiedad, así que el compilador no la malinterpreta al memoizar.

## 7.6 Estado del visor

| Estado | Tipo | Por qué ahí |
|---|---|---|
| `groups` | `useState(() => snapshot)` | **Foto fija** de la bandeja al abrir (ver abajo). |
| `pos = { group, story, done }` | `useState` (JS) | Qué historia se muestra. Cambia pocas veces → estado de React. |
| `readyId` | `useState` (JS) | Id de la historia cuya imagen ya está lista; `ready = readyId === story.id` (estado **derivado**). |
| `progress`, `paused`, `running`, `dragY` | `useSharedValue` (UI + JS) | Cambian **cada frame** o se leen desde worklets → no deben ser estado de React. |

### Foto fija (*snapshot*) de los grupos

Al ver una historia se marca como vista → `storiesStore` recalcula los grupos → el orden cambia (los vistos pasan al final). Si el visor leyera la lista **viva**, `groups[pos.group]` apuntaría a **otra persona** a mitad de la reproducción. Por eso el visor toma una copia con `useState(() => useStories.getState().groups)` al montarse y navega sobre ella. La bandeja del feed sí se actualiza en vivo.

### Navegación con funciones puras (`stepStory`)

`goNext = () => setPos((p) => stepStory(groups, p, 1))` usa la **forma funcional** de `setState`: no captura `pos` en el closure, así que el callback que recibe la animación (creado varios segundos antes) **nunca queda desactualizado** (*stale closure*). `stepStory` es pura: siguiente historia → siguiente autor → `done`. Cuando `done` pasa a `true`, un efecto cierra el visor.

### La barra no avanza mientras la imagen carga

El efecto de reproducción depende de `ready`. Mientras la imagen no llega, `progress = 0` y no hay animación → no se "gasta" tiempo de la historia en una pantalla negra.

## 7.7 Imágenes en el visor (integración con la Fase 5)

- La historia actual se pide al **motor de caché** (`imageCache.acquire`) con el ancho de la pantalla en píxeles. `CachedImage` pide la misma imagen con el mismo ancho → **deduplicación** (una sola carga) → `users = 2`.
- **Precarga:** en el mismo efecto se pide la **siguiente** historia (`peekNext`) y se **suelta enseguida** (`h.release()`). Queda decodificada en la LRU de RAM, sin fijar, así que al avanzar aparece **instantánea**. Si el usuario avanza rápido, el `AbortController` del cleanup **cancela** las cargas que ya no sirven.
- Historias creadas offline: se muestran desde el archivo local (`localImageUri`) y se consideran listas de inmediato.

## 7.8 Estado "visto" local (SQLite)

- Tabla `story_seen(story_id PK, seen_at, expires_at)`, migración **v4**.
- `markStorySeen(story)`: primero en **memoria** (el anillo se vuelve gris al instante, `groups` recalculado), luego **SQLite** en un hilo nativo. `INSERT OR IGNORE`: ver la misma historia dos veces no duplica ni cambia la fecha.
- **¿Por qué local y no en el servidor?** Es lo que pide el enunciado ("persistencia local"), es instantáneo y funciona **sin red**. Trade-off honesto: si entras desde otro celular, allí aparecen como no vistas. (Instagram sí lo sincroniza para mostrarle al autor quién vio su historia; eso no se pidió.)
- **Limpieza:** se guarda `expires_at` de la historia; en cada carga `purgeExpired()` borra las marcas de historias vencidas → la tabla **no crece para siempre**.
- **Retomar:** al abrir un autor se empieza en `firstUnseenIndex()`, la primera historia que no has visto.

## 7.9 Expiración de 24 h

- **Servidor (fuente de verdad):** `expires_at default now() + interval '24 hours'` en la tabla (Fase 1). El ejecutor `CREATE_STORY` **no envía** `expires_at`: el reloj del celular puede estar mal o manipulado.
- **RLS:** `stories_select using (expires_at > now() and can_view(author_id))` → una historia vencida **no se puede leer**, aunque alguien llame a la API directamente. Además `can_view` aplica la privacidad: no ves historias de cuentas privadas que no sigues.
- `get_story_feed()` (`security invoker`) solo devuelve historias **mías y de cuentas que sigo** (aceptadas), activas, ordenadas por autor y fecha. Índice en `expires_at` para que el filtro no recorra toda la tabla.
- **Cliente:** `groupStories` descarta las que vencieron mientras la app estaba abierta (`isExpired`).
- La imagen queda en Storage después de vencer (no hay un job de borrado). En producción se agregaría una tarea programada (`pg_cron`) que borre filas y archivos vencidos.

## 7.10 Crear una historia

`StoriesBar` → "+" (o tocar "Tu historia" si no tienes) → `pickStoryImage()` (recorte **9:16**) → `compressForUpload` (1080 px, JPEG 80 %, hilo nativo, `release()`) → `createStory()`:
- Copia persistente en documentos (`persistPendingFile`, compartido con los posts).
- Borrador visible **al instante** en "Tu historia" (imagen local, "Publicando…" en el visor).
- `CREATE_STORY` en la **cola offline** → sube a `media/<uid>/stories/<id>.jpg` con upsert + insert idempotente.
- Al completarse se recargan las historias (el borrador se reemplaza por la real); si falla permanentemente, se quita y se avisa.

## 7.11 Orden de la bandeja de historias (`groupStories`, función pura)

1. **Mi historia** primero.
2. Autores con historias **sin ver**.
3. Autores con todo **visto**.
4. Dentro de cada bloque, por la historia **más reciente** del autor.
Las historias de cada autor se ordenan cronológicamente (así se reproducen).

## 7.12 Preguntas probables del profe — Fase 7

**P63. ¿Cómo funciona la barra de progreso? ¿En qué hilo corre?**
Es un `SharedValue` animado con `withTiming` de 0 a 1 en 5 s. Reanimated ejecuta la animación en el UI thread, y `useAnimatedStyle` (un worklet) traduce el valor a ancho en cada frame. No hay ni un re-render de React. Al terminar, el callback usa `scheduleOnRN` para pasarle `goNext` al hilo JS, que cambia de historia.
- *Contrapregunta: "¿Qué pasa si el hilo JS se bloquea 500 ms?"* → La barra sigue fluida porque no depende del hilo JS. Lo único que se retrasa es el cambio de historia al final.
- *Contrapregunta: "¿Por qué no `setInterval` + `useState`?"* → 60 re-renders por segundo en el hilo JS, y cualquier bloqueo de JS haría saltar la barra.

**P64. ¿Cómo implementaste la pausa al mantener presionado?**
Con `Gesture.LongPress().minDuration(200)`. Su `onStart` es un worklet en el UI thread que hace `cancelAnimation(progress)`, así que la barra se detiene en el mismo frame, sin ir a JS. Al soltar (`onFinalize`), reanudo con el tiempo restante: `(1 − progress) × 5000`. Mientras está en pausa, los controles se ocultan con una opacidad animada.
- *Contrapregunta: "¿Cómo evitas que al soltar también avance a la siguiente?"* → `Gesture.Exclusive(longPress, tap)`: el tap solo cuenta si el long press falla.
- *Contrapregunta: "¿Y si la app pasa a segundo plano?"* → `AppState` cancela la animación y la reanuda al volver.

**P65. ¿Qué es un worklet y qué es `scheduleOnRN`?**
Un worklet es una función que el plugin de Babel prepara para ejecutarse en un segundo runtime de JS que vive en el UI thread. Puede leer `SharedValue`s y animar sin pasar por el hilo de React. `scheduleOnRN` agenda una función normal en el hilo JS de React Native desde un worklet; en Reanimated 4 reemplaza a `runOnJS`.

**P66. ¿Dónde guardas el estado "visto" y por qué?**
En SQLite local (`story_seen`), como pide el enunciado. Es instantáneo y funciona sin red. Uso `INSERT OR IGNORE`, guardo `expires_at` y purgo las marcas vencidas para que la tabla no crezca. El anillo gris y el punto de reanudación salen de ahí.
- *Contrapregunta: "¿Y si abro la app en otro celular?"* → Las verá como no vistas: es un estado por dispositivo, un trade-off consciente. Sincronizarlo requeriría una tabla en el servidor.

**P67. ¿Cómo garantizas que desaparezcan a las 24 horas?**
El servidor pone `expires_at` (no el cliente, cuyo reloj no es confiable), y la política RLS exige `expires_at > now()`, así que una historia vencida no se puede leer ni por API. El cliente también las filtra si la app sigue abierta.

**P68. ¿Por qué el visor usa una "foto fija" de los grupos?**
Porque al marcar una historia como vista, la bandeja se reordena (los vistos van al final). Si el visor navegara sobre la lista viva, el índice del grupo apuntaría a otra persona a mitad de la reproducción.

**P69. ¿Cómo logras que la siguiente historia aparezca sin pantalla negra?**
Precarga: mientras se ve una, se pide la siguiente al motor de caché y se suelta enseguida, así que queda decodificada en la LRU de RAM. Además, la barra no arranca hasta que la imagen actual está lista. Si se avanza rápido, el `AbortController` cancela las precargas que ya no sirven.

**P70. ¿Por qué `progress.get()` / `progress.set()` y no `progress.value`?**
Con el React Compiler activo, Reanimated recomienda `get`/`set`: el compilador asume que los valores devueltos por hooks no se mutan, y una asignación a `.value` parece una mutación. `set()` es una llamada a método y no confunde al compilador.

---

# Fase 8 — Auditoría final y preparación de la defensa

## 8.1 Auditoría de arquitectura

Se revisó todo el código contra la regla de dependencia de Clean Architecture:

| Revisión | Resultado |
|---|---|
| ¿`domain` importa React, React Native, Expo, Supabase u otras capas? | ✅ **Ninguna importación externa.** El dominio es TypeScript puro. |
| ¿Quién importa implementaciones de `data`? | Solo `di/container.ts` (composition root). |
| ❌ Encontrado: `CachedImage`, `ImageCacheDiagnostics` y el visor de historias importaban **tipos** de `data/imageCache` | ✅ Corregido con un **puerto** `core/cache/ImageCache.ts` (interfaz `ImageCache`, tipos `ImageHandle`, `ImageCacheStats`). `ImageCacheEngine implements ImageCache` y el contenedor lo exporta tipado como la interfaz. |

**¿Por qué el puerto del caché está en `core` y no en `domain`?** Porque expone `ImageRef` (un bitmap nativo de expo-image), un tipo de **infraestructura** que no tiene sentido en el dominio del negocio (posts, mensajes, historias). `core` contiene la infraestructura transversal (LRU, mutex, red, imágenes) que pueden usar todas las capas.

## 8.2 Deep link sin sesión (limitación resuelta)

**Antes:** si un link `instagramclone://post/<id>` abría la app sin sesión, `Stack.Protected` mandaba al login y el destino se perdía.

**Ahora:**
1. `+native-intent.tsx` calcula el destino (`/(tabs)/(home)/post/<id>`) y, **si no hay sesión** (o se está restaurando), lo guarda con `rememberDeepLink()` en `presentation/navigation/pendingDeepLink.ts` (una variable de módulo: no se dibuja, solo se consume una vez).
2. El layout raíz recuerda el `status` anterior con `useRef`. Cuando pasa de **`signedOut` → `signedIn`**, llama `consumeDeepLink()` y navega con `router.push` en un `setTimeout(0)` (para que `Stack.Protected` ya haya montado las rutas protegidas).
3. Si la app arrancó **ya con sesión** (`loading → signedIn`), el router abrió el link por sí solo; el pendiente se **descarta** para no navegar dos veces.
4. Con sesión activa no se guarda nada (evita que un link viejo se reabra en un login futuro).

## 8.2b ¿Por qué el link compartido por WhatsApp abre Chrome? (probado en el dispositivo)

Al compartir `exp://anonymous-8081.exp.direct/--/post/<id>` por WhatsApp y tocarlo, se abrió **Chrome** con `ERR_NGROK_3200 … endpoint is offline`. Dos causas:

1. **WhatsApp (y casi todas las apps de mensajería) solo hacen clickeables los links `http://` / `https://`.** Ignoró el `exp://` y convirtió el resto (`anonymous-8081.exp.direct/...`) en una URL web → Chrome. El link nunca llegó a Expo Go. Un scheme propio (`instagramclone://`) tendría el mismo problema.
2. *Endpoint offline*: en Expo Go el link apunta al tunnel de Metro del PC; si Metro está apagado, no hay destino.

**Cómo lo resuelve una app real:** Instagram comparte `https://www.instagram.com/p/<id>` y usa **Android App Links / iOS Universal Links**: el dominio publica un archivo de verificación (`/.well-known/assetlinks.json` en Android, `apple-app-site-association` en iOS) que demuestra que la app es dueña del dominio. Si la app está instalada, el SO abre el link **directamente en la app**; si no, abre la web. Requiere un dominio propio y una build de la app (no Expo Go); en Expo se configura con `android.intentFilters` (con `autoVerify`) y `ios.associatedDomains` en `app.json`.

**Cómo se prueba en Expo Go:** botón **"Abrir deep link de prueba"** (Perfil → Editar perfil, `DeepLinkTester.tsx`). Llama `Linking.openURL(Linking.createURL('post/<id>'))`, que lanza el link como un **intent del sistema operativo** (igual que si viniera de otra app): Android se lo entrega a Expo Go → `+native-intent.tsx` → abre el post en la pila de Home. Para probar el arranque en frío: `adb shell am start -a android.intent.action.VIEW -d "<url>"` con la app cerrada.

**P71. Si compartes el link por WhatsApp, ¿por qué no abre la app?**
Porque WhatsApp solo hace clickeables los links http(s): `exp://` o `instagramclone://` no son clickeables, y WhatsApp convirtió la parte del dominio en una URL web. En producción se usan App Links / Universal Links: un link `https` de un dominio verificado (`assetlinks.json`) que el SO abre en la app si está instalada o en la web si no. El código de ruteo (`+native-intent` y las rutas) sería el mismo; solo cambia cómo llega el link.

## 8.3 Limpieza

- Eliminado `Placeholder.tsx` (sin uso desde la Fase 4).
- Desinstaladas dependencias de la plantilla que no se usan: `@expo/ui`, `expo-glass-effect`, `expo-symbols`, `expo-web-browser`, `expo-device`. Si el profe revisa `package.json`, cada dependencia tiene un propósito.
- `README.md` del proyecto: instalación, orden de los SQL, variables de entorno, cómo correrlo y estructura.
- **`expo-doctor`: 21/21 verificaciones superadas.** `tsc --noEmit` y `expo lint` (con reglas del React Compiler) sin errores ni advertencias.

## 8.4 Mapa enunciado → evidencia (para tener a mano)

| Requisito del PDF | Dónde se demuestra en la app | Sección |
|---|---|---|
| Barra inferior persistente | 5 pestañas | 2.3 |
| Posts con imágenes, likes, comentarios anidados en tiempo real | Feed, Crear, Comentarios (2 celulares) | 4.4, 4.7, 4.9 |
| Compartir enlaces o referencias internas | Avión de papel del post → DM o enlace | 4.11, 6.12 |
| Público / privado con solicitud, aprobación y rechazo por reglas del backend | Editar perfil → Cuenta privada; Actividad → Confirmar/Eliminar | 1.3, 4.10 |
| Caché de dos niveles con LRU | Editar perfil → panel "Caché de imágenes" | 5.3–5.6, 5.13 |
| 60 FPS y cancelación al salir del viewport | Performance Monitor + contador "canceladas" | 5.9, 5.11 |
| Evitar memory leaks / OOM | "Vaciar RAM", presupuesto, release | 5.10 |
| UI optimista (0 ms) | Like y comentario en modo avión | 4.4 |
| Cola en SQLite, orden cronológico, conflictos | Editar perfil → panel "Cola de sincronización" | 3.x |
| Chat por WebSockets | Mensajes entre 2 celulares | 6.3–6.6 |
| Escribiendo…, entregado, visto | Chat entre 2 celulares | 6.7, 6.8 |
| Reordenamiento de la bandeja | Bandeja | 6.9 |
| Pila de navegación independiente por pestaña | Abrir posts en Home y Explorar, alternar | 2.4 |
| Deep linking `instagramclone://post/{uuid}` | Compartir enlace → abrirlo | 2.5, 8.2 |
| Historias 24 h, barras, pausa, "visto" local | Barra de historias del feed | 7.x |

## 8.5 Lista para el día de la defensa

**La noche anterior:**
- [ ] Supabase activo (los proyectos gratuitos se **pausan** tras ~1 semana sin uso: entra al panel y verifica que diga *Active*).
- [ ] Al menos 2–3 cuentas con posts, una **privada**, seguimientos entre ellas, una conversación y una historia de menos de 24 h. (Las historias vencen: **crea una nueva ese mismo día**.)
- [ ] Los 200 posts de prueba (sección 5.13) para mostrar scroll y FPS.
- [ ] Repasar el **Resumen de estudio** y las preguntas P1–P70.

**Antes de entrar:**
- [ ] Metro corriendo (`bash scripts/start-phone.sh`) y la app abierta en los **dos** celulares con cuentas distintas.
- [ ] Celulares cargados y con datos/Wi-Fi.
- [ ] VS Code abierto en el proyecto con `docs/DEFENSA.md` y `src/` a mano.

**Demo sugerida (≈ 3 min) si te piden mostrar la app:**
1. Feed con historias → abrir una historia → **mantener presionado** (pausa en el UI thread).
2. Like en **modo avión** → píldora "Sin conexión · 1 pendiente" → quitar modo avión → se sincroniza.
3. Chat entre los dos celulares: **Escribiendo…** → **Entregado** → **Visto**.
4. Perfil privado desde la otra cuenta → candado → Seguir → **Solicitado** → aprobar en Actividad.
5. Editar perfil → panel de caché: aciertos RAM / disco / red, **Vaciar RAM**.

---

# Problemas encontrados y cómo se resolvieron

| Problema | Causa | Solución |
|---|---|---|
| `Email signups are disabled` al registrarse | En Supabase estaba desactivado "Allow new users to sign up" | Activarlo en *Authentication → Sign In / Providers*. Dejar "Confirm email" en OFF para la demo. |
| TS: `useSegments()` tipado como tupla de 1 elemento | Typed routes infiere un tipo muy estricto | `useSegments() as string[]` |
| Lint `react/display-name` en íconos de tabs | La factory devolvía una función anónima | Devolver una función con nombre (`TabIcon`) |
| El celular no alcanza a Metro | WSL usa red NAT | `npx expo start --tunnel` (`scripts/start-phone.sh`) |
| Transacciones de SQLite no seguras con escrituras concurrentes | `withTransactionAsync` no es exclusiva; `withExclusiveTransactionAsync` hace fallar otras escrituras con `database is locked` (leído en los tipos de `expo-sqlite`) | Mutex en JS que serializa todas las escrituras (`write` / `writeTransaction`) |
| Distinguir "sin red" de "rechazado por el servidor" | supabase-js no lanza excepciones: devuelve `{ error, status }` | Confirmado en el código de `postgrest-js`: sin red devuelve `status: 0`. `ensureOk` + `classifyError` |
| Errores de Storage con otra forma | `StorageApiError` trae `status`; `StorageUnknownError` (fallo de red) no | `ensureStorageOk`: sin `status` → 0 → transitorio |
| Perfil ajeno en blanco | `ProfileView` cargaba perfil + contadores + seguimiento con `Promise.all` dentro de un `try { } catch {}` vacío: si fallaba **una** consulta (p. ej. `get_profile_stats` sin el SQL de la Fase 4) se perdían las tres y el error se tragaba en silencio | `Promise.allSettled`: cada carga es independiente; el perfil se muestra aunque fallen los contadores. Estados explícitos: cargando / no existe / error con "Reintentar". **Lección:** nunca un `catch {}` vacío en una carga de pantalla. |
| Registro que "no hacía nada" / login "incorrecto" | Con "Confirm email" activo, `signUp` crea el usuario **sin sesión** y la app no lo avisaba | `signUp` verifica `data.session` y explica qué pasó; mensajes específicos para "Email not confirmed", signups desactivados y username duplicado. Correo en minúsculas al registrar y al entrar. |
| Presentación importaba tipos de la capa `data` (violación de Clean Architecture) | `CachedImage`, el panel de caché y el visor usaban `ImageHandle`/`ImageCacheStats` definidos en `ImageCacheEngine` | Puerto `core/cache/ImageCache.ts`; el motor lo implementa y el contenedor lo exporta tipado como interfaz |
| Deep link perdido si no había sesión | `Stack.Protected` redirige al login y descarta el destino | `pendingDeepLink.ts` + consumo en la transición `signedOut → signedIn` |
| "Vaciar RAM" no liberaba casi nada | Las pestañas no se desmontan: el feed y Explorar, en segundo plano, seguían **fijando** sus bitmaps y la LRU no desaloja lo fijado | `useIsFocused` en `CachedImage`: sin foco se suelta el bitmap y se olvida la referencia; al volver se pide de nuevo (RAM/disco). La alerta del botón ahora dice cuántos se liberaron y cuántos siguen en pantalla. |
| Carrera: bitmap desalojado entre la inserción en la LRU y el `pin` de las celdas | Ventana entre la resolución de la Promise y la ejecución de los `.then` | Reserva `users = 1` al insertar, liberada con `setTimeout(0)` (después de todas las microtareas) |
| Tipos: `ViewStyle` no asignable al estilo de `expo-image` | `ImageStyle` no admite `overflow: 'scroll'` | La imagen se pinta con `absoluteFill` dentro de un `View` que recibe el estilo del llamador |
| Lint `react-hooks/set-state-in-effect` en `MediaImage` y Explorar | `setState` sincrónico dentro de un efecto causa renders en cascada | Estado **derivado** en el render (`resolved.path === path`) en vez de sincronizar con `setState` |

# Estado de verificación

| Ítem | Estado |
|---|---|
| Typecheck (`tsc --noEmit`) y lint | ✅ limpio |
| Bundle Android (`expo export`) | ✅ compila |
| Registro / login en dispositivo | ✅ (tras habilitar signups) |
| Pilas independientes por pestaña | ✅ probado en Android |
| Deep link en frío → pila de Home (`+native-intent`) | ⏳ pendiente de probar con `adb` |
| Fase 3: typecheck, lint, bundle Android | ✅ |
| Fase 3: demo en dispositivo (modo avión, coalescencia, fallidas) | ✅ probado en Android |
| Fase 4: typecheck, lint, bundle Android | ✅ |
| Fase 4: SQL `002_fase4.sql` ejecutado en Supabase | ✅ |
| Fase 4: prueba en dispositivo con 2 cuentas | ✅ |
| Fase 5: typecheck, lint, bundle Android | ✅ |
| Fase 5: Performance Monitor en scroll de 200 posts | ✅ UI 59 fps · JS 57 fps (Android) |
| Fase 5: "Vaciar disco" | ✅ |
| Fase 5: "Vaciar RAM" tras la corrección de `useIsFocused` | ✅ |
| Fase 6: typecheck, lint, bundle Android | ✅ |
| Fase 6: SQL `003_fase6.sql` ejecutado | ✅ |
| Fase 6: prueba con 2 dispositivos (mensajes, typing, entregado/visto, orden de bandeja, compartir post) | ✅ |
| Fase 7: typecheck, lint, bundle Android (worklets compilados) | ✅ |
| Fase 7: SQL `004_fase7.sql` ejecutado | ✅ |
| Fase 7: prueba en dispositivo | ✅ |
| Fase 8: `expo-doctor` 21/21, `tsc`, `lint`, bundle Android | ✅ |
| Fase 8: deep link compartido → abrir con sesión (pila de Home) | ⏳ pendiente |
| Fase 8: deep link → abrir **sin** sesión → iniciar sesión → abre el post | ⏳ pendiente |
