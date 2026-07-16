import { z } from 'zod';

import { RootrApiError } from '../client.js';
import { resolveTarget, requireResolved } from '../resolve.js';
import { textResult, jsonResult, errorResult, makeClient } from './shared.js';

/** Registers the original 6 document tools: list/read/append/edit/write/search. */
export function registerDocumentTools(server) {
  server.registerTool(
    'rootr_list',
    {
      title: 'List Rootr documents',
      description:
        'List documents and folders in the connected Rootr (루터) workspace, optionally filtered to a path prefix. ' +
        'Use this first to discover what exists before reading or writing.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Optional path prefix to filter results, e.g. "/notes"'),
      },
    },
    async ({ path }) => {
      try {
        const client = makeClient();
        const nodes = await client.getTree();
        const rows = nodes
          .filter((n) => {
            if (!path) return true;
            const p = n.path || '';
            return p === path || p.startsWith(path.endsWith('/') ? path : path + '/');
          })
          .map((n) => `${n.type || '?'} ${n.path || n.name || n.id}`)
          .sort();
        return textResult(rows.length ? rows.join('\n') : '(no matching nodes)');
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_read',
    {
      title: 'Read a Rootr document',
      description:
        'Read the full markdown content of a Rootr (루터) document by path (starting with "/") or by node id. ' +
        'Read a document before editing or appending to it so you know its current structure.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (e.g. "/notes/todo.md") or node id'),
      },
    },
    async ({ target }) => {
      try {
        const client = makeClient();
        const resolved = await resolveTarget(client, target);
        const id = requireResolved(resolved);
        const { content } = await client.getDocumentMarkdown(id);
        return textResult(content);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_append',
    {
      title: 'Append to a Rootr document (preferred write)',
      description:
        'Append content to a Rootr document, optionally under a given heading. This is a conflict-free, ' +
        'additive operation — it never overwrites existing content, so PREFER this over rootr_write whenever ' +
        'you just need to add new information (log entries, notes, findings) to an existing document.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
        content: z.string().describe('Markdown content to append'),
        underHeading: z
          .string()
          .optional()
          .describe(
            'Heading to append under, e.g. "## Notes" or "Notes". If omitted, appends to the end of the document. ' +
              'A missing heading section is created at the document end.',
          ),
      },
    },
    async ({ target, content, underHeading }) => {
      try {
        const client = makeClient();
        const resolved = await resolveTarget(client, target);
        const id = requireResolved(resolved);
        const result = await client.appendDocument(id, { content, underHeading });
        return textResult(`appended (etag ${result.etag || 'n/a'})`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_edit',
    {
      title: 'Edit a Rootr document by anchor replace',
      description:
        'Replace an exact snippet of text ("find") with new text ("replace") inside a Rootr document. ' +
        'Fails with a clear error if the snippet is missing or ambiguous (not unique), so read the document ' +
        'first to copy the exact text to find. Good for precise, targeted edits; use rootr_append instead when ' +
        'you are only adding new content.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
        find: z.string().describe('Exact existing text to find (must be unique unless replaceAll is set)'),
        replace: z.string().describe('Text to replace it with'),
        replaceAll: z.boolean().optional().describe('Replace all occurrences instead of requiring uniqueness'),
      },
    },
    async ({ target, find, replace, replaceAll }) => {
      try {
        const client = makeClient();
        const resolved = await resolveTarget(client, target);
        const id = requireResolved(resolved);
        await client.patchDocumentAnchor(id, { find, replace, replaceAll });
        return textResult('edited');
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_write',
    {
      title: 'Overwrite a Rootr document (destructive)',
      description:
        'Replace the ENTIRE content of a Rootr document, or create a new document at a path if it does not exist. ' +
        'This is DESTRUCTIVE — it discards whatever is currently there. Read the document first and pass its etag ' +
        'as ifMatch to avoid clobbering concurrent changes. Prefer rootr_append or rootr_edit for incremental changes.',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/", created if missing) or node id'),
        content: z.string().describe('Full new markdown content for the document'),
        ifMatch: z
          .string()
          .optional()
          .describe('ETag obtained from a previous rootr_read/rootr_write, to guard against overwriting concurrent edits'),
      },
    },
    async ({ target, content, ifMatch }) => {
      try {
        const client = makeClient();
        const resolved = await resolveTarget(client, target);
        if (!resolved.existed) {
          if (!resolved.path) throw new RootrApiError(`대상을 찾을 수 없습니다: ${target}`);
          // creating with content IS the write — a follow-up PUT would just
          // double the version history and extraction work
          const created = await client.createNode({
            type: 'DOCUMENT',
            path: resolved.path,
            createParents: true,
            autoRename: false,
            content,
          });
          const id = created.id || (created.node && created.node.id);
          return textResult(`created ${resolved.path} (id ${id})`);
        }
        const { etag } = await client.putDocument(resolved.id, content, { ifMatch });
        return textResult(`wrote (etag ${etag || 'n/a'})`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_search',
    {
      title: 'Search the Rootr workspace',
      description:
        'Full-text search across the connected Rootr (루터) workspace. Use this to find relevant documents before ' +
        'reading or editing them.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        query: z.string().describe('Search query text'),
      },
    },
    async ({ query }) => {
      try {
        const client = makeClient();
        const results = await client.search(query);
        const rows = results.map((r) => `${r.path || r.name || r.nodeId} — ${r.snippet || ''}`);
        return textResult(rows.length ? rows.join('\n') : '(no results)');
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_comment_document',
    {
      title: 'Comment on a Rootr document',
      description:
        'Add a comment to a Rootr (루터) document (optionally anchored to a block, or as a reply via parentId). ' +
        'Comments carry a user identity, so this requires an ACCOUNT key (PAT) — a workspace-scoped key ' +
        '(including remote-connector tokens) gets a 403; fall back to rootr_append in that case.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
        body: z.string().describe('Comment text (markdown)'),
        blockId: z.string().optional().describe('Block id to anchor the comment to'),
        parentId: z.string().optional().describe('Parent comment id, to reply in a thread'),
      },
    },
    async ({ target, body, blockId, parentId }) => {
      try {
        const client = makeClient();
        const id = requireResolved(await resolveTarget(client, target));
        return jsonResult(await client.createComment(id, { body, blockId, parentId }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_list_document_comments',
    {
      title: 'List comments on a Rootr document',
      description:
        'List the comment threads on a Rootr (루터) document, optionally filtered to one block. Works with any key.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
        blockId: z.string().optional().describe('Only comments anchored to this block'),
      },
    },
    async ({ target, blockId }) => {
      try {
        const client = makeClient();
        const id = requireResolved(await resolveTarget(client, target));
        return jsonResult(await client.listComments(id, { blockId }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_publish_document',
    {
      title: 'Publish a Rootr document to a public URL',
      description:
        'Publish a Rootr (루터) document at a public read-only URL (rootr.io/p/{slug}) — outsiders can read it ' +
        'and propose git-style edit suggestions the owner can merge. Publishing is an owner-level action: it needs ' +
        'MANAGE permission, which workspace-scoped keys (including remote-connector tokens) do not carry — use an ' +
        'ACCOUNT key (PAT) of the owner, or ask the user to publish from the share dialog. ' +
        'Returns the slug/URL. Check rootr_document_public_status first; unpublish via rootr_set_document_public.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
      },
    },
    async ({ target }) => {
      try {
        const client = makeClient();
        const id = requireResolved(await resolveTarget(client, target));
        return jsonResult(await client.publishDocument(id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_set_document_public',
    {
      title: 'Update public settings of a Rootr document',
      description:
        'Update a published Rootr (루터) document\'s public settings — e.g. {"isPublic": false} to unpublish. ' +
        'Owner-level action (MANAGE): works with an account key (PAT), not with workspace-scoped/connector tokens.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
        isPublic: z.boolean().optional().describe('false to unpublish, true to re-enable'),
      },
    },
    async ({ target, isPublic }) => {
      try {
        const client = makeClient();
        const id = requireResolved(await resolveTarget(client, target));
        return jsonResult(await client.setDocumentPublic(id, { isPublic }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_document_public_status',
    {
      title: 'Public status of a Rootr document',
      description: 'Whether a Rootr (루터) document is published, and at which public slug/URL.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
      },
    },
    async ({ target }) => {
      try {
        const client = makeClient();
        const id = requireResolved(await resolveTarget(client, target));
        return jsonResult(await client.getDocumentPublicStatus(id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_duplicate_node',
    {
      title: 'Duplicate a Rootr node (deep copy)',
      description:
        'Deep-copy a Rootr (루터) node — a document or a whole folder tree — next to the original, or into ' +
        'another workspace the user can access (targetWorkspaceId). Returns the new root node.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Node path (starting with "/") or node id to copy'),
        deep: z.boolean().optional().describe('Copy children too (default true)'),
        targetWorkspaceId: z.string().optional().describe('Destination workspace id (defaults to same workspace)'),
      },
    },
    async ({ target, deep, targetWorkspaceId }) => {
      try {
        const client = makeClient();
        const id = requireResolved(await resolveTarget(client, target));
        return jsonResult(await client.duplicateNode(id, { deep, targetWorkspaceId }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
