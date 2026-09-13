import { ConnectorRegistry, JsonFileConnector, WordPressConnector } from '@wecom/connectors';

export function buildRegistry(): ConnectorRegistry {
  const r = new ConnectorRegistry();
  r.register(new WordPressConnector());
  r.register(new JsonFileConnector());
  return r;
}
