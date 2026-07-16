import { z } from 'zod';

import { jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

const VALID_EVENTS = [
  'document.created',
  'document.updated',
  'document.moved',
  'document.deleted',
  'comment.created',
  'extraction.completed',
  'extraction.failed',
  'log.anomaly.rca',
  'scaffold.applied',
];

/** Webhook management tools: list/create/delete. Requires webhooks:manage scope. */
export function registerWebhookTools(server) {
  server.registerTool(
    'rootr_list_webhooks',
    {
      title: 'List webhooks configured on a workspace',
      description:
        'List webhooks configured on a Rootr (루터) workspace. Secrets are not re-shown here (they only appear ' +
        'once, at creation time).',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.listWebhooks(ws);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_create_webhook',
    {
      title: 'Create a webhook',
      description:
        `Create a webhook on a Rootr (루터) workspace. Valid events: ${VALID_EVENTS.join(', ')}. ` +
        'Optionally scope it to a subtree (scopeNodeId, inherited by descendants) and/or a tag filter (filterTags). ' +
        'debounceSeconds coalesces bursts of events (server enforces a fixed trailing debounce with a cap). ' +
        'IMPORTANT: the response secret is shown ONLY ONCE, in this call\'s result — copy it now, it will not be ' +
        'shown again. LOOP GUARD: deliveries carry the actor as data.actorId ("apikey:<key-id>" for API writes) — ' +
        'a consumer MUST skip deliveries caused by its own key before reacting, or an agent that writes on ' +
        'notification will trigger itself forever.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        url: z.string().describe('HTTPS endpoint to receive webhook POSTs'),
        events: z.array(z.string()).describe(`Event names to subscribe to, from: ${VALID_EVENTS.join(', ')}`),
        name: z.string().optional().describe('Human-readable name for the webhook'),
        scopeNodeId: z.string().optional().describe('Restrict to this node and its descendants'),
        filterTags: z.array(z.string()).optional().describe('Only fire for nodes carrying one of these tags'),
        debounceSeconds: z.number().optional().describe('Trailing debounce window in seconds (server-capped)'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ url, events, name, scopeNodeId, filterTags, debounceSeconds, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createWebhook(ws, {
          name,
          url,
          events,
          scopeNodeId,
          filterTags,
          debounceSeconds,
        });
        const note =
          '\n\n(This secret will not be shown again — store it now if you need to verify signatures.)';
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) + note }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_delete_webhook',
    {
      title: 'Delete a webhook',
      description: 'Delete a webhook from a Rootr (루터) workspace. This cannot be undone.',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        webhookId: z.string().describe('Webhook id to delete'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ webhookId, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        await client.deleteWebhook(ws, webhookId);
        return jsonResult({ deleted: webhookId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
