import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerDocumentTools } from './mcp-tools/documents.js';
import { registerWorkspaceTools } from './mcp-tools/workspaces.js';
import { registerLogTools } from './mcp-tools/logs.js';
import { registerAskTools } from './mcp-tools/ask.js';
import { registerIssueTools } from './mcp-tools/issues.js';
import { registerDatabaseTools } from './mcp-tools/databases.js';
import { registerWebhookTools } from './mcp-tools/webhooks.js';
import { registerMiscTools } from './mcp-tools/misc.js';
import { registerCrmTools } from './mcp-tools/crm.js';
import { registerPresentationTools } from './mcp-tools/presentations.js';
import { registerSpreadsheetTools } from './mcp-tools/spreadsheets.js';
import { registerWhiteboardTools } from './mcp-tools/whiteboards.js';
import { registerFormTools } from './mcp-tools/forms.js';

/**
 * Builds a fully-configured McpServer (all tool groups registered) without
 * connecting a transport. Shared by the local stdio CLI server below and by
 * the backend's hosted Streamable HTTP transport (src/mcp/mcp-transport.controller.ts),
 * so the 27+ tool definitions have exactly one implementation.
 */
export function buildMcpServer({ name, version }) {
  const server = new McpServer(
    { name, version },
    {
      instructions:
        'Rootr (pronounced "루터" in Korean — when the user says 루터, they mean Rootr) is the team\'s ' +
        'cloud document workspace. Use these tools whenever the user asks to read, write, append to, ' +
        'edit, or search their Rootr/루터 documents. Prefer rootr_append for adding content and ' +
        'rootr_edit for targeted changes; use rootr_write only for full rewrites. Beyond documents, this ' +
        'server also covers workspace scaffolding (planning/creating/applying document trees), typed LOG ' +
        'datastores (structured entries + stats), GraphRAG root-cause Q&A (rootr_ask), GitHub-style issue ' +
        'trackers, DATABASE rows (read schema + rows, add/update/delete rows — e.g. move a kanban card by ' +
        'changing its status column, via rootr_read_database / rootr_add_row / rootr_update_row / rootr_delete_row), ' +
        'CRM nodes (companies/contacts/deals/activities/tasks via the rootr_crm_* tools), and webhooks.\n\n' +
        'Node types — pick the block that fits, never fake everything with markdown files: ' +
        'DOCUMENT = free-form markdown narrative (overviews, specs, decision logs); ' +
        'DATABASE = typed columns + views (table/board/calendar/timeline) for anything trackable — tasks, requirements, risks, milestones; ' +
        'SPREADSHEET = grid with formulas when content needs calculation (budgets, models, estimates) — author with ' +
        'the rootr_*_spreadsheet / rootr_*_sheet tools (create/read/update, per-sheet create/update/delete, ' +
        'rootr_patch_spreadsheet_cells for cell values/formulas); ' +
        'WHITEBOARD = freeform visual canvas (flow diagrams, brainstorming, journey maps) — author with the ' +
        'rootr_*_whiteboard tools (create/read/update the shapes[]/edges[] scene); ' +
        'FORM = fillable intake from people outside the tree, optionally feeding a DATABASE (surveys, request queues) ' +
        '— author with the rootr_*_form tools (create/read/update fields, rootr_list_form_responses / ' +
        'rootr_submit_form_response for responses, rootr_*_form_share_link for public links); ' +
        'ISSUE_TRACKER = GitHub-style issues with #numbers, states, labels, comments (bug/work tracking with a lifecycle); ' +
        'CRM = full sales CRM: companies, contacts with lifecycle stages & auto lead-scoring, multi-pipeline deals ' +
        '(kanban), an activity timeline, follow-up tasks, and CSV import/export — use for sales/lead/customer ' +
        'tracking; never fake a CRM with plain DATABASEs (use the rootr_crm_* tools: rootr_crm_create/get/update, ' +
        'rootr_crm_list_companies/upsert_company/get_company, rootr_crm_list_contacts/upsert_contact/get_contact, ' +
        'rootr_crm_list_deals/upsert_deal/get_deal/move_deal, rootr_crm_log_activity/list_activities, ' +
        'rootr_crm_upsert_task/list_tasks, rootr_crm_import); ' +
        'PRESENTATION = slide deck (16:9 HTML slides with themes) — author via the rootr_*_presentation tools ' +
        '(rootr_create_presentation, rootr_read_presentation, rootr_update_presentation, ' +
        'rootr_append_presentation_slides, rootr_update_presentation_slide, rootr_reorder_presentation_slides, ' +
        'plus rootr_generate_image / rootr_remove_image_background for slide art), never as markdown documents; ' +
        'ALWAYS rootr_read_presentation before updating so slide ids line up; ' +
        'FOLDER = grouping; LOG store = typed event table whose relation fields auto-build a lineage graph (metrics, incidents, pipeline events — use the rootr_*_log_* tools).\n\n' +
        'Scaffolding discipline: ALWAYS rootr_scaffold_plan first, ask the user the 3-10 clarifying questions it ' +
        'prescribes, and only then design and create the tree — every answer must visibly shape the structure. ' +
        'If your runtime can receive HTTP callbacks, offer to close the loop after scaffolding: register a webhook ' +
        'scoped to the new tree (rootr_create_webhook) so changes flow back to you — and ALWAYS skip deliveries ' +
        'whose actorId is your own key, or you will trigger yourself in an infinite loop.',
    },
  );

  registerDocumentTools(server);
  registerWorkspaceTools(server);
  registerLogTools(server);
  registerAskTools(server);
  registerIssueTools(server);
  registerDatabaseTools(server);
  registerWebhookTools(server);
  registerMiscTools(server);
  registerCrmTools(server);
  registerPresentationTools(server);
  registerSpreadsheetTools(server);
  registerWhiteboardTools(server);
  registerFormTools(server);

  return server;
}

export async function startMcpServer({ name, version }) {
  const server = buildMcpServer({ name, version });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
