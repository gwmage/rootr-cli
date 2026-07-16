import { z } from 'zod';

import { jsonResult, errorResult, makeClient, requireWorkspace } from './shared.js';

/**
 * Shared context repeated (shortened) across tool descriptions so an agent
 * that only sees ONE of these tools still understands the node: CRM is a
 * full sales CRM node — companies, contacts (with lifecycle stage + auto
 * lead-scoring), multi-pipeline deals (kanban board), an activity timeline,
 * and follow-up tasks — all auto-connected into the workspace's knowledge
 * graph. Use it for anything sales/lead/customer-tracking; never fake a CRM
 * with a plain DATABASE.
 */
const CRM_CONTEXT =
  'Part of a Rootr (루터) CRM node: a full sales CRM (companies, contacts with lifecycle stages + auto lead-scoring, ' +
  'multi-pipeline deals/kanban, activity timeline, follow-up tasks), auto-linked into the knowledge graph.';

const stageShape = z.object({
  id: z.string().optional().describe('Stage id; auto-generated if omitted'),
  name: z.string().describe('Stage name, e.g. "Qualified", "Proposal Sent"'),
  probability: z.number().optional().describe('Default win probability 0-100 for deals entering this stage'),
  color: z.string().optional().describe('Kanban column color hint, e.g. a hex code or color name'),
});

const pipelineShape = z.object({
  id: z.string().optional().describe('Pipeline id; auto-generated if omitted'),
  name: z.string().describe('Pipeline name, e.g. "Sales Pipeline", "Renewals"'),
  stages: z.array(stageShape).optional().describe('Ordered kanban stages for this pipeline'),
});

/**
 * A parameter got JSON-stringified by the MCP client instead of arriving as
 * a real object/array (seen historically whenever a tool schema used
 * z.any()/z.unknown() at the top level). Defensively parse if we get a
 * string where an object/array was expected, so a mis-behaving client still
 * works instead of erroring the whole call.
 */
function coerceJson(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function registerCrmTools(server) {
  server.registerTool(
    'rootr_crm_create',
    {
      title: 'Create a Rootr CRM node',
      description:
        'Create a new CRM node in a Rootr (루터) workspace — companies, contacts, multi-pipeline deals (kanban), ' +
        'activities and tasks all live inside it. Optionally seed custom `pipelines` (name + ordered stages, each ' +
        'with an optional win probability/color) and/or custom company/contact/deal `fields`; sane defaults are ' +
        'used if omitted. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        name: z.string().optional().describe('CRM node name'),
        path: z.string().optional().describe('Full tree path to create at, e.g. "/sales/crm"'),
        parentId: z.string().optional().describe('Parent folder/node id to create the CRM under'),
        icon: z.string().optional().describe('Emoji icon for the CRM node'),
        pipelines: z
          .array(pipelineShape)
          .optional()
          .describe('Custom deal pipelines with stages; defaults to a single standard sales pipeline if omitted'),
        fields: z
          .array(z.record(z.unknown()))
          .optional()
          .describe('Custom field definitions for companies/contacts/deals (schema-defined by the CRM feature)'),
        config: z.record(z.unknown()).optional().describe('Free-form CRM config/settings object'),
        createParents: z.boolean().optional().describe('Create missing parent folders in the path (default true)'),
        autoRename: z.boolean().optional().describe('Auto-rename on name collision instead of erroring'),
        workspace: z.string().optional().describe('Workspace id; defaults to ROOTR_WORKSPACE/config if omitted'),
      },
    },
    async ({ name, path, parentId, icon, pipelines, fields, config, createParents, autoRename, workspace }) => {
      try {
        const ws = requireWorkspace(workspace);
        const client = makeClient(ws);
        const result = await client.createCrm(ws, {
          name,
          path,
          parentId,
          icon,
          pipelines: coerceJson(pipelines),
          fields: coerceJson(fields),
          config: coerceJson(config),
          createParents,
          autoRename,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_get',
    {
      title: 'Get a Rootr CRM node (pipelines, fields, counts)',
      description:
        'Fetch a Rootr (루터) CRM node: its pipelines (with stages), custom field definitions, config, entity ' +
        'counts, and your access level. Call this before rootr_crm_update or before creating deals so you know ' +
        'the exact pipeline/stage ids. Set includeSummary to also merge in rootr_crm_get\'s stage-value/forecast/' +
        'win-rate summary in one call. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        includeSummary: z
          .boolean()
          .optional()
          .describe('If true, also fetch and merge the CRM summary (pipeline value/forecast/win-rate/tasks) as `summary`'),
      },
    },
    async ({ crmId, includeSummary }) => {
      try {
        const client = makeClient();
        const crm = await client.getCrm(crmId);
        if (includeSummary) {
          const summary = await client.getCrmSummary(crmId);
          return jsonResult({ ...crm, summary });
        }
        return jsonResult(crm);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_update',
    {
      title: 'Update a Rootr CRM node (pipelines/fields/config)',
      description:
        'Merge-patch a Rootr (루터) CRM node\'s pipelines, custom field definitions, config, or icon. Passing ' +
        '`pipelines` REPLACES the whole pipelines array — call rootr_crm_get first and resend any stages/pipelines ' +
        'you want to keep. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        pipelines: z
          .array(pipelineShape)
          .optional()
          .describe('COMPLETE pipelines array to set (replaces existing pipelines/stages)'),
        fields: z.array(z.record(z.unknown())).optional().describe('COMPLETE custom field definitions to set'),
        config: z.record(z.unknown()).optional().describe('Free-form CRM config/settings object'),
        icon: z.string().optional().describe('Emoji icon for the CRM node'),
      },
    },
    async ({ crmId, pipelines, fields, config, icon }) => {
      try {
        const client = makeClient();
        const result = await client.updateCrm(crmId, {
          pipelines: coerceJson(pipelines),
          fields: coerceJson(fields),
          config: coerceJson(config),
          icon,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Companies -----------------------------------------------------------

  server.registerTool(
    'rootr_crm_list_companies',
    {
      title: 'List companies in a Rootr CRM',
      description:
        'List/search companies in a Rootr (루터) CRM, optionally filtered by free-text query, owner, or tag, and ' +
        'sorted/paginated. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        q: z.string().optional().describe('Free-text search (name/domain/etc.)'),
        ownerId: z.string().optional().describe('Filter by owning user id'),
        tag: z.string().optional().describe('Filter by tag'),
        sort: z.string().optional().describe('Sort key, e.g. "name" | "-createdAt"'),
        limit: z.number().optional().describe('Max results (pagination)'),
        offset: z.number().optional().describe('Result offset (pagination)'),
      },
    },
    async ({ crmId, q, ownerId, tag, sort, limit, offset }) => {
      try {
        const client = makeClient();
        const result = await client.listCrmCompanies(crmId, { q, ownerId, tag, sort, limit, offset });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_upsert_company',
    {
      title: 'Create, update, or delete a company in a Rootr CRM',
      description:
        'Create a new company (omit `companyId`), update an existing one (pass `companyId` + the fields to change), ' +
        'or delete one (pass `companyId` and `delete: true`). `custom` holds values for the CRM\'s custom field ' +
        'definitions (see rootr_crm_get). ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        companyId: z.string().optional().describe('Existing company id to update/delete; omit to create a new company'),
        delete: z.boolean().optional().describe('If true (with companyId), delete the company instead of updating'),
        name: z.string().optional().describe('Company name (required when creating)'),
        domain: z.string().optional().describe('Primary domain, e.g. "acme.com" (auto-links contacts sharing it)'),
        industry: z.string().optional(),
        size: z.string().optional().describe('Company size band, e.g. "1-10" | "51-200"'),
        address: z.string().optional(),
        description: z.string().optional(),
        ownerId: z.string().optional().describe('Owning user id'),
        source: z.string().optional().describe('Acquisition source, e.g. "referral" | "outbound"'),
        tags: z.array(z.string()).optional(),
        custom: z.record(z.unknown()).optional().describe('Custom field values, keyed by field id/name'),
      },
    },
    async ({ crmId, companyId, delete: doDelete, custom, ...rest }) => {
      try {
        const client = makeClient();
        if (companyId && doDelete) {
          await client.deleteCrmCompany(companyId);
          return jsonResult({ deleted: true, companyId });
        }
        const body = { ...rest, custom: coerceJson(custom) };
        const result = companyId
          ? await client.updateCrmCompany(companyId, body)
          : await client.createCrmCompany(crmId, body);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_get_company',
    {
      title: 'Get a company detail (contacts, deals, activities, tasks)',
      description:
        'Fetch full detail of ONE Rootr (루터) CRM company: the company plus its contacts, deals, activities, and ' +
        'tasks. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        companyId: z.string().describe('Company id'),
      },
    },
    async ({ companyId }) => {
      try {
        const client = makeClient();
        const result = await client.getCrmCompany(companyId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Contacts ------------------------------------------------------------

  server.registerTool(
    'rootr_crm_list_contacts',
    {
      title: 'List contacts in a Rootr CRM',
      description:
        'List/search contacts in a Rootr (루터) CRM, filterable by free-text query, company, lifecycle stage ' +
        '(lead|mql|sql|opportunity|customer|evangelist), lead status (new|attempting|connected|open_deal|unqualified), ' +
        'owner, or tag. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        q: z.string().optional().describe('Free-text search (name/email/etc.)'),
        companyId: z.string().optional().describe('Filter by company id'),
        lifecycleStage: z.string().optional().describe('lead | mql | sql | opportunity | customer | evangelist'),
        leadStatus: z.string().optional().describe('new | attempting | connected | open_deal | unqualified'),
        ownerId: z.string().optional().describe('Filter by owning user id'),
        tag: z.string().optional().describe('Filter by tag'),
        sort: z.string().optional().describe('Sort key, e.g. "name" | "-createdAt"'),
        limit: z.number().optional().describe('Max results (pagination)'),
        offset: z.number().optional().describe('Result offset (pagination)'),
      },
    },
    async ({ crmId, q, companyId, lifecycleStage, leadStatus, ownerId, tag, sort, limit, offset }) => {
      try {
        const client = makeClient();
        const result = await client.listCrmContacts(crmId, {
          q,
          companyId,
          lifecycleStage,
          leadStatus,
          ownerId,
          tag,
          sort,
          limit,
          offset,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_upsert_contact',
    {
      title: 'Create, update, or delete a contact in a Rootr CRM',
      description:
        'Create a new contact (omit `contactId`), update an existing one (pass `contactId` + fields to change), ' +
        'or delete one (pass `contactId` and `delete: true`). Setting `email` auto-links the contact to a matching ' +
        'company by domain, and leadScore is computed server-side automatically — do not try to set it yourself. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        contactId: z.string().optional().describe('Existing contact id to update/delete; omit to create a new contact'),
        delete: z.boolean().optional().describe('If true (with contactId), delete the contact instead of updating'),
        name: z.string().optional().describe('Contact name (required when creating)'),
        email: z.string().optional().describe('Email address; its domain auto-links a matching company'),
        phone: z.string().optional(),
        title: z.string().optional().describe('Job title'),
        companyId: z.string().optional().describe('Company id to attach to (overrides domain auto-link)'),
        lifecycleStage: z
          .string()
          .optional()
          .describe('lead | mql | sql | opportunity | customer | evangelist'),
        leadStatus: z
          .string()
          .optional()
          .describe('new | attempting | connected | open_deal | unqualified'),
        ownerId: z.string().optional().describe('Owning user id'),
        source: z.string().optional().describe('Acquisition source, e.g. "referral" | "outbound"'),
        linkedinUrl: z.string().optional(),
        tags: z.array(z.string()).optional(),
        custom: z.record(z.unknown()).optional().describe('Custom field values, keyed by field id/name'),
      },
    },
    async ({ crmId, contactId, delete: doDelete, custom, ...rest }) => {
      try {
        const client = makeClient();
        if (contactId && doDelete) {
          await client.deleteCrmContact(contactId);
          return jsonResult({ deleted: true, contactId });
        }
        const body = { ...rest, custom: coerceJson(custom) };
        const result = contactId
          ? await client.updateCrmContact(contactId, body)
          : await client.createCrmContact(crmId, body);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_get_contact',
    {
      title: 'Get a contact by id',
      description: 'Fetch full detail of ONE Rootr (루터) CRM contact by id. ' + CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        contactId: z.string().describe('Contact id'),
      },
    },
    async ({ contactId }) => {
      try {
        const client = makeClient();
        const result = await client.getCrmContact(contactId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Deals ---------------------------------------------------------------

  server.registerTool(
    'rootr_crm_list_deals',
    {
      title: 'List deals in a Rootr CRM',
      description:
        'List/search deals (kanban cards) in a Rootr (루터) CRM, filterable by query, pipeline, stage, status ' +
        '(open|won|lost|all), owner, company, contact, or tag. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        q: z.string().optional().describe('Free-text search (deal name/etc.)'),
        pipelineId: z.string().optional().describe('Filter by pipeline id'),
        stageId: z.string().optional().describe('Filter by stage id'),
        status: z.string().optional().describe('open | won | lost | all'),
        ownerId: z.string().optional().describe('Filter by owning user id'),
        companyId: z.string().optional().describe('Filter by company id'),
        contactId: z.string().optional().describe('Filter by contact id'),
        tag: z.string().optional().describe('Filter by tag'),
        sort: z.string().optional().describe('Sort key, e.g. "-value" | "expectedCloseDate"'),
        limit: z.number().optional().describe('Max results (pagination)'),
        offset: z.number().optional().describe('Result offset (pagination)'),
      },
    },
    async ({ crmId, q, pipelineId, stageId, status, ownerId, companyId, contactId, tag, sort, limit, offset }) => {
      try {
        const client = makeClient();
        const result = await client.listCrmDeals(crmId, {
          q,
          pipelineId,
          stageId,
          status,
          ownerId,
          companyId,
          contactId,
          tag,
          sort,
          limit,
          offset,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_upsert_deal',
    {
      title: 'Create, update, or delete a deal in a Rootr CRM',
      description:
        'Create a new deal (omit `dealId`; defaults to the CRM\'s first pipeline if `pipelineId` is omitted), ' +
        'update an existing one (pass `dealId` + fields to change — set `status` to "won" or "lost" to close it, ' +
        'with `wonLostReason`, or "open" to reopen), or delete one (pass `dealId` and `delete: true`). To MOVE a ' +
        'deal between kanban stages, prefer rootr_crm_move_deal instead of patching `stageId` here. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        dealId: z.string().optional().describe('Existing deal id to update/delete; omit to create a new deal'),
        delete: z.boolean().optional().describe('If true (with dealId), delete the deal instead of updating'),
        name: z.string().optional().describe('Deal name (required when creating)'),
        value: z.number().optional().describe('Deal value'),
        currency: z.string().optional().describe('Currency code, e.g. "USD" | "KRW"'),
        pipelineId: z.string().optional().describe('Pipeline id; defaults to the CRM\'s first pipeline when creating'),
        stageId: z.string().optional().describe('Stage id (see rootr_crm_move_deal to change stage on an existing deal)'),
        status: z.string().optional().describe('open | won | lost (patch only)'),
        wonLostReason: z.string().optional().describe('Reason text when closing status to won/lost'),
        probability: z.number().optional().describe('Win probability override 0-100'),
        expectedCloseDate: z.string().optional().describe('ISO date string'),
        priority: z.string().optional().describe('low | medium | high'),
        ownerId: z.string().optional().describe('Owning user id'),
        source: z.string().optional().describe('Acquisition source'),
        tags: z.array(z.string()).optional(),
        companyId: z.string().optional().describe('Associated company id'),
        primaryContactId: z.string().optional().describe('Primary contact id'),
        contacts: z
          .array(z.object({ contactId: z.string(), role: z.string().optional() }))
          .optional()
          .describe('Additional contacts on the deal with an optional role, e.g. "champion" | "economic buyer"'),
        custom: z.record(z.unknown()).optional().describe('Custom field values, keyed by field id/name'),
      },
    },
    async ({ crmId, dealId, delete: doDelete, contacts, custom, ...rest }) => {
      try {
        const client = makeClient();
        if (dealId && doDelete) {
          await client.deleteCrmDeal(dealId);
          return jsonResult({ deleted: true, dealId });
        }
        const body = { ...rest, contacts: coerceJson(contacts), custom: coerceJson(custom) };
        const result = dealId ? await client.updateCrmDeal(dealId, body) : await client.createCrmDeal(crmId, body);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_get_deal',
    {
      title: 'Get a deal by id',
      description: 'Fetch full detail of ONE Rootr (루터) CRM deal by id. ' + CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        dealId: z.string().describe('Deal id'),
      },
    },
    async ({ dealId }) => {
      try {
        const client = makeClient();
        const result = await client.getCrmDeal(dealId);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_move_deal',
    {
      title: 'Move a deal to another kanban stage',
      description:
        'Move a Rootr (루터) CRM deal to a different pipeline stage (kanban column), optionally into a different ' +
        'pipeline and/or a specific card position. Call rootr_crm_get first to learn the target stageId/pipelineId. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        dealId: z.string().describe('Deal id to move'),
        stageId: z.string().describe('Target stage id'),
        pipelineId: z.string().optional().describe('Target pipeline id, if moving across pipelines'),
        position: z.number().optional().describe('0-based card position within the target stage'),
      },
    },
    async ({ dealId, stageId, pipelineId, position }) => {
      try {
        const client = makeClient();
        const result = await client.moveCrmDeal(dealId, { stageId, pipelineId, position });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Activities ------------------------------------------------------------

  server.registerTool(
    'rootr_crm_log_activity',
    {
      title: 'Log an activity on a Rootr CRM timeline',
      description:
        'Log an activity (note|call|email|meeting) on a Rootr (루터) CRM\'s timeline, attached to a contact, ' +
        'company, and/or deal. Use this to record outreach/history that shows up on the contact/company/deal detail ' +
        'view. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        type: z.string().describe('note | call | email | meeting'),
        subject: z.string().optional(),
        body: z.string().optional().describe('Activity body/notes (markdown/plain text)'),
        occurredAt: z.string().optional().describe('ISO datetime; defaults to now if omitted'),
        contactId: z.string().optional(),
        companyId: z.string().optional(),
        dealId: z.string().optional(),
      },
    },
    async ({ crmId, ...rest }) => {
      try {
        const client = makeClient();
        const result = await client.createCrmActivity(crmId, rest);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_list_activities',
    {
      title: 'List activities on a Rootr CRM timeline',
      description:
        'List logged activities in a Rootr (루터) CRM, filterable by contact, company, deal, or activity type. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        contactId: z.string().optional(),
        companyId: z.string().optional(),
        dealId: z.string().optional(),
        type: z.string().optional().describe('note | call | email | meeting'),
        limit: z.number().optional().describe('Max results (pagination)'),
        offset: z.number().optional().describe('Result offset (pagination)'),
      },
    },
    async ({ crmId, contactId, companyId, dealId, type, limit, offset }) => {
      try {
        const client = makeClient();
        const result = await client.listCrmActivities(crmId, { contactId, companyId, dealId, type, limit, offset });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Tasks -----------------------------------------------------------------

  server.registerTool(
    'rootr_crm_upsert_task',
    {
      title: 'Create or update a follow-up task in a Rootr CRM',
      description:
        'Create a new follow-up task (omit `taskId`) or update an existing one (pass `taskId` + fields to change, ' +
        'e.g. set `status` to "done" to complete it) in a Rootr (루터) CRM, optionally attached to a contact, ' +
        'company, and/or deal. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id (required when creating; ignored when updating)'),
        taskId: z.string().optional().describe('Existing task id to update; omit to create a new task'),
        title: z.string().optional().describe('Task title (required when creating)'),
        type: z.string().optional().describe('todo | call | email | meeting'),
        dueAt: z.string().optional().describe('ISO datetime due date'),
        status: z.string().optional().describe('open | done (patch only)'),
        assigneeId: z.string().optional().describe('Assignee user id'),
        contactId: z.string().optional(),
        companyId: z.string().optional(),
        dealId: z.string().optional(),
      },
    },
    async ({ crmId, taskId, ...rest }) => {
      try {
        const client = makeClient();
        const result = taskId ? await client.updateCrmTask(taskId, rest) : await client.createCrmTask(crmId, rest);
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'rootr_crm_list_tasks',
    {
      title: 'List follow-up tasks in a Rootr CRM',
      description:
        'List follow-up tasks in a Rootr (루터) CRM, filterable by status (open|done|all), assignee, due bucket ' +
        '(overdue|today|upcoming), contact, company, or deal. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        status: z.string().optional().describe('open | done | all'),
        assigneeId: z.string().optional(),
        due: z.string().optional().describe('overdue | today | upcoming'),
        contactId: z.string().optional(),
        companyId: z.string().optional(),
        dealId: z.string().optional(),
        limit: z.number().optional().describe('Max results (pagination)'),
        offset: z.number().optional().describe('Result offset (pagination)'),
      },
    },
    async ({ crmId, status, assigneeId, due, contactId, companyId, dealId, limit, offset }) => {
      try {
        const client = makeClient();
        const result = await client.listCrmTasks(crmId, {
          status,
          assigneeId,
          due,
          contactId,
          companyId,
          dealId,
          limit,
          offset,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Import ------------------------------------------------------------

  server.registerTool(
    'rootr_crm_import',
    {
      title: 'Bulk-import rows into a Rootr CRM',
      description:
        'Bulk-import rows into a Rootr (루터) CRM as companies, contacts, or deals in one call (`entity` picks which, ' +
        '`rows` is an array of plain field objects matching that entity\'s create shape, e.g. the same fields as ' +
        'rootr_crm_upsert_company/_contact/_deal). Use this for migrating a spreadsheet/CSV of leads or accounts ' +
        'instead of calling the upsert tools one row at a time. ' +
        CRM_CONTEXT,
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        crmId: z.string().describe('CRM node id'),
        entity: z.string().describe('contact | company | deal'),
        rows: z.array(z.record(z.unknown())).describe('Array of row objects to import, matching the entity shape'),
      },
    },
    async ({ crmId, entity, rows }) => {
      try {
        const client = makeClient();
        const result = await client.importCrm(crmId, { entity, rows: coerceJson(rows) });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
