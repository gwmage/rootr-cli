import { z } from 'zod';

import { jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

/** LOG datastore tools: create/update-fields/add-entries/query-entries/stats. */
export function registerLogTools(server) {
  server.registerTool(
    'rootr_create_log_store',
    {
      title: 'Create a typed LOG datastore',
      description:
        'Create a new typed LOG store (a structured, queryable table-like node) in a Rootr (루터) workspace. ' +
        'Each field has a name/type; type is one of string|int|float|bool|datetime|json|enum|level|relation. ' +
        'Relation fields additionally need target (a node id to relate to) and optional many/relation flags. ' +
        'Use rootr_add_log_entries afterward to insert rows, and rootr_query_log_entries / rootr_log_stats to read them back.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().describe('Name of the LOG store'),
        fields: z
          .array(z.record(z.any()))
          .describe(
            'Field definitions: [{name, type, ...}]. type=string|int|float|bool|datetime|json|enum|level|relation. ' +
              'relation fields add target (node id), many?, relation?.',
          ),
        parentId: z.string().optional().describe('Parent node id to nest the LOG store under'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ name, fields, parentId, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createLogStore(ws, { name, fields, parentId });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_log_fields',
    {
      title: 'Replace a LOG store\'s field definitions (full replace)',
      description:
        'Update the field schema of an existing LOG store. WARNING: this REPLACES THE ENTIRE FIELD SET — ' +
        'you must resend every field you want to keep, not just the ones you are changing/adding. ' +
        'Read the LOG store first (e.g. via rootr_read or a get-log call) to see its current fields before calling this.',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        logId: z.string().describe('LOG store node id'),
        fields: z
          .array(z.record(z.any()))
          .describe('COMPLETE field list to set — omitted existing fields will be dropped'),
      },
    },
    async ({ logId, fields }) => {
      try {
        const client = makeClient();
        const result = await client.updateLogFields(logId, fields);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_add_log_entries',
    {
      title: 'Add entries to a LOG store',
      description:
        'Append one or more entries (rows) to a LOG store. Each entry may carry ts, source, level, message, data ' +
        '(shaped per the store\'s field schema). This is additive — existing entries are untouched.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        logId: z.string().describe('LOG store node id'),
        entries: z
          .array(z.record(z.any()))
          .describe('Entries to add: [{ts?, source?, level?, message?, data?}, ...]'),
      },
    },
    async ({ logId, entries }) => {
      try {
        const client = makeClient();
        const result = await client.addLogEntries(logId, entries);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_query_log_entries',
    {
      title: 'Query entries from a LOG store',
      description:
        'Query/filter entries from a LOG store by time range, source, level, and/or anomaly flag. ' +
        'Use this to inspect recent activity or find anomalous entries before asking rootr_ask for root-cause analysis.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        logId: z.string().describe('LOG store node id'),
        from: z.string().optional().describe('ISO timestamp lower bound'),
        to: z.string().optional().describe('ISO timestamp upper bound'),
        source: z.string().optional().describe('Filter by source'),
        level: z.string().optional().describe('Filter by level'),
        anomalyOnly: z.boolean().optional().describe('Only return entries flagged as anomalous'),
        limit: z.number().optional().describe('Max entries to return'),
        order: z.string().optional().describe('Sort order, e.g. "asc" or "desc"'),
      },
    },
    async ({ logId, from, to, source, level, anomalyOnly, limit, order }) => {
      try {
        const client = makeClient();
        const result = await client.queryLogEntries(logId, {
          from,
          to,
          source,
          level,
          anomalyOnly,
          limit,
          order,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_log_stats',
    {
      title: 'Aggregate stats over a LOG store',
      description:
        'Compute aggregate statistics over a LOG store\'s entries, grouped by hour/day/source/level, with a ' +
        'metric of count/avg/max/min/sum (avg/max/min/sum require a numeric `field`). Useful for trend/volume ' +
        'questions without pulling raw entries.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        logId: z.string().describe('LOG store node id'),
        groupBy: z.string().optional().describe('hour | day | source | level'),
        metric: z.string().optional().describe('count | avg | max | min | sum'),
        field: z.string().optional().describe('Numeric field name, required for avg/max/min/sum'),
        from: z.string().optional().describe('ISO timestamp lower bound'),
        to: z.string().optional().describe('ISO timestamp upper bound'),
      },
    },
    async ({ logId, groupBy, metric, field, from, to }) => {
      try {
        const client = makeClient();
        const result = await client.logStats(logId, { groupBy, metric, field, from, to });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
