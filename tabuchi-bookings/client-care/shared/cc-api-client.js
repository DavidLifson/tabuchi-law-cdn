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

const ClientCareAPI = (() => {
  'use strict';

  const WH = 'https://tabuchilaw.app.n8n.cloud/webhook';

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
    'system_stats', 'list_recipients', 'report', 'preview_audience', 'list_steps'];

  // Actions that mutate data (invalidate cache)
  var WRITE_ACTIONS = ['create', 'update', 'delete', 'bulk_update_tags',
    'bulk_update_status', 'create_step', 'delete_step', 'enroll',
    'schedule', 'send_now', 'cancel', 'duplicate', 'test_send',
    'resend_non_openers', 'create_template', 'update_template',
    'create_task', 'update_task', 'delete_task'];

  function _cacheKey(path, body) {
    return path + '|' + JSON.stringify(body || {});
  }

  function _getCacheTTL(path) {
    if (path.indexOf('/cc/config') !== -1) return CACHE_TTL.config;
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
          throw { status: response.status, ...data };
        }

        // ── Cache: store successful read responses ──
        if (cacheKey) {
          _cache[cacheKey] = { data: data, time: Date.now() };
        }

        return data;
      } catch (error) {
        if (error.status) throw error;
        throw { status: 0, success: false, error: 'Network error. Please try again.' };
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
    return request('POST', '/cc/campaigns', { body: { action: 'preview_audience', audience: audienceDefinition } });
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
    const d = new Date(dateStr);
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

  // ─── Public API ──────────────────────────────────────────────
  return {
    // Auth
    auth: {
      loginSSO, getToken, setToken, clearToken,
      getUser, setUser, isAuthenticated, requireAuth
    },
    // Leads
    leads: { list: listLeads, get: getLead, create: createLead, update: updateLead, updateStage },
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
      listSteps: listCampaignSteps, createStep: createCampaignStep, deleteStep: deleteCampaignStep,
      enroll: enrollLeads
    },
    // Campaign Templates
    campaignTemplates: {
      list: listCampaignTemplates, get: getCampaignTemplate,
      create: createCampaignTemplate, update: updateCampaignTemplate,
      delete: deleteCampaignTemplate, duplicate: duplicateCampaignTemplate
    },
    // Admin
    admin: {
      listUsers, createUser, updateUser, listTemplates, createTemplate, updateTemplate, getSystemStats,
      config: { list: listConfig, create: createConfig, update: updateConfig, delete: deleteConfig }
    },
    // Price Book
    priceBook: {
      list: listPriceBook, get: getPriceBookItem,
      create: createPriceBookItem, update: updatePriceBookItem,
      createTask: createPriceBookTask, updateTask: updatePriceBookTask,
      deleteTask: deletePriceBookTask
    },
    // Dashboard
    dashboard: { get: getDashboard },
    // Subscriptions
    subscriptions: { unsubscribe },
    // Intake (public)
    intake: { save: saveIntakeForm, resume: resumeIntakeForm, submit: submitIntakeForm },
    // Cache management
    cache: { invalidate: invalidateCache },
    // Utilities
    util: {
      formatDate, formatDateTime, formatRelativeTime,
      stageLabel, stageColor, priorityColor,
      contactStatusLabel, contactStatusColor,
      showLoading, showError, getUrlParams, getPathSegments,
      STAGE_LABELS, STAGE_COLORS,
      CONTACT_STATUS_LABELS, CONTACT_STATUS_COLORS
    }
  };
})();

/* ── Nav Sync: ensure all CRM pages have Dashboard + Contacts links ── */
(function navSync() {
  var nav = document.getElementById('app-crm-nav');
  if (!nav) return;

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

  // Re-highlight active page (in case we just added the active link)
  var bar = document.getElementById('app-nav-bar');
  if (!bar) return;
  var ap = bar.getAttribute('data-active-page') || '';
  if (!ap) return;
  var all = nav.querySelectorAll('a[data-nav]');
  for (var j = 0; j < all.length; j++) {
    if (all[j].getAttribute('data-nav') === ap) {
      all[j].style.color = 'white';
      all[j].style.background = '#374151';
    }
  }
})();
