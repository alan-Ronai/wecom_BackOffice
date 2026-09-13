import type { Connector, ConnectorInfo } from './contract.js';
export class ConnectorRegistry {
  private map = new Map<string, Connector<unknown>>();
  register(c: Connector<never>): void {
    const id = c.describe().id;
    if (this.map.has(id)) throw new Error(`connector already registered: ${id}`);
    this.map.set(id, c as Connector<unknown>);
  }
  get(id: string): Connector<unknown> {
    const c = this.map.get(id);
    if (!c) throw new Error(`unknown connector: ${id}`);
    return c;
  }
  list(): ConnectorInfo[] {
    return [...this.map.values()].map((c) => c.describe());
  }
}
