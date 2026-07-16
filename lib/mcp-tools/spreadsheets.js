import { z } from 'zod';

import { jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

const CELL_VALUE = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .describe('Raw/display value; null clears the cell when patching');

const cellShape = z
  .object({
    v: CELL_VALUE.optional(),
    f: z.string().optional().describe('Formula source, e.g. "=SUM(A1:A3)" (leading "=" included)'),
  })
  .describe('One cell: v (value) and/or f (formula). Formulas are recalculated server-side.');

const CELLS_GUIDE =
  'Cells are addressed A1-style ("A1", "B12", ...) in a sparse map: { "A1": { v: 42 }, "B1": { f: "=A1*2" } }. ' +
  'Set a cell to `null` to clear it. Read the sheet first (rootr_read_spreadsheet) so you know current dimensions ' +
  'and existing content before patching — patchCells only touches the keys you send, everything else is untouched.';

/** SPREADSHEET node tools: create/read/update the grid, manage sheets, patch cells. */
export function registerSpreadsheetTools(server) {
  server.registerTool(
    'rootr_create_spreadsheet',
    {
      title: 'Create a Rootr spreadsheet',
      description:
        'Create a new SPREADSHEET node (a grid with formulas) in a Rootr (루터) workspace. Use SPREADSHEET when ' +
        'content needs calculation (budgets, models, estimates) — for plain tracked lists use DATABASE instead. ' +
        'Defaults to a single empty "Sheet1" if no `data` is given. ' +
        CELLS_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().optional().describe('Spreadsheet name/title'),
        parentId: z.string().optional().describe('Parent folder/node id to create it under'),
        icon: z.string().optional().describe('Emoji icon for the node'),
        data: z
          .object({ sheets: z.array(z.record(z.unknown())).optional() })
          .optional()
          .describe('Initial data payload; defaults to a single empty "Sheet1"'),
        config: z.record(z.unknown()).optional().describe('Free-form spreadsheet config object'),
        workspace: z.string().optional().describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ name, parentId, icon, data, config, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createSpreadsheet(ws, { name, parentId, icon, data, config });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_read_spreadsheet',
    {
      title: 'Read a Rootr spreadsheet',
      description:
        'Read a Rootr (루터) SPREADSHEET node — its sheets, each with a sparse `cells` map and dimensions. Call ' +
        'this before rootr_update_spreadsheet / rootr_patch_spreadsheet_cells so you know the current sheetIds ' +
        'and cell contents.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        spreadsheetId: z.string().describe('SPREADSHEET node id'),
      },
    },
    async ({ spreadsheetId }) => {
      try {
        const client = makeClient();
        const result = await client.getSpreadsheet(spreadsheetId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_spreadsheet',
    {
      title: 'Update a Rootr spreadsheet (config/icon, or replace all sheets)',
      description:
        'Merge-patch a Rootr (루터) SPREADSHEET: update config/icon, or REPLACE THE WHOLE sheets array (if you ' +
        'pass `sheets`, it replaces every existing sheet — call rootr_read_spreadsheet first and resend sheets ' +
        'you want to keep, or prefer rootr_create_sheet / rootr_patch_spreadsheet_cells for incremental changes).',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        spreadsheetId: z.string().describe('SPREADSHEET node id'),
        sheets: z
          .array(z.record(z.unknown()))
          .optional()
          .describe('COMPLETE sheets array to set — omitted existing sheets will be dropped'),
        config: z.record(z.unknown()).optional().describe('Free-form spreadsheet config object'),
        icon: z.string().optional().describe('Emoji icon for the node'),
      },
    },
    async ({ spreadsheetId, sheets, config, icon }) => {
      try {
        const client = makeClient();
        const result = await client.updateSpreadsheet(spreadsheetId, { sheets, config, icon });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_create_sheet',
    {
      title: 'Add a sheet (tab) to a Rootr spreadsheet',
      description: 'Add a new empty sheet (tab) to an existing Rootr (루터) SPREADSHEET, without touching other sheets.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        spreadsheetId: z.string().describe('SPREADSHEET node id'),
        name: z.string().optional().describe('Sheet name, e.g. "Q1 Budget"'),
        rowCount: z.number().int().min(1).max(10_000).optional().describe('Row count (default 1000)'),
        colCount: z.number().int().min(1).max(500).optional().describe('Column count (default 52)'),
      },
    },
    async ({ spreadsheetId, name, rowCount, colCount }) => {
      try {
        const client = makeClient();
        const result = await client.createSheet(spreadsheetId, { name, rowCount, colCount });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_update_sheet',
    {
      title: 'Rename/resize ONE sheet of a Rootr spreadsheet',
      description:
        'Merge-patch a single sheet\'s name/dimensions/row-col sizing by sheetId, without touching its cells. ' +
        'Call rootr_read_spreadsheet first to get the exact sheetId.',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        spreadsheetId: z.string().describe('SPREADSHEET node id'),
        sheetId: z.string().describe('Sheet id to update'),
        name: z.string().optional().describe('New sheet name'),
        rowCount: z.number().int().min(1).max(10_000).optional(),
        colCount: z.number().int().min(1).max(500).optional(),
        rowSizes: z.record(z.number()).optional().describe('Per-row heights (px), keyed by 0-based row index string'),
        colSizes: z.record(z.number()).optional().describe('Per-column widths (px), keyed by 0-based col index string'),
        merges: z
          .array(z.object({ r1: z.number(), c1: z.number(), r2: z.number(), c2: z.number() }))
          .optional()
          .describe('Merged-cell ranges (0-indexed, inclusive, anchor = top-left)'),
      },
    },
    async ({ spreadsheetId, sheetId, name, rowCount, colCount, rowSizes, colSizes, merges }) => {
      try {
        const client = makeClient();
        const result = await client.patchSheet(spreadsheetId, sheetId, {
          name,
          rowCount,
          colCount,
          rowSizes,
          colSizes,
          merges,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_delete_sheet',
    {
      title: 'Delete a sheet (tab) from a Rootr spreadsheet',
      description: 'Delete one sheet (tab) from a Rootr (루터) SPREADSHEET by sheetId. Not recoverable — read first to confirm.',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        spreadsheetId: z.string().describe('SPREADSHEET node id'),
        sheetId: z.string().describe('Sheet id to delete'),
      },
    },
    async ({ spreadsheetId, sheetId }) => {
      try {
        const client = makeClient();
        await client.deleteSheet(spreadsheetId, sheetId);
        return jsonResult({ deleted: sheetId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_patch_spreadsheet_cells',
    {
      title: 'Write cells into a Rootr spreadsheet sheet (preferred way to fill in data)',
      description:
        'Sparse-patch cells of ONE sheet in a Rootr (루터) SPREADSHEET, without touching the rest of the sheet. ' +
        'PREFER this over rootr_update_spreadsheet when you are only filling in / editing cell values or formulas. ' +
        CELLS_GUIDE,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        spreadsheetId: z.string().describe('SPREADSHEET node id'),
        sheetId: z.string().describe('Sheet id to patch'),
        cells: z
          .record(cellShape.nullable())
          .describe('Map of A1-style ref -> cell (or null to clear), e.g. { "A1": { "v": 42 }, "B1": { "f": "=A1*2" } }'),
      },
    },
    async ({ spreadsheetId, sheetId, cells }) => {
      try {
        const client = makeClient();
        const result = await client.patchCells(spreadsheetId, sheetId, cells);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
