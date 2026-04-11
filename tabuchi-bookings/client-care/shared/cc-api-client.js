/**
 * Tabuchi Law Client Care CRM - API Client
 * Shared helper for all Client Care Webflow pages to communicate with n8n backend.
 *
 * Usage: Include this script before page-specific scripts.
 * Loaded via Webflow custom code on clientcare.tabuchilaw.com pages.
 *
 * Authentication: All /crm endpoints require a Dashboard_Token header.
 * Token is stored in localStorage as 'app_token' (unified with Booking system).
 */

if (!window.ClientCareAPI) (function() {
  var ClientCareAPI = (function() {
  'use strict';

  const WH = 'https://n8n.tabuchilaw.com/webhook';

  // ─── Response Cache ────────────────────────────────────────────
  // TTL-based cache for GET-like requests. Keyed by endpoint + body JSON.
  // Mutations (create/update/delete actions) bypass and invalidate cache.
  var _cache = {};
  var _inflight = {};

  var CACHE_TTL = {
    default: 30000,       // 30s for most list/get endpoints
    config: 300000,       // 5min for config (rarely changes)
    price_book: 300000,   // 5min for price book (rarely changes)
    system_stats: 60000,  // 1min for admin stats
    reports: 60000        // 1min for report data
  };

  // Actions that are read-only (safe to cache)
  var READ_ACTIONS = ['list', 'get', 'get_history', 'list_users', 'list_templates',
    'system_stats', 'list_recipients', 'report', 'preview_audience', 'list_steps',
    'approve_review', 'link_lead', 'recent_messages',
    'get_sms_thread', 'get_user_settings',
    'list_submissions', 'get_public',
    'list_creators', 'analyze'];

  // Actions that mutate data (invalidate cache)
  var WRITE_ACTIONS = ['create', 'update', 'delete', 'bulk_update_tags',
    'bulk_update_status', 'create_step', 'update_step', 'delete_step', 'enroll',
    'schedule', 'send_now', 'cancel', 'duplicate', 'test_send',
    'resend_non_openers', 'create_template', 'update_template',
    'create_task', 'update_task', 'delete_task',
    'generate_will', 'upload_to_clio', 'retry_processing', 'generate',
    'send_email', 'send_sms', 'log_call', 'update_user_settings',
    'create_section', 'update_section', 'delete_section',
    'create_field', 'update_field', 'delete_field', 'reorder',
    'send_link', 'generate_summary'];

  function _cacheKey(path, body) {
    return path + '|' + JSON.stringify(body || {});
  }

  function _getCacheTTL(path) {
    if (path.indexOf('/cc/config') !== -1) return CACHE_TTL.config;
    if (path.indexOf('/cc/forms') !== -1) return CACHE_TTL.default;
    if (path.indexOf('/cc/price-book') !== -1) return CACHE_TTL.price_book;
    if (path.indexOf('/cc/admin') !== -1 && path.indexOf('stats') !== -1) return CACHE_TTL.system_stats;
    if (path.indexOf('/cc/reports') !== -1) return CACHE_TTL.reports;
    if (path.indexOf('/cc/dashboard') !== -1) return CACHE_TTL.reports;
    return CACHE_TTL.default;
  }

  function _isCacheable(path, body) {
    if (!body || !body.action) return false;
    return READ_ACTIONS.indexOf(body.action) !== -1;
  }

  function _isWrite(body) {
    if (!body || !body.action) return false;
    return WRITE_ACTIONS.indexOf(body.action) !== -1;
  }

  function _invalidatePrefix(prefix) {
    var keys = Object.keys(_cache);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(prefix) === 0) delete _cache[keys[i]];
    }
    // Also clear inflight for the prefix
    keys = Object.keys(_inflight);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(prefix) === 0) delete _inflight[keys[i]];
    }
  }

  /** Invalidate all cached responses for a given endpoint path */
  function invalidateCache(path) {
    if (path) {
      _invalidatePrefix(path);
    } else {
      _cache = {};
      _inflight = {};
    }
  }

  // ─── Auth Token ──────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem('app_token') || localStorage.getItem('dashboard_token') || '';
  }

  function setToken(token) {
    localStorage.setItem('app_token', token);
  }

  function clearToken() {
    localStorage.removeItem('app_token');
    localStorage.removeItem('app_user');
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('app_user') || 'null');
    } catch (e) { return null; }
  }

  function setUser(user) {
    localStorage.setItem('app_user', JSON.stringify(user));
  }

  function isAuthenticated() {
    return !!getToken();
  }

  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = '/login';
      return false;
    }
    return true;
  }

  // ─── Error Notification (fire-and-forget to Teams) ───────────
  function _notifyError(errObj) {
    try {
      var user = getUser();
      fetch(`${WH}/cc/error-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: errObj.action || 'unknown',
          endpoint: errObj.endpoint || 'unknown',
          status: errObj.status || 0,
          error: errObj.error || 'Unknown error',
          user_name: (user && user.name) || 'Unknown',
          user_email: (user && user.email) || '',
          timestamp: new Date().toISOString()
        })
      }).catch(function() { /* silently ignore notification failures */ });
    } catch (e) { /* silently ignore */ }
  }

  // ─── Core Request ────────────────────────────────────────────
  async function request(method, path, options = {}) {
    var body = options.body;

    // ── Cache: invalidate on writes ──
    if (_isWrite(body)) {
      _invalidatePrefix(path);
    }

    // ── Cache: return cached response for reads ──
    var cacheKey = null;
    if (method === 'POST' && _isCacheable(path, body) && !options.skipCache) {
      cacheKey = _cacheKey(path, body);
      var cached = _cache[cacheKey];
      if (cached && (Date.now() - cached.time) < _getCacheTTL(path)) {
        return cached.data;
      }
      // ── Deduplication: reuse inflight request for same key ──
      if (_inflight[cacheKey]) {
        return _inflight[cacheKey];
      }
    }

    const url = new URL(`${WH}${path}`);

    if (options.params) {
      Object.entries(options.params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, v);
        }
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    // Auto-attach auth token for /cc/ endpoints
    if (path.startsWith('/cc/') && !options.skipAuth) {
      const token = getToken();
      if (token) headers['X-Dashboard-Token'] = token;
    }

    const fetchOptions = { method, headers };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    var promise = (async function() {
      try {
        const response = await fetch(url.toString(), fetchOptions);

        // Handle 401 — redirect to login
        if (response.status === 401) {
          clearToken();
          window.location.href = '/login?expired=1';
          throw { status: 401, error: 'Session expired. Please sign in again.' };
        }

        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: 'Invalid response from server' }; }
        if (!response.ok) {
          var err = { status: response.status, endpoint: path, action: (body && body.action) || method, ...data };
          // Fire-and-forget error notification (skip 401 session expiry)
          if (response.status !== 401) _notifyError(err);
          throw err;
        }

        // ── Cache: store successful read responses ──
        if (cacheKey) {
          _cache[cacheKey] = { data: data, time: Date.now() };
        }

        return data;
      } catch (error) {
        if (error.status) throw error;
        var netErr = { status: 0, success: false, error: 'Network error. Please try again.', endpoint: path, action: (body && body.action) || method };
        _notifyError(netErr);
        throw netErr;
      } finally {
        if (cacheKey) delete _inflight[cacheKey];
      }
    })();

    // ── Store inflight promise for deduplication ──
    if (cacheKey) _inflight[cacheKey] = promise;

    return promise;
  }

  // ─── Auth / SSO ──────────────────────────────────────────────

  /**
   * Login via Microsoft SSO — sends id_token to backend CC-09
   * @param {string} idToken - Microsoft Entra ID token
   * @returns {{ success, token, user: { id, name, email, role, team } }}
   */
  async function loginSSO(idToken) {
    return request('POST', '/cc/login-sso', {
      body: { id_token: idToken },
      skipAuth: true
    });
  }

  // ─── Leads ───────────────────────────────────────────────────

  /**
   * List leads with filters, sorting, and pagination
   * @param {Object} params
   * @param {string} [params.stage] - Filter by Lead_Stage
   * @param {string} [params.owner] - Filter by Lead_Owner record ID
   * @param {string} [params.team] - Filter by team
   * @param {string} [params.practice_area] - Filter by Practice_Area
   * @param {string} [params.disposition] - Filter by Disposition (OPEN, WON, LOST)
   * @param {string} [params.search] - Search client name/email
   * @param {string} [params.sort_by] - Field to sort by (default: Created_At)
   * @param {string} [params.sort_dir] - asc or desc (default: desc)
   * @param {string} [params.start_date] - Filter created after (ISO date)
   * @param {string} [params.end_date] - Filter created before (ISO date)
   * @param {number} [params.offset] - Pagination offset
   * @param {number} [params.limit] - Page size (default: 50)
   */
  async function listLeads(params = {}) {
    return request('POST', '/cc/leads', { body: { action: 'list', ...params } });
  }

  /**
   * Get a single lead by ID (includes linked intake case, activities, tasks)
   * @param {string} id - Lead record ID
   */
  async function getLead(id) {
    return request('POST', '/cc/leads', { body: { action: 'get', id } });
  }

  /**
   * Create a new lead manually
   * @param {Object} data - Lead fields
   */
  async function createLead(data) {
    return request('POST', '/cc/leads', { body: { action: 'create', ...data } });
  }

  /**
   * Update a lead (including stage changes)
   * @param {string} id - Lead record ID
   * @param {Object} fields - Fields to update
   */
  async function updateLead(id, fields) {
    return request('POST', '/cc/leads', { body: { action: 'update', id, ...fields } });
  }

  async function deleteLead(id) {
    return request('POST', '/cc/leads', { body: { action: 'delete', id } });
  }

  // ─── Pipeline ──────────────────────────────────────────────

  /**
   * Update lead pipeline stage with close gate validation
   * @param {string} leadId - Lead record ID
   * @param {string} newStage - Target stage
   * @param {Object} [opts] - { notes, disposition, close_reason }
   */
  async function updateStage(leadId, newStage, opts = {}) {
    var result = await request('POST', '/cc/stage-update', {
      body: { lead_id: leadId, new_stage: newStage, ...opts }
    });
    if (result.success) _invalidatePrefix('/cc/leads');
    return result;
  }

  // ─── Activities ──────────────────────────────────────────────

  /**
   * List activities for a lead
   * @param {string} leadId - Lead record ID
   * @param {Object} [params] - Optional filters
   */
  async function listActivities(leadId, params = {}) {
    return request('POST', '/cc/activities', {
      body: { action: 'list', lead_id: leadId, ...params }
    });
  }

  /**
   * Log a new activity
   * @param {Object} data - { lead_id, type, subject, body, duration_minutes, outcome }
   */
  async function createActivity(data) {
    return request('POST', '/cc/activities', { body: { action: 'create', ...data } });
  }

  // ─── Tasks ───────────────────────────────────────────────────

  /**
   * List tasks with filters
   * @param {Object} params - { lead_id, owner, status, due_start, due_end, sort_by, sort_dir }
   */
  async function listTasks(params = {}) {
    return request('POST', '/cc/tasks', { body: { action: 'list', ...params } });
  }

  /**
   * Create a task
   * @param {Object} data - { lead_id, title, description, due_at, owner, task_type }
   */
  async function createTask(data) {
    return request('POST', '/cc/tasks', { body: { action: 'create', ...data } });
  }

  /**
   * Update a task (complete, reassign, reschedule)
   * @param {string} id - Task record ID
   * @param {Object} fields - Fields to update
   */
  async function updateTask(id, fields) {
    return request('POST', '/cc/tasks', { body: { action: 'update', id, ...fields } });
  }

  // ─── Reports ─────────────────────────────────────────────────

  /**
   * Get a report by type
   * @param {string} type - close-ratio, funnel, stage-aging, rep-performance, source-attribution, sla-compliance, lost-reasons
   * @param {Object} params - { start_date, end_date, date_field, practice_area, lead_owner_id, source, campaign_id }
   */
  async function getReport(type, params = {}) {
    return request('POST', '/cc/reports', { body: { action: type, ...params } });
  }

  // ─── Dashboard ──────────────────────────────────────────────

  async function getDashboard() {
    return request('POST', '/cc/dashboard', { body: { action: 'get' } });
  }

  // ─── Campaigns ───────────────────────────────────────────────

  async function listCampaigns(params = {}) {
    return request('POST', '/cc/campaigns', { body: { action: 'list', ...params } });
  }

  async function getCampaign(campaignId) {
    return request('POST', '/cc/campaigns', { body: { action: 'get', campaign_id: campaignId } });
  }

  async function createCampaign(data) {
    return request('POST', '/cc/campaigns', { body: { action: 'create', ...data } });
  }

  async function updateCampaign(id, fields) {
    return request('POST', '/cc/campaigns', { body: { action: 'update', campaign_id: id, ...fields } });
  }

  async function validateCampaign(campaignId) {
    return request('POST', '/cc/campaigns', { body: { action: 'validate', campaign_id: campaignId } });
  }

  async function testSendCampaign(campaignId, data) {
    return request('POST', '/cc/campaigns', { body: { action: 'test_send', campaign_id: campaignId, ...data } });
  }

  async function scheduleCampaign(campaignId, scheduledAt, timezone) {
    return request('POST', '/cc/campaigns', { body: { action: 'schedule', campaign_id: campaignId, scheduled_at: scheduledAt, timezone } });
  }

  async function sendCampaignNow(campaignId) {
    return request('POST', '/cc/campaigns', { body: { action: 'send_now', campaign_id: campaignId } });
  }

  async function cancelCampaign(campaignId) {
    return request('POST', '/cc/campaigns', { body: { action: 'cancel', campaign_id: campaignId } });
  }

  async function duplicateCampaign(campaignId, newName) {
    return request('POST', '/cc/campaigns', { body: { action: 'duplicate', campaign_id: campaignId, name: newName } });
  }

  async function resendNonOpeners(campaignId, data) {
    return request('POST', '/cc/campaigns', { body: { action: 'resend_non_openers', campaign_id: campaignId, ...data } });
  }

  async function listCampaignRecipients(campaignId, params = {}) {
    return request('POST', '/cc/campaigns', { body: { action: 'list_recipients', campaign_id: campaignId, ...params } });
  }

  async function getCampaignReport(campaignId, reportType = 'overview') {
    return request('POST', '/cc/campaigns', { body: { action: 'report', campaign_id: campaignId, report_type: reportType } });
  }

  async function previewAudience(audienceDefinition) {
    return request('POST', '/cc/campaigns', { body: { action: 'preview_audience', audience_rules: audienceDefinition } });
  }

  // Campaign Steps (drip/automation campaigns)
  async function listCampaignSteps(campaignId) {
    return request('POST', '/cc/campaigns', { body: { action: 'list_steps', campaign_id: campaignId } });
  }

  async function createCampaignStep(data) {
    return request('POST', '/cc/campaigns', { body: { action: 'create_step', ...data } });
  }

  async function deleteCampaignStep(stepId) {
    return request('POST', '/cc/campaigns', { body: { action: 'delete_step', step_id: stepId } });
  }

  async function updateCampaignStep(stepId, fields) {
    return request('POST', '/cc/campaigns', { body: { action: 'update_step', step_id: stepId, ...fields } });
  }

  async function enrollLeads(campaignId, leadIds) {
    return request('POST', '/cc/campaigns', { body: { action: 'enroll', campaign_id: campaignId, lead_ids: leadIds } });
  }

  // ─── Templates (Campaign) ──────────────────────────────────────

  async function listCampaignTemplates(params = {}) {
    return request('POST', '/cc/campaign-templates', { body: { action: 'list', ...params } });
  }

  async function getCampaignTemplate(templateId) {
    return request('POST', '/cc/campaign-templates', { body: { action: 'get', template_id: templateId } });
  }

  async function createCampaignTemplate(data) {
    return request('POST', '/cc/campaign-templates', { body: { action: 'create', ...data } });
  }

  async function updateCampaignTemplate(id, fields) {
    return request('POST', '/cc/campaign-templates', { body: { action: 'update', template_id: id, ...fields } });
  }

  async function deleteCampaignTemplate(id) {
    return request('POST', '/cc/campaign-templates', { body: { action: 'delete', template_id: id } });
  }

  async function duplicateCampaignTemplate(id, newName) {
    return request('POST', '/cc/campaign-templates', { body: { action: 'duplicate', template_id: id, name: newName } });
  }

  // ─── Admin ─────────────────────────────────────────────────

  async function listUsers(params = {}) {
    return request('POST', '/cc/admin', { body: { action: 'list_users', ...params } });
  }

  async function updateUser(userId, fields) {
    return request('POST', '/cc/admin', { body: { action: 'update_user', user_id: userId, ...fields } });
  }

  async function createUser(data) {
    return request('POST', '/cc/admin', { body: { action: 'create_user', ...data } });
  }

  async function listTemplates(params = {}) {
    return request('POST', '/cc/admin', { body: { action: 'list_templates', ...params } });
  }

  async function createTemplate(data) {
    return request('POST', '/cc/admin', { body: { action: 'create_template', ...data } });
  }

  async function updateTemplate(id, fields) {
    return request('POST', '/cc/admin', { body: { action: 'update_template', template_id: id, ...fields } });
  }

  async function getSystemStats() {
    return request('POST', '/cc/admin', { body: { action: 'system_stats' } });
  }

  async function getRecentMessages(limit) {
    var body = { action: 'recent_messages' };
    if (limit) body.limit = limit;
    return request('POST', '/cc/admin', { body: body });
  }

  // ─── Config (Admin) ────────────────────────────────────────

  /**
   * List config records, optionally filtered by config_key
   * @param {string} [configKey] - e.g. 'lead_source', 'stage', 'disposition'
   */
  async function listConfig(configKey) {
    const body = { action: 'list' };
    if (configKey) body.config_key = configKey;
    return request('POST', '/cc/config', { body });
  }

  /**
   * Create a config record
   * @param {Object} data - { config_key, label, sort_order, meta }
   */
  async function createConfig(data) {
    return request('POST', '/cc/config', { body: { action: 'create', ...data } });
  }

  /**
   * Update a config record
   * @param {string} id - Record ID
   * @param {Object} fields - { label, sort_order, is_active, meta }
   */
  async function updateConfig(id, fields) {
    return request('POST', '/cc/config', { body: { action: 'update', id, ...fields } });
  }

  /**
   * Soft-delete a config record (sets Is_Active = false)
   * @param {string} id - Record ID
   */
  async function deleteConfig(id) {
    return request('POST', '/cc/config', { body: { action: 'delete', id } });
  }

  // ─── Price Book ─────────────────────────────────────────────

  async function listPriceBook(includeInactive) {
    var body = { action: 'list' };
    if (includeInactive) body.include_inactive = true;
    return request('POST', '/cc/price-book', { body: body });
  }

  async function getPriceBookItem(id) {
    return request('POST', '/cc/price-book', { body: { action: 'get', id: id } });
  }

  async function createPriceBookItem(data) {
    return request('POST', '/cc/price-book', { body: { action: 'create', ...data } });
  }

  async function updatePriceBookItem(id, fields) {
    return request('POST', '/cc/price-book', { body: { action: 'update', id: id, ...fields } });
  }

  async function createPriceBookTask(data) {
    return request('POST', '/cc/price-book', { body: { action: 'create_task', ...data } });
  }

  async function updatePriceBookTask(id, fields) {
    return request('POST', '/cc/price-book', { body: { action: 'update_task', id: id, ...fields } });
  }

  async function deletePriceBookTask(id) {
    return request('POST', '/cc/price-book', { body: { action: 'delete_task', id: id } });
  }

  // ─── Subscriptions ───────────────────────────────────────────

  async function unsubscribe(token) {
    return request('POST', '/cc/subscription', {
      body: { token, action: 'unsubscribe' },
      skipAuth: true
    });
  }

  async function getPreferences(token) {
    var resp = await fetch(WH + '/cc/subscription?token=' + encodeURIComponent(token));
    return resp.json();
  }

  async function updatePreferences(token, preferences, reason) {
    return request('POST', '/cc/subscription', {
      body: { token: token, action: 'update_preferences', preferences: preferences, reason: reason || '' },
      skipAuth: true
    });
  }

  async function unsubscribeAll(token, reason) {
    return request('POST', '/cc/subscription', {
      body: { token: token, action: 'unsubscribe', reason: reason || '' },
      skipAuth: true
    });
  }

  async function getLeadPreferences(leadId) {
    return request('POST', '/cc/subscription', {
      body: { action: 'status', lead_id: leadId }
    });
  }

  async function updateLeadPreferences(leadId, preferences) {
    return request('POST', '/cc/subscription', {
      body: { action: 'update_preferences', lead_id: leadId, preferences: preferences }
    });
  }

  // ─── Intake Form (Public) ────────────────────────────────────

  /**
   * Save partial intake form data (auto-save on step change)
   * @param {Object} data - { session_id?, step_number, form_data_partial }
   * @returns {{ success, session_id }}
   */
  async function saveIntakeForm(data) {
    return request('POST', '/cc/intake/save', {
      body: data,
      skipAuth: true
    });
  }

  /**
   * Resume a saved intake form session
   * @param {string} sessionId - Form session UUID
   * @returns {{ success, step_number, form_data }}
   */
  async function resumeIntakeForm(sessionId) {
    return request('GET', '/cc/intake/save', {
      params: { session_id: sessionId },
      skipAuth: true
    });
  }

  /**
   * Submit final intake form
   * @param {Object} data - { session_id, final_form_data, consent_status }
   */
  async function submitIntakeForm(data) {
    return request('POST', '/cc/intake/submit', {
      body: data,
      skipAuth: true
    });
  }

  /**
   * Upload a file for an intake form (ID documents, etc.)
   * Uses Azure Function endpoint with multipart/form-data
   * @param {string} sessionId - Form session UUID
   * @param {string} fieldId - Field identifier (e.g. 'id_doc1_front')
   * @param {File} file - File object from input
   * @returns {{ success, blob_path, preview_url }}
   */
  async function uploadIntakeFile(sessionId, fieldId, file) {
    var formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('field_id', fieldId);
    formData.append('file', file);

    var resp = await fetch(WH.replace('/webhook', '') + '/api/upload-intake-doc', {
      method: 'POST',
      body: formData
    });

    if (!resp.ok) {
      var errText = await resp.text().catch(function() { return 'Upload failed'; });
      throw new Error(errText);
    }

    return resp.json();
  }

  // ─── Forms ────────────────────────────────────────────────

  async function listForms(filters) {
    return request('POST', '/cc/forms', { body: Object.assign({ action: 'list' }, filters || {}) });
  }

  async function getForm(formId) {
    return request('POST', '/cc/forms', { body: { action: 'get', form_id: formId } });
  }

  async function getFormPublic(formId) {
    return request('POST', '/cc/forms/public', { body: { form_id: formId }, skipAuth: true });
  }

  async function createForm(data) {
    return request('POST', '/cc/forms', { body: Object.assign({ action: 'create' }, data) });
  }

  async function updateForm(id, fields) {
    return request('POST', '/cc/forms', { body: Object.assign({ action: 'update', id: id }, fields) });
  }

  async function deleteForm(id) {
    return request('POST', '/cc/forms', { body: { action: 'delete', id: id } });
  }

  async function duplicateForm(id, name, formId) {
    return request('POST', '/cc/forms', { body: { action: 'duplicate', id: id, name: name, form_id: formId } });
  }

  async function sendFormLink(data) {
    return request('POST', '/cc/forms', { body: Object.assign({ action: 'send_link' }, data) });
  }

  async function listFormSubmissions(params) {
    var body = { action: 'list_submissions' };
    if (typeof params === 'string') { body.form_id = params; }
    else if (params && typeof params === 'object') {
      if (params.form_id) body.form_id = params.form_id;
      if (params.lead_id) body.lead_id = params.lead_id;
    }
    return request('POST', '/cc/forms', { body: body });
  }

  async function submitDynamicForm(data) {
    return request('POST', '/cc/form-submit', { body: data, skipAuth: true });
  }

  // Form sections
  async function createFormSection(data) {
    return request('POST', '/cc/form-fields', { body: Object.assign({ action: 'create_section' }, data) });
  }

  async function updateFormSection(id, fields) {
    return request('POST', '/cc/form-fields', { body: Object.assign({ action: 'update_section', id: id }, fields) });
  }

  async function deleteFormSection(id, formId, sectionId) {
    return request('POST', '/cc/form-fields', { body: { action: 'delete_section', id: id, form_id: formId, section_id: sectionId } });
  }

  // Form fields
  async function createFormField(data) {
    return request('POST', '/cc/form-fields', { body: Object.assign({ action: 'create_field' }, data) });
  }

  async function updateFormField(id, fields) {
    return request('POST', '/cc/form-fields', { body: Object.assign({ action: 'update_field', id: id }, fields) });
  }

  async function deleteFormField(id) {
    return request('POST', '/cc/form-fields', { body: { action: 'delete_field', id: id } });
  }

  async function reorderFormItems(type, updates) {
    return request('POST', '/cc/form-fields', { body: { action: 'reorder', type: type, updates: updates } });
  }

  // ─── Contacts ──────────────────────────────────────────────

  /**
   * Get contact history (activities + campaign sends + conversion)
   * @param {string} leadId - Lead record ID
   * @returns {{ activities, campaign_sends, conversion: { converted, date, campaign_name } }}
   */
  async function getContactHistory(leadId) {
    return request('POST', '/cc/contacts', { body: { action: 'get_history', id: leadId } });
  }

  /**
   * Bulk update tags on multiple contacts
   * @param {string[]} ids - Lead record IDs
   * @param {string} tagAction - 'add' or 'remove'
   * @param {string[]} tags - Tag names to add/remove
   */
  async function bulkUpdateTags(ids, tagAction, tags) {
    return request('POST', '/cc/contacts', {
      body: { action: 'bulk_update_tags', ids, tag_action: tagAction, tags }
    });
  }

  /**
   * Bulk update contact status on multiple contacts
   * @param {string[]} ids - Lead record IDs
   * @param {string} contactStatus - PROSPECT, ACTIVE_CLIENT, FORMER_CLIENT, OTHER
   */
  async function bulkUpdateStatus(ids, contactStatus) {
    return request('POST', '/cc/contacts', {
      body: { action: 'bulk_update_status', ids, contact_status: contactStatus }
    });
  }

  // ─── Utility Functions ───────────────────────────────────────

  function formatDate(dateStr) {
    if (!dateStr) return '';
    // Parse YYYY-MM-DD as local date (not UTC) to avoid off-by-one in negative UTC offsets
    const parts = dateStr.split('T')[0].split('-');
    const d = parts.length === 3
      ? new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
      : new Date(dateStr);
    return d.toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  function formatRelativeTime(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(isoStr);
  }

  /** Stage display labels */
  const STAGE_LABELS = {
    NEW_LEAD: 'New Lead',
    CONTACTED: 'Contacted',
    INTAKE_RECEIVED: 'Intake Received',
    DISCOVERY_MEETING_BOOKED: 'Discovery Meeting Booked',
    MEETING_DONE: 'Meeting Done',
    READY_TO_DRAFT: 'Ready to Draft'
  };

  /** Stage badge colors (CSS class suffixes) */
  const STAGE_COLORS = {
    NEW_LEAD: 'blue',
    CONTACTED: 'cyan',
    INTAKE_RECEIVED: 'purple',
    DISCOVERY_MEETING_BOOKED: 'teal',
    MEETING_DONE: 'green',
    READY_TO_DRAFT: 'yellow'
  };

  const PRIORITY_COLORS = {
    LOW: 'green', MEDIUM: 'yellow', HIGH: 'red'
  };

  /** Contact status display labels */
  const CONTACT_STATUS_LABELS = {
    PROSPECT: 'Prospect',
    ACTIVE_CLIENT: 'Active Client',
    FORMER_CLIENT: 'Former Client',
    OTHER: 'Other'
  };

  /** Contact status badge colors (CSS class suffixes) */
  const CONTACT_STATUS_COLORS = {
    PROSPECT: 'blue',
    ACTIVE_CLIENT: 'green',
    FORMER_CLIENT: 'gray',
    OTHER: 'yellow'
  };

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || stage;
  }

  function stageColor(stage) {
    return STAGE_COLORS[stage] || 'gray';
  }

  function priorityColor(priority) {
    return PRIORITY_COLORS[priority] || 'gray';
  }

  function contactStatusLabel(status) {
    return CONTACT_STATUS_LABELS[status] || status;
  }

  function contactStatusColor(status) {
    return CONTACT_STATUS_COLORS[status] || 'gray';
  }

  function showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading...</p></div>';
  }

  function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const p = document.createElement('p');
    p.textContent = message;
    el.innerHTML = '<div class="cc-error"></div>';
    el.firstChild.appendChild(p);
  }

  function getUrlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  function getPathSegments() {
    return window.location.pathname.split('/').filter(Boolean);
  }

  // ─── Recordings ─────────────────────────────────────────────

  async function listRecordings(filters) {
    return request('POST', '/cc/recordings', {
      body: Object.assign({ action: 'list' }, filters || {})
    });
  }

  async function getRecording(id) {
    return request('POST', '/cc/recordings', { body: { action: 'get', transcription_id: id } });
  }

  async function approveRecordingReview(id) {
    return request('POST', '/cc/recordings', { body: { action: 'approve_review', transcription_id: id } });
  }

  async function generateWill(transcriptionId, templateId, overrides) {
    return request('POST', '/cc/recordings', {
      body: {
        action: 'generate_will',
        transcription_id: transcriptionId,
        template_id: templateId,
        overrides: overrides || {}
      }
    });
  }

  async function uploadToClio(transcriptionId) {
    return request('POST', '/cc/recordings', { body: { action: 'upload_to_clio', transcription_id: transcriptionId } });
  }

  async function retryRecordingProcessing(id) {
    return request('POST', '/cc/recordings', { body: { action: 'retry_processing', transcription_id: id } });
  }

  async function deleteRecording(id) {
    return request('POST', '/cc/recordings', { body: { action: 'delete', transcription_id: id } });
  }

  async function generateSummary(transcriptionId) {
    return request('POST', '/cc/generate-summary', { body: { transcription_id: transcriptionId } });
  }

  async function linkRecordingLead(transcriptionId, leadId) {
    return request('POST', '/cc/recordings', { body: { action: 'link_lead', transcription_id: transcriptionId, lead_id: leadId } });
  }

  async function uploadRecordingFile(data) {
    // 3-step upload: create record + get SAS URL → upload to Azure Blob → start processing
    var onProgress = data.onProgress || function() {};

    // Step 1: Create record + get SAS upload URL (single API call)
    console.log('[Upload Step 1] Creating Airtable record + SAS URL...');
    onProgress(2);
    var metaResult = await request('POST', '/cc/recordings', {
      body: {
        action: 'upload_file',
        lead_id: data.lead_id,
        file_name: data.file_name,
        file_type: data.file_type,
        subject: data.subject,
        source: data.source || 'upload'
      }
    });

    console.log('[Upload Step 1] Result:', JSON.stringify(metaResult).substring(0, 300));
    if (!metaResult.success) return metaResult;
    onProgress(5);

    var transcriptionId = metaResult.transcription_id;
    var uploadUrl = metaResult.upload_url;
    var blobPath = metaResult.blob_path;

    if (!uploadUrl) {
      console.warn('[Upload Step 2] No SAS URL returned — cannot upload to blob');
      return { success: true, transcription_id: transcriptionId, message: 'Record created but direct upload not available. Contact admin.', status: 'pending' };
    }

    // Step 2: Upload file directly to Azure Blob Storage with progress
    console.log('[Upload Step 2] Uploading to Azure Blob...', blobPath);
    try {
      await new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', data.file_type || 'application/octet-stream');

        xhr.upload.addEventListener('progress', function(e) {
          if (e.lengthComputable) {
            var pct = 5 + (e.loaded / e.total) * 85;
            onProgress(pct);
          }
        });

        xhr.addEventListener('load', function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            console.log('[Upload Step 2] Blob upload complete, HTTP ' + xhr.status);
            onProgress(92);
            resolve();
          } else {
            console.error('[Upload Step 2] Blob upload failed, HTTP ' + xhr.status, xhr.responseText);
            reject(new Error('Azure upload failed: HTTP ' + xhr.status));
          }
        });

        xhr.addEventListener('error', function() { reject(new Error('Upload network error')); });
        xhr.addEventListener('timeout', function() { reject(new Error('Upload timed out')); });
        xhr.timeout = 600000; // 10 min
        xhr.send(data.file);
      });
    } catch (err) {
      console.error('[Upload Step 2] Error:', err.message);
      return { success: true, transcription_id: transcriptionId, message: 'Record created but file upload failed: ' + err.message, status: 'pending' };
    }

    // Step 3: Tell backend to start processing the uploaded file
    console.log('[Upload Step 3] Starting processing...', transcriptionId, blobPath);
    onProgress(95);
    try {
      var processResult = await request('POST', '/cc/recordings', {
        body: {
          action: 'start_processing',
          transcription_id: transcriptionId,
          blob_path: blobPath
        }
      });
      console.log('[Upload Step 3] Result:', JSON.stringify(processResult).substring(0, 300));
      onProgress(100);
      return processResult;
    } catch (err) {
      console.error('[Upload Step 3] Error:', err.message || err.error);
      return { success: true, transcription_id: transcriptionId, message: 'File uploaded. Processing will begin shortly.', status: 'pending' };
    }
  }

  // ─── Documents ──────────────────────────────────────────────
  async function listDocuments(leadId) {
    return request('POST', '/cc/documents', { body: { action: 'list', lead_id: leadId } });
  }
  async function getDocument(id) {
    return request('POST', '/cc/documents', { body: { action: 'get', id: id } });
  }
  async function generateDocument(data) {
    return request('POST', '/cc/documents', { body: Object.assign({ action: 'generate' }, data) });
  }
  async function listDocumentCreators() {
    return request('POST', '/cc/documents', { body: { action: 'list_creators' } });
  }
  async function deleteDocument(id) {
    return request('POST', '/cc/documents', { body: { action: 'delete', id: id } });
  }

  // ─── Transcription Analysis ────────────────────────────────
  async function analyzeTranscription(transcriptionId) {
    return request('POST', '/cc/transcription-analyze', { body: { action: 'analyze', transcription_id: transcriptionId } });
  }

  // ─── Communications ─────────────────────────────────────────
  async function sendEmail(data) {
    return request('POST', '/cc/comms', { body: { action: 'send_email', lead_id: data.lead_id, subject: data.subject, body_html: data.body_html, template_id: data.template_id } });
  }

  async function sendSms(data) {
    return request('POST', '/cc/comms', { body: { action: 'send_sms', lead_id: data.lead_id, body: data.body } });
  }

  async function getSmsThread(leadId, opts) {
    opts = opts || {};
    return request('POST', '/cc/comms', { body: { action: 'get_sms_thread', lead_id: leadId, limit: opts.limit, offset: opts.offset }, skipCache: true });
  }

  async function logCall(data) {
    return request('POST', '/cc/comms', { body: { action: 'log_call', lead_id: data.lead_id, duration_minutes: data.duration_minutes, outcome: data.outcome, notes: data.notes, rc_call_id: data.rc_call_id, recording_url: data.recording_url } });
  }

  // ─── User Settings ────────────────────────────────────────────
  async function getUserSettings(userId) {
    return request('POST', '/cc/comms', { body: { action: 'get_user_settings', user_id: userId } });
  }

  async function updateUserSettings(data) {
    return request('POST', '/cc/comms', { body: { action: 'update_user_settings', user_id: data.user_id, rc_extension: data.rc_extension, email_signature: data.email_signature, notification_prefs: data.notification_prefs } });
  }

  // ─── Email Content ──────────────────────────────────────────
  async function getEmailContent(recipientEmail, sentAfter, subject) {
    return request('POST', '/cc/comms', { body: { action: 'get_email_content', recipient_email: recipientEmail, sent_after: sentAfter, subject: subject } });
  }

  // ─── Escape Helpers (shared) ────────────────────────────────
  function _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _escAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── Template Accordion (shared) ─────────────────────────────
  function buildTemplateAccordion(templates, options) {
    options = options || {};
    var defaultPA = options.defaultOpenPA || '';
    var selectedId = options.selectedId || '';
    var cardClass = options.cardClass || 'cc-tpl-accordion-card';

    // Group by practice_area
    var groups = {};
    templates.forEach(function(t) {
      var pa = t.practice_area || t.Practice_Area || 'General';
      if (!groups[pa]) groups[pa] = [];
      groups[pa].push(t);
    });

    var sortedKeys = Object.keys(groups).sort(function(a, b) {
      if (a === 'General') return 1;
      if (b === 'General') return -1;
      return a.localeCompare(b);
    });

    var html = '';
    sortedKeys.forEach(function(pa) {
      var isOpen = pa === defaultPA || (sortedKeys.length === 1);
      html += '<div class="cc-em-accordion" style="border:1px solid #E5E7EB;border-radius:6px;margin-bottom:8px;">';
      html += '<div class="cc-em-accordion-header" style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:' + (isOpen ? '#EFF6FF' : '#F9FAFB') + ';border-radius:6px;font-weight:600;font-size:0.85rem;color:#374151;">';
      html += '<span>' + _escHtml(pa) + ' <span style="font-weight:400;color:#9CA3AF;">(' + groups[pa].length + ')</span></span>';
      html += '<span class="cc-em-accordion-chevron" style="transition:transform 0.2s;' + (isOpen ? 'transform:rotate(180deg);' : '') + '">&#9660;</span>';
      html += '</div>';
      html += '<div class="cc-em-accordion-body" style="' + (isOpen ? '' : 'display:none;') + '">';
      groups[pa].forEach(function(t) {
        var isSelected = t.id === selectedId;
        var channelBadge = (t.channel || t.Channel || 'EMAIL') === 'SMS' ? '<span style="background:#7C3AED;color:white;font-size:0.65rem;padding:1px 5px;border-radius:3px;margin-left:6px;">SMS</span>' : '';
        html += '<div class="' + cardClass + '" data-tid="' + _escAttr(t.id) + '" style="padding:10px 14px;border-bottom:1px solid #F3F4F6;cursor:pointer;' + (isSelected ? 'background:#EFF6FF;border-left:3px solid #2563EB;' : '') + '">';
        html += '<div style="font-weight:500;font-size:0.85rem;color:#1F2937;">' + _escHtml(t.name || t.Name || '') + channelBadge + '</div>';
        if (t.subject || t.Subject) html += '<div style="font-size:0.78rem;color:#6B7280;margin-top:2px;">' + _escHtml(t.subject || t.Subject || '') + '</div>';
        else if (t.body_text || t.Body_Text) html += '<div style="font-size:0.78rem;color:#6B7280;margin-top:2px;">' + _escHtml((t.body_text || t.Body_Text || '').substring(0, 80)) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    });
    return html;
  }

  function bindAccordionToggles(containerEl) {
    if (!containerEl) return;
    containerEl.querySelectorAll('.cc-em-accordion-header').forEach(function(hdr) {
      hdr.addEventListener('click', function() {
        var body = hdr.nextElementSibling;
        var chevron = hdr.querySelector('.cc-em-accordion-chevron');
        if (body.style.display === 'none') {
          body.style.display = '';
          hdr.style.background = '#EFF6FF';
          if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
          body.style.display = 'none';
          hdr.style.background = '#F9FAFB';
          if (chevron) chevron.style.transform = '';
        }
      });
    });
  }

  // ─── Public API ──────────────────────────────────────────────
  return {
    // Auth
    auth: {
      loginSSO, getToken, setToken, clearToken,
      getUser, setUser, isAuthenticated, requireAuth
    },
    // Leads
    leads: { list: listLeads, get: getLead, create: createLead, update: updateLead, delete: deleteLead, updateStage },
    // Contacts
    contacts: { getHistory: getContactHistory, bulkUpdateTags, bulkUpdateStatus },
    // Activities
    activities: { list: listActivities, create: createActivity },
    // Tasks
    tasks: { list: listTasks, create: createTask, update: updateTask },
    // Reports
    reports: { get: getReport },
    // Campaigns
    campaigns: {
      list: listCampaigns, get: getCampaign, create: createCampaign, update: updateCampaign,
      validate: validateCampaign, testSend: testSendCampaign,
      schedule: scheduleCampaign, sendNow: sendCampaignNow, cancel: cancelCampaign,
      duplicate: duplicateCampaign, resendNonOpeners: resendNonOpeners,
      listRecipients: listCampaignRecipients, report: getCampaignReport,
      previewAudience: previewAudience,
      listSteps: listCampaignSteps, createStep: createCampaignStep, updateStep: updateCampaignStep, deleteStep: deleteCampaignStep,
      enroll: enrollLeads
    },
    // Campaign Templates
    campaignTemplates: {
      list: listCampaignTemplates, get: getCampaignTemplate,
      create: createCampaignTemplate, update: updateCampaignTemplate,
      delete: deleteCampaignTemplate, duplicate: duplicateCampaignTemplate
    },
    // Communications
    comms: { sendEmail, sendSms, getSmsThread, logCall },
    // Admin
    admin: {
      listUsers, createUser, updateUser, listTemplates, createTemplate, updateTemplate, getSystemStats, getRecentMessages,
      getUserSettings, updateUserSettings, getEmailContent,
      config: { list: listConfig, create: createConfig, update: updateConfig, delete: deleteConfig }
    },
    // Price Book
    priceBook: {
      list: listPriceBook, get: getPriceBookItem,
      create: createPriceBookItem, update: updatePriceBookItem,
      createTask: createPriceBookTask, updateTask: updatePriceBookTask,
      deleteTask: deletePriceBookTask
    },
    // Recordings
    recordings: {
      list: listRecordings, get: getRecording,
      approveReview: approveRecordingReview, generateWill,
      uploadToClio, retryProcessing: retryRecordingProcessing,
      delete: deleteRecording, linkLead: linkRecordingLead,
      analyze: analyzeTranscription, uploadFile: uploadRecordingFile,
      generateSummary
    },
    // Documents
    documents: {
      list: listDocuments, get: getDocument, generate: generateDocument,
      listCreators: listDocumentCreators, delete: deleteDocument
    },
    // Dashboard
    dashboard: { get: getDashboard },
    // Subscriptions
    subscriptions: { unsubscribe, getPreferences, updatePreferences, unsubscribeAll, getLeadPreferences, updateLeadPreferences },
    // Forms (management)
    forms: {
      list: listForms, get: getForm, getPublic: getFormPublic,
      create: createForm, update: updateForm, delete: deleteForm,
      duplicate: duplicateForm, sendLink: sendFormLink,
      listSubmissions: listFormSubmissions, submitDynamic: submitDynamicForm,
      createSection: createFormSection, updateSection: updateFormSection, deleteSection: deleteFormSection,
      createField: createFormField, updateField: updateFormField, deleteField: deleteFormField,
      reorder: reorderFormItems
    },
    // Intake (public)
    intake: { save: saveIntakeForm, resume: resumeIntakeForm, submit: submitIntakeForm, uploadFile: uploadIntakeFile },
    // Cache management
    cache: { invalidate: invalidateCache },
    // Utilities
    util: {
      formatDate, formatDateTime, formatRelativeTime,
      stageLabel, stageColor, priorityColor,
      contactStatusLabel, contactStatusColor,
      showLoading, showError, getUrlParams, getPathSegments,
      STAGE_LABELS, STAGE_COLORS,
      CONTACT_STATUS_LABELS, CONTACT_STATUS_COLORS,
      buildTemplateAccordion: buildTemplateAccordion,
      bindAccordionToggles: bindAccordionToggles
    }
  };
})();

// Expose to window so other scripts can find it
window.ClientCareAPI = ClientCareAPI;

// On /intake pages, retry intake-engine init by pre-loading the config
// (the OLD cached intake-engine.js runs before this API is available)
if (/\/intake/.test(location.pathname)) {
  setTimeout(function tryReinit() {
    var errEl = document.querySelector('#cc-intake-step-content .cc-error');
    if (errEl && /Form configuration not found/i.test(errEl.textContent)) {
      var params = new URLSearchParams(location.search);
      var formId = params.get('form');
      if (!formId) return;
      window.ClientCareAPI.forms.getPublic(formId).then(function(result) {
        if (!result || !result.success || !result.config) return;
        // Inject the config into IntakeFormConfigs so static lookup works
        window.IntakeFormConfigs = window.IntakeFormConfigs || {};
        window.IntakeFormConfigs[formId] = result.config;
        // Inject a fresh intake-engine.js with a cache-busting URL
        var s = document.createElement('script');
        s.src = 'https://davidlifson.github.io/tabuchi-law-cdn/tabuchi-bookings/client-care/public/intake-engine.js?_v=' + Date.now();
        document.body.appendChild(s);
      });
    }
  }, 1000);
}
})();  // End of "if (!window.ClientCareAPI)" wrapper

/* ── Nav Sync: ensure all CRM pages have Dashboard + Contacts links, Campaigns dropdown ── */
(function navSync() {
  var nav = document.getElementById('app-crm-nav');
  if (!nav) return;
  var bar = document.getElementById('app-nav-bar');
  if (bar) bar.style.display = 'flex';
  var ap = bar ? (bar.getAttribute('data-active-page') || '') : '';

  // Ensure home link → /crm/dashboard
  var hl = document.getElementById('app-home-link');
  if (hl) hl.href = '/crm/dashboard';

  var links = nav.querySelectorAll('a[data-nav]');
  var has = {};
  for (var i = 0; i < links.length; i++) has[links[i].getAttribute('data-nav')] = links[i];

  var style = 'color:#D1D5DB;text-decoration:none;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;';

  // Inject Dashboard link if missing (first in nav)
  if (!has.dashboard) {
    var d = document.createElement('a');
    d.href = '/crm/dashboard'; d.setAttribute('data-nav', 'dashboard');
    d.setAttribute('style', style); d.textContent = 'Dashboard';
    nav.insertBefore(d, nav.firstChild);
  }

  // Inject Contacts link if missing (after Leads)
  if (!has.contacts) {
    var c = document.createElement('a');
    c.href = '/crm/contacts'; c.setAttribute('data-nav', 'contacts');
    c.setAttribute('style', style); c.textContent = 'Contacts';
    var leadsLink = has.leads;
    if (leadsLink && leadsLink.nextSibling) {
      nav.insertBefore(c, leadsLink.nextSibling);
    } else if (leadsLink) {
      nav.appendChild(c);
    }
  }

  // Inject Kanban link if missing (after Contacts, before Recordings)
  if (!has.kanban) {
    var k = document.createElement('a');
    k.href = '/crm/kanban'; k.setAttribute('data-nav', 'kanban');
    k.setAttribute('style', style); k.textContent = 'Kanban';
    var contactsLink = has.contacts || nav.querySelector('a[data-nav="contacts"]');
    var recordingsLink = has.recordings;
    if (recordingsLink) {
      nav.insertBefore(k, recordingsLink);
    } else if (contactsLink && contactsLink.nextSibling) {
      nav.insertBefore(k, contactsLink.nextSibling);
    } else {
      nav.appendChild(k);
    }
  }

  // Convert Campaigns single link → dropdown (Campaigns, Templates, Drip Enrollment)
  if (has.campaigns && !document.getElementById('app-camp-btn')) {
    var cl = has.campaigns;
    var cs = document.createElement('span');
    cs.id = 'app-camp-nav'; cs.style.cssText = 'position:relative;';
    var cb = document.createElement('button');
    cb.id = 'app-camp-btn';
    cb.setAttribute('data-nav', 'campaigns,campaign-templates,templates');
    cb.style.cssText = 'color:#D1D5DB;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;background:none;border:none;cursor:pointer;font-family:inherit;';
    cb.innerHTML = 'Campaigns &#9662;';
    var cd = document.createElement('div');
    cd.id = 'app-camp-dropdown';
    cd.style.cssText = 'display:none;position:absolute;left:0;top:100%;background:white;border:1px solid #E5E7EB;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:180px;z-index:100;margin-top:0.25rem;';
    var ds = 'display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;';
    cd.innerHTML = '<a href="/crm/campaigns" data-nav="campaigns" style="' + ds + '">Campaigns</a>' +
      '<a href="/crm/campaign-templates" data-nav="campaign-templates,templates" style="' + ds + '">Templates</a>' +
      '<a href="/crm/admin#drip-enrollment" data-nav="drip-enrollment" style="' + ds + '">Drip Enrollment</a>';
    cs.appendChild(cb); cs.appendChild(cd);
    cl.parentNode.replaceChild(cs, cl);
    // Toggle
    cb.addEventListener('click', function(e) {
      e.stopPropagation();
      var allDD = (bar || document).querySelectorAll('[id$="-dropdown"]');
      for (var k = 0; k < allDD.length; k++) { if (allDD[k] !== cd) allDD[k].style.display = 'none'; }
      cd.style.display = cd.style.display === 'block' ? 'none' : 'block';
    });
    cd.addEventListener('click', function(e) { e.stopPropagation(); });
    // Highlight button + active dropdown item
    if (ap === 'campaigns' || ap === 'campaign-templates' || ap === 'templates') {
      cb.style.color = 'white'; cb.style.background = '#374151';
      var ddLinks = cd.querySelectorAll('a');
      for (var m = 0; m < ddLinks.length; m++) {
        var dnv = (ddLinks[m].getAttribute('data-nav') || '').split(',');
        if (dnv.indexOf(ap) !== -1) { ddLinks[m].style.background = '#F3F4F6'; ddLinks[m].style.fontWeight = '600'; }
      }
    }
  }

  // Re-highlight active page (in case we just added the active link)
  if (!bar || !ap) return;
  var all = nav.querySelectorAll('a[data-nav]');
  for (var j = 0; j < all.length; j++) {
    if (all[j].getAttribute('data-nav') === ap) {
      all[j].style.color = 'white';
      all[j].style.background = '#374151';
    }
  }
})();
