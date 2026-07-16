#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig, saveConfig, maskKey, CONFIG_PATH, DEFAULT_BASE_URL } from '../lib/config.js';
import { RootrClient, RootrApiError } from '../lib/client.js';
import { resolveTarget, requireResolved } from '../lib/resolve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const USAGE = `Rootr CLI v${pkg.version}

사용법:
  rootr ls [path]                                  워크스페이스 트리 조회
  rootr read <path|id> [--json]                    문서 읽기 (마크다운 또는 JSON)
  rootr write <path|id> [--file <f>] [--if-match <etag>]   문서 전체 교체(파일 없으면 생성)
  rootr append <path|id> [<text>] [--heading "## X"] [--file <f>]  문서 끝(또는 헤딩 아래)에 안전하게 추가
  rootr edit <path|id> --find <text> --replace <text> [--all]      본문 내 텍스트 치환
  rootr search <query>                             워크스페이스 검색
  rootr ws                                         내 워크스페이스 목록 (id\tname)
  rootr ask <question> [--workspace <w>]           GraphRAG 질의응답 (RCA), 인용 포함 출력
  rootr config [--api-key <k>] [--workspace <w>] [--base-url <u>]  설정 조회/저장
  rootr mcp                                        MCP stdio 서버 구동 (도구 27종 — README 참고)
  rootr --help                                     도움말
  rootr --version                                  버전 출력

설정 우선순위: 환경변수(ROOTR_API_KEY, ROOTR_WORKSPACE, ROOTR_BASE_URL) > ~/.rootr/config.json

경로 인자는 '/'로 시작해야 합니다 (예: /notes/todo.md). 그 외 값은 노드 id로 취급됩니다.
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(tok);
    }
  }
  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function makeClient() {
  const cfg = loadConfig();
  return new RootrClient(cfg);
}

function printErrorAndExit(err) {
  if (err instanceof RootrApiError) {
    console.error(`오류: ${err.message}`);
    if (err.status) console.error(`(HTTP ${err.status})`);
    if (err.hint) console.error(`힌트: ${err.hint}`);
  } else {
    console.error(`오류: ${err.message || err}`);
  }
  process.exit(1);
}

// ---- commands -------------------------------------------------------------

async function cmdLs(args) {
  const client = makeClient();
  const filterPath = args._[0];
  const nodes = await client.getTree();

  const rows = nodes
    .filter((n) => {
      if (!filterPath) return true;
      const p = n.path || '';
      return p === filterPath || p.startsWith(filterPath.endsWith('/') ? filterPath : filterPath + '/');
    })
    .map((n) => ({ type: n.type || '?', path: n.path || n.name || n.id }))
    .sort((a, b) => a.path.localeCompare(b.path));

  for (const row of rows) {
    console.log(`${row.type}\t${row.path}`);
  }
}

async function cmdRead(args) {
  const target = args._[0];
  if (!target) throw new Error('사용법: rootr read <path|id> [--json]');

  const client = makeClient();
  const resolved = await resolveTarget(client, target);
  const id = requireResolved(resolved);

  if (args.json) {
    const doc = await client.getDocumentJson(id);
    console.log(JSON.stringify(doc, null, 2));
  } else {
    const { content } = await client.getDocumentMarkdown(id);
    process.stdout.write(content.endsWith('\n') ? content : content + '\n');
  }
}

async function cmdWrite(args) {
  const target = args._[0];
  if (!target) throw new Error('사용법: rootr write <path|id> [--file <f>] [--if-match <etag>]');

  let content;
  if (typeof args.file === 'string') {
    content = readFileSync(args.file, 'utf8');
  } else {
    content = await readStdin();
  }

  const client = makeClient();
  const resolved = await resolveTarget(client, target);

  if (!resolved.existed) {
    if (!resolved.path) {
      throw new Error(`대상을 찾을 수 없습니다: ${target}`);
    }
    // 생성 자체가 쓰기 — 곧바로 PUT을 또 하면 버전/추출만 이중으로 쌓인다
    const created = await client.createNode({
      type: 'DOCUMENT',
      path: resolved.path,
      createParents: true,
      autoRename: false,
      content,
    });
    const id = created.id || (created.node && created.node.id);
    console.error(`created ${resolved.path} (id ${id})`);
    return;
  }

  const { etag } = await client.putDocument(resolved.id, content, { ifMatch: args['if-match'] });
  console.error(`wrote ${target} (etag ${etag || 'n/a'})`);
}

async function cmdAppend(args) {
  const target = args._[0];
  if (!target) throw new Error('사용법: rootr append <path|id> [<text>] [--heading "## X"] [--file <f>]');

  let content;
  if (typeof args._[1] === 'string') {
    content = args._[1];
  } else if (typeof args.file === 'string') {
    content = readFileSync(args.file, 'utf8');
  } else {
    content = await readStdin();
  }

  if (!content) {
    throw new Error('추가할 내용이 없습니다 (텍스트 인자, --file, 또는 stdin 필요).');
  }

  const client = makeClient();
  const resolved = await resolveTarget(client, target);
  const id = requireResolved(resolved);

  const result = await client.appendDocument(id, {
    content,
    underHeading: args.heading,
  });

  console.error(`appended to ${target} (etag ${result.etag || 'n/a'})`);
}

async function cmdEdit(args) {
  const target = args._[0];
  if (!target) throw new Error('사용법: rootr edit <path|id> --find <text> --replace <text> [--all]');
  if (typeof args.find !== 'string' || typeof args.replace !== 'string') {
    throw new Error('--find와 --replace가 모두 필요합니다.');
  }

  const client = makeClient();
  const resolved = await resolveTarget(client, target);
  const id = requireResolved(resolved);

  await client.patchDocumentAnchor(id, {
    find: args.find,
    replace: args.replace,
    replaceAll: Boolean(args.all),
  });

  console.error(`edited ${target}`);
}

async function cmdSearch(args) {
  const query = args._[0];
  if (!query) throw new Error('사용법: rootr search <query>');

  const client = makeClient();
  const results = await client.search(query);

  for (const r of results) {
    console.log(`${r.path || r.name || r.nodeId} — ${r.snippet || ''}`);
  }
}

async function cmdWs() {
  const client = makeClient();
  const workspaces = await client.listWorkspaces();
  for (const w of workspaces) {
    console.log(`${w.id}\t${w.name || w.slug || ''}`);
  }
}

async function cmdAsk(args) {
  const question = args._.join(' ');
  if (!question) throw new Error('사용법: rootr ask <question> [--workspace <w>]');

  const cfg = loadConfig();
  const workspace = args.workspace || cfg.workspace;
  if (!workspace) {
    throw new RootrApiError('워크스페이스가 설정되지 않았습니다.', {
      hint: '--workspace <id>로 넘기거나 rootr config --workspace <id> 또는 ROOTR_WORKSPACE 환경변수를 지정하세요.',
    });
  }

  const client = new RootrClient({ ...cfg, workspace });
  const result = await client.ask(workspace, question);
  console.log(result.text || '(응답 없음)');
  const citations = Array.isArray(result.citations) ? result.citations : [];
  if (citations.length) {
    console.log('\nCitations:');
    for (const c of citations) {
      console.log(`- ${c.documentPath}: ${c.quote}`);
    }
  }
}

async function cmdConfig(args) {
  const hasAny = args['api-key'] || args.workspace || args['base-url'];
  if (!hasAny) {
    const cfg = loadConfig();
    console.log(`config file: ${CONFIG_PATH}`);
    console.log(`apiKey:      ${maskKey(cfg.apiKey)}`);
    console.log(`workspace:   ${cfg.workspace || '(not set)'}`);
    console.log(`baseUrl:     ${cfg.baseUrl || DEFAULT_BASE_URL}`);
    return;
  }

  const partial = {};
  if (typeof args['api-key'] === 'string') partial.apiKey = args['api-key'];
  if (typeof args.workspace === 'string') partial.workspace = args.workspace;
  if (typeof args['base-url'] === 'string') partial.baseUrl = args['base-url'];

  saveConfig(partial);
  console.log(`설정을 저장했습니다: ${CONFIG_PATH}`);
}

async function cmdMcp() {
  const { startMcpServer } = await import('../lib/mcp.js');
  await startMcpServer({ name: 'rootr', version: pkg.version });
}

// ---- entry ------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._.shift();

  if (args.version) {
    console.log(pkg.version);
    return;
  }
  if (!cmd || args.help || cmd === 'help') {
    console.log(USAGE);
    return;
  }

  switch (cmd) {
    case 'ls':
      return cmdLs(args);
    case 'read':
      return cmdRead(args);
    case 'write':
      return cmdWrite(args);
    case 'append':
      return cmdAppend(args);
    case 'edit':
      return cmdEdit(args);
    case 'search':
      return cmdSearch(args);
    case 'ws':
      return cmdWs(args);
    case 'ask':
      return cmdAsk(args);
    case 'config':
      return cmdConfig(args);
    case 'mcp':
      return cmdMcp(args);
    default:
      console.error(`알 수 없는 명령: ${cmd}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch(printErrorAndExit);
