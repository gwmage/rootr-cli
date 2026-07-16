/**
 * Thin REST client for the Rootr API.
 *
 * All requests are authenticated with the `x-api-key` header. Errors from
 * the API are normalized into RootrApiError so callers (CLI or MCP tools)
 * can render consistent, helpful messages.
 */

export class RootrApiError extends Error {
  constructor(message, { status, body, hint } = {}) {
    super(message);
    this.name = 'RootrApiError';
    this.status = status;
    this.body = body;
    this.hint = hint;
  }
}

function hintFor(status, body) {
  if (status === 401 || status === 403) {
    return (
      'API 키 또는 워크스페이스 스코프를 확인하세요 (rootr config로 현재 설정 확인). ' +
      '워크스페이스 생성(rootr_create_workspace)은 계정 키(PAT, workspaces:create 스코프)가 필요합니다 — ' +
      '워크스페이스 키(docs:read/docs:write/graph:read/ask/webhooks:manage 스코프)로는 할 수 없습니다.'
    );
  }
  if (status === 412) {
    return '문서가 그 사이 변경되었습니다: 다시 읽고 재시도하세요.';
  }
  if (status === 409) {
    return body && (body.message || body.error) ? undefined : '충돌이 발생했습니다.';
  }
  return undefined;
}

export class RootrClient {
  constructor({ apiKey, workspace, baseUrl }) {
    this.apiKey = apiKey;
    this.workspace = workspace;
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
  }

  _requireWorkspace() {
    if (!this.workspace) {
      throw new RootrApiError('워크스페이스가 설정되지 않았습니다.', {
        hint: 'rootr config --workspace <id> 로 설정하거나 ROOTR_WORKSPACE 환경변수를 지정하세요.',
      });
    }
  }

  _requireApiKey() {
    if (!this.apiKey) {
      throw new RootrApiError('API 키가 설정되지 않았습니다.', {
        hint: 'rootr config --api-key <key> 로 설정하거나 ROOTR_API_KEY 환경변수를 지정하세요.',
      });
    }
  }

  /**
   * Low-level request helper.
   * @param {string} path - path beginning with '/', appended to baseUrl
   * @param {object} opts
   * @param {string} [opts.method]
   * @param {object} [opts.headers]
   * @param {any} [opts.body] - if an object, JSON-stringified and Content-Type set
   * @param {boolean} [opts.rawText] - if true, return response text instead of parsed JSON
   * @param {boolean} [opts.returnResponse] - if true, return the raw Response (for header access)
   */
  async request(path, opts = {}) {
    this._requireApiKey();

    const url = opts.url || `${this.baseUrl}${path}`;
    const headers = {
      'x-api-key': this.apiKey,
      ...(opts.headers || {}),
    };

    let body = opts.body;
    if (body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body,
      });
    } catch (err) {
      throw new RootrApiError(`네트워크 오류: ${err.message}`, { hint: `요청 URL: ${url}` });
    }

    if (opts.returnResponse) {
      if (!res.ok) {
        await this._throwForResponse(res);
      }
      return res;
    }

    if (!res.ok) {
      await this._throwForResponse(res);
    }

    if (opts.rawText) {
      return res.text();
    }

    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async _throwForResponse(res) {
    let bodyText = '';
    let bodyJson;
    try {
      bodyText = await res.text();
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      // body wasn't JSON; keep raw text
    }

    const message =
      (bodyJson && (bodyJson.message || bodyJson.error)) ||
      bodyText ||
      `HTTP ${res.status} ${res.statusText}`;

    throw new RootrApiError(message, {
      status: res.status,
      body: bodyJson || bodyText,
      hint: hintFor(res.status, bodyJson),
    });
  }

  // ---- Tree / navigation -------------------------------------------------

  async getTree() {
    this._requireWorkspace();
    const data = await this.request(`/workspaces/${encodeURIComponent(this.workspace)}/tree`);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.nodes)) return data.nodes;
    if (data && Array.isArray(data.tree)) return data.tree;
    return [];
  }

  async getNodeByPath(path) {
    this._requireWorkspace();
    try {
      const data = await this.request(
        `/workspaces/${encodeURIComponent(this.workspace)}/nodes/by-path?path=${encodeURIComponent(path)}`,
      );
      return data;
    } catch (err) {
      if (err instanceof RootrApiError && err.status === 404) return null;
      throw err;
    }
  }

  async createNode({ type = 'DOCUMENT', path, createParents = true, autoRename = false, content }) {
    this._requireWorkspace();
    return this.request(`/workspaces/${encodeURIComponent(this.workspace)}/nodes`, {
      method: 'POST',
      body: { type, path, createParents, autoRename, content },
    });
  }

  async search(query) {
    this._requireWorkspace();
    const data = await this.request(
      `/workspaces/${encodeURIComponent(this.workspace)}/search?q=${encodeURIComponent(query)}`,
    );
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.results)) return data.results;
    return [];
  }

  // ---- Documents ----------------------------------------------------------

  /** Fetch raw markdown content for a document id. Returns { content, etag }. */
  async getDocumentMarkdown(id) {
    const res = await this.request(`/documents/${encodeURIComponent(id)}`, {
      headers: { Accept: 'text/markdown' },
      returnResponse: true,
    });
    const content = await res.text();
    const etag = res.headers.get('etag') || res.headers.get('ETag') || undefined;
    return { content, etag };
  }

  /** Fetch the full JSON representation of a document. */
  async getDocumentJson(id) {
    const res = await this.request(`/documents/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      returnResponse: true,
    });
    const text = await res.text();
    const etag = res.headers.get('etag') || res.headers.get('ETag') || undefined;
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { content: text };
    }
    if (etag && json && json.etag === undefined) json.etag = etag;
    return json;
  }

  /** Replace document content entirely. */
  async putDocument(id, content, { ifMatch } = {}) {
    const headers = {};
    if (ifMatch) headers['If-Match'] = ifMatch;
    const res = await this.request(`/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: { content },
      returnResponse: true,
    });
    const etag = res.headers.get('etag') || res.headers.get('ETag') || undefined;
    return { etag };
  }

  /** Safe, conflict-free append. */
  async appendDocument(id, { content, underHeading, createIfMissing } = {}) {
    const res = await this.request(`/documents/${encodeURIComponent(id)}/append`, {
      method: 'POST',
      body: { content, underHeading, createIfMissing },
      returnResponse: true,
    });
    const etag = res.headers.get('etag') || res.headers.get('ETag') || undefined;
    let json;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    return { ...json, etag: json.etag || etag };
  }

  /** Section-mode patch: { op, heading?, content, createIfMissing? } */
  async patchDocumentSection(id, { op, heading, content, createIfMissing, ifMatch } = {}) {
    const headers = {};
    if (ifMatch) headers['If-Match'] = ifMatch;
    return this.request(`/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      body: { op, heading, content, createIfMissing, ...(ifMatch ? { ifMatch } : {}) },
    });
  }

  /** Anchor-edit mode patch: { find, replace, replaceAll? } */
  async patchDocumentAnchor(id, { find, replace, replaceAll, ifMatch } = {}) {
    const headers = {};
    if (ifMatch) headers['If-Match'] = ifMatch;
    return this.request(`/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      body: { find, replace, replaceAll, ...(ifMatch ? { ifMatch } : {}) },
    });
  }

  /** List document versions. */
  async getDocumentVersions(id, { limit } = {}) {
    const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.request(`/documents/${encodeURIComponent(id)}/versions${qs}`);
  }

  /** Move a node to the trash (recoverable). */
  async deleteNode(id) {
    return this.request(`/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ---- Comments / publishing / duplication (document-level extras) --------

  /** Comments carry a user identity — needs an account key (PAT) or user session; workspace keys 403. */
  async createComment(documentId, { body, blockId, parentId } = {}) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/comments`, {
      method: 'POST',
      body: { body, blockId, parentId },
    });
  }

  async listComments(documentId, { blockId } = {}) {
    return this.request(
      `/documents/${encodeURIComponent(documentId)}/comments${this._qs({ blockId })}`,
    );
  }

  /** Publish to a public /p/{slug} URL. Returns { slug, ... }. Requires MANAGE on the node. */
  async publishDocument(documentId) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/publish`, { method: 'POST' });
  }

  /** Patch public settings, e.g. { isPublic: false } to unpublish. */
  async setDocumentPublic(documentId, settings = {}) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/public`, {
      method: 'PATCH',
      body: settings,
    });
  }

  async getDocumentPublicStatus(documentId) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/public-status`);
  }

  /** Deep-copy a node (tree) — optionally into another workspace the caller can access. */
  async duplicateNode(nodeId, { deep, targetWorkspaceId } = {}) {
    return this.request(`/nodes/${encodeURIComponent(nodeId)}/duplicate`, {
      method: 'POST',
      body: { deep, targetWorkspaceId },
    });
  }

  // ---- Workspaces (account-key scoped) -------------------------------------

  /** List workspaces visible to the current key (account key / JWT). Defensive parsing. */
  async listWorkspaces() {
    const data = await this.request('/workspaces');
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.workspaces)) return data.workspaces;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  // ---- Scaffolding ----------------------------------------------------------

  /** Plan a scaffold tree from a natural-language intent. No workspace required. */
  async scaffoldPlan(intent) {
    return this.request('/scaffold/plan', { method: 'POST', body: { intent } });
  }

  /** Create a brand-new workspace from a scaffold tree. Requires an account key (PAT) with workspaces:create. */
  async createWorkspaceScaffold({ name, intent, tree }) {
    return this.request('/scaffold/workspace', {
      method: 'POST',
      body: { name, intent, tree },
    });
  }

  /** Apply a scaffold tree to an existing workspace. */
  async scaffoldApply(workspace, { rootPath, tree } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/scaffold/apply`, {
      method: 'POST',
      body: { rootPath, tree },
    });
  }

  // ---- LOG datastores ---------------------------------------------------

  /** Create a typed LOG store node. fields: [{name,type,...}] (relation fields carry target/many/relation). */
  async createLogStore(workspace, { name, fields, parentId } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/logs`, {
      method: 'POST',
      body: { name, fields, parentId },
    });
  }

  async getLog(id) {
    return this.request(`/logs/${encodeURIComponent(id)}`);
  }

  /** Replace the ENTIRE field set of a LOG store — resend every field you want to keep. */
  async updateLogFields(id, fields) {
    return this.request(`/logs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { fields },
    });
  }

  async addLogEntries(id, entries) {
    return this.request(`/logs/${encodeURIComponent(id)}/entries`, {
      method: 'POST',
      body: { entries },
    });
  }

  async queryLogEntries(id, { from, to, source, level, anomalyOnly, limit, order } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (source) params.set('source', source);
    if (level) params.set('level', level);
    if (anomalyOnly !== undefined) params.set('anomalyOnly', String(anomalyOnly));
    if (limit !== undefined) params.set('limit', String(limit));
    if (order) params.set('order', order);
    const qs = params.toString();
    return this.request(`/logs/${encodeURIComponent(id)}/entries${qs ? `?${qs}` : ''}`);
  }

  async logStats(id, { groupBy, metric, field, from, to } = {}) {
    const params = new URLSearchParams();
    if (groupBy) params.set('groupBy', groupBy);
    if (metric) params.set('metric', metric);
    if (field) params.set('field', field);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return this.request(`/logs/${encodeURIComponent(id)}/stats${qs ? `?${qs}` : ''}`);
  }

  // ---- ask (GraphRAG RCA over GraphQL) --------------------------------------

  /**
   * Ask a natural-language question against a workspace's knowledge graph.
   * Uses the GraphQL endpoint (baseUrl with trailing /v1 swapped for /graphql),
   * not the REST /v1 base. Requires the `ask` scope.
   */
  async ask(workspaceId, question) {
    this._requireApiKey();
    const graphqlUrl = `${this.baseUrl.replace(/\/v1\/?$/, '')}/graphql`;
    const query =
      'query($ws:String!,$q:String!){ask(workspaceId:$ws,question:$q){text citations{documentPath quote}}}';
    const data = await this.request(null, {
      url: graphqlUrl,
      method: 'POST',
      body: { query, variables: { ws: workspaceId, q: question } },
    });
    if (data && Array.isArray(data.errors) && data.errors.length) {
      const msg = data.errors.map((e) => e.message || String(e)).join('; ');
      throw new RootrApiError(`ask 오류: ${msg}`, { body: data.errors });
    }
    return (data && data.data && data.data.ask) || { text: '', citations: [] };
  }

  // ---- Issues ---------------------------------------------------------------

  async createIssueTracker(workspace, name) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/issue-trackers`, {
      method: 'POST',
      body: { name },
    });
  }

  async getIssueTracker(trackerId) {
    return this.request(`/issue-trackers/${encodeURIComponent(trackerId)}`);
  }

  async listIssues(trackerId, { state, label, type, assigneeId, q } = {}) {
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (label) params.set('label', label);
    if (type) params.set('type', type);
    if (assigneeId) params.set('assigneeId', assigneeId);
    if (q) params.set('q', q);
    const qs = params.toString();
    return this.request(`/issue-trackers/${encodeURIComponent(trackerId)}/issues${qs ? `?${qs}` : ''}`);
  }

  async createIssue(trackerId, { title, body, labels, type, assigneeId, parentIssueId } = {}) {
    return this.request(`/issue-trackers/${encodeURIComponent(trackerId)}/issues`, {
      method: 'POST',
      body: { title, body, labels, type, assigneeId, parentIssueId },
    });
  }

  async getIssue(issueId) {
    return this.request(`/issues/${encodeURIComponent(issueId)}`);
  }

  async updateIssue(issueId, patch) {
    return this.request(`/issues/${encodeURIComponent(issueId)}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  /** Comment on an issue — issues live as blocks inside the tracker document. */
  async commentIssue(trackerId, issueId, body) {
    return this.request(`/documents/${encodeURIComponent(trackerId)}/comments`, {
      method: 'POST',
      body: { body, blockId: issueId },
    });
  }

  // ---- Webhooks ---------------------------------------------------------

  async listWebhooks(workspace) {
    const data = await this.request(`/workspaces/${encodeURIComponent(workspace)}/webhooks`);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.webhooks)) return data.webhooks;
    return [];
  }

  async createWebhook(workspace, { name, url, events, scopeNodeId, filterTags, debounceSeconds } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/webhooks`, {
      method: 'POST',
      body: { name, url, events, scopeNodeId, filterTags, debounceSeconds },
    });
  }

  async updateWebhook(workspace, webhookId, patch) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  async deleteWebhook(workspace, webhookId) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    });
  }

  // ---- Databases (rows) -------------------------------------------------

  /** Database definition: { id, name, icon, path, properties[], views[], rowCount }. */
  async getDatabase(databaseId) {
    return this.request(`/databases/${encodeURIComponent(databaseId)}`);
  }

  /** All rows of a database, in position order. Returns the raw rows array. */
  async listRows(databaseId) {
    const data = await this.request(`/databases/${encodeURIComponent(databaseId)}/rows`);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.rows)) return data.rows;
    return [];
  }

  async createRow(databaseId, { values, position } = {}) {
    return this.request(`/databases/${encodeURIComponent(databaseId)}/rows`, {
      method: 'POST',
      body: { values, position },
    });
  }

  async updateRow(databaseId, rowId, { values, position } = {}) {
    return this.request(
      `/databases/${encodeURIComponent(databaseId)}/rows/${encodeURIComponent(rowId)}`,
      { method: 'PATCH', body: { values, position } },
    );
  }

  async deleteRow(databaseId, rowId) {
    return this.request(
      `/databases/${encodeURIComponent(databaseId)}/rows/${encodeURIComponent(rowId)}`,
      { method: 'DELETE' },
    );
  }

  // ---- CRM ----------------------------------------------------------------

  /** Create a CRM node. pipelines/fields/config optional (server fills sane defaults). */
  async createCrm(workspace, { name, path, parentId, icon, pipelines, fields, config, createParents, autoRename } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/crms`, {
      method: 'POST',
      body: { name, path, parentId, icon, pipelines, fields, config, createParents, autoRename },
    });
  }

  /** CRM detail: { id, name, pipelines[{id,name,stages[]}], fields, config, counts, myLevel }. */
  async getCrm(crmId) {
    return this.request(`/crms/${encodeURIComponent(crmId)}`);
  }

  async updateCrm(crmId, { pipelines, fields, config, icon } = {}) {
    return this.request(`/crms/${encodeURIComponent(crmId)}`, {
      method: 'PATCH',
      body: { pipelines, fields, config, icon },
    });
  }

  /** Per-pipeline stage value/forecast/win-rate + wonByMonth + open task counts. */
  async getCrmSummary(crmId) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/summary`);
  }

  _qs(params) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
    }
    const s = usp.toString();
    return s ? `?${s}` : '';
  }

  // -- Companies --

  async listCrmCompanies(crmId, { q, ownerId, tag, sort, limit, offset } = {}) {
    return this.request(
      `/crms/${encodeURIComponent(crmId)}/companies${this._qs({ q, ownerId, tag, sort, limit, offset })}`,
    );
  }

  async createCrmCompany(crmId, body) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/companies`, { method: 'POST', body });
  }

  /** Detail includes contacts/deals/activities/tasks alongside the company. */
  async getCrmCompany(companyId) {
    return this.request(`/crm-companies/${encodeURIComponent(companyId)}`);
  }

  async updateCrmCompany(companyId, patch) {
    return this.request(`/crm-companies/${encodeURIComponent(companyId)}`, { method: 'PATCH', body: patch });
  }

  async deleteCrmCompany(companyId) {
    return this.request(`/crm-companies/${encodeURIComponent(companyId)}`, { method: 'DELETE' });
  }

  // -- Contacts --

  async listCrmContacts(crmId, { q, companyId, lifecycleStage, leadStatus, ownerId, tag, sort, limit, offset } = {}) {
    return this.request(
      `/crms/${encodeURIComponent(crmId)}/contacts${this._qs({
        q,
        companyId,
        lifecycleStage,
        leadStatus,
        ownerId,
        tag,
        sort,
        limit,
        offset,
      })}`,
    );
  }

  async createCrmContact(crmId, body) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/contacts`, { method: 'POST', body });
  }

  async getCrmContact(contactId) {
    return this.request(`/crm-contacts/${encodeURIComponent(contactId)}`);
  }

  async updateCrmContact(contactId, patch) {
    return this.request(`/crm-contacts/${encodeURIComponent(contactId)}`, { method: 'PATCH', body: patch });
  }

  async deleteCrmContact(contactId) {
    return this.request(`/crm-contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
  }

  // -- Deals --

  async listCrmDeals(crmId, { q, pipelineId, stageId, status, ownerId, companyId, contactId, tag, sort, limit, offset } = {}) {
    return this.request(
      `/crms/${encodeURIComponent(crmId)}/deals${this._qs({
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
      })}`,
    );
  }

  async createCrmDeal(crmId, body) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/deals`, { method: 'POST', body });
  }

  async getCrmDeal(dealId) {
    return this.request(`/crm-deals/${encodeURIComponent(dealId)}`);
  }

  async updateCrmDeal(dealId, patch) {
    return this.request(`/crm-deals/${encodeURIComponent(dealId)}`, { method: 'PATCH', body: patch });
  }

  async deleteCrmDeal(dealId) {
    return this.request(`/crm-deals/${encodeURIComponent(dealId)}`, { method: 'DELETE' });
  }

  /** Kanban-style stage move: { stageId, pipelineId?, position? }. */
  async moveCrmDeal(dealId, { stageId, pipelineId, position } = {}) {
    return this.request(`/crm-deals/${encodeURIComponent(dealId)}/move`, {
      method: 'POST',
      body: { stageId, pipelineId, position },
    });
  }

  // -- Activities --

  async listCrmActivities(crmId, { contactId, companyId, dealId, type, limit, offset } = {}) {
    return this.request(
      `/crms/${encodeURIComponent(crmId)}/activities${this._qs({ contactId, companyId, dealId, type, limit, offset })}`,
    );
  }

  async createCrmActivity(crmId, body) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/activities`, { method: 'POST', body });
  }

  // -- Tasks --

  async listCrmTasks(crmId, { status, assigneeId, due, contactId, companyId, dealId, limit, offset } = {}) {
    return this.request(
      `/crms/${encodeURIComponent(crmId)}/tasks${this._qs({
        status,
        assigneeId,
        due,
        contactId,
        companyId,
        dealId,
        limit,
        offset,
      })}`,
    );
  }

  async createCrmTask(crmId, body) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/tasks`, { method: 'POST', body });
  }

  async updateCrmTask(taskId, patch) {
    return this.request(`/crm-tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: patch });
  }

  // -- Import / export --

  /** Raw CSV text for entity = contact | company | deal. */
  async exportCrm(crmId, entity) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/export${this._qs({ entity })}`, { rawText: true });
  }

  async importCrm(crmId, { entity, rows } = {}) {
    return this.request(`/crms/${encodeURIComponent(crmId)}/import`, {
      method: 'POST',
      body: { entity, rows },
    });
  }

  // ---- Presentations (slide decks) ----------------------------------------

  async createPresentation(workspaceId, { name, parentId, theme, slides, config, icon } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspaceId)}/presentations`, {
      method: 'POST',
      body: { name, parentId, theme, slides, config, icon },
    });
  }

  /** Full deck: node meta + theme + ordered slides array. */
  async getPresentation(presentationId) {
    return this.request(`/presentations/${encodeURIComponent(presentationId)}`);
  }

  /** Merge-patch theme/config/icon; `slides` REPLACES the whole array when present. */
  async updatePresentation(presentationId, { theme, slides, config, icon } = {}) {
    return this.request(`/presentations/${encodeURIComponent(presentationId)}`, {
      method: 'PATCH',
      body: { theme, slides, config, icon },
    });
  }

  async appendPresentationSlides(presentationId, slides) {
    return this.request(`/presentations/${encodeURIComponent(presentationId)}/slides`, {
      method: 'POST',
      body: { slides },
    });
  }

  async updatePresentationSlide(presentationId, slideId, slide) {
    return this.request(
      `/presentations/${encodeURIComponent(presentationId)}/slides/${encodeURIComponent(slideId)}`,
      { method: 'PATCH', body: { slide } },
    );
  }

  /** `order` = slide ids in the desired order (must be a permutation of existing ids). */
  async reorderPresentationSlides(presentationId, order) {
    return this.request(`/presentations/${encodeURIComponent(presentationId)}/reorder`, {
      method: 'POST',
      body: { order },
    });
  }

  // ---- Images (deck assets; consume AI credits) ---------------------------

  async generateImage(workspaceId, { prompt, nodeId, context } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspaceId)}/images/generate`, {
      method: 'POST',
      body: { prompt, nodeId, context },
    });
  }

  async removeImageBackground(workspaceId, { attachmentId, nodeId } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspaceId)}/images/remove-background`, {
      method: 'POST',
      body: { attachmentId, nodeId },
    });
  }

  // ---- Spreadsheets ---------------------------------------------------------

  async listSpreadsheets(workspace) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/spreadsheets`);
  }

  async createSpreadsheet(workspace, { name, parentId, path, createParents, autoRename, icon, data, config } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/spreadsheets`, {
      method: 'POST',
      body: { name, parentId, path, createParents, autoRename, icon, data, config },
    });
  }

  /** Full spreadsheet: node meta + sheets[] (each with a sparse `cells` map). */
  async getSpreadsheet(spreadsheetId) {
    return this.request(`/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  }

  /** Merge-patch config/icon; `sheets` REPLACES the whole sheets array when present. */
  async updateSpreadsheet(spreadsheetId, { sheets, config, icon } = {}) {
    return this.request(`/spreadsheets/${encodeURIComponent(spreadsheetId)}`, {
      method: 'PATCH',
      body: { sheets, config, icon },
    });
  }

  async createSheet(spreadsheetId, { name, rowCount, colCount } = {}) {
    return this.request(`/spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets`, {
      method: 'POST',
      body: { name, rowCount, colCount },
    });
  }

  async patchSheet(spreadsheetId, sheetId, patch) {
    return this.request(
      `/spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets/${encodeURIComponent(sheetId)}`,
      { method: 'PATCH', body: patch },
    );
  }

  async deleteSheet(spreadsheetId, sheetId) {
    return this.request(
      `/spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets/${encodeURIComponent(sheetId)}`,
      { method: 'DELETE' },
    );
  }

  /** Sparse cell patch: { "A1": { v, f? } | null }. null clears the cell. */
  async patchCells(spreadsheetId, sheetId, cells) {
    return this.request(
      `/spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets/${encodeURIComponent(sheetId)}/cells`,
      { method: 'PATCH', body: { cells } },
    );
  }

  // ---- Whiteboards -----------------------------------------------------------

  async createWhiteboard(workspace, { name, parentId, path, createParents, autoRename, icon, scene, config } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/whiteboards`, {
      method: 'POST',
      body: { name, parentId, path, createParents, autoRename, icon, scene, config },
    });
  }

  /** Full board: node meta + scene ({ shapes[], edges[] }). */
  async getWhiteboard(whiteboardId) {
    return this.request(`/whiteboards/${encodeURIComponent(whiteboardId)}`);
  }

  /** Merge-patch config/icon; `scene` REPLACES the whole scene when present. */
  async updateWhiteboard(whiteboardId, { scene, config, icon } = {}) {
    return this.request(`/whiteboards/${encodeURIComponent(whiteboardId)}`, {
      method: 'PATCH',
      body: { scene, config, icon },
    });
  }

  // ---- Forms -----------------------------------------------------------------

  async createForm(workspace, { name, parentId, path, createParents, autoRename, icon, fields, targetDatabaseId, config } = {}) {
    return this.request(`/workspaces/${encodeURIComponent(workspace)}/forms`, {
      method: 'POST',
      body: { name, parentId, path, createParents, autoRename, icon, fields, targetDatabaseId, config },
    });
  }

  /** Full form: node meta + fields[] + targetDatabaseId + config. */
  async getForm(formId) {
    return this.request(`/forms/${encodeURIComponent(formId)}`);
  }

  /** Merge-patch fields/targetDatabaseId/config/icon. */
  async updateForm(formId, { fields, targetDatabaseId, config, icon } = {}) {
    return this.request(`/forms/${encodeURIComponent(formId)}`, {
      method: 'PATCH',
      body: { fields, targetDatabaseId, config, icon },
    });
  }

  /** Submitted responses, most recent first. */
  async listFormResponses(formId) {
    const data = await this.request(`/forms/${encodeURIComponent(formId)}/responses`);
    if (data && Array.isArray(data.responses)) return data.responses;
    return [];
  }

  async createFormResponse(formId, values) {
    return this.request(`/forms/${encodeURIComponent(formId)}/responses`, {
      method: 'POST',
      body: { values },
    });
  }

  /** Issue a new public share link ({ token, url, ... }) for the form. */
  async createFormShareLink(formId) {
    return this.request(`/forms/${encodeURIComponent(formId)}/share`, { method: 'POST' });
  }

  async listFormShareLinks(formId) {
    const data = await this.request(`/forms/${encodeURIComponent(formId)}/share`);
    if (data && Array.isArray(data.links)) return data.links;
    return [];
  }
}
