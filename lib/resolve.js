import { RootrApiError } from './client.js';

/**
 * Resolve a CLI/MCP "target" argument to a node id.
 * If it starts with '/', treat it as a path and look it up via by-path
 * (requires a workspace to be configured). Otherwise treat it as an id already.
 *
 * Returns { id, existed, path } where existed indicates whether the path
 * resolved to an existing node (always true for id-form targets, since we
 * don't verify those against the API).
 */
export async function resolveTarget(client, target) {
  if (!target.startsWith('/')) {
    return { id: target, existed: true, path: undefined };
  }

  const node = await client.getNodeByPath(target);
  if (!node) {
    return { id: undefined, existed: false, path: target };
  }
  const id = node.id || (node.node && node.node.id);
  return { id, existed: true, path: target, node: node.node || node };
}

export function requireResolved(resolved) {
  if (!resolved.existed || !resolved.id) {
    throw new RootrApiError(`경로를 찾을 수 없습니다: ${resolved.path}`);
  }
  return resolved.id;
}
