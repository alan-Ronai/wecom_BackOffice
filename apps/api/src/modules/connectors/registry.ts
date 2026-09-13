import {
  ConnectorRegistry,
  JsonFileConnector,
  WordPressConnector,
  type ConnectorGuards,
} from '@wecom/connectors';

/**
 * `guards` come from `ConfigSchema` (`CONNECTOR_FILE_ROOT`, `CONNECTOR_HOST_ALLOWLIST`).
 * Called without them — as the unit tests do — the connectors are unrestricted.
 */
export function buildRegistry(guards: ConnectorGuards = {}): ConnectorRegistry {
  const r = new ConnectorRegistry();
  r.register(new WordPressConnector(fetch, guards));
  r.register(new JsonFileConnector(guards));
  return r;
}
