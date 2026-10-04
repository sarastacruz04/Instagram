import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { AppState, PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import type { ImageHandle } from '@/core/cache/ImageCache';
import { timeAgo } from '@/core/format';
import { imageCache, mediaRepository } from '@/di/container';
import { firstUnseenIndex, peekNext, stepStory, type StoryPosition } from '@/domain/entities/Story';
import { Avatar } from '@/presentation/components/Avatar';
import { CachedImage } from '@/presentation/components/CachedImage';
import { markStorySeen, useStories } from '@/presentation/stores/storiesStore';

const DURATION_MS = 5000;

/**
 * Arranca (o reanuda) la barra de progreso hasta 1 en `remainingMs`.
 * 'worklet': se puede llamar desde el hilo JS (efecto) Y desde el UI thread (gesto).
 * La animación con withTiming corre en el UI THREAD: sigue fluida aunque JS esté ocupado.
 * Al terminar, el callback (que corre en el UI thread) usa scheduleOnRN para avisar al hilo JS.
 */
function runProgress(progress: SharedValue<number>, remainingMs: number, onDone: () => void) {
  'worklet';
  progress.set(
    withTiming(1, { duration: Math.max(0, remainingMs), easing: Easing.linear }, (finished) => {
      // finished=false si se canceló (pausa o cambio de historia): no avanzar.
      if (finished) scheduleOnRN(onDone);
    }),
  );
}

export default function StoryViewerScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const px = PixelRatio.getPixelSizeForLayoutSize(width);

  // FOTO FIJA de los grupos al abrir: marcar historias como vistas reordena la bandeja,
  // y si el visor leyera la lista viva los índices apuntarían a otra persona a mitad de camino.
  const [groups] = useState(() => useStories.getState().groups);
  const [pos, setPos] = useState<StoryPosition>(() => {
    const seen = new Set(Object.keys(useStories.getState().seen));
    const g = Math.max(0, groups.findIndex((x) => x.authorId === userId));
    return { group: g, story: groups[g] ? firstUnseenIndex(groups[g], seen) : 0, done: groups.length === 0 };
  });
  const group = groups[pos.group];
  const story = group?.stories[pos.story];

  // La barra NO avanza mientras la imagen no está lista (no se "gasta" tiempo cargando).
  const [readyId, setReadyId] = useState<string | null>(null);
  const ready = !!story && readyId === story.id;

  // Estado de animación: vive en el UI thread (SharedValue), no en React.
  const progress = useSharedValue(0);
  const paused = useSharedValue(false);
  const running = useSharedValue(false); // ¿hay una historia lista reproduciéndose?
  const dragY = useSharedValue(0);

  const goNext = useCallback(() => setPos((p) => stepStory(groups, p, 1)), [groups]);
  const goPrev = useCallback(() => setPos((p) => stepStory(groups, p, -1)), [groups]);
  const close = useCallback(() => router.back(), []);

  useEffect(() => {
    if (pos.done) router.back();
  }, [pos.done]);

  // 1) Cargar la imagen actual por el motor de caché y PRECARGAR la siguiente.
  useEffect(() => {
    if (!story) return;
    const controller = new AbortController();
    let handle: ImageHandle | null = null;

    if (story.localImageUri) {
      void Promise.resolve().then(() => setReadyId(story.id)); // archivo local: listo ya
    } else {
      imageCache
        .acquire(story.imagePath, () => mediaRepository.getSignedUrl(story.imagePath), px, controller.signal)
        .then((h) => {
          handle = h;
          setReadyId(story.id);
        })
        .catch(() => {});
    }

    // Precarga: se decodifica la siguiente historia mientras se ve esta, y se suelta enseguida
    // (queda en la LRU de RAM) → al avanzar aparece instantánea, sin pantalla negra.
    const next = peekNext(groups, pos);
    if (next && !next.localImageUri) {
      imageCache
        .acquire(next.imagePath, () => mediaRepository.getSignedUrl(next.imagePath), px, controller.signal)
        .then((h) => h.release())
        .catch(() => {});
    }

    return () => {
      controller.abort(); // si se avanzó rápido, cancela las cargas que ya no sirven
      handle?.release();
    };
  }, [story, groups, pos, px]);

  // 2) Reproducir: cuando la imagen está lista, marcar como vista y arrancar la barra.
  useEffect(() => {
    cancelAnimation(progress);
    progress.set(0);
    running.set(false);
    if (!ready || !story) return;
    markStorySeen(story); // estado "visto" LOCAL (SQLite)
    running.set(true);
    paused.set(false);
    runProgress(progress, DURATION_MS, goNext);
    return () => {
      running.set(false);
      cancelAnimation(progress);
    };
  }, [ready, story, goNext, progress, paused, running]);

  // 3) App a segundo plano → pausar; al volver → reanudar desde donde iba.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!running.get()) return;
      if (state !== 'active') cancelAnimation(progress);
      else if (!paused.get()) runProgress(progress, (1 - progress.get()) * DURATION_MS, goNext);
    });
    return () => sub.remove();
  }, [progress, paused, running, goNext]);

  // ---------------------------------------------------------------- gestos

  // MANTENER PRESIONADO = pausa. Corre como worklet en el UI THREAD: cancelAnimation se
  // ejecuta en el mismo hilo que la animación, sin ida y vuelta por JS → la barra se detiene
  // en el MISMO frame en que el dedo se queda quieto, aunque el hilo JS esté ocupado.
  const longPress = Gesture.LongPress()
    .minDuration(200)
    .maxDistance(30)
    .onStart(() => {
      paused.set(true);
      cancelAnimation(progress);
    })
    .onFinalize(() => {
      if (!paused.get()) return;
      paused.set(false);
      // Reanuda con el TIEMPO RESTANTE (no desde cero): progreso 0.6 → faltan 2 s de 5.
      if (running.get()) runProgress(progress, (1 - progress.get()) * DURATION_MS, goNext);
    });

  // TOQUE: tercio izquierdo = anterior; resto = siguiente (como Instagram).
  const tap = Gesture.Tap().onEnd((e) => {
    scheduleOnRN(e.x < width / 3 ? goPrev : goNext);
  });

  // DESLIZAR HACIA ABAJO = cerrar (con pausa mientras se arrastra).
  const pan = Gesture.Pan()
    .activeOffsetY(20)
    .failOffsetX([-20, 20])
    .onStart(() => cancelAnimation(progress))
    .onUpdate((e) => dragY.set(Math.max(0, e.translationY)))
    .onEnd((e) => {
      if (e.translationY > 120) {
        scheduleOnRN(close);
      } else {
        dragY.set(withTiming(0, { duration: 150 }));
        if (running.get()) runProgress(progress, (1 - progress.get()) * DURATION_MS, goNext);
      }
    });

  // Exclusive: si es pulsación larga, NO cuenta como toque. Race: el primero que se active gana.
  const gesture = Gesture.Race(pan, Gesture.Exclusive(longPress, tap));

  // Estilos animados: se calculan en el UI thread en cada frame, sin re-render de React.
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.get() }],
    opacity: 1 - Math.min(dragY.get() / 600, 0.5),
  }));
  // Al pausar se ocultan los controles, como en Instagram.
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: withTiming(paused.get() ? 0 : 1, { duration: 150 }),
  }));

  if (!group || !story) return <View style={styles.screen} />;

  const imageHeight = Math.min(height, (width * 16) / 9);

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.screen, containerStyle]}>
          <View style={[styles.imageBox, { top: insets.top }]}>
            <CachedImage
              key={story.id}
              cacheKey={story.imagePath}
              kind="media"
              localUri={story.localImageUri}
              width={width}
              style={{ width, height: imageHeight, borderRadius: 8, overflow: 'hidden' }}
            />
          </View>

          <Animated.View style={[styles.overlay, { paddingTop: insets.top + 8 }, overlayStyle]}>
            <ProgressBars count={group.stories.length} current={pos.story} progress={progress} />
            <View style={styles.header}>
              <Avatar uri={group.avatarUrl} size={32} />
              <Text style={styles.username}>{group.username}</Text>
              <Text style={styles.time}>{story.pending ? 'Publicando…' : timeAgo(story.createdAt)}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={close} hitSlop={12}>
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Una barra por historia: las anteriores llenas, la actual animada, las siguientes vacías. */
function ProgressBars({ count, current, progress }: { count: number; current: number; progress: SharedValue<number> }) {
  return (
    <View style={styles.bars}>
      {Array.from({ length: count }, (_, i) => (
        <Bar key={i} state={i < current ? 'done' : i === current ? 'active' : 'todo'} progress={progress} />
      ))}
    </View>
  );
}

function Bar({ state, progress }: { state: 'done' | 'active' | 'todo'; progress: SharedValue<number> }) {
  // Lee el SharedValue en el UI thread: el ancho cambia 60 veces por segundo SIN re-render de React.
  const fill = useAnimatedStyle(() => ({
    width: `${(state === 'done' ? 1 : state === 'active' ? progress.get() : 0) * 100}%`,
  }));
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  imageBox: { position: 'absolute', left: 0, right: 0 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 8, gap: 10 },
  bars: { flexDirection: 'row', gap: 4 },
  barTrack: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  username: { color: '#fff', fontWeight: '600', fontSize: 14 },
  time: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
});
