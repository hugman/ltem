/** A least-recently-used cache keyed by text, bounded by its number of entries and by the size of what it holds. */
export class TextCache<V> {
  private readonly entries = new Map<string, { value: V; size: number }>();
  private total = 0;

  /**
   * @param maxEntries the most entries kept
   * @param maxSize the most characters kept, counting each entry's key and the size given for it
   */
  constructor(private readonly maxEntries: number, private readonly maxSize: number) {}

  /** The value for `key`, or undefined if it is not cached. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Cache `value` for `key`; `size` is what the value holds beyond the key, in characters. */
  set(key: string, value: V, size = 0): void {
    const old = this.entries.get(key);
    if (old !== undefined) {
      this.total -= old.size;
      this.entries.delete(key);
    }
    const entry = { value, size: key.length + size };
    this.entries.set(key, entry);
    this.total += entry.size;
    while (this.entries.size > this.maxEntries || (this.total > this.maxSize && this.entries.size > 1)) {
      const [oldest, evicted] = this.entries.entries().next().value!;
      this.entries.delete(oldest);
      this.total -= evicted.size;
    }
  }

  /** Forget everything. */
  clear(): void {
    this.entries.clear();
    this.total = 0;
  }
}
