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

  // ─── Auth Token ──────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem('app_token') || '';
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

    if (options.body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url.toString(), fetchOptions);

      // Handle 401 — redirect to login
      if (response.status === 401) {
        clearToken();
        window.location.href = '/login?expired=1';
        throw { status: 401, error: 'Session expired. Please sign in again.' };
      }

      const data = await response.json();
      if (!response.ok) {
        throw { status: response.status, ...data };
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      throw { status: 0, success: false, error: 'Network error. Please try again.' };
    }
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
    return request('POST', '/cc/stage-update', {
      body: { lead_id: leadId, new_stage: newStage, ...opts }
    });
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

  // ─── Admin ─────────────────────────────────────────────────

  async function listUsers(params = {}) {
    return request('POST', '/cc/admin', { body: { action: 'list_users', ...params } });
  }

  async function updateUser(userId, fields) {
    return request('POST', '/cc/admin', { body: { action: 'update_user', user_id: userId, ...fields } });
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
    MEETING1_BOOKED: 'Meeting #1 Booked',
    MEETING1_COMPLETED: 'Meeting #1 Completed',
    INTAKE_COMPLETE_READY_TO_DRAFT: 'Ready to Draft',
    CLOSED_INTAKE_RECEIVED: 'Intake Received'
  };

  /** Stage badge colors (CSS class suffixes) */
  const STAGE_COLORS = {
    NEW_LEAD: 'blue',
    CONTACTED: 'cyan',
    MEETING1_BOOKED: 'teal',
    MEETING1_COMPLETED: 'green',
    INTAKE_COMPLETE_READY_TO_DRAFT: 'yellow',
    CLOSED_INTAKE_RECEIVED: 'purple'
  };

  const PRIORITY_COLORS = {
    LOW: 'green', MEDIUM: 'yellow', HIGH: 'red'
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

  function showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading...</p></div>';
  }

  function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `<div class="cc-error"><p>${message}</p></div>`;
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
    // Activities
    activities: { list: listActivities, create: createActivity },
    // Tasks
    tasks: { list: listTasks, create: createTask, update: updateTask },
    // Reports
    reports: { get: getReport },
    // Campaigns
    campaigns: {
      list: listCampaigns, get: getCampaign, create: createCampaign, update: updateCampaign,
      listSteps: listCampaignSteps, createStep: createCampaignStep, deleteStep: deleteCampaignStep,
      enroll: enrollLeads
    },
    // Admin
    admin: {
      listUsers, updateUser, listTemplates, createTemplate, updateTemplate, getSystemStats
    },
    // Subscriptions
    subscriptions: { unsubscribe },
    // Intake (public)
    intake: { save: saveIntakeForm, resume: resumeIntakeForm, submit: submitIntakeForm },
    // Utilities
    util: {
      formatDate, formatDateTime, formatRelativeTime,
      stageLabel, stageColor, priorityColor,
      showLoading, showError, getUrlParams, getPathSegments,
      STAGE_LABELS, STAGE_COLORS
    }
  };
})();
