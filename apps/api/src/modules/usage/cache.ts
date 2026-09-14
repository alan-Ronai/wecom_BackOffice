/** Tiny in-memory TTL cache for the 60-second analytics responses (spec §3 Usage). */
export class TtlCache<T> {
  private map = new Map<string, { value: T; expiresAt: number }>();
  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
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
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}
