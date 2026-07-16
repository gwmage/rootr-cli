import { z } from 'zod';

import { textResult, jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

/** Issue tracker tools: create tracker, list/create/get/update issues, comment. */
export function registerIssueTools(server) {
  server.registerTool(
    'rootr_create_issue_tracker',
    {
      title: 'Create an issue tracker in a Rootr workspace',
      description:
        'Create a new GitHub-style issue tracker document in a Rootr (루터) workspace. Returns the tracker with ' +
        'its id, plus its default labels/types — use rootr_create_issue afterward to add issues to it.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().describe('Name of the issue tracker'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ name, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createIssueTracker(ws, name);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_list_issues',
    {
      title: 'List issues in a tracker',
      description:
        'List issues in a Rootr (루터) issue tracker, optionally filtered by state (OPEN/CLOSED/ALL), label id, ' +
        'type id, or a text query. Use rootr_get_issue for full details of one issue.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        trackerId: z.string().describe('Issue tracker node id'),
        state: z.string().optional().describe('OPEN | CLOSED | ALL'),
        q: z.string().optional().describe('Free-text search within issues'),
        label: z.string().optional().describe('Label id to filter by'),
        type: z.string().optional().describe('Issue type id to filter by'),
      },
    },
    async ({ trackerId, state, q, label, type }) => {
      try {
        const client = makeClient();
        const result = await client.listIssues(trackerId, { state, q, label, type });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_create_issue',
    {
      title: 'Create an issue',
      description:
        'Create a new issue in a Rootr (루터) issue tracker. labels is an array of label ids, type is a type id ' +
        '(both from the tracker\'s custom type/label definitions — see rootr_read on the tracker or its metadata). ' +
        'parentIssueId nests this issue under another issue (sub-issue).',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        trackerId: z.string().describe('Issue tracker node id'),
        title: z.string().describe('Issue title'),
        body: z.string().optional().describe('Issue body (markdown)'),
        labels: z.array(z.string()).optional().describe('Label ids to attach'),
        type: z.string().optional().describe('Issue type id'),
        parentIssueId: z.string().optional().describe('Parent issue id, to create this as a sub-issue'),
      },
    },
    async ({ trackerId, title, body, labels, type, parentIssueId }) => {
      try {
        const client = makeClient();
        const result = await client.createIssue(trackerId, { title, body, labels, type, parentIssueId });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_get_issue',
    {
      title: 'Get an issue',
      description: 'Fetch full details of a single Rootr (루터) issue by id.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        issueId: z.string().describe('Issue id'),
      },
    },
    async ({ issueId }) => {
      try {
        const client = makeClient();
        const result = await client.getIssue(issueId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_issue',
    {
      title: 'Update an issue',
      description:
        'Update arbitrary fields of a Rootr (루터) issue. To close an issue, set state to "CLOSED" and stateReason ' +
        'to one of completed | not_planned | duplicate.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        issueId: z.string().describe('Issue id'),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.string().optional().describe('e.g. "OPEN" or "CLOSED"'),
        stateReason: z.string().optional().describe('completed | not_planned | duplicate (when closing)'),
        labels: z.array(z.string()).optional().describe('Label ids (replaces current labels)'),
        type: z.string().optional().describe('Issue type id'),
        assigneeId: z.string().optional().describe('User id to assign'),
      },
    },
    async ({ issueId, ...patch }) => {
      try {
        const client = makeClient();
        // Drop undefined keys so we don't send explicit nulls for untouched fields.
        const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const result = await client.updateIssue(issueId, body);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_comment_issue',
    {
      title: 'Comment on an issue',
      description:
        'Add a comment to a Rootr (루터) issue within its tracker. Comments carry a user identity, ' +
        'so this requires an ACCOUNT key (PAT) as ROOTR_API_KEY — a workspace key gets a 403.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        trackerId: z.string().describe('Issue tracker node id'),
        issueId: z.string().describe('Issue id to comment on'),
        body: z.string().describe('Comment body (markdown)'),
      },
    },
    async ({ trackerId, issueId, body }) => {
      try {
        const client = makeClient();
        const result = await client.commentIssue(trackerId, issueId, body);
        return textResult(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
