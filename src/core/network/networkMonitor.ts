import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

// El SO (ConnectivityManager en Android) detecta los cambios de red en un hilo nativo
// y NetInfo los entrega como eventos al hilo JS.
//
// isConnected=true solo significa "hay Wi-Fi/datos", no que haya internet
// (p. ej. un Wi-Fi con portal cautivo). isInternetReachable lo verifica, pero puede
// ser `null` mientras no se sabe; solo lo tratamos como offline si es `false` explícito.
function isOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/** Suscribe al estado de conectividad. El listener recibe el estado actual poco después de suscribirse. */
export function subscribeToConnectivity(listener: (online: boolean) => void): () => void {
  let last: boolean | null = null;
  return NetInfo.addEventListener((state) => {
    const online = isOnline(state);
    // NetInfo emite eventos por cambios que no nos importan (p. ej. intensidad de señal).
    if (online !== last) {
      last = online;
      listener(online);
    }
  });
}
