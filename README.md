# Instagram Clone — Parcial Desarrollo Móvil (Proyecto 3)

Red social estilo Instagram con **Expo SDK 57 (React Native 0.86, Nueva Arquitectura)**, que corre en **Expo Go**.

| Módulo | Implementación principal |
|---|---|
| 1. Feed y publicaciones | Feed paginado, posts con imagen, likes, comentarios anidados en tiempo real, compartir (DM y enlace), cuentas privadas con solicitud / aprobación / rechazo validadas por **RLS** en Postgres |
| 2. Caché de imágenes y 60 FPS | Motor propio de dos niveles: **RAM** (LRU de bitmaps decodificados) + **disco** (archivos + índice SQLite, LRU), cancelación al salir del viewport, FlashList |
| 3. UI optimista y offline-first | Cola de sincronización en **SQLite** (outbox), FIFO estricto, idempotencia, backoff exponencial, reconciliación |
| 4. Mensajería directa | Supabase Realtime (WebSocket): mensajes, "Escribiendo…", entregado / visto, bandeja ordenada en vivo |
| 5. Navegación, deep linking e historias | Pila independiente por pestaña (shared routes), `instagramclone://post/<id>`, historias de 24 h con Reanimated en el UI thread |

La explicación técnica completa (hilos, estado, decisiones y preguntas de defensa) está en **[docs/DEFENSA.md](docs/DEFENSA.md)**.

## Requisitos

- Node 20+ y npm.
- Un proyecto de [Supabase](https://supabase.com) (plan gratuito).
- Expo Go **SDK 57** en el celular.

## 1. Configurar Supabase

1. En **SQL Editor**, ejecutar **en este orden**:
   1. `supabase/schema.sql` — tablas, triggers, RLS, buckets de Storage, publicación de Realtime
   2. `supabase/002_fase4.sql` — feed, explorar, perfil, actividad
   3. `supabase/003_fase6.sql` — bandeja de mensajes y canal privado de "Escribiendo…"
   4. `supabase/004_fase7.sql` — historias
2. **Authentication → Sign In / Providers**: activar *Allow new users to sign up*; en **Email**, desactivar *Confirm email* (para la demo).

## 2. Variables de entorno

Crear `.env.local` en la raíz:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

La publishable key es pública por diseño; la seguridad la aplican las políticas RLS.

## 3. Ejecutar

```bash
npm install
npx expo start            # misma red Wi-Fi
npx expo start --tunnel   # si el celular no ve al PC (p. ej. WSL)
```

Escanear el QR con Expo Go.

## Deep links

- En Expo Go: `exp://<host>/--/post/<uuid>`
- En una development build: `instagramclone://post/<uuid>`

```bash
adb shell am start -a android.intent.action.VIEW -d "exp://<host>/--/post/<uuid>"
```

## Verificación

```bash
npx tsc --noEmit   # tipos
npx expo lint      # lint (incluye reglas del React Compiler)
npx expo-doctor    # salud del proyecto
```

## Estructura

```
src/
├── domain/        Entidades, contratos (interfaces) y reglas puras. Sin React ni Supabase.
├── data/          Implementaciones: Supabase, SQLite, cola de sincronización, motor de caché.
├── core/          Infraestructura transversal: LRU, mutex, red, imágenes, formato.
├── di/            Composition root: único lugar que conecta interfaces con implementaciones.
├── presentation/  Stores (Zustand), componentes y tema.
└── app/           Rutas de expo-router (cada archivo es una pantalla).
supabase/          Scripts SQL (esquema, RLS, funciones).
docs/DEFENSA.md    Guía técnica de defensa.
```
