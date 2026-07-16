import { z } from 'zod';

import { jsonResult, errorResult, makeClient } from './shared.js';

/**
 * Resolve a `{propertyNameOrId: value}` map to `{propertyId: value}` using the
 * database schema, so agents can address columns by their human name OR their
 * id. `null` is preserved (clear marker for PATCH). Throws on an unknown key so
 * the model is told to read the schema first.
 */
function resolveValueKeys(properties, values) {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const byName = new Map(properties.map((p) => [p.name.toLowerCase(), p]));
  const out = {};
  for (const [key, v] of Object.entries(values || {})) {
    const prop = byId.get(key) ?? byName.get(String(key).toLowerCase());
    if (!prop) {
      throw new Error(`Unknown property "${key}". Call rootr_read_database first to see the column ids/names.`);
    }
    out[prop.id] = v;
  }
  return out;
}

/**
 * Database (Notion-style table/board/kanban) row tools. The REST layer already
 * exposes GET /databases/:id (schema), GET/POST /databases/:id/rows and
 * PATCH/DELETE /databases/:id/rows/:rowId — these tools wrap it so agents can
 * read the schema, then create/move/edit/delete rows (e.g. change a select
 * "status" column = move a kanban card between columns).
 */
export function registerDatabaseTools(server) {
  server.registerTool(
    'rootr_read_database',
    {
      title: 'Read a database schema and rows',
      description:
        'Read a Rootr (루터) DATABASE node — its schema (properties with ids/types and select options) plus all rows ' +
        '(each with its rowId and values). ALWAYS call this before rootr_add_row / rootr_update_row so you know the exact ' +
        'property ids/names and, for board/kanban views, which select column holds the status. Only works on DATABASE nodes.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        databaseId: z.string().describe('DATABASE node id'),
      },
    },
    async ({ databaseId }) => {
      try {
        const client = makeClient();
        const [database, rows] = await Promise.all([
          client.getDatabase(databaseId),
          client.listRows(databaseId),
        ]);
        return jsonResult({ database, rows });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_list_rows',
    {
      title: 'List database rows',
      description:
        'List the rows of a Rootr (루터) DATABASE (id + values + position), without the schema. ' +
        'Use rootr_read_database instead when you also need the property/column definitions.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        databaseId: z.string().describe('DATABASE node id'),
      },
    },
    async ({ databaseId }) => {
      try {
        const client = makeClient();
        const rows = await client.listRows(databaseId);
        return jsonResult({ rows });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_add_row',
    {
      title: 'Add a database row',
      description:
        'Append a row to a Rootr (루터) DATABASE. `values` maps property NAME (or id) → value. ' +
        'Value shapes by type: title/text/url/select/person → string; number → number; multi_select → string[]; ' +
        'checkbox → boolean; date → { start: "YYYY-MM-DD", end? }. A select value is the OPTION NAME. ' +
        'Call rootr_read_database first to learn the columns. Optionally set `position` to insert at an index.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        databaseId: z.string().describe('DATABASE node id'),
        values: z.record(z.unknown()).describe('{ propertyNameOrId: value } for the new row'),
        position: z.number().optional().describe('0-based insert index; appended at the end if omitted'),
      },
    },
    async ({ databaseId, values, position }) => {
      try {
        const client = makeClient();
        const database = await client.getDatabase(databaseId);
        const resolved = resolveValueKeys(database.properties || [], values);
        const row = await client.createRow(databaseId, { values: resolved, position });
        return jsonResult(row);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_row',
    {
      title: 'Update a database row',
      description:
        'Merge-patch ONE row of a Rootr (루터) DATABASE by rowId (get rowIds from rootr_read_database). ' +
        '`values` maps property NAME (or id) → new value; only the passed keys change, `null` clears a key, omitted keys ' +
        'are left unchanged. To MOVE a kanban card to another column, set its select/status property to the new option name. ' +
        'Optionally set `position` to reorder the row.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        databaseId: z.string().describe('DATABASE node id'),
        rowId: z.string().describe('Row id (must belong to the database)'),
        values: z.record(z.unknown()).optional().describe('{ propertyNameOrId: newValue | null } partial patch'),
        position: z.number().optional().describe('New 0-based position for the row'),
      },
    },
    async ({ databaseId, rowId, values, position }) => {
      try {
        const client = makeClient();
        let resolved;
        if (values !== undefined) {
          const database = await client.getDatabase(databaseId);
          resolved = resolveValueKeys(database.properties || [], values);
        }
        const row = await client.updateRow(databaseId, rowId, { values: resolved, position });
        return jsonResult(row);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_delete_row',
    {
      title: 'Delete a database row',
      description:
        'Delete ONE row of a Rootr (루터) DATABASE by rowId (its linked page, if any, is moved to the trash). ' +
        'Verify the row via rootr_read_database first — do not guess rowIds.',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        databaseId: z.string().describe('DATABASE node id'),
        rowId: z.string().describe('Row id to delete (must belong to the database)'),
      },
    },
    async ({ databaseId, rowId }) => {
      try {
        const client = makeClient();
        await client.deleteRow(databaseId, rowId);
        return jsonResult({ deleted: true, rowId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
