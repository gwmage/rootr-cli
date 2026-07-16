import { z } from 'zod';

import { jsonResult, errorResult, makeClient } from './shared.js';
import { resolveTarget, requireResolved } from '../resolve.js';

/** Miscellaneous document/node tools: version history, trash. */
export function registerMiscTools(server) {
  server.registerTool(
    'rootr_document_versions',
    {
      title: 'List a document\'s version history',
      description:
        'List saved versions of a Rootr (루터) document, most recent first. Useful for seeing what changed and ' +
        'when, or to recover an older revision.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        target: z.string().describe('Document path (starting with "/") or node id'),
        limit: z.number().optional().describe('Max number of versions to return'),
      },
    },
    async ({ target, limit }) => {
      try {
        const client = makeClient();
        const resolved = await resolveTarget(client, target);
        const id = requireResolved(resolved);
        const result = await client.getDocumentVersions(id, { limit });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_delete_node',
    {
      title: 'Delete a node (move to trash)',
      description:
        'Delete a Rootr (루터) document or folder by moving it to the trash — this is recoverable, not a ' +
        'permanent delete. Use rootr_read/rootr_list first to confirm you have the right target.',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        target: z.string().describe('Document/folder path (starting with "/") or node id'),
      },
    },
    async ({ target }) => {
      try {
        const client = makeClient();
        const resolved = await resolveTarget(client, target);
        const id = requireResolved(resolved);
        await client.deleteNode(id);
        return jsonResult({ deleted: id, note: 'moved to trash, recoverable' });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
