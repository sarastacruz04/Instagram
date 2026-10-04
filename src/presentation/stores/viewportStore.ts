import type { ViewToken } from '@shopify/flash-list';
import { create } from 'zustand';

// Qué items del feed SALIERON del viewport. Se guarda "oculto" (no "visible") para que
// todo item cuente como visible por defecto: así las celdas que FlashList pre-renderiza
// fuera de pantalla (buffer de drawDistance) igual precargan su imagen, y solo se cancela
// cuando un item que ESTUVO visible deja de estarlo.
interface ViewportState {
  hidden: Record<string, true>;
}

export const useViewport = create<ViewportState>(() => ({ hidden: {} }));

/** Config y callback ESTABLES (a nivel de módulo): FlashList no admite cambiarlos en caliente. */
export const feedViewabilityConfig = { itemVisiblePercentThreshold: 1, minimumViewTime: 0 };

export function onFeedViewableItemsChanged({ changed }: { changed: ViewToken<string>[] }): void {
  if (changed.length === 0) return;
  // Un solo setState por evento, aunque cambien varias celdas a la vez.
  useViewport.setState((s) => {
    const hidden = { ...s.hidden };
    for (const token of changed) {
      const id = token.item;
      if (token.isViewable) delete hidden[id];
      else hidden[id] = true;
    }
    return { hidden };
  });
}
