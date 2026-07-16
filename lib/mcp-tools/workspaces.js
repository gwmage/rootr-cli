import { z } from 'zod';

import { textResult, jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

/**
 * Scaffold `tree` argument schema. Declared as an ARRAY of node objects so MCP
 * clients serialize the value as real JSON. A bare `z.any()` emits an empty
 * JSON Schema (no type), which some clients send as a stringified blob — the
 * scaffold API then rejects it with "tree must be an array". The `.or(z.string())`
 * branch plus parseTree() keeps any client that still stringifies working.
 * Mirrors the typed-array pattern already used in logs.js.
 */
const treeArg = (desc) => z.array(z.record(z.any())).or(z.string()).describe(desc);

/** Accept either a real array (typed clients) or a JSON string (clients that stringify structured args). */
function parseTree(tree) {
  if (typeof tree !== 'string') return tree;
  try {
    return JSON.parse(tree);
  } catch {
    throw new Error('tree must be a JSON array of node objects (received an unparseable string)');
  }
}

/** Workspace listing and scaffolding tools: rootr_workspaces, rootr_scaffold_plan, rootr_create_workspace, rootr_scaffold_apply. */
export function registerWorkspaceTools(server) {
  server.registerTool(
    'rootr_workspaces',
    {
      title: 'List my Rootr workspaces',
      description:
        'List the Rootr (루터) workspaces the current API key can see. Works with either key type: with an ' +
        'account key (PAT) this lists all workspaces you belong to; a workspace key only sees the workspace ' +
        "it's scoped to. Use this to find a workspace id before calling other workspace-scoped tools.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {},
    },
    async () => {
      try {
        const client = makeClient();
        const workspaces = await client.listWorkspaces();
        const rows = workspaces.map((w) => `${w.id}\t${w.name || w.slug || ''}`);
        return textResult(rows.length ? rows.join('\n') : '(no workspaces visible to this key)');
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_scaffold_plan',
    {
      title: 'Plan a workspace scaffold from an intent — then ASK THE USER before building',
      description:
        'Step 1 of scaffolding, ALWAYS call this first. Given a natural-language intent (e.g. "SRE 온콜 위키" or ' +
        '"sales CRM for a 5-person team"), Rootr\'s consultant returns a questionPolicy (ask the user MIN 3, up ' +
        'to 10 clarifying questions — this is not optional), the dimensions to cover, domain frameworks, and the ' +
        'buildingBlocks menu (DATABASE/DOCUMENT/SPREADSHEET/WHITEBOARD/FORM/ISSUE_TRACKER/FOLDER). You must then ' +
        'GENERATE your own questions from those frameworks, ask the user, and only design the tree AFTER their ' +
        'answers — every answer must visibly shape the result. Never build straight from a one-line intent. ' +
        'No workspace needed; create with rootr_create_workspace or rootr_scaffold_apply afterwards.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        intent: z.string().describe('Natural-language description of what the workspace/tree should be for'),
      },
    },
    async ({ intent }) => {
      try {
        const client = makeClient();
        const plan = await client.scaffoldPlan(intent);
        return jsonResult(plan);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_create_workspace',
    {
      title: 'Create a brand-new Rootr workspace from a scaffold tree',
      description:
        'Create an entirely new Rootr (루터) workspace pre-populated with the given document tree. ' +
        'REQUIRES an account key (PAT) with the workspaces:create scope — a workspace-scoped key cannot do this. ' +
        'PRECONDITION: call rootr_scaffold_plan first and ask the user its 3-10 clarifying questions; design the ' +
        'tree from their answers. Build a real tool, not a pile of thin markdown files: mix DATABASE (board/' +
        'timeline views, seed rows), SPREADSHEET (formulas), FORM, ISSUE_TRACKER and rich multi-section DOCUMENTs ' +
        'where they fit, and set an emoji `icon` on folders/databases/key documents. The `tree` shape follows ' +
        'the scaffold schema in llms.txt (max 200 nodes). AFTER creating: if your runtime can receive HTTP ' +
        'callbacks, offer the user to register a webhook on the new tree (rootr_create_webhook with scopeNodeId) ' +
        'so changes flow back to you — skip your own actorId to avoid self-triggering.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().describe('Name for the new workspace'),
        intent: z.string().optional().describe('Original natural-language intent, for reference/regeneration'),
        tree: treeArg('Scaffold tree — an ARRAY of node objects to populate the new workspace with (see llms.txt tree schema)'),
      },
    },
    async ({ name, intent, tree }) => {
      try {
        const client = makeClient();
        const result = await client.createWorkspaceScaffold({ name, intent, tree: parseTree(tree) });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_scaffold_apply',
    {
      title: 'Apply a scaffold tree to an existing workspace',
      description:
        'Create the given document tree inside an existing Rootr (루터) workspace, optionally rooted under an ' +
        'existing path. Works with a workspace key (docs:write scope). PRECONDITION: call rootr_scaffold_plan ' +
        'first and ask the user its 3-10 clarifying questions; design the tree from their answers (same quality ' +
        'bar as rootr_create_workspace — real building blocks with icons/views/seed content, not thin markdown). ' +
        'AFTER creating: if your runtime can receive HTTP callbacks, offer a webhook on the new subtree ' +
        '(rootr_create_webhook with scopeNodeId) so changes flow back to you — skip your own actorId.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        tree: treeArg('Scaffold tree — an ARRAY of node objects to create (see llms.txt tree schema)'),
        rootPath: z.string().optional().describe('Existing path to root the new tree under, e.g. "/projects"'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ tree, rootPath, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.scaffoldApply(ws, { rootPath, tree: parseTree(tree) });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
