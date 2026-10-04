/**
 * Caché LRU (Least Recently Used) con PESO: el límite no es "N elementos" sino una suma
 * de pesos (p. ej. bytes). Al superarlo se desaloja lo que lleva más tiempo sin usarse.
 *
 * Implementación O(1) con un solo Map: en JS el Map conserva el ORDEN DE INSERCIÓN.
 *   - get(): borra y vuelve a insertar la clave → pasa al final (= "más reciente").
 *   - Desalojo: se recorre desde el principio (= "menos reciente").
 * No hace falta la lista doblemente enlazada clásica: el Map ya la implementa por dentro.
 *
 * `canEvict` permite "fijar" (pin) entradas que no se deben desalojar aunque sean viejas,
 * p. ej. un bitmap que una celda está MOSTRANDO en este momento.
 */
export interface LruOptions<K, V> {
  maxWeight: number;
  weigh: (value: V) => number;
  onEvict?: (key: K, value: V) => void;
  canEvict?: (key: K, value: V) => boolean;
}

export class LruCache<K, V> {
  private readonly map = new Map<K, { value: V; weight: number }>();
  private total = 0;

  constructor(private readonly options: LruOptions<K, V>) {}

  /** Lee y marca como usado recientemente. */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Lee SIN alterar el orden (para inspección). */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  set(key: K, value: V): void {
    const old = this.map.get(key);
    if (old) {
      this.map.delete(key);
      this.total -= old.weight;
    }
    const weight = this.options.weigh(value);
    this.map.set(key, { value, weight });
    this.total += weight;
    // La entrada recién insertada no se desaloja a sí misma en esta pasada.
    this.trimTo(this.options.maxWeight, key);
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    this.total -= entry.weight;
    return true;
  }

  /**
   * Desaloja desde la entrada MENOS reciente hasta quedar en `target`.
   * Salta las fijadas (canEvict=false): el total puede quedar por encima del límite
   * temporalmente, mientras esas entradas sigan en uso.
   */
  trimTo(target: number, protectedKey?: K): number {
    let evicted = 0;
    for (const [key, entry] of this.map) {
      if (this.total <= target) break;
      if (key === protectedKey) continue;
      if (this.options.canEvict && !this.options.canEvict(key, entry.value)) continue;
      this.map.delete(key); // borrar durante la iteración de un Map es seguro en JS
      this.total -= entry.weight;
      evicted++;
      this.options.onEvict?.(key, entry.value);
    }
    return evicted;
  }

  trim(): number {
    return this.trimTo(this.options.maxWeight);
  }

  /** Recorre los valores del menos al más reciente (sin alterar el orden). */
  *values(): Generator<V> {
    for (const entry of this.map.values()) yield entry.value;
  }

  get size(): number {
    return this.map.size;
  }

  get weight(): number {
    return this.total;
  }

  get maxWeight(): number {
    return this.options.maxWeight;
  }
}
