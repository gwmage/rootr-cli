import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Lets a hosted (multi-tenant) MCP transport inject a per-request RootrClient
 * so the same tool registration functions used by the local stdio CLI server
 * can be reused without them reading ~/.rootr/config.json or process env
 * (which are single-tenant, CLI-only concepts). CLI usage never sets this,
 * so `makeClient()` falls back to `loadConfig()` unchanged.
 */
const storage = new AsyncLocalStorage();

export function withClient(client, fn) {
  return storage.run(client, fn);
}

export function currentClientOverride() {
  return storage.getStore();
}
