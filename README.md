# rootr-cli

Official CLI and MCP server for [Rootr](https://rootr.io) — a team documentation workspace that
AI agents can read **and write**.

Point Claude, Cursor, or any MCP client at your workspace and it can browse the document tree,
read and edit markdown, add rows to a database, open and close issues, build a slide deck, run a
spreadsheet, or ask a question and get an answer with citations back to the exact document.

*(한국어 문서: [README.ko.md](README.ko.md))*

- `rootr` CLI — `ls`, `read`, `write`, `append`, `edit`, `search`, `ws`, `ask`, `config`
- `rootr mcp` — stdio MCP server, **81 tools** (see [MCP tools](#mcp-tools))

Plain Node.js ESM, no build step. Node 18+ (uses the built-in `fetch`).

## Two ways to connect

**1. Remote connector — nothing to install.** Rootr hosts an MCP endpoint with OAuth:

```
https://rootr.io/mcp
```

Add it as a custom connector in Claude (Streamable HTTP), sign in, done. Same tools as the local
server. This is the recommended path for most people.

**2. Local CLI** — use this repo when you want the client running on your own machine or
infrastructure, or when you want the shell commands.

```bash
npx rootr-cli mcp        # run the MCP server straight from npm
npm install -g rootr-cli # or install the `rootr` command globally
```

Or from a clone:

```bash
npm install
node bin/rootr.js --help
```

Docker:

```bash
docker build -t rootr-cli .
docker run -i --rm -e ROOTR_API_KEY=rootr_xxx -e ROOTR_WORKSPACE=ws_123 rootr-cli
```

## Configuration

Precedence: **environment variables > `~/.rootr/config.json`**

| Env var | Config key | Description |
|---|---|---|
| `ROOTR_API_KEY` | `apiKey` | API key (`rootr_...`), sent as the `x-api-key` header |
| `ROOTR_WORKSPACE` | `workspace` | Workspace id |
| `ROOTR_BASE_URL` | `baseUrl` | Defaults to `https://rootr.io/api/v1` |

Save them to the config file:

```bash
rootr config --api-key rootr_xxxxxxxxxxxxxxxx --workspace ws_123
# self-hosted or dev server
rootr config --api-key rootr_xxx --workspace ws_123 --base-url https://dev.rootr.io/api/v1
```

`~/.rootr/config.json` is written with mode `600`.

### Two kinds of key

- **Workspace key** — scoped to one workspace. Scopes: `docs:read`, `docs:write`, `graph:read`,
  `ask`, `webhooks:manage`. Enough for almost every tool.
- **Account key (PAT)** — acts for the whole account. With the `workspaces:create` scope it can
  create new workspaces (`rootr_create_workspace`). Trying that with a workspace key returns 403
  with a hint saying an account key is required.

Show the current configuration (only the first 12 characters of the key are printed):

```bash
rootr config
```

## CLI

Path arguments starting with `/` are resolved as **paths** through the by-path API (needs a
workspace). Anything else is treated as a **node id**.

```bash
rootr ls                                  # whole tree, TYPE<TAB>path
rootr ls /notes                           # one subtree

rootr read /notes/todo.md                 # markdown to stdout
rootr read /notes/todo.md --json          # full JSON with metadata

echo "# Title" | rootr write /notes/new.md
rootr write /notes/new.md --file ./local.md
rootr write <nodeId> --file ./local.md --if-match '"abc123"'   # optimistic concurrency

rootr append /notes/log.md "deploy finished"
rootr append /notes/log.md "- one more item" --heading "## Todo"
cat diff.md | rootr append /notes/log.md

rootr edit /notes/todo.md --find "- [ ] deploy" --replace "- [x] deploy"
rootr edit /notes/todo.md --find "TODO" --replace "DONE" --all

rootr search "deployment runbook"
rootr ws                                  # id<TAB>name
rootr ask "why did latency go up after last week's deploy?"
```

`append` never rewrites the whole document, so concurrent writers cannot clobber each other —
prefer it over `write`. `--heading` appends to the end of that heading's section.

`edit` returns 409 if the `--find` text is missing or not unique; the server's reason is printed
as-is. `write --if-match` returns 412 if the document changed in the meantime.

`ask` queries the workspace knowledge graph (GraphRAG) and prints the answer plus citations in
`document path: quote` form. Requires the `ask` scope.

## MCP tools

`rootr mcp` speaks MCP over stdio. 81 tools:

| Group | Count | Tools |
|---|---|---|
| Documents | 12 | list, read, append, edit, write, search, comment, list comments, publish, set public, public status, duplicate node |
| Workspaces & scaffolding | 4 | workspaces, scaffold plan, create workspace, scaffold apply |
| Databases | 5 | read schema, list rows, add/update/delete row |
| Spreadsheets | 7 | create/read/update, per-sheet create/update/delete, patch cells & formulas |
| Whiteboards | 3 | create/read/update the shapes & edges scene |
| Forms | 7 | create/read/update, list & submit responses, share links |
| Presentations | 6 | create/read/update deck, append/update/reorder slides |
| Images | 2 | generate image, remove background |
| Issue tracker | 6 | create tracker, list/create/get/update issue, comment |
| CRM | 18 | companies, contacts, deals (incl. pipeline moves), activities, tasks, CSV import |
| LOG datastores | 5 | create store, update fields, add entries, query, stats |
| Root-cause Q&A | 1 | ask the knowledge graph, answer with citations |
| Webhooks | 3 | list, create (secret shown once), delete |
| Versions & trash | 2 | document version history, move node to trash |

Guidance baked into the tool descriptions: agents should reach for `rootr_append` and
`rootr_edit`, and use `rootr_write` only for a genuine full rewrite (ideally with `ifMatch`).
Tools that take a `workspace` argument fall back to `ROOTR_WORKSPACE` / the config file, and
return a clear error if neither is set.

Scope notes: document, database, spreadsheet, whiteboard, form, presentation, issue, CRM and LOG
tools need `docs:read` / `docs:write`; `rootr_ask` needs `ask`; webhook tools need
`webhooks:manage`; `rootr_create_workspace` needs an account key with `workspaces:create`.

For high-quality slide decks, write self-contained 1280×720 HTML into each slide's `html` field —
the viewer renders it verbatim instead of the default template. The rules (inline everything,
images as data URIs, font fallback stack, `<span class="pn">` for page numbers, and keeping the
text fields filled so the deck still feeds the knowledge graph) are documented in
[`/llms.txt`](https://rootr.io/llms.txt).

### Register with Claude Code / Claude Desktop

```json
{
  "mcpServers": {
    "rootr": {
      "command": "npx",
      "args": ["-y", "rootr-cli", "mcp"],
      "env": {
        "ROOTR_API_KEY": "rootr_xxxxxxxxxxxxxxxx",
        "ROOTR_WORKSPACE": "ws_123"
      }
    }
  }
}
```

With a global install, use `"command": "rootr"` and `"args": ["mcp"]`. From a clone, point
`command` at `node` and `args` at `["/path/to/rootr-cli/bin/rootr.js", "mcp"]`.

## Errors

On a non-2xx response the CLI prints the API's `message` to stderr and exits 1, with hints:

- `401` / `403` — check the API key and workspace scopes
- `412` — document changed since you read it; read again and retry (If-Match mismatch)
- `409` — the server's reason is shown verbatim (e.g. `edit` found no unique match)

## Development

- Dependencies: `@modelcontextprotocol/sdk` (MCP server) and `zod` (tool input schemas). The CLI
  itself (`bin/rootr.js`, `lib/config.js`, `lib/client.js`, `lib/resolve.js`) has none.
- No build step — plain ESM JavaScript.

```
bin/rootr.js            entry point, command dispatch
lib/config.js           config load/save
lib/client.js           Rootr REST client
lib/resolve.js          path/id target resolution
lib/mcp.js              MCP stdio server, assembles the tool modules
lib/mcp-tools/*.js      one module per tool group (shared, documents, workspaces, logs,
                        ask, issues, databases, webhooks, crm, presentations,
                        spreadsheets, whiteboards, forms, misc)
```

Smoke-test the MCP server without any credentials — it must start and list its tools:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node bin/rootr.js mcp
```

## License

MIT — see [LICENSE](LICENSE).
