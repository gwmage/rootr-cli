import { z } from 'zod';

import { jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

const fieldShape = z
  .object({
    id: z.string().optional().describe('Stable field id (also the key under response `values`). Server-generated if omitted.'),
    name: z.string().describe('Field label shown to respondents'),
    type: z
      .enum(['text', 'textarea', 'number', 'select', 'multi_select', 'checkbox', 'date'])
      .describe('Field input type'),
    required: z.boolean().optional().describe('Whether the field must be filled in'),
    options: z
      .array(z.object({ name: z.string(), color: z.string() }))
      .optional()
      .describe('Choices for select/multi_select fields'),
  })
  .describe('One form field definition.');

const FIELDS_GUIDE =
  'Fields are typed inputs shown to respondents: text | textarea | number | select | multi_select | checkbox | date; ' +
  'select/multi_select need `options` ({name,color}[]). Read the form first (rootr_read_form) before updating so ' +
  'you keep each field\'s `id` stable — response values are keyed by field id, so renaming/dropping an id orphans ' +
  'past responses\' answers for that field.';

/** FORM node tools: create/read/update the field definitions, list/submit responses, manage public share links. */
export function registerFormTools(server) {
  server.registerTool(
    'rootr_create_form',
    {
      title: 'Create a Rootr form',
      description:
        'Create a new FORM node (fillable intake) in a Rootr (루터) workspace, optionally seeded with field ' +
        'definitions. Use FORM for surveys/request queues collected from people outside the tree — set ' +
        '`targetDatabaseId` to also mirror each response into a DATABASE\'s rows. ' +
        FIELDS_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().optional().describe('Form name/title'),
        parentId: z.string().optional().describe('Parent folder/node id to create it under'),
        icon: z.string().optional().describe('Emoji icon for the node'),
        fields: z.array(fieldShape).optional().describe('Initial field definitions; defaults to an empty form'),
        targetDatabaseId: z.string().optional().describe('DATABASE node id whose rows should mirror this form\'s responses'),
        config: z.record(z.unknown()).optional().describe('Free-form form config object (e.g. publicSubmit mode)'),
        workspace: z.string().optional().describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ name, parentId, icon, fields, targetDatabaseId, config, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createForm(ws, { name, parentId, icon, fields, targetDatabaseId, config });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_read_form',
    {
      title: 'Read a Rootr form',
      description:
        'Read a Rootr (루터) FORM node — its field definitions, targetDatabaseId, and config. Call this before ' +
        'rootr_update_form so you keep existing field ids stable, or before rootr_list_form_responses to know ' +
        'which field ids the response `values` are keyed by.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        formId: z.string().describe('FORM node id'),
      },
    },
    async ({ formId }) => {
      try {
        const client = makeClient();
        const result = await client.getForm(formId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_form',
    {
      title: 'Update a Rootr form (fields/targetDatabaseId/config)',
      description:
        'Merge-patch a Rootr (루터) FORM: if you pass `fields`, it REPLACES the whole fields array — call ' +
        'rootr_read_form first and resend fields you want to keep (with their existing ids) so past responses ' +
        'stay attributable. Pass `targetDatabaseId: null` to unlink the mirrored DATABASE. ' +
        FIELDS_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        formId: z.string().describe('FORM node id'),
        fields: z.array(fieldShape).optional().describe('COMPLETE fields array to set — omitted existing fields will be dropped'),
        targetDatabaseId: z.string().nullable().optional().describe('DATABASE node id to mirror responses into, or null to unlink'),
        config: z.record(z.unknown()).optional().describe('Free-form form config object (e.g. publicSubmit mode)'),
        icon: z.string().optional().describe('Emoji icon for the node'),
      },
    },
    async ({ formId, fields, targetDatabaseId, config, icon }) => {
      try {
        const client = makeClient();
        const result = await client.updateForm(formId, { fields, targetDatabaseId, config, icon });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_list_form_responses',
    {
      title: 'List a Rootr form\'s submitted responses',
      description:
        'List all responses submitted to a Rootr (루터) FORM, most recent first. Each response has `values` keyed ' +
        'by field id — call rootr_read_form first to map ids to field names. This is what lets an AI analyze ' +
        'responses collected from a form.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        formId: z.string().describe('FORM node id'),
      },
    },
    async ({ formId }) => {
      try {
        const client = makeClient();
        const result = await client.listFormResponses(formId);
        return jsonResult({ responses: result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_submit_form_response',
    {
      title: 'Submit a response to a Rootr form',
      description:
        'Submit one response to a Rootr (루터) FORM on behalf of the caller (authenticated submission, not the ' +
        'public/anonymous share-link flow). `values` is keyed by field id — call rootr_read_form first to get the ' +
        'exact field ids and types.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        formId: z.string().describe('FORM node id'),
        values: z.record(z.unknown()).describe('Response values keyed by field id'),
      },
    },
    async ({ formId, values }) => {
      try {
        const client = makeClient();
        const result = await client.createFormResponse(formId, values);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_create_form_share_link',
    {
      title: 'Issue a public share link for a Rootr form',
      description:
        'Issue a new public share link/token for a Rootr (루터) FORM so people outside the workspace can submit ' +
        'responses (via the /f/{token} page). The form\'s public-submit mode itself is controlled separately via ' +
        'rootr_update_form\'s config.publicSubmit ("off" | "login" | "anon").',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        formId: z.string().describe('FORM node id'),
      },
    },
    async ({ formId }) => {
      try {
        const client = makeClient();
        const result = await client.createFormShareLink(formId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_list_form_share_links',
    {
      title: 'List a Rootr form\'s public share links',
      description: 'List existing public share links/tokens issued for a Rootr (루터) FORM.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        formId: z.string().describe('FORM node id'),
      },
    },
    async ({ formId }) => {
      try {
        const client = makeClient();
        const result = await client.listFormShareLinks(formId);
        return jsonResult({ links: result });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
