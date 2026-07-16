import { loadConfig } from '../config.js';
import { RootrClient, RootrApiError } from '../client.js';
import { currentClientOverride } from '../context.js';

export function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(err) {
  const message =
    err instanceof RootrApiError
      ? `${err.message}${err.hint ? `\n힌트: ${err.hint}` : ''}`
      : err.message || String(err);
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}

/**
 * Build a RootrClient. If `workspaceOverride` is given, it wins over the
 * configured/env workspace — this backs the optional `workspace` argument
 * that every workspace-scoped MCP tool accepts.
 */
export function makeClient(workspaceOverride) {
  const hosted = currentClientOverride();
  if (hosted) {
    // Hosted MCP requests are locked to the workspace granted at OAuth
    // consent time — silently ignoring a caller-supplied workspace here
    // would be a scoping bug, so only honor an override that matches.
    if (workspaceOverride && workspaceOverride !== hosted.workspace) {
      throw new RootrApiError('이 연결은 하나의 워크스페이스에만 연결되어 있습니다.', {
        hint: '다른 워크스페이스가 필요하면 설정>연동에서 새 원격 커넥터를 발급하세요.',
      });
    }
    return hosted;
  }
  const cfg = loadConfig();
  const workspace = workspaceOverride || cfg.workspace;
  return new RootrClient({ ...cfg, workspace });
}

/**
 * Resolve the effective workspace id for a tool call: explicit arg wins,
 * then ROOTR_WORKSPACE/config. Throws a clear RootrApiError otherwise.
 */
export function requireWorkspace(workspaceOverride) {
  const hosted = currentClientOverride();
  const cfg = hosted ? { workspace: hosted.workspace } : loadConfig();
  const workspace = workspaceOverride || cfg.workspace;
  if (!workspace) {
    throw new RootrApiError('워크스페이스가 설정되지 않았습니다.', {
      hint:
        '이 도구의 workspace 인자로 워크스페이스 id를 넘기거나, ' +
        'rootr config --workspace <id> 로 설정하거나 ROOTR_WORKSPACE 환경변수를 지정하세요.',
    });
  }
  return workspace;
}

export { RootrApiError };
