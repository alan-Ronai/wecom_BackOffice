/**
 * Tiny in-memory TTL cache for the 60-second analytics responses (spec §3 Usage).
 *
 * The keys carry attacker-chosen query values (`from`/`to`/`world`), so the size is capped as
 * well as the age: without it a caller can grow the map without bound by varying a date by a
 * millisecond. Eviction is insertion order, which for a TTL cache is close enough to oldest.
 */
export class TtlCache<T> {
  private map = new Map<string, { value: T; expiresAt: number }>();
  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
    private maxEntries = 500,
  ) {}
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}
