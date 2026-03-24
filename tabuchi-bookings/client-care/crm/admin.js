/* v2.5.0 */
/**
 * Tabuchi Law Client Care CRM - Admin Configuration
 * Handles: /crm/admin
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - System overview dashboard (pipeline stats, Clio sync failures, service level breaches)
 * - User management (list, update roles/teams, activate/deactivate)
 * - Template management (list, create, edit email/SMS templates)
 * - System configuration (service level thresholds, integration status)
 * - Role restricted: ADMIN only
 *
 * Page element IDs:
 * - #cc-admin-container     (main container)
 * - #cc-admin-tabs          (tab navigation)
 * - #cc-admin-content       (tab content area)
 * - #cc-user-name           (nav user display)
 */

(function Admin() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

  // Block BOOKINGS-only users from CRM pages
  var _u = ClientCareAPI.auth.getUser();
  if (_u && _u.role === 'BOOKINGS') { window.location.href = '/dashboard'; return; }

  var API = ClientCareAPI;
  // Pick visible element, avoiding hidden .w-embed duplicate
  var $el = function(id) {
    var all = document.querySelectorAll('#' + id);
    if (!all.length) return null;
    for (var i = 0; i < all.length; i++) {
      if (!all[i].closest('.w-embed')) return all[i];
    }
    return all[all.length - 1];
  };

  // ─── Constants ─────────────────────────────────────────────
  var TABS = [
    { key: 'system-status', label: 'System Status' },
    { key: 'staff-users', label: 'Users' },
    { key: 'templates', label: 'Templates' },
    { key: 'forms', label: 'Forms' },
    { key: 'categories', label: 'Meeting Type Categories' },
    { key: 'practice-areas', label: 'Practice Areas' },
    { key: 'lead-sources', label: 'Lead Sources' },
    { key: 'stages', label: 'Stages' },
    { key: 'dispositions', label: 'Dispositions' },
    { key: 'activity-types', label: 'Activity Types' },
    { key: 'entity-types', label: 'Entity Types' },
    { key: 'tags', label: 'Tags' },
    { key: 'price-book', label: 'Price Books' },
    { key: 'assignment-rules', label: 'Assignment Rules' }
  ];

  // Tabs grouped under the "Options Lists" dropdown in the tab bar
  var OPTIONS_LIST_TABS = ['categories', 'practice-areas', 'stages', 'lead-sources', 'dispositions', 'activity-types', 'entity-types', 'tags'];

  // Tabs accessible via hash but hidden from tab bar (accessed via Campaigns nav dropdown)
  var HIDDEN_TABS = ['drip-enrollment'];

  var CONFIG_META = {
    'practice_area': [],
    'lead_source': [],
    'stage': [
      { key: 'percentage', label: 'Percentage (%)', type: 'number' },
      { key: 'color', label: 'Color', type: 'color' }
    ],
    'disposition': [
      { key: 'color', label: 'Color', type: 'color' }
    ],
    'activity_type': [],
    'entity_type': [],
    'tag': [
      { key: 'category', label: 'Category', type: 'select', choices: ['Client Type', 'Marketing', 'Case Status', 'Practice Area', 'Internal'] },
      { key: 'color', label: 'Color', type: 'color' }
    ]
  };

  function tabToConfigKey(tabKey) {
    var map = { 'practice-areas': 'practice_area', 'lead-sources': 'lead_source', 'stages': 'stage', 'dispositions': 'disposition', 'activity-types': 'activity_type', 'entity-types': 'entity_type', 'tags': 'tag' };
    return map[tabKey] || tabKey;
  }

  var ROLE_OPTIONS = ['ADMIN', 'MANAGER', 'SALES_INTAKE', 'LAWYER', 'MARKETING', 'READ_ONLY'];
  var CHANNEL_OPTIONS = ['EMAIL', 'SMS'];

  var ROLE_COLORS = {
    ADMIN: 'red', MANAGER: 'blue', SALES_INTAKE: 'teal',
    LAWYER: 'green', MARKETING: 'purple', READ_ONLY: 'gray'
  };

  // ─── Booking Admin API Helper (calls WF-19 at api/admin/{endpoint}) ──
  async function bookingAdminFetch(endpoint, data) {
    var t = localStorage.getItem('admin_token') || '';
    var r = await fetch('https://tabuchilaw.app.n8n.cloud/webhook/api/admin/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Admin_Token': t },
      body: JSON.stringify(data || {})
    });
    var j;
    try { j = await r.json(); } catch (e) { j = { error: 'Invalid response from server (status ' + r.status + ')' }; }
    if (!r.ok) throw Object.assign({ status: r.status }, j);
    return j;
  }

  async function categoriesApiFetch(action, data) {
    var t = localStorage.getItem('app_token') || '';
    var r = await fetch('https://tabuchilaw.app.n8n.cloud/webhook/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Dashboard_Token': t },
      body: JSON.stringify(Object.assign({ action: action }, data || {}))
    });
    var j;
    try { j = await r.json(); } catch (e) { j = { error: 'Invalid response from server (status ' + r.status + ')' }; }
    if (!r.ok) throw Object.assign({ status: r.status }, j);
    return j;
  }

  // ─── State ─────────────────────────────────────────────────
  var state = {
    activeTab: 'system-status',
    user: API.auth.getUser(),
    // Overview
    stats: null,
    statsLoading: false,
    // Users (merged CRM + booking staff)
    users: [],
    staffList: [],
    staffUsersLoading: false,
    staffUsersSortKey: 'name',
    staffUsersSortDir: 'asc',
    usersSubTab: 'manage-users',
    permissionsData: null,
    permissionsConfigId: null,
    permissionsSaving: false,
    // Role config (booking priority + cost)
    roleConfigItems: [],
    roleConfigLoading: false,
    // Templates
    templates: [],
    templatesLoading: false,
    templatesSortKey: 'name',
    templatesSortDir: 'asc',
    templateFilterChannel: '',
    // Clio sync failures
    clioFailures: [],
    clioLoading: false,
    dripHeartbeat: null,
    // (staff state merged into staffList above)
    // Categories
    categories: [],
    categoriesLoading: false,
    // Config items (generic for lead sources, stages, etc.)
    configItems: {},
    configLoading: {},
    // Price Book
    priceBookItems: [],
    priceBookLoading: false,
    priceBookDetail: null,
    priceBookDetailLoading: false,
    // Drip Enrollment
    dripConfig: null,
    dripConfigRecordId: null,
    dripCampaigns: [],
    dripLoading: false,
    // Messages Sent
    recentMessages: [],
    messagesLoading: false,
    messagesDisplayCount: 25,
    // Assignment Rules
    assignmentRules: [],
    assignmentRulesLoading: false,
    assignmentRulesUsers: [],
    assignmentRulesConfigCache: {},
    // Forms
    forms: [],
    formsLoading: false,
    formDetail: null,
    formDetailLoading: false,
    formEditorMode: null, // null | 'list' | 'edit' | 'create'
    formEditorData: null,
    formSectionExpanded: {}
  };

  // ─── Role Gate ─────────────────────────────────────────────
  function checkRole() {
    var u = state.user || {};
    if ((u.role || '').toUpperCase() !== 'ADMIN' && !u.is_admin) {
      var container = $el('cc-admin-container');
      if (container) container.innerHTML =
        '<div class="cc-error"><p>Access denied. Admin configuration requires ADMIN role.</p></div>';
      return false;
    }
    return true;
  }

  // ─── Tab Navigation ────────────────────────────────────────
  function renderTabs() {
    var el = $el('cc-admin-tabs');
    if (!el) return;

    var optActive = OPTIONS_LIST_TABS.indexOf(state.activeTab) !== -1;
    var optLabel = optActive ? TABS.find(function(t) { return t.key === state.activeTab; }).label : '';

    var html = '<div class="cc-admin-tab-bar">';
    TABS.forEach(function(tab) {
      // Skip tabs that belong to the Options Lists dropdown
      if (OPTIONS_LIST_TABS.indexOf(tab.key) !== -1) return;
      var cls = 'cc-admin-tab' + (state.activeTab === tab.key ? ' cc-admin-tab-active' : '');
      html += '<button class="' + cls + '" data-tab="' + tab.key + '">' + tab.label + '</button>';
    });

    // Options Lists dropdown button
    var dropCls = 'cc-admin-tab cc-admin-tab-dropdown' + (optActive ? ' cc-admin-tab-active' : '');
    html += '<div class="cc-admin-dropdown-wrap">';
    html += '<button class="' + dropCls + '" id="cc-options-list-btn">';
    html += optActive ? optLabel + ' &#9662;' : 'Options Lists &#9662;';
    html += '</button>';
    html += '<div class="cc-admin-dropdown-menu" id="cc-options-list-menu">';
    TABS.forEach(function(tab) {
      if (OPTIONS_LIST_TABS.indexOf(tab.key) === -1) return;
      var itemCls = 'cc-admin-dropdown-item' + (state.activeTab === tab.key ? ' cc-admin-dropdown-item-active' : '');
      html += '<button class="' + itemCls + '" data-tab="' + tab.key + '">' + tab.label + '</button>';
    });
    html += '</div></div>';

    html += '</div>';
    el.innerHTML = html;

    // Bind regular tab clicks
    el.querySelectorAll('.cc-admin-tab[data-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.activeTab = btn.dataset.tab;
        location.hash = '#' + btn.dataset.tab;
        renderTabs();
        renderActiveTab();
      });
    });

    // Bind dropdown toggle
    var dropBtn = el.querySelector('#cc-options-list-btn');
    var dropMenu = el.querySelector('#cc-options-list-menu');
    if (dropBtn && dropMenu) {
      dropBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var open = dropMenu.classList.toggle('cc-admin-dropdown-open');
        // Close on next outside click
        if (open) {
          var closeHandler = function() {
            dropMenu.classList.remove('cc-admin-dropdown-open');
            document.removeEventListener('click', closeHandler);
          };
          setTimeout(function() { document.addEventListener('click', closeHandler); }, 0);
        }
      });

      // Bind dropdown item clicks
      dropMenu.querySelectorAll('.cc-admin-dropdown-item').forEach(function(item) {
        item.addEventListener('click', function() {
          state.activeTab = item.dataset.tab;
          location.hash = '#' + item.dataset.tab;
          dropMenu.classList.remove('cc-admin-dropdown-open');
          renderTabs();
          renderActiveTab();
        });
      });
    }
  }

  function renderActiveTab() {
    switch (state.activeTab) {
      case 'system-status':  renderSystemStatus(); break;
      case 'staff-users':    renderStaffUsersTab(); break;
      case 'templates':      renderTemplatesTab(); break;
      case 'forms':          renderFormsTab(); break;
      case 'categories':     renderCategoriesTab(); break;
      case 'price-book':     renderPriceBookTab(); break;
      case 'assignment-rules': renderAssignmentRulesTab(); break;
      case 'drip-enrollment': renderDripTab(); break;
      case 'lead-sources':
      case 'stages':
      case 'dispositions':
      case 'activity-types':
      case 'entity-types':
        renderConfigTab(tabToConfigKey(state.activeTab), TABS.find(function(t) { return t.key === state.activeTab; }).label);
        break;
    }
    // Fetch fresh data for the active tab
    switch (state.activeTab) {
      case 'system-status': fetchOverviewData(); break;
      case 'staff-users':   fetchStaffUsers(); break;
      case 'templates':     fetchTemplates(); break;
      case 'forms':         fetchForms(); break;
      case 'categories':    fetchCategories(); break;
      case 'price-book':    fetchPriceBookItems(); break;
      case 'assignment-rules': fetchAssignmentRulesData(); break;
      case 'drip-enrollment': fetchDripData(); break;
      default:
        var ck = tabToConfigKey(state.activeTab);
        if (CONFIG_META[ck] !== undefined) {
          fetchConfigItems(ck).then(function() {
            renderConfigTab(ck, TABS.find(function(t) { return t.key === state.activeTab; }).label);
          });
        }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FORMS TAB
  // ═══════════════════════════════════════════════════════════

  var FORM_PRACTICE_AREAS = [
    { key: 'ESTATE_PLANNING_WILL_POA', label: 'Estate Planning - Will & POA' },
    { key: 'ESTATE_PLANNING_TRUST', label: 'Estate Planning - Trust' },
    { key: 'ESTATE_PLANNING_FULL', label: 'Estate Planning - Full' },
    { key: 'PROBATE', label: 'Probate' },
    { key: 'ESTATE_ADMINISTRATION', label: 'Estate Administration' },
    { key: 'REAL_ESTATE', label: 'Real Estate' },
    { key: 'CORPORATE', label: 'Corporate' },
    { key: 'OTHER', label: 'Other' }
  ];

  var FORM_FIELD_TYPES = [
    { key: 'short_text', label: 'Short Text' },
    { key: 'long_text', label: 'Long Text' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'number', label: 'Number' },
    { key: 'date', label: 'Date' },
    { key: 'address', label: 'Address' },
    { key: 'multiple_choice', label: 'Multiple Choice' },
    { key: 'yes_no', label: 'Yes / No' },
    { key: 'file_upload', label: 'File Upload' },
    { key: 'info', label: 'Info Block' },
    { key: 'select', label: 'Select Dropdown' },
    { key: 'checkbox_group', label: 'Checkbox Group' }
  ];

  var AUTOMATION_TYPES = [
    { type: 'notify_staff', label: 'Notify Staff', desc: 'Send email notification to selected staff members' },
    { type: 'update_stage', label: 'Update Lead Stage', desc: 'Automatically change the lead\'s pipeline stage' },
    { type: 'log_activity', label: 'Log Activity', desc: 'Create an activity log entry on the lead record' },
    { type: 'assign_owner', label: 'Assign Owner', desc: 'Set the lead owner to a specific staff member' },
    { type: 'send_confirmation', label: 'Send Confirmation Email', desc: 'Send a confirmation email to the client' },
    { type: 'create_task', label: 'Create Task', desc: 'Create a follow-up task when form is submitted' },
    { type: 'enroll_drip', label: 'Enroll in Drip Campaign', desc: 'Automatically enroll the lead in a drip email campaign' }
  ];

  var STAGE_OPTIONS = [
    { key: 'NEW_LEAD', label: 'New Lead' },
    { key: 'CONTACTED', label: 'Contacted' },
    { key: 'INTAKE_RECEIVED', label: 'Intake Received' },
    { key: 'DISCOVERY_MEETING_BOOKED', label: 'Discovery Meeting Booked' },
    { key: 'MEETING_DONE', label: 'Meeting Done' },
    { key: 'READY_TO_DRAFT', label: 'Ready to Draft' }
  ];

  function slugify(text) {
    return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function fetchForms() {
    state.formsLoading = true;
    renderFormsTab();
    try {
      var result = await API.forms.list();
      state.forms = (result && result.data) || [];
    } catch (e) {
      state.forms = [];
    }
    state.formsLoading = false;
    renderFormsTab();
  }

  function renderFormsTab() {
    if (state.formEditorMode === 'edit' || state.formEditorMode === 'create') {
      renderFormEditor();
      return;
    }

    var content = $el('cc-admin-content');
    if (!content) return;

    var items = state.forms || [];

    var html = '<div class="cc-admin-config">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Forms</h3>';
    html += '<button id="cc-forms-add-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ New Form</button>';
    html += '</div>';

    if (state.formsLoading) {
      html += '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading forms...</p></div></div>';
      content.innerHTML = html;
      return;
    }

    if (items.length === 0) {
      html += '<div class="cc-empty"><p>No forms configured yet.</p></div></div>';
      content.innerHTML = html;
      bindFormsAddBtn();
      return;
    }

    html += '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">';
    html += '<table class="cc-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th">Name</th>';
    html += '<th class="cc-th" style="width:160px;">Form ID</th>';
    html += '<th class="cc-th" style="width:160px;">Practice Area</th>';
    html += '<th class="cc-th" style="width:80px;">Status</th>';
    html += '<th class="cc-th" style="width:100px;">Submissions</th>';
    html += '<th class="cc-th" style="width:220px;">Actions</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function(item) {
      var itemActive = item.Is_Active !== undefined ? item.Is_Active : (item.is_active !== false);
      var activeCls = itemActive ? 'green' : 'gray';
      var activeText = itemActive ? 'Active' : 'Inactive';
      var paLabel = '';
      var pAreaVal = item.Practice_Area || item.practice_area || '';
      var pa = FORM_PRACTICE_AREAS.find(function(p) { return p.key === pAreaVal; });
      if (pa) paLabel = pa.label;
      else paLabel = item.practice_area || '';

      var slug = item.Form_ID || item.form_id || item.slug || '';
      var name = item.Name || item.name || '';
      var subCount = item.Submission_Count || item.submission_count || 0;
      var isActive = item.Is_Active !== undefined ? item.Is_Active : (item.is_active !== false);
      html += '<tr class="cc-form-row" data-form-slug="' + escapeAttr(slug) + '" data-form-rec-id="' + escapeAttr(item.id || '') + '" style="border-bottom:1px solid #F3F4F6;transition:background 0.1s;cursor:pointer;" onmouseover="this.style.background=\'#F9FAFB\'" onmouseout="this.style.background=\'\'">';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;font-weight:500;">' + escapeHtml(name) + '</td>';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;"><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">' + escapeHtml(slug) + '</code></td>';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;">' + escapeHtml(paLabel) + '</td>';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;"><span class="cc-badge cc-badge-' + activeCls + '">' + activeText + '</span></td>';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;">' + subCount + '</td>';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-edit-btn" data-form-slug="' + escapeAttr(slug) + '">Edit</button> ';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-dup-btn" data-form-id="' + escapeAttr(item.id || '') + '" data-form-name="' + escapeAttr(name) + '" data-form-slug="' + escapeAttr(slug) + '">Duplicate</button> ';
      if (itemActive) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-form-toggle-btn" data-form-id="' + escapeAttr(item.id || '') + '" data-action="deactivate">Deactivate</button> ';
      } else {
        html += '<button class="cc-btn cc-btn-sm cc-btn-success-outline cc-form-toggle-btn" data-form-id="' + escapeAttr(item.id || '') + '" data-action="activate">Activate</button> ';
      }
      html += '<button class="cc-btn cc-btn-sm cc-btn-danger cc-form-delete-btn" data-form-id="' + escapeAttr(item.id || '') + '" data-form-name="' + escapeAttr(name) + '" style="margin-left:2px;">Delete</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += '</div>';
    content.innerHTML = html;

    bindFormsAddBtn();
    bindFormsTableEvents();
  }

  function bindFormsAddBtn() {
    var btn = document.getElementById('cc-forms-add-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      state.formEditorMode = 'create';
      state.formEditorData = {
        name: '', form_id: '', practice_area: '', description: '',
        submit_message: '', is_active: true, settings_json: '{}',
        automations_json: '[]', sections: []
      };
      state.formSectionExpanded = {};
      renderFormsTab();
    });
  }

  function bindFormsTableEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Edit buttons
    content.querySelectorAll('.cc-form-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var slug = btn.dataset.formSlug;
        try {
          showToast('Loading form...', 'info');
          var result = await API.forms.get(slug);
          state.formEditorMode = 'edit';
          state.formEditorData = result.config || result.data || result;
          state.formSectionExpanded = {};
          renderFormsTab();
        } catch (err) {
          showToast(err.error || 'Failed to load form.', 'error');
        }
      });
    });

    // Row click → edit
    content.querySelectorAll('.cc-form-row').forEach(function(row) {
      row.addEventListener('click', async function(e) {
        if (e.target.closest('button')) return;
        var slug = row.dataset.formSlug;
        try {
          showToast('Loading form...', 'info');
          var result = await API.forms.get(slug);
          state.formEditorMode = 'edit';
          state.formEditorData = result.config || result.data || result;
          state.formSectionExpanded = {};
          renderFormsTab();
        } catch (err) {
          showToast(err.error || 'Failed to load form.', 'error');
        }
      });
    });

    // Duplicate buttons
    content.querySelectorAll('.cc-form-dup-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var formId = btn.dataset.formId;
        var formName = btn.dataset.formName;
        var formSlug = btn.dataset.formSlug;
        try {
          await API.forms.duplicate(formId, formName + ' (Copy)', formSlug + '-copy');
          showToast('Form duplicated.', 'success');
          fetchForms();
        } catch (err) {
          showToast(err.error || 'Failed to duplicate form.', 'error');
        }
      });
    });

    // Toggle (activate/deactivate) buttons
    content.querySelectorAll('.cc-form-toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var formId = btn.dataset.formId;
        var action = btn.dataset.action;
        var newActive = action === 'activate';
        var verb = newActive ? 'Activate' : 'Deactivate';
        if (!confirm(verb + ' this form?')) return;
        try {
          await API.forms.update(formId, { is_active: newActive });
          showToast('Form ' + verb.toLowerCase() + 'd.', 'success');
          fetchForms();
        } catch (err) {
          showToast(err.error || 'Failed to ' + verb.toLowerCase() + '.', 'error');
        }
      });
    });

    // Delete buttons
    content.querySelectorAll('.cc-form-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var formId = btn.dataset.formId;
        var formName = btn.dataset.formName;
        if (!confirm('Permanently delete "' + formName + '"?\n\nThis will remove the form and all its sections, fields, and submissions. This action cannot be undone.')) return;
        if (!confirm('Are you sure? This is irreversible.')) return;
        try {
          await API.forms.delete(formId);
          showToast('Form deleted.', 'success');
          fetchForms();
        } catch (err) {
          showToast(err.error || 'Failed to delete form.', 'error');
        }
      });
    });
  }

  // ─── Form Editor ─────────────────────────────────────────

  function renderFormEditor() {
    var content = $el('cc-admin-content');
    if (!content) return;
    var fd = state.formEditorData;
    if (!fd) return;

    // Prefetch drip campaigns for enroll_drip automation dropdown
    if (!state.dripCampaigns.length && !state._dripFetched) {
      state._dripFetched = true;
      API.campaigns.list().then(function(r) {
        state.dripCampaigns = (r.campaigns || [])
          .filter(function(c) { return (c.type || c.Type || '').toUpperCase() === 'DRIP'; })
          .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
        if (state.formEditorMode === 'edit' || state.formEditorMode === 'create') renderFormEditor();
      }).catch(function() {});
    }

    var isNew = state.formEditorMode === 'create';
    var title = isNew ? 'New Form' : escapeHtml(fd.name || 'Edit Form');
    var sections = fd.sections || [];
    var settings = {};
    try { settings = typeof fd.settings_json === 'string' ? JSON.parse(fd.settings_json || '{}') : (fd.settings_json || {}); } catch(e) { settings = {}; }
    var automations = [];
    try { automations = typeof fd.automations_json === 'string' ? JSON.parse(fd.automations_json || '[]') : (fd.automations_json || []); } catch(e) { automations = []; }
    var branding = settings.branding || {};

    var html = '';

    // ─ Header bar
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">';
    html += '<div style="display:flex;align-items:center;gap:12px;">';
    html += '<button id="cc-form-back-btn" class="cc-btn cc-btn-outline cc-btn-sm">&larr; Back to Forms</button>';
    html += '<h3 style="margin:0;font-size:18px;font-weight:600;color:#1e293b;">' + title + '</h3>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;">';
    if (!isNew && fd.form_id) {
      html += '<button id="cc-form-preview-btn" class="cc-btn cc-btn-outline cc-btn-sm">Preview</button>';
    }
    html += '<button id="cc-form-save-btn" class="cc-btn cc-btn-primary cc-btn-sm">Save</button>';
    html += '</div>';
    html += '</div>';

    // ─ Settings panel
    html += '<div class="cc-form-settings" style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';
    html += '<h4 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#334155;">Form Settings</h4>';
    html += '<div class="cc-form-settings-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">';

    // Name
    html += '<div>';
    html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Name</label>';
    html += '<input type="text" id="cc-form-name" class="cc-input" value="' + escapeAttr(fd.name || '') + '" placeholder="Form name">';
    html += '</div>';

    // Form ID / slug
    html += '<div>';
    html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Form ID (slug)</label>';
    html += '<input type="text" id="cc-form-slug" class="cc-input" value="' + escapeAttr(fd.form_id || '') + '" placeholder="auto-generated-from-name">';
    html += '</div>';

    // Practice Area
    html += '<div>';
    html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Practice Area</label>';
    html += '<select id="cc-form-practice-area" class="cc-input">';
    html += '<option value="">— Select —</option>';
    FORM_PRACTICE_AREAS.forEach(function(pa) {
      var sel = (fd.practice_area === pa.key) ? ' selected' : '';
      html += '<option value="' + escapeAttr(pa.key) + '"' + sel + '>' + escapeHtml(pa.label) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Active toggle
    html += '<div style="display:flex;align-items:center;gap:8px;padding-top:20px;">';
    html += '<input type="checkbox" id="cc-form-active"' + (fd.is_active !== false ? ' checked' : '') + '>';
    html += '<label for="cc-form-active" style="font-size:13px;font-weight:500;color:#475569;">Active</label>';
    html += '</div>';

    // Description (full width)
    html += '<div style="grid-column:1/-1;">';
    html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Description</label>';
    html += '<textarea id="cc-form-description" class="cc-input" rows="2" placeholder="Brief description of this form">' + escapeHtml(fd.description || '') + '</textarea>';
    html += '</div>';

    // Submit Message (full width)
    html += '<div style="grid-column:1/-1;">';
    html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Submit Message</label>';
    html += '<textarea id="cc-form-submit-message" class="cc-input" rows="2" placeholder="Custom thank-you message...">' + escapeHtml(fd.submit_message || '') + '</textarea>';
    html += '</div>';

    // Accent Color
    html += '<div>';
    html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Accent Color</label>';
    html += '<input type="color" id="cc-form-accent-color" class="cc-input" value="' + escapeAttr(branding.accent_color || '#2563eb') + '" style="width:60px;height:36px;padding:2px;cursor:pointer;">';
    html += '</div>';

    html += '</div>'; // end grid
    html += '</div>'; // end settings panel

    // ─ Sections & Steps Builder
    html += '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';
    html += '<h4 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#334155;">Sections &amp; Steps</h4>';

    if (sections.length === 0) {
      html += '<div class="cc-empty" style="padding:24px;text-align:center;"><p>No sections yet. Add a section to start building.</p></div>';
    }

    sections.forEach(function(section, si) {
      var secId = section.id || section.section_id || ('sec-' + si);
      var expanded = !!state.formSectionExpanded[secId];
      var steps = section.steps || [];

      html += '<div class="cc-form-section-card" data-section-idx="' + si + '" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px;overflow:hidden;">';

      // Section header
      html += '<div class="cc-form-section-header" data-section-id="' + escapeAttr(secId) + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;cursor:pointer;user-select:none;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span style="display:inline-block;transition:transform .2s;transform:rotate(' + (expanded ? '90' : '0') + 'deg);font-size:12px;color:#64748b;">&#9654;</span>';
      html += '<span style="font-weight:600;font-size:14px;color:#334155;">' + escapeHtml(section.title || 'Untitled Section') + '</span>';
      html += '<span style="color:#94a3b8;font-size:13px;">(' + steps.length + ' step' + (steps.length !== 1 ? 's' : '') + ')</span>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px;" onclick="event.stopPropagation()">';
      if (si > 0) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-section-up" data-section-idx="' + si + '" title="Move up">&uarr;</button>';
      if (si < sections.length - 1) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-section-down" data-section-idx="' + si + '" title="Move down">&darr;</button>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-section-edit" data-section-idx="' + si + '" title="Edit section">&#9998;</button>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-form-section-delete" data-section-idx="' + si + '" title="Delete section">&times;</button>';
      html += '</div>';
      html += '</div>';

      // Section body (steps) — only if expanded
      if (expanded) {
        html += '<div style="padding:12px 14px;">';

        steps.forEach(function(step, sti) {
          var fields = step.fields || [];
          html += '<div class="cc-form-step-card" data-section-idx="' + si + '" data-step-idx="' + sti + '" style="border:1px solid #e2e8f0;border-radius:6px;margin-bottom:10px;overflow:hidden;">';

          // Step header
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f1f5f9;">';
          html += '<div style="display:flex;align-items:center;gap:8px;">';
          html += '<span style="font-weight:500;font-size:13px;color:#475569;">' + escapeHtml(step.title || 'Untitled Step') + '</span>';
          html += '<span class="cc-badge cc-badge-gray" style="font-size:11px;">' + fields.length + ' field' + (fields.length !== 1 ? 's' : '') + '</span>';
          html += '</div>';
          html += '<div style="display:flex;gap:4px;">';
          if (sti > 0) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-step-up" data-section-idx="' + si + '" data-step-idx="' + sti + '" title="Move up">&uarr;</button>';
          if (sti < steps.length - 1) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-step-down" data-section-idx="' + si + '" data-step-idx="' + sti + '" title="Move down">&darr;</button>';
          html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-form-step-delete" data-section-idx="' + si + '" data-step-idx="' + sti + '" title="Delete step">&times;</button>';
          html += '</div>';
          html += '</div>';

          // Fields
          html += '<div style="padding:8px 12px;">';
          if (fields.length === 0) {
            html += '<p style="color:#94a3b8;font-size:13px;margin:4px 0;">No fields yet.</p>';
          }
          fields.forEach(function(field, fi) {
            var typeLabel = (FORM_FIELD_TYPES.find(function(t) { return t.key === field.type; }) || {}).label || field.type || 'Unknown';
            html += '<div class="cc-form-field-item" style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">';
            html += '<div style="display:flex;align-items:center;gap:8px;">';
            html += '<span class="cc-badge cc-badge-blue" style="font-size:10px;text-transform:uppercase;">' + escapeHtml(typeLabel) + '</span>';
            html += '<span style="font-size:13px;color:#334155;">' + escapeHtml(field.label || field.field_id || '') + '</span>';
            if (field.required) html += ' <span class="cc-badge cc-badge-red" style="font-size:10px;">Required</span>';
            html += '</div>';
            html += '<div style="display:flex;gap:4px;">';
            html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-field-edit" data-section-idx="' + si + '" data-step-idx="' + sti + '" data-field-idx="' + fi + '" title="Edit field">&#9998;</button>';
            html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-form-field-delete" data-section-idx="' + si + '" data-step-idx="' + sti + '" data-field-idx="' + fi + '" title="Delete field">&times;</button>';
            html += '</div>';
            html += '</div>';
          });
          html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-add-field" data-section-idx="' + si + '" data-step-idx="' + sti + '" style="margin-top:8px;">+ Add Field</button>';
          html += '</div>'; // end fields
          html += '</div>'; // end step card
        });

        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-form-add-step" data-section-idx="' + si + '" style="margin-top:4px;">+ Add Step</button>';
        html += '</div>'; // end section body
      }

      html += '</div>'; // end section card
    });

    html += '<button id="cc-form-add-section" class="cc-btn cc-btn-sm cc-btn-outline" style="margin-top:8px;">+ Add Section</button>';
    html += '</div>'; // end sections panel

    // ─ Automations panel
    html += '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';
    html += '<h4 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#334155;">Automations</h4>';
    html += '<p style="color:#64748b;font-size:13px;margin:0 0 16px;">Configure actions that run when this form is submitted.</p>';

    AUTOMATION_TYPES.forEach(function(at) {
      var existing = automations.find(function(a) { return a.type === at.type; });
      var enabled = !!existing;

      html += '<div class="cc-automation-card" style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:10px;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:' + (enabled ? '10' : '0') + 'px;">';
      html += '<div>';
      html += '<span style="font-weight:600;font-size:14px;color:#334155;">' + escapeHtml(at.label) + '</span>';
      html += '<p style="color:#64748b;font-size:12px;margin:2px 0 0;">' + escapeHtml(at.desc) + '</p>';
      html += '</div>';
      html += '<label style="display:flex;align-items:center;cursor:pointer;gap:6px;">';
      html += '<input type="checkbox" class="cc-form-auto-toggle" data-auto-type="' + escapeAttr(at.type) + '"' + (enabled ? ' checked' : '') + '>';
      html += '<span style="font-size:12px;color:#64748b;">' + (enabled ? 'On' : 'Off') + '</span>';
      html += '</label>';
      html += '</div>';

      // Config fields when enabled
      if (enabled) {
        var config = existing.config || {};
        html += '<div class="cc-auto-config" data-auto-type="' + escapeAttr(at.type) + '" style="padding-top:10px;border-top:1px solid #f1f5f9;">';

        if (at.type === 'notify_staff') {
          html += '<div style="margin-bottom:8px;">';
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Notify Users</label>';
          var staffUsers = state.users || state.staffList || [];
          staffUsers.forEach(function(u) {
            var uName = u.Name || u.name || '';
            var uId = u.id || '';
            var checked = (config.user_ids || []).indexOf(uId) !== -1 ? ' checked' : '';
            html += '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:4px;">';
            html += '<input type="checkbox" class="cc-auto-notify-user" data-user-id="' + escapeAttr(uId) + '"' + checked + '>';
            html += escapeHtml(uName);
            html += '</label>';
          });
          html += '</div>';
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Subject Template</label>';
          html += '<input type="text" class="cc-input cc-auto-notify-subject" value="' + escapeAttr(config.subject || 'New {{form_name}} submission from {{client_name}}') + '" placeholder="New {{form_name}} submission from {{client_name}}">';
        }

        if (at.type === 'update_stage') {
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Target Stage</label>';
          html += '<select class="cc-input cc-auto-stage-select">';
          STAGE_OPTIONS.forEach(function(s) {
            var sel = config.stage === s.key ? ' selected' : '';
            html += '<option value="' + escapeAttr(s.key) + '"' + sel + '>' + escapeHtml(s.label) + '</option>';
          });
          html += '</select>';
        }

        if (at.type === 'log_activity') {
          html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
          html += '<div>';
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Activity Type</label>';
          html += '<input type="text" class="cc-input cc-auto-activity-type" value="' + escapeAttr(config.activity_type || 'Form Submission') + '" placeholder="Form Submission">';
          html += '</div>';
          html += '<div>';
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Subject Template</label>';
          html += '<input type="text" class="cc-input cc-auto-activity-subject" value="' + escapeAttr(config.subject || '{{form_name}} submitted by {{client_name}}') + '" placeholder="{{form_name}} submitted by {{client_name}}">';
          html += '</div>';
          html += '</div>';
        }

        if (at.type === 'assign_owner') {
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Assign To</label>';
          html += '<select class="cc-input cc-auto-assign-select">';
          html += '<option value="">— Select User —</option>';
          var staffUsers2 = state.users || state.staffList || [];
          staffUsers2.forEach(function(u) {
            var sel = config.user_id === (u.id || '') ? ' selected' : '';
            html += '<option value="' + escapeAttr(u.id || '') + '"' + sel + '>' + escapeHtml(u.Name || u.name || '') + '</option>';
          });
          html += '</select>';
        }

        if (at.type === 'send_confirmation') {
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Template ID</label>';
          html += '<input type="text" class="cc-input cc-auto-confirm-template" value="' + escapeAttr(config.template_id || '') + '" placeholder="Email template ID or name">';
        }

        if (at.type === 'create_task') {
          html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
          html += '<div>';
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Task Title</label>';
          html += '<input type="text" class="cc-input cc-auto-task-title" value="' + escapeAttr(config.title || 'Follow up: {{form_name}} - {{client_name}}') + '" placeholder="Follow up: {{form_name}} - {{client_name}}">';
          html += '</div>';
          html += '<div>';
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Due In (days)</label>';
          html += '<input type="number" class="cc-input cc-auto-task-days" value="' + escapeAttr(String(config.due_days || 1)) + '" min="0">';
          html += '</div>';
          html += '</div>';
          html += '<div style="margin-top:8px;">';
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Assign To</label>';
          html += '<select class="cc-input cc-auto-task-assign">';
          html += '<option value="owner"' + (config.assign_to === 'owner' || !config.assign_to ? ' selected' : '') + '>Lead Owner</option>';
          var staffUsers3 = state.users || state.staffList || [];
          staffUsers3.forEach(function(u) {
            var sel = config.assign_to === (u.id || '') ? ' selected' : '';
            html += '<option value="' + escapeAttr(u.id || '') + '"' + sel + '>' + escapeHtml(u.Name || u.name || '') + '</option>';
          });
          html += '</select>';
          html += '</div>';
        }

        if (at.type === 'enroll_drip') {
          html += '<label style="display:block;font-size:12px;font-weight:500;color:#475569;margin-bottom:4px;">Drip Campaign</label>';
          html += '<select class="cc-input cc-auto-drip-campaign">';
          html += '<option value="">— Select Campaign —</option>';
          var dripCamps = state.dripCampaigns || [];
          dripCamps.forEach(function(c) {
            var cName = c.Name || c.name || '';
            var cId = c.id || '';
            var sel = config.campaign_id === cId ? ' selected' : '';
            html += '<option value="' + escapeAttr(cId) + '"' + sel + '>' + escapeHtml(cName) + '</option>';
          });
          html += '</select>';
          if (config.campaign_id) {
            html += '<a href="/crm/campaigns?id=' + escapeAttr(config.campaign_id) + '" target="_blank" style="display:inline-block;margin-top:8px;font-size:13px;color:#2563EB;text-decoration:none;">Configure Campaign Steps &rarr;</a>';
          }
        }

        html += '</div>'; // end auto config
      }

      html += '</div>'; // end automation card
    });

    html += '</div>'; // end automations panel

    content.innerHTML = html;
    bindFormEditorEvents();
  }

  function collectFormEditorData() {
    var fd = state.formEditorData;
    if (!fd) return null;

    fd.name = (document.getElementById('cc-form-name') || {}).value || '';
    fd.form_id = (document.getElementById('cc-form-slug') || {}).value || '';
    fd.practice_area = (document.getElementById('cc-form-practice-area') || {}).value || '';
    fd.is_active = !!(document.getElementById('cc-form-active') || {}).checked;
    fd.description = (document.getElementById('cc-form-description') || {}).value || '';
    fd.submit_message = (document.getElementById('cc-form-submit-message') || {}).value || '';

    // Collect accent color into settings_json
    var settings = {};
    try { settings = typeof fd.settings_json === 'string' ? JSON.parse(fd.settings_json || '{}') : (fd.settings_json || {}); } catch(e) { settings = {}; }
    var accentEl = document.getElementById('cc-form-accent-color');
    if (accentEl) {
      if (!settings.branding) settings.branding = {};
      settings.branding.accent_color = accentEl.value;
    }
    fd.settings_json = JSON.stringify(settings);

    // Collect automations from the UI
    var autos = [];
    var content = $el('cc-admin-content');
    if (content) {
      content.querySelectorAll('.cc-form-auto-toggle').forEach(function(toggle) {
        if (!toggle.checked) return;
        var autoType = toggle.dataset.autoType;
        var config = {};
        var configEl = content.querySelector('.cc-auto-config[data-auto-type="' + autoType + '"]');

        if (autoType === 'notify_staff' && configEl) {
          config.user_ids = [];
          configEl.querySelectorAll('.cc-auto-notify-user:checked').forEach(function(cb) {
            config.user_ids.push(cb.dataset.userId);
          });
          var subjectEl = configEl.querySelector('.cc-auto-notify-subject');
          if (subjectEl) config.subject = subjectEl.value;
        }
        if (autoType === 'update_stage' && configEl) {
          var stageEl = configEl.querySelector('.cc-auto-stage-select');
          if (stageEl) config.stage = stageEl.value;
        }
        if (autoType === 'log_activity' && configEl) {
          var atEl = configEl.querySelector('.cc-auto-activity-type');
          if (atEl) config.activity_type = atEl.value;
          var asEl = configEl.querySelector('.cc-auto-activity-subject');
          if (asEl) config.subject = asEl.value;
        }
        if (autoType === 'assign_owner' && configEl) {
          var aoEl = configEl.querySelector('.cc-auto-assign-select');
          if (aoEl) config.user_id = aoEl.value;
        }
        if (autoType === 'send_confirmation' && configEl) {
          var tplEl = configEl.querySelector('.cc-auto-confirm-template');
          if (tplEl) config.template_id = tplEl.value;
        }
        if (autoType === 'create_task' && configEl) {
          var ttEl = configEl.querySelector('.cc-auto-task-title');
          if (ttEl) config.title = ttEl.value;
          var tdEl = configEl.querySelector('.cc-auto-task-days');
          if (tdEl) config.due_days = parseInt(tdEl.value, 10) || 1;
          var taEl = configEl.querySelector('.cc-auto-task-assign');
          if (taEl) config.assign_to = taEl.value;
        }
        if (autoType === 'enroll_drip' && configEl) {
          var dcEl = configEl.querySelector('.cc-auto-drip-campaign');
          if (dcEl) config.campaign_id = dcEl.value;
        }

        autos.push({ type: autoType, config: config });
      });
    }
    fd.automations_json = JSON.stringify(autos);
    return fd;
  }

  function bindFormEditorEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Back button
    var backBtn = document.getElementById('cc-form-back-btn');
    if (backBtn) backBtn.addEventListener('click', function() {
      state.formEditorMode = null;
      state.formEditorData = null;
      state.formSectionExpanded = {};
      renderFormsTab();
    });

    // Preview button
    var previewBtn = document.getElementById('cc-form-preview-btn');
    if (previewBtn) previewBtn.addEventListener('click', function() {
      var slug = (document.getElementById('cc-form-slug') || {}).value || state.formEditorData.form_id || '';
      window.open('/intake?form=' + encodeURIComponent(slug) + '&preview=1', '_blank');
    });

    // Save button
    var saveBtn = document.getElementById('cc-form-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', async function() {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        var fd = collectFormEditorData();
        if (!fd.name || !fd.name.trim()) throw { error: 'Form Name is required.' };
        if (!fd.form_id || !fd.form_id.trim()) throw { error: 'Form ID is required.' };
        if (!/^[a-z0-9][a-z0-9-]*$/.test(fd.form_id.trim())) throw { error: 'Form ID must be lowercase letters, numbers, and hyphens only.' };

        if (state.formEditorMode === 'create') {
          var result = await API.forms.create(fd);
          showToast('Form created.', 'success');
          // Switch to edit mode with returned data
          state.formEditorMode = 'edit';
          state.formEditorData = result.config || result.data || result;
        } else {
          await API.forms.update(fd.id, fd);
          showToast('Form saved.', 'success');
        }
      } catch (err) {
        showToast(err.error || 'Failed to save form.', 'error');
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    });

    // Auto-slug from name
    var nameInput = document.getElementById('cc-form-name');
    var slugInput = document.getElementById('cc-form-slug');
    if (nameInput && slugInput && state.formEditorMode === 'create') {
      nameInput.addEventListener('input', function() {
        slugInput.value = slugify(nameInput.value);
      });
    }

    // Section header click → toggle expand
    content.querySelectorAll('.cc-form-section-header').forEach(function(hdr) {
      hdr.addEventListener('click', function() {
        var secId = hdr.dataset.sectionId;
        state.formSectionExpanded[secId] = !state.formSectionExpanded[secId];
        // Collect current form data before re-render
        collectFormEditorData();
        renderFormEditor();
      });
    });

    // Section sort (up/down)
    content.querySelectorAll('.cc-form-section-up').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.sectionIdx, 10);
        collectFormEditorData();
        var secs = state.formEditorData.sections;
        if (idx > 0 && idx < secs.length) {
          var tmp = secs[idx];
          secs[idx] = secs[idx - 1];
          secs[idx - 1] = tmp;
        }
        renderFormEditor();
      });
    });
    content.querySelectorAll('.cc-form-section-down').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.sectionIdx, 10);
        collectFormEditorData();
        var secs = state.formEditorData.sections;
        if (idx >= 0 && idx < secs.length - 1) {
          var tmp = secs[idx];
          secs[idx] = secs[idx + 1];
          secs[idx + 1] = tmp;
        }
        renderFormEditor();
      });
    });

    // Section edit
    content.querySelectorAll('.cc-form-section-edit').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.sectionIdx, 10);
        collectFormEditorData();
        var section = state.formEditorData.sections[idx];
        if (!section) return;
        var newTitle = prompt('Section title:', section.title || '');
        if (newTitle !== null) {
          section.title = newTitle;
          renderFormEditor();
        }
      });
    });

    // Section delete
    content.querySelectorAll('.cc-form-section-delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.sectionIdx, 10);
        if (!confirm('Delete this section and all its steps/fields?')) return;
        collectFormEditorData();
        state.formEditorData.sections.splice(idx, 1);
        renderFormEditor();
      });
    });

    // Add section
    var addSecBtn = document.getElementById('cc-form-add-section');
    if (addSecBtn) addSecBtn.addEventListener('click', function() {
      var title = prompt('Section title:', '');
      if (!title) return;
      var secId = slugify(title) || ('section-' + Date.now());
      collectFormEditorData();
      state.formEditorData.sections.push({
        id: secId, section_id: secId, title: title, steps: []
      });
      state.formSectionExpanded[secId] = true;
      renderFormEditor();
    });

    // Add step
    content.querySelectorAll('.cc-form-add-step').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sIdx = parseInt(btn.dataset.sectionIdx, 10);
        var title = prompt('Step title:', '');
        if (!title) return;
        var stepId = slugify(title) || ('step-' + Date.now());
        collectFormEditorData();
        var section = state.formEditorData.sections[sIdx];
        if (!section) return;
        if (!section.steps) section.steps = [];
        section.steps.push({ id: stepId, step_id: stepId, title: title, fields: [] });
        renderFormEditor();
      });
    });

    // Step sort (up/down)
    content.querySelectorAll('.cc-form-step-up').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sIdx = parseInt(btn.dataset.sectionIdx, 10);
        var stIdx = parseInt(btn.dataset.stepIdx, 10);
        collectFormEditorData();
        var steps = (state.formEditorData.sections[sIdx] || {}).steps || [];
        if (stIdx > 0 && stIdx < steps.length) {
          var tmp = steps[stIdx];
          steps[stIdx] = steps[stIdx - 1];
          steps[stIdx - 1] = tmp;
        }
        renderFormEditor();
      });
    });
    content.querySelectorAll('.cc-form-step-down').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sIdx = parseInt(btn.dataset.sectionIdx, 10);
        var stIdx = parseInt(btn.dataset.stepIdx, 10);
        collectFormEditorData();
        var steps = (state.formEditorData.sections[sIdx] || {}).steps || [];
        if (stIdx >= 0 && stIdx < steps.length - 1) {
          var tmp = steps[stIdx];
          steps[stIdx] = steps[stIdx + 1];
          steps[stIdx + 1] = tmp;
        }
        renderFormEditor();
      });
    });

    // Step delete
    content.querySelectorAll('.cc-form-step-delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sIdx = parseInt(btn.dataset.sectionIdx, 10);
        var stIdx = parseInt(btn.dataset.stepIdx, 10);
        if (!confirm('Delete this step and all its fields?')) return;
        collectFormEditorData();
        var steps = (state.formEditorData.sections[sIdx] || {}).steps || [];
        steps.splice(stIdx, 1);
        renderFormEditor();
      });
    });

    // Add field
    content.querySelectorAll('.cc-form-add-field').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sIdx = parseInt(btn.dataset.sectionIdx, 10);
        var stIdx = parseInt(btn.dataset.stepIdx, 10);
        collectFormEditorData();
        showFieldEditorModal(sIdx, stIdx, null, null);
      });
    });

    // Edit field
    content.querySelectorAll('.cc-form-field-edit').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sIdx = parseInt(btn.dataset.sectionIdx, 10);
        var stIdx = parseInt(btn.dataset.stepIdx, 10);
        var fIdx = parseInt(btn.dataset.fieldIdx, 10);
        collectFormEditorData();
        var field = ((state.formEditorData.sections[sIdx] || {}).steps || [])[stIdx];
        var existingField = field ? (field.fields || [])[fIdx] : null;
        showFieldEditorModal(sIdx, stIdx, fIdx, existingField);
      });
    });

    // Delete field
    content.querySelectorAll('.cc-form-field-delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sIdx = parseInt(btn.dataset.sectionIdx, 10);
        var stIdx = parseInt(btn.dataset.stepIdx, 10);
        var fIdx = parseInt(btn.dataset.fieldIdx, 10);
        if (!confirm('Delete this field?')) return;
        collectFormEditorData();
        var step = ((state.formEditorData.sections[sIdx] || {}).steps || [])[stIdx];
        if (step && step.fields) step.fields.splice(fIdx, 1);
        renderFormEditor();
      });
    });

    // Automation toggles
    content.querySelectorAll('.cc-form-auto-toggle').forEach(function(toggle) {
      toggle.addEventListener('change', function() {
        collectFormEditorData();
        // Re-parse automations after collection, then toggle
        var autos = [];
        try { autos = JSON.parse(state.formEditorData.automations_json || '[]'); } catch(e) { autos = []; }
        var autoType = toggle.dataset.autoType;
        if (toggle.checked) {
          // Add if not present
          var exists = autos.find(function(a) { return a.type === autoType; });
          if (!exists) autos.push({ type: autoType, config: {} });
        } else {
          // Remove
          autos = autos.filter(function(a) { return a.type !== autoType; });
        }
        state.formEditorData.automations_json = JSON.stringify(autos);
        renderFormEditor();
      });
    });
  }

  // ─── Field Editor Modal ──────────────────────────────────

  function showFieldEditorModal(sectionIdx, stepIdx, fieldIdx, existingField) {
    var isEdit = existingField !== null && existingField !== undefined;
    var f = existingField || {};
    var modalTitle = isEdit ? 'Edit Field' : 'Add Field';

    // Gather all field IDs in the form for conditional logic dropdown
    var allFieldIds = [];
    (state.formEditorData.sections || []).forEach(function(sec) {
      (sec.steps || []).forEach(function(step) {
        (step.fields || []).forEach(function(fld) {
          if (fld.field_id) allFieldIds.push(fld.field_id);
        });
      });
    });

    var condition = f.condition || {};

    var bodyHtml = '';

    // Type
    bodyHtml += '<div style="margin-bottom:12px;">';
    bodyHtml += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Type</label>';
    bodyHtml += '<select id="cc-field-type" class="cc-input">';
    FORM_FIELD_TYPES.forEach(function(t) {
      var sel = f.type === t.key ? ' selected' : '';
      bodyHtml += '<option value="' + escapeAttr(t.key) + '"' + sel + '>' + escapeHtml(t.label) + '</option>';
    });
    bodyHtml += '</select>';
    bodyHtml += '</div>';

    // Field ID
    bodyHtml += '<div style="margin-bottom:12px;">';
    bodyHtml += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Field ID</label>';
    bodyHtml += '<input type="text" id="cc-field-id" class="cc-input" value="' + escapeAttr(f.field_id || '') + '" placeholder="auto-from-label">';
    bodyHtml += '</div>';

    // Label
    bodyHtml += '<div style="margin-bottom:12px;">';
    bodyHtml += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Label</label>';
    bodyHtml += '<input type="text" id="cc-field-label" class="cc-input" value="' + escapeAttr(f.label || '') + '">';
    bodyHtml += '</div>';

    // Description
    bodyHtml += '<div style="margin-bottom:12px;">';
    bodyHtml += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Description</label>';
    bodyHtml += '<textarea id="cc-field-description" class="cc-input" rows="2">' + escapeHtml(f.description || '') + '</textarea>';
    bodyHtml += '</div>';

    // Placeholder
    bodyHtml += '<div style="margin-bottom:12px;">';
    bodyHtml += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Placeholder</label>';
    bodyHtml += '<input type="text" id="cc-field-placeholder" class="cc-input" value="' + escapeAttr(f.placeholder || '') + '">';
    bodyHtml += '</div>';

    // Required
    bodyHtml += '<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">';
    bodyHtml += '<input type="checkbox" id="cc-field-required"' + (f.required ? ' checked' : '') + '>';
    bodyHtml += '<label for="cc-field-required" style="font-size:13px;font-weight:500;color:#475569;">Required</label>';
    bodyHtml += '</div>';

    // Conditional logic
    bodyHtml += '<div style="margin-bottom:12px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">';
    bodyHtml += '<label style="display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:8px;">Conditional Logic (optional)</label>';
    bodyHtml += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">';

    bodyHtml += '<div>';
    bodyHtml += '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:2px;">Field</label>';
    bodyHtml += '<select id="cc-field-cond-field" class="cc-input">';
    bodyHtml += '<option value="">— None —</option>';
    allFieldIds.forEach(function(fid) {
      var sel = condition.field === fid ? ' selected' : '';
      bodyHtml += '<option value="' + escapeAttr(fid) + '"' + sel + '>' + escapeHtml(fid) + '</option>';
    });
    bodyHtml += '</select>';
    bodyHtml += '</div>';

    bodyHtml += '<div>';
    bodyHtml += '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:2px;">Operator</label>';
    bodyHtml += '<select id="cc-field-cond-op" class="cc-input">';
    ['eq', 'neq', 'in', 'truthy', 'falsy'].forEach(function(op) {
      var sel = condition.op === op ? ' selected' : '';
      bodyHtml += '<option value="' + op + '"' + sel + '>' + op + '</option>';
    });
    bodyHtml += '</select>';
    bodyHtml += '</div>';

    bodyHtml += '<div>';
    bodyHtml += '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:2px;">Value</label>';
    bodyHtml += '<input type="text" id="cc-field-cond-value" class="cc-input" value="' + escapeAttr(condition.value || '') + '">';
    bodyHtml += '</div>';

    bodyHtml += '</div>'; // end grid
    bodyHtml += '</div>'; // end conditional

    // Type-specific section
    bodyHtml += '<div id="cc-field-type-specific" style="margin-bottom:12px;">';
    bodyHtml += renderFieldTypeSpecific(f.type || 'short_text', f);
    bodyHtml += '</div>';

    showModal(modalTitle, bodyHtml, async function(formEl) {
      var fieldData = {
        type: (formEl.querySelector('#cc-field-type') || {}).value || 'short_text',
        field_id: (formEl.querySelector('#cc-field-id') || {}).value || '',
        label: (formEl.querySelector('#cc-field-label') || {}).value || '',
        description: (formEl.querySelector('#cc-field-description') || {}).value || '',
        placeholder: (formEl.querySelector('#cc-field-placeholder') || {}).value || '',
        required: !!(formEl.querySelector('#cc-field-required') || {}).checked
      };

      // Auto-generate field_id from label if empty
      if (!fieldData.field_id) fieldData.field_id = slugify(fieldData.label);

      // Conditional logic
      var condField = (formEl.querySelector('#cc-field-cond-field') || {}).value;
      if (condField) {
        fieldData.condition = {
          field: condField,
          op: (formEl.querySelector('#cc-field-cond-op') || {}).value || 'eq',
          value: (formEl.querySelector('#cc-field-cond-value') || {}).value || ''
        };
      }

      // Type-specific data
      if (fieldData.type === 'multiple_choice' || fieldData.type === 'select' || fieldData.type === 'checkbox_group') {
        fieldData.options = collectFieldOptions(formEl);
      }
      if (fieldData.type === 'long_text') {
        fieldData.rows = parseInt((formEl.querySelector('#cc-field-rows') || {}).value, 10) || 4;
      }
      if (fieldData.type === 'yes_no') {
        fieldData.yes_label = (formEl.querySelector('#cc-field-yes-label') || {}).value || 'Yes';
        fieldData.no_label = (formEl.querySelector('#cc-field-no-label') || {}).value || 'No';
      }

      // Save to local state
      var step = ((state.formEditorData.sections[sectionIdx] || {}).steps || [])[stepIdx];
      if (!step) return;
      if (!step.fields) step.fields = [];

      if (isEdit && fieldIdx !== null) {
        // Preserve any extra properties from existing field
        step.fields[fieldIdx] = Object.assign({}, step.fields[fieldIdx], fieldData);
      } else {
        step.fields.push(fieldData);
      }

      closeModal();
      renderFormEditor();
    });

    // Bind type change to show/hide type-specific fields
    var typeSelect = document.querySelector('#cc-field-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', function() {
        var specific = document.getElementById('cc-field-type-specific');
        if (specific) specific.innerHTML = renderFieldTypeSpecific(typeSelect.value, f);
      });
    }

    // Auto-generate field_id from label
    var labelInput = document.querySelector('#cc-field-label');
    var fieldIdInput = document.querySelector('#cc-field-id');
    if (labelInput && fieldIdInput && !isEdit) {
      labelInput.addEventListener('input', function() {
        fieldIdInput.value = slugify(labelInput.value);
      });
    }
  }

  function renderFieldTypeSpecific(type, fieldData) {
    var html = '';
    fieldData = fieldData || {};

    if (type === 'multiple_choice' || type === 'select' || type === 'checkbox_group') {
      var options = fieldData.options || [];
      html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Options</label>';
      html += '<div id="cc-field-options-list">';
      if (options.length === 0) {
        html += '<p style="color:#94a3b8;font-size:12px;">No options yet. Click "Add Option" to start.</p>';
      }
      options.forEach(function(opt, oi) {
        html += '<div class="cc-field-option-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">';
        html += '<input type="text" class="cc-input cc-field-opt-value" value="' + escapeAttr(opt.value || '') + '" placeholder="Value" style="flex:1;">';
        html += '<input type="text" class="cc-input cc-field-opt-label" value="' + escapeAttr(opt.label || '') + '" placeholder="Label" style="flex:1;">';
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-field-opt-remove" data-opt-idx="' + oi + '">&times;</button>';
        html += '</div>';
      });
      html += '</div>';
      html += '<button id="cc-field-add-option" class="cc-btn cc-btn-sm cc-btn-outline" style="margin-top:4px;">+ Add Option</button>';
    }

    if (type === 'long_text') {
      html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Rows</label>';
      html += '<input type="number" id="cc-field-rows" class="cc-input" value="' + escapeAttr(String(fieldData.rows || 4)) + '" min="1" max="20" style="width:80px;">';
    }

    if (type === 'yes_no') {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
      html += '<div>';
      html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">Yes Label</label>';
      html += '<input type="text" id="cc-field-yes-label" class="cc-input" value="' + escapeAttr(fieldData.yes_label || 'Yes') + '">';
      html += '</div>';
      html += '<div>';
      html += '<label style="display:block;font-size:13px;font-weight:500;color:#475569;margin-bottom:4px;">No Label</label>';
      html += '<input type="text" id="cc-field-no-label" class="cc-input" value="' + escapeAttr(fieldData.no_label || 'No') + '">';
      html += '</div>';
      html += '</div>';
    }

    return html;
  }

  function collectFieldOptions(formEl) {
    var options = [];
    var rows = formEl.querySelectorAll('.cc-field-option-row');
    rows.forEach(function(row) {
      var value = (row.querySelector('.cc-field-opt-value') || {}).value || '';
      var label = (row.querySelector('.cc-field-opt-label') || {}).value || '';
      if (value || label) {
        options.push({ value: value || slugify(label), label: label || value });
      }
    });
    return options;
  }

  // ═══════════════════════════════════════════════════════════
  // OVERVIEW TAB
  // ═══════════════════════════════════════════════════════════

  async function fetchOverviewData() {
    state.statsLoading = true;
    state.clioLoading = true;

    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading overview...</p></div>';

    try {
      // Fetch system stats, Clio failures, drip heartbeat, and recent messages in parallel
      var results = await Promise.allSettled([
        API.admin.getSystemStats(),
        API.leads.list({ disposition: 'WON', limit: 100 }),
        API.admin.config.list('system_status'),
        API.admin.getRecentMessages(50)
      ]);

      // Stats
      if (results[0].status === 'fulfilled' && results[0].value.success) {
        state.stats = results[0].value;
      } else {
        state.stats = null;
      }

      // Clio sync failures — filter WON leads missing Clio IDs
      if (results[1].status === 'fulfilled' && results[1].value.success) {
        var leads = results[1].value.leads || [];
        state.clioFailures = leads.filter(function(l) {
          return l.Disposition === 'WON' && (!l.Clio_Contact_ID || !l.Clio_Matter_ID);
        });
      } else {
        state.clioFailures = [];
      }

      // Drip sender heartbeat
      if (results[2].status === 'fulfilled' && results[2].value.success) {
        var configs = results[2].value.data || [];
        var hb = configs.find(function(c) { return c.Label === 'drip_sender_last_run'; });
        if (hb && hb.Meta) {
          try { state.dripHeartbeat = typeof hb.Meta === 'string' ? JSON.parse(hb.Meta) : hb.Meta; } catch(e) { state.dripHeartbeat = null; }
        } else {
          state.dripHeartbeat = null;
        }
      } else {
        state.dripHeartbeat = null;
      }
      // Recent messages
      if (results[3].status === 'fulfilled' && results[3].value.success) {
        state.recentMessages = results[3].value.messages || [];
      } else {
        state.recentMessages = [];
      }
    } catch (err) {
      state.stats = null;
      state.clioFailures = [];
      state.dripHeartbeat = null;
      state.recentMessages = [];
    }

    state.statsLoading = false;
    state.clioLoading = false;
    renderSystemStatus();
  }

  function renderSystemStatus() {
    var content = $el('cc-admin-content');
    if (!content) return;

    var html = '<div class="cc-admin-overview">';

    // Stats cards
    html += '<h3 class="cc-admin-section-title">System Overview</h3>';
    html += '<div class="cc-admin-stats-grid">';

    if (state.stats) {
      var s = state.stats;
      html += renderStatCard('Total Leads', s.total_leads || 0, 'blue');
      html += renderStatCard('Open Leads', s.open_leads || 0, 'green');
      html += renderStatCard('Won (Closed)', s.won_leads || 0, 'teal');
      html += renderStatCard('Lost', s.lost_leads || 0, 'red');
      html += renderStatCard('Active Users', s.active_users || 0, 'purple');
      html += renderStatCard('Active Campaigns', s.active_campaigns || 0, 'cyan');
    } else {
      html += '<div class="cc-admin-stat-card cc-admin-stat-gray">';
      html += '<div class="cc-admin-stat-label">Stats</div>';
      html += '<div class="cc-admin-stat-value">Pending backend (CC-15)</div>';
      html += '</div>';
    }

    html += '</div>';

    // Drip Sender Status
    html += '<h3 class="cc-admin-section-title">Drip Sender Status</h3>';
    html += '<div class="cc-admin-config-card">';
    if (state.dripHeartbeat) {
      var hb = state.dripHeartbeat;
      var lastRun = hb.last_run ? new Date(hb.last_run) : null;
      var minutesAgo = lastRun ? Math.round((Date.now() - lastRun.getTime()) / 60000) : null;
      var isHealthy = minutesAgo !== null && minutesAgo <= 90;
      var statusBadge = isHealthy
        ? '<span class="cc-badge cc-badge-green">Active</span>'
        : '<span class="cc-badge cc-badge-red">Stale</span>';
      html += '<table class="cc-table cc-admin-config-table">';
      html += '<thead><tr><th class="cc-th">Indicator</th><th class="cc-th">Value</th></tr></thead>';
      html += '<tbody>';
      html += '<tr><td>Status</td><td>' + statusBadge + (isHealthy ? '' : ' &mdash; last run was over 90 minutes ago') + '</td></tr>';
      html += '<tr><td>Last Successful Run</td><td>' + (lastRun ? escapeHtml(API.util.formatDateTime(hb.last_run)) : 'Unknown') + (minutesAgo !== null ? ' (' + minutesAgo + ' min ago)' : '') + '</td></tr>';
      html += '<tr><td>Active Drip Campaigns</td><td>' + escapeHtml(String(hb.active_campaigns || 0)) + '</td></tr>';
      html += '<tr><td>Schedule</td><td>Every 1 hour (CC-14)</td></tr>';
      html += '</tbody></table>';
    } else {
      html += '<p class="cc-admin-hint">No heartbeat data available. CC-14 has not reported yet, or the system_status config record has not been created.</p>';
    }
    html += '</div>';

    // Messages Sent
    html += '<h3 class="cc-admin-section-title">Messages Sent</h3>';
    html += '<div class="cc-admin-config-card">';
    if (state.recentMessages.length > 0) {
      var visibleMessages = state.recentMessages.slice(0, state.messagesDisplayCount);
      html += '<div style="max-height:480px;overflow-y:auto;border:1px solid #E5E7EB;border-radius:6px;">';
      html += '<table class="cc-table" style="margin:0;">';
      html += '<thead style="position:sticky;top:0;background:#F9FAFB;z-index:1;"><tr>';
      html += '<th class="cc-th">From</th>';
      html += '<th class="cc-th">To</th>';
      html += '<th class="cc-th">Type</th>';
      html += '<th class="cc-th">Template / Subject</th>';
      html += '<th class="cc-th">Date</th>';
      html += '<th class="cc-th">Time</th>';
      html += '</tr></thead><tbody>';
      visibleMessages.forEach(function(msg) {
        var d = msg.occurred_at ? new Date(msg.occurred_at) : null;
        var dateStr = d ? d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        var timeStr = d ? d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '';
        var typeBadge = msg.type === 'EMAIL'
          ? '<span class="cc-badge cc-badge-blue">Email</span>'
          : '<span class="cc-badge cc-badge-purple">SMS</span>';
        var toDisplay = msg.to_name ? escapeHtml(msg.to_name) + '<br><span style="color:#6B7280;font-size:0.85em;">' + escapeHtml(msg.to) + '</span>' : escapeHtml(msg.to || '—');
        var templateDisplay = escapeHtml(msg.template || msg.subject || '—');
        if (msg.automation && msg.automation !== 'MANUAL') {
          templateDisplay += ' <span style="color:#9CA3AF;font-size:0.8em;">(' + escapeHtml(msg.automation) + ')</span>';
        }
        html += '<tr>';
        html += '<td>' + escapeHtml(msg.from || 'info@tabuchilaw.com') + '</td>';
        html += '<td>' + toDisplay + '</td>';
        html += '<td>' + typeBadge + '</td>';
        html += '<td>' + templateDisplay + '</td>';
        html += '<td>' + escapeHtml(dateStr) + '</td>';
        html += '<td>' + escapeHtml(timeStr) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
      if (state.recentMessages.length > state.messagesDisplayCount) {
        html += '<div style="text-align:center;padding:0.75rem;">';
        html += '<button class="cc-btn cc-btn-secondary" id="cc-load-more-messages">Show More (' + (state.recentMessages.length - state.messagesDisplayCount) + ' remaining)</button>';
        html += '</div>';
      }
      html += '<p class="cc-admin-hint">Showing ' + visibleMessages.length + ' of ' + state.recentMessages.length + ' recent messages. Scroll to view more.</p>';
    } else {
      html += '<p class="cc-admin-hint">No recent email or SMS messages found in activity log.</p>';
    }
    html += '</div>';

    // Clio Sync Failures
    html += '<h3 class="cc-admin-section-title">Clio Sync Failures</h3>';
    if (state.clioFailures.length > 0) {
      html += '<p class="cc-admin-alert cc-admin-alert-warning">' +
        state.clioFailures.length + ' lead(s) marked WON but missing Clio Contact or Matter ID.</p>';
      html += '<table class="cc-table cc-admin-clio-table">';
      html += '<thead><tr>';
      html += '<th class="cc-th">Client Name</th>';
      html += '<th class="cc-th">Email</th>';
      html += '<th class="cc-th">Practice Area</th>';
      html += '<th class="cc-th">Clio Contact</th>';
      html += '<th class="cc-th">Clio Matter</th>';
      html += '<th class="cc-th">Actions</th>';
      html += '</tr></thead><tbody>';

      state.clioFailures.forEach(function(lead) {
        html += '<tr>';
        html += '<td>' + escapeHtml(lead.Client_Name || 'Unnamed') + '</td>';
        html += '<td>' + escapeHtml(lead.Client_Email || '') + '</td>';
        html += '<td>' + escapeHtml(formatPracticeArea(lead.Practice_Area)) + '</td>';
        html += '<td>' + (lead.Clio_Contact_ID ? '<span class="cc-badge cc-badge-green">Linked</span>' : '<span class="cc-badge cc-badge-red">Missing</span>') + '</td>';
        html += '<td>' + (lead.Clio_Matter_ID ? '<span class="cc-badge cc-badge-green">Linked</span>' : '<span class="cc-badge cc-badge-red">Missing</span>') + '</td>';
        html += '<td><a href="/crm/lead?id=' + escapeAttr(lead.id) + '" class="cc-link">View Lead</a></td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
    } else {
      html += '<p class="cc-admin-success">No Clio sync failures. All WON leads are linked.</p>';
    }

    // Service Level Configuration (merged from System tab)
    html += '<h3 class="cc-admin-section-title">Service Level Configuration</h3>';
    html += '<div class="cc-admin-config-card">';
    html += '<table class="cc-table cc-admin-config-table">';
    html += '<thead><tr><th class="cc-th">Setting</th><th class="cc-th">Value</th><th class="cc-th">Description</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td>Initial Contact Service Level</td><td><strong>4 hours</strong></td><td>New leads must be contacted within this window (CC-13 checks every 15 min)</td></tr>';
    html += '<tr><td>Follow-Up Service Level</td><td><strong>48 hours</strong></td><td>Maximum time between touchpoints for open leads</td></tr>';
    html += '<tr><td>Form Session Expiry</td><td><strong>7 days</strong></td><td>Intake form save/resume sessions expire after this period</td></tr>';
    html += '<tr><td>Clio Retry Attempts</td><td><strong>3</strong></td><td>Number of retries before marking as MANUAL_REVIEW (CC-08 runs every 15 min)</td></tr>';
    html += '<tr><td>Drip Sender Interval</td><td><strong>1 hour</strong></td><td>CC-14 checks for pending drip steps every hour</td></tr>';
    html += '</tbody></table>';
    html += '<p class="cc-admin-hint">Service level thresholds are configured in n8n workflows. To change, edit the CC-13 (Service Level Checker) and CC-08 (Clio Retry) workflows.</p>';
    html += '</div>';

    // Integration Status
    html += '<h3 class="cc-admin-section-title">Integration Status</h3>';
    html += '<div class="cc-admin-config-card">';
    html += '<table class="cc-table cc-admin-config-table">';
    html += '<thead><tr><th class="cc-th">Integration</th><th class="cc-th">Status</th><th class="cc-th">Details</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td>Airtable</td><td><span class="cc-badge cc-badge-green">Connected</span></td><td>Base: appPccm6NkaJdvqwy &mdash; 13 CC_ tables</td></tr>';
    html += '<tr><td>Microsoft Entra SSO</td><td><span class="cc-badge cc-badge-green">Connected</span></td><td>App: tabuchi-dashboard-spa (4df869dd-...)</td></tr>';
    html += '<tr><td>Clio Manage</td><td><span class="cc-badge cc-badge-green">Connected</span></td><td>OAuth credentials in n8n. Contact/Matter creation on close.</td></tr>';
    html += '<tr><td>Microsoft Graph (Mail)</td><td><span class="cc-badge cc-badge-green">Connected</span></td><td>Mail.Send permission granted. Used for drip campaigns & service level notifications.</td></tr>';
    html += '<tr><td>Twilio SMS</td><td><span class="cc-badge cc-badge-green">Connected</span></td><td>Phone: +16479553886. Used for SMS campaigns.</td></tr>';
    html += '</tbody></table>';
    html += '</div>';

    // Pipeline Stages
    html += '<h3 class="cc-admin-section-title">Pipeline Stages</h3>';
    html += '<div class="cc-admin-config-card">';
    html += '<table class="cc-table cc-admin-config-table">';
    html += '<thead><tr><th class="cc-th">#</th><th class="cc-th">Stage Key</th><th class="cc-th">Display Label</th><th class="cc-th">Close Gate</th></tr></thead>';
    html += '<tbody>';

    var stages = [
      { key: 'NEW_LEAD', label: 'New Lead', gate: 'None' },
      { key: 'CONTACTED', label: 'Contacted', gate: 'None' },
      { key: 'INTAKE_RECEIVED', label: 'Intake Received', gate: 'None' },
      { key: 'DISCOVERY_MEETING_BOOKED', label: 'Discovery Meeting Booked', gate: 'None' },
      { key: 'MEETING_DONE', label: 'Meeting Done', gate: 'Meeting notes required' },
      { key: 'READY_TO_DRAFT', label: 'Ready to Draft', gate: 'Disposition + Clio sync (CC-07)' }
    ];

    stages.forEach(function(s, i) {
      html += '<tr>';
      html += '<td>' + (i + 1) + '</td>';
      html += '<td><code>' + s.key + '</code></td>';
      html += '<td>' + s.label + '</td>';
      html += '<td>' + s.gate + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';

    // Roles & Permissions
    html += '<h3 class="cc-admin-section-title">Roles & Permissions</h3>';
    html += '<div class="cc-admin-config-card">';
    html += '<table class="cc-table cc-admin-config-table">';
    html += '<thead><tr><th class="cc-th">Role</th><th class="cc-th">Lead Access</th><th class="cc-th">Write</th><th class="cc-th">Notes</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td><span class="cc-badge cc-badge-red">ADMIN</span></td><td>All leads</td><td>Full</td><td>System configuration, user management</td></tr>';
    html += '<tr><td><span class="cc-badge cc-badge-blue">MANAGER</span></td><td>Managed teams</td><td>Full</td><td>Can move leads backward, view restricted notes</td></tr>';
    html += '<tr><td><span class="cc-badge cc-badge-teal">SALES_INTAKE</span></td><td>Own + shared team leads</td><td>Yes</td><td>Primary intake operators</td></tr>';
    html += '<tr><td><span class="cc-badge cc-badge-green">LAWYER</span></td><td>Assigned leads</td><td>Yes</td><td>See restricted notes, assigned as Responsible_Lawyer</td></tr>';
    html += '<tr><td><span class="cc-badge cc-badge-purple">MARKETING</span></td><td>Marketing-flagged leads</td><td>Campaigns only</td><td>No estate profiles, no restricted notes</td></tr>';
    html += '<tr><td><span class="cc-badge cc-badge-gray">READ_ONLY</span></td><td>Per role scope</td><td>None</td><td>View-only access</td></tr>';
    html += '</tbody></table>';
    html += '</div>';

    // n8n Workflows
    html += '<h3 class="cc-admin-section-title">n8n Workflows</h3>';
    html += '<div class="cc-admin-config-card">';
    html += '<table class="cc-table cc-admin-config-table">';
    html += '<thead><tr><th class="cc-th">ID</th><th class="cc-th">Name</th><th class="cc-th">Trigger</th></tr></thead>';
    html += '<tbody>';

    var workflows = [
      { id: 'CC-01', name: 'Intake Form Save/Resume', trigger: 'Webhook' },
      { id: 'CC-02', name: 'Intake Form Submit', trigger: 'Webhook' },
      { id: 'CC-03', name: 'Lead CRUD', trigger: 'Webhook' },
      { id: 'CC-04', name: 'Activity Log', trigger: 'Webhook' },
      { id: 'CC-05', name: 'Task CRUD', trigger: 'Webhook' },
      { id: 'CC-06', name: 'Stage Update', trigger: 'Webhook' },
      { id: 'CC-07', name: 'Close Gate + Clio Create', trigger: 'Internal (CC-06)' },
      { id: 'CC-08', name: 'Clio Retry Queue', trigger: 'Schedule (15 min)' },
      { id: 'CC-09', name: 'Login SSO', trigger: 'Webhook' },
      { id: 'CC-10', name: 'Reports API', trigger: 'Webhook' },
      { id: 'CC-11', name: 'Campaign CRUD', trigger: 'Webhook' },
      { id: 'CC-12', name: 'Subscribe/Unsubscribe', trigger: 'Webhook' },
      { id: 'CC-13', name: 'Service Level Breach Checker', trigger: 'Schedule (15 min)' },
      { id: 'CC-14', name: 'Drip Step Sender', trigger: 'Schedule (1 hour)' }
    ];

    workflows.forEach(function(w) {
      html += '<tr><td><strong>' + w.id + '</strong></td><td>' + w.name + '</td><td>' + w.trigger + '</td></tr>';
    });

    html += '</tbody></table>';
    html += '<p class="cc-admin-hint">Workflows are managed at <a href="https://tabuchilaw.app.n8n.cloud" target="_blank" rel="noopener" class="cc-link">tabuchilaw.app.n8n.cloud</a> under the "Client Care" project.</p>';
    html += '</div>';

    html += '</div>';
    content.innerHTML = html;

    // Bind "Show More" messages button
    var loadMoreBtn = document.getElementById('cc-load-more-messages');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function() {
        state.messagesDisplayCount += 25;
        renderSystemStatus();
      });
    }
  }

  function renderStatCard(label, value, color) {
    return '<div class="cc-admin-stat-card cc-admin-stat-' + color + '">' +
      '<div class="cc-admin-stat-value">' + escapeHtml(String(value)) + '</div>' +
      '<div class="cc-admin-stat-label">' + escapeHtml(label) + '</div>' +
      '</div>';
  }

  // ═══════════════════════════════════════════════════════════
  // STAFF & USERS TAB (merged)
  // ═══════════════════════════════════════════════════════════

  async function fetchStaffUsers() {
    state.staffUsersLoading = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading users...</p></div>';

    try {
      var results = await Promise.allSettled([
        API.admin.listUsers(),
        bookingAdminFetch('staff', { action: 'list-staff' }),
        loadPermissionsConfig(),
        API.admin.config.list('role')
      ]);

      if (results[0].status === 'fulfilled' && results[0].value.success) {
        state.users = results[0].value.users || [];
      } else {
        state.users = [];
      }

      if (results[1].status === 'fulfilled') {
        state.staffList = results[1].value.staff || [];
      } else {
        state.staffList = [];
      }

      if (results[3].status === 'fulfilled') {
        var roleRes = results[3].value;
        state.roleConfigItems = (roleRes && roleRes.items) ? roleRes.items : [];
      } else {
        state.roleConfigItems = [];
      }
    } catch (err) {
      state.users = [];
      state.staffList = [];
      showToast('Error loading users.', 'error');
    }

    state.staffUsersLoading = false;
    renderStaffUsersTab();
  }

  function mergeStaffUsers() {
    // Build a lookup of booking staff by lowercase email
    var staffByEmail = {};
    state.staffList.forEach(function(s) {
      if (s.email) staffByEmail[s.email.toLowerCase()] = s;
    });

    var merged = [];
    var seenEmails = {};

    // Start with CRM users, enrich with booking staff data
    state.users.forEach(function(u) {
      var email = (u.email || '').toLowerCase();
      seenEmails[email] = true;
      var staff = staffByEmail[email] || null;
      merged.push({
        id: u.id,
        staffId: staff ? staff.id : null,
        name: u.name || (staff ? staff.name : ''),
        email: u.email || '',
        role: u.role || '',
        team: u.team_name || '',  // kept for data but removed from table display
        is_active: u.is_active !== false,
        bookingActive: staff ? staff.active : null,
        slug: staff ? staff.slug : '',
        hours: (staff && staff.workingHoursStart && staff.workingHoursEnd)
          ? (staff.workingHoursStart + ' \u2013 ' + staff.workingHoursEnd) : '',
        lastLogin: u.last_login_at || '',
        source: staff ? 'both' : 'crm'
      });
    });

    // Add booking-only staff not in CRM
    state.staffList.forEach(function(s) {
      var email = (s.email || '').toLowerCase();
      if (!seenEmails[email]) {
        merged.push({
          id: null,
          staffId: s.id,
          name: s.name || '',
          email: s.email || '',
          role: '',
          team: '',
          is_active: null,
          bookingActive: s.active,
          slug: s.slug || '',
          hours: (s.workingHoursStart && s.workingHoursEnd)
            ? (s.workingHoursStart + ' \u2013 ' + s.workingHoursEnd) : '',
          lastLogin: '',
          source: 'booking'
        });
      }
    });

    return merged;
  }

  function renderStaffUsersTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // ─── Sub-tab navigation ───────────────────────────────────
    var subTabs = [
      { key: 'manage-users', label: 'Manage Users' },
      { key: 'permissions', label: 'Permissions' },
      { key: 'booking-priority', label: 'Role / Booking Priority' },
      { key: 'cost', label: 'Cost' }
    ];

    var html = '<div class="cc-admin-staff-users">';
    html += '<div class="cc-admin-sub-tabs" style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:20px;">';
    subTabs.forEach(function(st) {
      var active = state.usersSubTab === st.key;
      html += '<button class="cc-admin-sub-tab-btn" data-subtab="' + st.key + '" style="'
        + 'padding:10px 20px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:500;'
        + 'border-bottom:2px solid ' + (active ? '#2563eb' : 'transparent') + ';'
        + 'margin-bottom:-2px;color:' + (active ? '#2563eb' : '#6b7280') + ';'
        + '">' + st.label + '</button>';
    });
    html += '</div>';

    switch (state.usersSubTab) {
      case 'manage-users':      html += renderManageUsersContent(); break;
      case 'permissions':       html += renderInteractivePermissions(); break;
      case 'booking-priority':  html += renderBookingPriorityContent(); break;
      case 'cost':              html += renderCostContent(); break;
    }

    html += '</div>';
    content.innerHTML = html;

    // Bind sub-tab clicks
    content.querySelectorAll('.cc-admin-sub-tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.usersSubTab = btn.dataset.subtab;
        renderStaffUsersTab();
      });
    });

    switch (state.usersSubTab) {
      case 'manage-users':      bindStaffUsersEvents(); break;
      case 'permissions':       bindPermissionsEvents(); break;
      case 'booking-priority':  bindBookingPriorityEvents(); break;
      case 'cost':              bindCostEvents(); break;
    }
  }

  // ─── Manage Users sub-tab content ─────────────────────────
  function renderManageUsersContent() {
    var merged = mergeStaffUsers();

    // Sort
    var sorted = merged.slice().sort(function(a, b) {
      var key = state.staffUsersSortKey;
      var av = String(a[key] || '');
      var bv = String(b[key] || '');
      return state.staffUsersSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    var html = '';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Manage Users</h3>';
    html += '<button id="cc-import-staff-btn" class="cc-btn cc-btn-primary cc-btn-sm">Import from Office 365</button>';
    html += '</div>';
    html += '<p class="cc-admin-hint">CRM users are provisioned on first SSO login. Booking staff can be imported from Office 365.</p>';

    if (sorted.length === 0 && !state.staffUsersLoading) {
      html += '<div class="cc-empty"><p>No users found.</p></div>';
      return html;
    }

    var columns = [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'hours', label: 'Hours' },
      { key: 'is_active', label: 'Status' },
      { key: 'lastLogin', label: 'Last Login' }
    ];

    html += '<table class="cc-table cc-admin-staff-users-table">';
    html += '<thead><tr>';
    columns.forEach(function(col) {
      var arrow = '';
      var cls = 'cc-th cc-th-sortable';
      if (state.staffUsersSortKey === col.key) {
        cls += ' cc-th-sorted';
        arrow = state.staffUsersSortDir === 'asc' ? ' &#9650;' : ' &#9660;';
      }
      html += '<th class="' + cls + '" data-col="' + col.key + '">' + col.label + arrow + '</th>';
    });
    html += '<th class="cc-th">Actions</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function(row) {
      var roleCls = ROLE_COLORS[row.role] || 'gray';

      // Build status badges
      var statusHtml = '';
      if (row.source === 'crm' || row.source === 'both') {
        statusHtml += row.is_active
          ? '<span class="cc-badge cc-badge-green">CRM Active</span>'
          : '<span class="cc-badge cc-badge-gray">CRM Inactive</span>';
      }
      if (row.source === 'booking' || row.source === 'both') {
        if (statusHtml) statusHtml += ' ';
        statusHtml += row.bookingActive
          ? '<span class="cc-badge cc-badge-teal">Booking Active</span>'
          : '<span class="cc-badge cc-badge-red">Booking Off</span>';
      }

      html += '<tr>';
      html += '<td class="cc-td-name">' + escapeHtml(row.name) + '</td>';
      html += '<td>' + escapeHtml(row.email) + '</td>';
      html += '<td>' + (row.role ? '<span class="cc-badge cc-badge-' + roleCls + '">' + escapeHtml(row.role) + '</span>' : '<span class="cc-text-muted">\u2014</span>') + '</td>';
      html += '<td>' + escapeHtml(row.hours || '\u2014') + '</td>';
      html += '<td>' + statusHtml + '</td>';
      html += '<td>' + (row.lastLogin ? escapeHtml(API.util.formatRelativeTime(row.lastLogin)) : '\u2014') + '</td>';

      // Action buttons
      html += '<td class="cc-td-actions">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-edit-user-btn" data-email="' + escapeAttr(row.email) + '" title="Edit">Edit</button>';
      if (row.staffId) {
        var toggleCls = row.bookingActive ? 'cc-btn-danger-outline' : 'cc-btn-success-outline';
        var toggleTxt = row.bookingActive ? 'Deactivate' : 'Activate';
        html += ' <button class="cc-btn cc-btn-sm ' + toggleCls + ' cc-toggle-staff-btn" data-staff-id="' + escapeAttr(row.staffId) + '" data-active="' + (row.bookingActive ? 'true' : 'false') + '" title="Toggle booking status">' + toggleTxt + '</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  // ─── Role-Permission Matrix ──────────────────────────────
  var PERMISSION_SECTIONS = [
    { key: 'leads',       label: 'Leads' },
    { key: 'contacts',    label: 'Contacts' },
    { key: 'campaigns',   label: 'Campaigns' },
    { key: 'kanban',      label: 'Kanban' },
    { key: 'reports',     label: 'Reports' },
    { key: 'intake',      label: 'Intake' },
    { key: 'admin',       label: 'Admin' },
    { key: 'bookings',    label: 'Bookings' }
  ];

  var ROLE_PERMISSIONS = {
    ADMIN:        ['leads', 'contacts', 'campaigns', 'kanban', 'reports', 'intake', 'admin', 'bookings'],
    MANAGER:      ['leads', 'contacts', 'campaigns', 'kanban', 'reports', 'intake', 'bookings'],
    SALES_INTAKE: ['leads', 'contacts', 'kanban', 'intake'],
    LAWYER:       ['leads', 'contacts', 'kanban', 'reports'],
    MARKETING:    ['leads', 'contacts', 'campaigns', 'reports'],
    READ_ONLY:    ['leads', 'contacts', 'reports']
  };

  function getPermissionsData() {
    // If we have saved data from CC_Config, use it; otherwise use defaults
    if (state.permissionsData) return state.permissionsData;
    // Clone from hardcoded defaults
    var data = {};
    Object.keys(ROLE_PERMISSIONS).forEach(function(role) {
      data[role] = ROLE_PERMISSIONS[role].slice();
    });
    return data;
  }

  function renderInteractivePermissions() {
    var permsData = getPermissionsData();
    var roles = Object.keys(permsData);

    var html = '';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Permissions Grid</h3>';
    html += '<button id="cc-add-role-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ Add Role</button>';
    html += '</div>';
    html += '<p class="cc-admin-hint">Toggle checkboxes to grant or revoke module access for each role. Changes are saved automatically.</p>';

    html += '<table class="cc-table cc-permissions-table" style="margin-top:12px;">';
    html += '<thead><tr>';
    html += '<th class="cc-th" style="min-width:140px;">Role</th>';
    PERMISSION_SECTIONS.forEach(function(sec) {
      html += '<th class="cc-th" style="text-align:center;min-width:80px;">' + escapeHtml(sec.label) + '</th>';
    });
    html += '<th class="cc-th" style="text-align:center;width:80px;">Actions</th>';
    html += '</tr></thead><tbody>';

    roles.forEach(function(role) {
      var perms = permsData[role] || [];
      var roleCls = ROLE_COLORS[role] || 'gray';
      html += '<tr data-perm-role="' + escapeAttr(role) + '">';
      html += '<td><span class="cc-badge cc-badge-' + roleCls + '">' + escapeHtml(role) + '</span></td>';
      PERMISSION_SECTIONS.forEach(function(sec) {
        var checked = perms.indexOf(sec.key) !== -1 ? ' checked' : '';
        html += '<td style="text-align:center;">';
        html += '<input type="checkbox" class="cc-perm-checkbox" data-role="' + escapeAttr(role) + '" data-module="' + escapeAttr(sec.key) + '"' + checked + ' style="width:18px;height:18px;cursor:pointer;" />';
        html += '</td>';
      });
      html += '<td style="text-align:center;">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-delete-role-btn" data-role="' + escapeAttr(role) + '" title="Delete role">Delete</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';

    if (state.permissionsSaving) {
      html += '<p class="cc-admin-hint" style="color:#2563eb;margin-top:8px;">Saving...</p>';
    }

    return html;
  }

  async function loadPermissionsConfig() {
    try {
      var res = await API.admin.config.list('permissions');
      if (res && res.items && res.items.length > 0) {
        // Find the permissions grid config record
        var record = res.items.find(function(it) { return it.Label === 'role_permissions'; });
        if (record && record.Meta) {
          try {
            state.permissionsData = JSON.parse(record.Meta);
            state.permissionsConfigId = record.id;
          } catch (e) { /* use defaults */ }
        }
      }
    } catch (e) { /* use defaults */ }
  }

  async function savePermissionsConfig() {
    state.permissionsSaving = true;
    var permsData = getPermissionsData();
    var meta = JSON.stringify(permsData);
    try {
      if (state.permissionsConfigId) {
        await API.admin.config.update(state.permissionsConfigId, {
          label: 'role_permissions',
          config_key: 'permissions',
          meta: meta
        });
      } else {
        var res = await API.admin.config.create({
          label: 'role_permissions',
          config_key: 'permissions',
          sort_order: 1,
          is_active: true,
          meta: meta
        });
        if (res && res.id) state.permissionsConfigId = res.id;
      }
      showToast('Permissions saved.', 'success');
    } catch (e) {
      showToast('Failed to save permissions: ' + (e.error || e.message || 'Unknown error'), 'error');
    }
    state.permissionsSaving = false;
  }

  function bindPermissionsEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Checkbox toggles
    content.querySelectorAll('.cc-perm-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var role = cb.dataset.role;
        var module = cb.dataset.module;
        var permsData = getPermissionsData();
        if (!permsData[role]) permsData[role] = [];
        if (cb.checked) {
          if (permsData[role].indexOf(module) === -1) permsData[role].push(module);
        } else {
          permsData[role] = permsData[role].filter(function(m) { return m !== module; });
        }
        state.permissionsData = permsData;
        savePermissionsConfig();
      });
    });

    // Add Role button
    var addBtn = content.querySelector('#cc-add-role-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        showAddRoleModal();
      });
    }

    // Delete Role buttons
    content.querySelectorAll('.cc-delete-role-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var role = btn.dataset.role;
        if (!confirm('Delete role "' + role + '" from the permissions grid?')) return;
        var permsData = getPermissionsData();
        delete permsData[role];
        state.permissionsData = permsData;
        savePermissionsConfig();
        renderStaffUsersTab();
      });
    });
  }

  function showAddRoleModal() {
    var html = '<div class="cc-modal-form">';
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Role Name</label>';
    html += '<input type="text" id="cc-modal-new-role" class="cc-input" placeholder="e.g. PARALEGAL" />';
    html += '</div>';
    html += '<p class="cc-admin-hint" style="margin-top:4px;">Use UPPER_CASE format (e.g. SALES_INTAKE).</p>';
    html += '</div>';

    showModal('Add Role', html, async function() {
      var roleName = (document.getElementById('cc-modal-new-role').value || '').trim().toUpperCase().replace(/\s+/g, '_');
      if (!roleName) { showToast('Role name is required.', 'error'); return; }
      var permsData = getPermissionsData();
      if (permsData[roleName]) { showToast('Role "' + roleName + '" already exists.', 'error'); return; }
      permsData[roleName] = [];
      state.permissionsData = permsData;
      await savePermissionsConfig();
      closeModal();
      renderStaffUsersTab();
    });
  }

  // Keep static reference for backwards compatibility
  function renderPermissionsMatrix() {
    return renderInteractivePermissions();
  }

  // ─── Booking Priority & Cost Tabs ─────────────────────────
  async function fetchRoleConfig() {
    state.roleConfigLoading = true;
    try {
      var res = await API.admin.config.list('role');
      state.roleConfigItems = (res && res.items) ? res.items : [];
    } catch (e) {
      state.roleConfigItems = [];
      showToast('Error loading role configuration.', 'error');
    }
    state.roleConfigLoading = false;
    // Re-render if currently viewing a role sub-tab
    if (state.activeTab === 'staff-users' && (state.usersSubTab === 'booking-priority' || state.usersSubTab === 'cost')) {
      renderStaffUsersTab();
    }
  }

  function getRoleConfigValue(roleName, metaKey) {
    var item = state.roleConfigItems.find(function(it) { return it.Label === roleName; });
    if (!item || !item.Meta) return '';
    try { var m = JSON.parse(item.Meta); return m[metaKey] != null ? m[metaKey] : ''; } catch (e) { return ''; }
  }

  function getRoleConfigRecordId(roleName) {
    var item = state.roleConfigItems.find(function(it) { return it.Label === roleName; });
    return item ? item.id : null;
  }

  async function saveRoleConfigValue(roleName, metaKey, value) {
    var item = state.roleConfigItems.find(function(it) { return it.Label === roleName; });
    var meta = {};
    if (item && item.Meta) { try { meta = JSON.parse(item.Meta); } catch (e) { meta = {}; } }
    meta[metaKey] = value;
    try {
      if (item) {
        await API.admin.config.update(item.id, { label: roleName, config_key: 'role', meta: JSON.stringify(meta) });
        item.Meta = JSON.stringify(meta);
      } else {
        var res = await API.admin.config.create({ label: roleName, config_key: 'role', sort_order: 0, is_active: true, meta: JSON.stringify(meta) });
        if (res && res.id) {
          state.roleConfigItems.push({ id: res.id, Label: roleName, Config_Key: 'role', Sort_Order: 0, Is_Active: true, Meta: JSON.stringify(meta) });
        }
      }
      showToast('Saved.', 'success');
    } catch (e) {
      showToast('Failed to save: ' + (e.error || e.message || 'Unknown error'), 'error');
    }
  }

  function renderBookingPriorityContent() {
    var permsData = getPermissionsData();
    var roles = Object.keys(permsData);

    var html = '<div class="cc-admin-booking-priority">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Role / Booking Priority</h3>';
    html += '<button id="cc-add-role-priority-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ Add New</button>';
    html += '</div>';
    html += '<p class="cc-admin-hint">Manage roles and set booking priority. Lower numbers are shown first in the booking calendar.</p>';

    html += '<table class="cc-table" style="margin-top:12px;max-width:700px;">';
    html += '<thead><tr>';
    html += '<th class="cc-th" style="min-width:140px;">Role</th>';
    html += '<th class="cc-th" style="width:120px;">Booking Priority</th>';
    html += '<th class="cc-th" style="width:160px;text-align:center;">Actions</th>';
    html += '</tr></thead><tbody>';

    roles.forEach(function(role) {
      var val = getRoleConfigValue(role, 'booking_priority');
      var roleCls = ROLE_COLORS[role] || 'gray';
      html += '<tr data-role-row="' + escapeAttr(role) + '">';
      html += '<td><span class="cc-badge cc-badge-' + roleCls + '">' + escapeHtml(role) + '</span></td>';
      html += '<td><input type="number" class="cc-input cc-role-priority-input" data-role="' + escapeAttr(role) + '" value="' + escapeAttr(String(val)) + '" style="width:80px;padding:4px 8px;" min="1" max="5" /></td>';
      html += '<td style="text-align:center;">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-edit-role-btn" data-role="' + escapeAttr(role) + '" style="margin-right:6px;">Edit</button>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-delete-role-priority-btn" data-role="' + escapeAttr(role) + '">Delete</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';

    // ── Edit Role Modal (hidden) ──
    html += '<div id="cc-edit-role-modal" class="cc-modal-overlay" style="display:none;">';
    html += '<div class="cc-modal" style="max-width:440px;">';
    html += '<div class="cc-modal-header">Edit Role<button id="cc-edit-role-close" class="cc-modal-close">&times;</button></div>';
    html += '<div class="cc-modal-body" style="padding:1.75rem;">';
    html += '<div style="margin-bottom:20px;">';
    html += '<label class="cc-label">Role Name</label>';
    html += '<input id="cc-edit-role-name" class="cc-input" />';
    html += '</div>';
    html += '<div style="margin-bottom:20px;">';
    html += '<label class="cc-label">Booking Priority</label>';
    html += '<input id="cc-edit-role-priority" type="number" class="cc-input" min="1" max="5" style="max-width:120px;" />';
    html += '</div>';
    html += '<div style="margin-bottom:0;">';
    html += '<label class="cc-label">Badge Color</label>';
    html += '<select id="cc-edit-role-color" class="cc-input">';
    ['red','blue','teal','green','purple','gray','orange','yellow'].forEach(function(c) {
      html += '<option value="' + c + '">' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += '<input id="cc-edit-role-original" type="hidden" />';
    html += '</div>';
    html += '<div class="cc-modal-footer" style="gap:0.75rem;">';
    html += '<button id="cc-edit-role-cancel" class="cc-btn cc-btn-sm cc-btn-outline">Cancel</button>';
    html += '<button id="cc-edit-role-save" class="cc-btn cc-btn-sm cc-btn-primary">Save</button>';
    html += '</div>';
    html += '</div></div>';

    // ── Delete Role Modal (hidden) ──
    html += '<div id="cc-delete-role-modal" class="cc-modal-overlay" style="display:none;">';
    html += '<div class="cc-modal" style="max-width:480px;">';
    html += '<div class="cc-modal-header" style="color:#DC2626;">Delete Role<button id="cc-delete-role-close" class="cc-modal-close">&times;</button></div>';
    html += '<div class="cc-modal-body">';
    html += '<p id="cc-delete-role-msg" style="margin-bottom:16px;"></p>';
    html += '<div id="cc-delete-role-reassign" style="margin-bottom:0;">';
    html += '<label class="cc-label">Reassign all users with this role to:</label>';
    html += '<select id="cc-delete-role-target" class="cc-input"></select>';
    html += '</div>';
    html += '<input id="cc-delete-role-name" type="hidden" />';
    html += '</div>';
    html += '<div class="cc-modal-footer">';
    html += '<button id="cc-delete-role-cancel" class="cc-btn cc-btn-sm cc-btn-outline">Cancel</button>';
    html += '<button id="cc-delete-role-confirm" class="cc-btn cc-btn-sm cc-btn-danger">Delete &amp; Reassign</button>';
    html += '</div>';
    html += '</div></div>';

    // ── Add Role Modal (hidden) ──
    html += '<div id="cc-add-role-priority-modal" class="cc-modal-overlay" style="display:none;">';
    html += '<div class="cc-modal" style="max-width:440px;">';
    html += '<div class="cc-modal-header">Add New Role<button id="cc-add-role-close" class="cc-modal-close">&times;</button></div>';
    html += '<div class="cc-modal-body" style="padding:1.75rem;">';
    html += '<div style="margin-bottom:20px;">';
    html += '<label class="cc-label">Role Name</label>';
    html += '<input id="cc-new-role-name" class="cc-input" placeholder="e.g. PARALEGAL" />';
    html += '<p class="cc-admin-hint" style="margin-top:4px;">Use UPPER_CASE with underscores.</p>';
    html += '</div>';
    html += '<div style="margin-bottom:20px;">';
    html += '<label class="cc-label">Booking Priority</label>';
    html += '<input id="cc-new-role-priority" type="number" class="cc-input" min="0" value="5" style="max-width:120px;" />';
    html += '</div>';
    html += '<div style="margin-bottom:0;">';
    html += '<label class="cc-label">Badge Color</label>';
    html += '<select id="cc-new-role-color" class="cc-input">';
    ['gray','red','blue','teal','green','purple','orange','yellow'].forEach(function(c) {
      html += '<option value="' + c + '">' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += '</div>';
    html += '<div class="cc-modal-footer">';
    html += '<button id="cc-new-role-cancel" class="cc-btn cc-btn-sm cc-btn-outline">Cancel</button>';
    html += '<button id="cc-new-role-save" class="cc-btn cc-btn-sm cc-btn-primary">Add Role</button>';
    html += '</div>';
    html += '</div></div>';

    html += '</div>';
    return html;
  }

  function bindBookingPriorityEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // ── Priority inputs ──
    content.querySelectorAll('.cc-role-priority-input').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var role = inp.dataset.role;
        var val = inp.value.trim() === '' ? '' : parseInt(inp.value, 10);
        if (val !== '' && (val < 1 || val > 5)) { showToast('Priority must be between 1 and 5.', 'error'); inp.value = ''; return; }
        saveRoleConfigValue(role, 'booking_priority', val);
      });
    });

    // ── Add New ──
    var addBtn = document.getElementById('cc-add-role-priority-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var modal = document.getElementById('cc-add-role-priority-modal');
        if (modal) modal.style.display = 'flex';
      });
    }

    var newCancel = document.getElementById('cc-new-role-cancel');
    if (newCancel) newCancel.addEventListener('click', function() {
      document.getElementById('cc-add-role-priority-modal').style.display = 'none';
    });
    var newClose = document.getElementById('cc-add-role-close');
    if (newClose) newClose.addEventListener('click', function() {
      document.getElementById('cc-add-role-priority-modal').style.display = 'none';
    });

    var newSave = document.getElementById('cc-new-role-save');
    if (newSave) {
      newSave.addEventListener('click', async function() {
        var nameInput = document.getElementById('cc-new-role-name');
        var priInput = document.getElementById('cc-new-role-priority');
        var colorInput = document.getElementById('cc-new-role-color');
        var roleName = (nameInput.value || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
        if (!roleName) { showToast('Role name is required.', 'error'); return; }

        var permsData = getPermissionsData();
        if (permsData[roleName]) { showToast('Role "' + roleName + '" already exists.', 'error'); return; }

        // Add to permissions with minimal defaults
        permsData[roleName] = ['leads', 'contacts'];
        state.permissionsData = permsData;
        ROLE_COLORS[roleName] = colorInput.value || 'gray';
        await savePermissionsConfig();

        // Save priority
        var pri = priInput.value.trim() === '' ? '' : parseInt(priInput.value, 10);
        if (pri !== '') await saveRoleConfigValue(roleName, 'booking_priority', pri);

        document.getElementById('cc-add-role-priority-modal').style.display = 'none';
        showToast('Role "' + roleName + '" created.', 'success');
        renderStaffUsersTab();
      });
    }

    // ── Edit Role ──
    content.querySelectorAll('.cc-edit-role-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var role = btn.dataset.role;
        var modal = document.getElementById('cc-edit-role-modal');
        document.getElementById('cc-edit-role-name').value = role;
        document.getElementById('cc-edit-role-priority').value = getRoleConfigValue(role, 'booking_priority') || '';
        document.getElementById('cc-edit-role-color').value = ROLE_COLORS[role] || 'gray';
        document.getElementById('cc-edit-role-original').value = role;
        if (modal) modal.style.display = 'flex';
      });
    });

    var editCancel = document.getElementById('cc-edit-role-cancel');
    if (editCancel) editCancel.addEventListener('click', function() {
      document.getElementById('cc-edit-role-modal').style.display = 'none';
    });
    var editClose = document.getElementById('cc-edit-role-close');
    if (editClose) editClose.addEventListener('click', function() {
      document.getElementById('cc-edit-role-modal').style.display = 'none';
    });

    var editSave = document.getElementById('cc-edit-role-save');
    if (editSave) {
      editSave.addEventListener('click', async function() {
        var origRole = document.getElementById('cc-edit-role-original').value;
        var newName = (document.getElementById('cc-edit-role-name').value || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
        var newPri = document.getElementById('cc-edit-role-priority').value;
        var newColor = document.getElementById('cc-edit-role-color').value;

        if (!newName) { showToast('Role name is required.', 'error'); return; }

        var permsData = getPermissionsData();
        if (newName !== origRole && permsData[newName]) { showToast('Role "' + newName + '" already exists.', 'error'); return; }

        // Rename if needed
        if (newName !== origRole) {
          permsData[newName] = permsData[origRole];
          delete permsData[origRole];
          // Move config values
          var oldCfg = state.roleConfigItems.find(function(it) { return it.Label === origRole; });
          if (oldCfg) oldCfg.Label = newName;
        }

        state.permissionsData = permsData;
        ROLE_COLORS[newName] = newColor;
        await savePermissionsConfig();

        var pri = newPri.trim && newPri.trim() === '' ? '' : parseInt(newPri, 10);
        if (!isNaN(pri)) await saveRoleConfigValue(newName, 'booking_priority', pri);

        document.getElementById('cc-edit-role-modal').style.display = 'none';
        showToast('Role updated.', 'success');
        renderStaffUsersTab();
      });
    }

    // ── Delete Role ──
    content.querySelectorAll('.cc-delete-role-priority-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var role = btn.dataset.role;
        var permsData = getPermissionsData();
        var otherRoles = Object.keys(permsData).filter(function(r) { return r !== role; });

        if (otherRoles.length === 0) {
          showToast('Cannot delete the last role.', 'error');
          return;
        }

        var modal = document.getElementById('cc-delete-role-modal');
        document.getElementById('cc-delete-role-name').value = role;
        document.getElementById('cc-delete-role-msg').innerHTML =
          'Are you sure you want to delete the <strong>' + escapeHtml(role) + '</strong> role? ' +
          'All users currently assigned this role will be reassigned to the role you select below.';

        var select = document.getElementById('cc-delete-role-target');
        select.innerHTML = '';
        otherRoles.forEach(function(r) {
          var opt = document.createElement('option');
          opt.value = r;
          opt.textContent = r;
          select.appendChild(opt);
        });

        if (modal) modal.style.display = 'flex';
      });
    });

    var delCancel = document.getElementById('cc-delete-role-cancel');
    if (delCancel) delCancel.addEventListener('click', function() {
      document.getElementById('cc-delete-role-modal').style.display = 'none';
    });
    var delClose = document.getElementById('cc-delete-role-close');
    if (delClose) delClose.addEventListener('click', function() {
      document.getElementById('cc-delete-role-modal').style.display = 'none';
    });

    var delConfirm = document.getElementById('cc-delete-role-confirm');
    if (delConfirm) {
      delConfirm.addEventListener('click', async function() {
        var role = document.getElementById('cc-delete-role-name').value;
        var target = document.getElementById('cc-delete-role-target').value;

        if (!target) { showToast('Please select a role to reassign to.', 'error'); return; }

        try {
          // 1. Update permissions: remove role
          var permsData = getPermissionsData();
          delete permsData[role];
          state.permissionsData = permsData;
          await savePermissionsConfig();

          // 2. Delete the role config record (priority/cost)
          var cfg = state.roleConfigItems.find(function(it) { return it.Label === role; });
          if (cfg) {
            await API.admin.config.delete(cfg.id);
            state.roleConfigItems = state.roleConfigItems.filter(function(it) { return it.Label !== role; });
          }

          // 3. Reassign users with this role to the target role
          if (state.users && state.users.length) {
            var usersToReassign = state.users.filter(function(u) { return u.Role === role; });
            for (var i = 0; i < usersToReassign.length; i++) {
              await API.admin.updateUser(usersToReassign[i].id, { Role: target });
              usersToReassign[i].Role = target;
            }
            if (usersToReassign.length > 0) {
              showToast(usersToReassign.length + ' user(s) reassigned to ' + target + '.', 'success');
            }
          }

          document.getElementById('cc-delete-role-modal').style.display = 'none';
          showToast('Role "' + role + '" deleted.', 'success');
          renderStaffUsersTab();
        } catch (e) {
          showToast('Failed to delete role: ' + (e.error || e.message || 'Unknown error'), 'error');
        }
      });
    }

    // ── Close modals on overlay click ──
    ['cc-edit-role-modal', 'cc-delete-role-modal', 'cc-add-role-priority-modal'].forEach(function(id) {
      var modal = document.getElementById(id);
      if (modal) {
        modal.addEventListener('click', function(e) {
          if (e.target === modal) modal.style.display = 'none';
        });
      }
    });
  }

  function renderCostContent() {
    var permsData = getPermissionsData();
    var roles = Object.keys(permsData);

    var html = '<div class="cc-admin-cost">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Cost</h3>';
    html += '</div>';
    html += '<p class="cc-admin-hint">Set the hourly cost rate for each role. Used for billing and reporting calculations.</p>';

    html += '<table class="cc-table" style="margin-top:12px;max-width:500px;">';
    html += '<thead><tr>';
    html += '<th class="cc-th" style="min-width:140px;">Role</th>';
    html += '<th class="cc-th" style="width:140px;">Cost ($/hr)</th>';
    html += '</tr></thead><tbody>';

    roles.forEach(function(role) {
      var val = getRoleConfigValue(role, 'cost');
      var roleCls = ROLE_COLORS[role] || 'gray';
      html += '<tr>';
      html += '<td><span class="cc-badge cc-badge-' + roleCls + '">' + escapeHtml(role) + '</span></td>';
      html += '<td><input type="number" class="cc-input cc-role-cost-input" data-role="' + escapeAttr(role) + '" value="' + escapeAttr(String(val)) + '" style="width:100px;padding:4px 8px;" min="0" step="0.01" /></td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    return html;
  }

  function bindCostEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;
    content.querySelectorAll('.cc-role-cost-input').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var role = inp.dataset.role;
        var val = inp.value.trim() === '' ? '' : parseFloat(inp.value);
        saveRoleConfigValue(role, 'cost', val);
      });
    });
  }

  function bindStaffUsersEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Sort headers
    content.querySelectorAll('.cc-admin-staff-users-table .cc-th-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var col = th.dataset.col;
        if (state.staffUsersSortKey === col) {
          state.staffUsersSortDir = state.staffUsersSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.staffUsersSortKey = col;
          state.staffUsersSortDir = 'asc';
        }
        renderStaffUsersTab();
      });
    });

    // Edit CRM user buttons
    content.querySelectorAll('.cc-edit-user-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var email = btn.dataset.email;
        var merged = mergeStaffUsers();
        var row = merged.find(function(r) { return r.email === email; });
        if (row) showEditUserModal(row);
      });
    });

    // Toggle booking staff buttons
    content.querySelectorAll('.cc-toggle-staff-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var staffId = btn.dataset.staffId;
        var currentActive = btn.dataset.active === 'true';
        btn.textContent = 'Updating...';
        btn.disabled = true;
        try {
          await bookingAdminFetch('staff', { action: 'toggle-staff', staffId: staffId, active: !currentActive });
          for (var i = 0; i < state.staffList.length; i++) {
            if (state.staffList[i].id === staffId) {
              state.staffList[i].active = !currentActive;
              break;
            }
          }
          renderStaffUsersTab();
        } catch (err) {
          btn.textContent = currentActive ? 'Deactivate' : 'Activate';
          btn.disabled = false;
          showToast(err.error || 'Failed to toggle staff status.', 'error');
        }
      });
    });

    // Import from Office 365 button
    bindStaffImportBtn();
  }

  function showEditUserModal(row) {
    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Name</label>';
    html += '<input type="text" id="cc-modal-user-name" class="cc-input" value="' + escapeAttr(row.name) + '" readonly />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Email</label>';
    html += '<input type="text" class="cc-input" value="' + escapeAttr(row.email) + '" readonly />';
    html += '</div>';

    // Role selector (available for all users)
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Role</label>';
    html += '<select id="cc-modal-user-role" class="cc-input">';
    html += '<option value=""' + (!row.role ? ' selected' : '') + '>— None —</option>';
    ROLE_OPTIONS.forEach(function(r) {
      html += '<option value="' + r + '"' + (row.role === r ? ' selected' : '') + '>' + r + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // CRM Active (only if this person has a CRM user record)
    if (row.id) {
      html += '<div class="cc-form-group">';
      html += '<label class="cc-label">CRM Active</label>';
      html += '<select id="cc-modal-user-active" class="cc-input">';
      html += '<option value="true"' + (row.is_active ? ' selected' : '') + '>Active</option>';
      html += '<option value="false"' + (!row.is_active ? ' selected' : '') + '>Inactive</option>';
      html += '</select>';
      html += '</div>';
    }

    // Booking fields (only if this person has a booking staff record)
    if (row.staffId) {
      html += '<div class="cc-form-group">';
      html += '<label class="cc-label">Booking Slug</label>';
      html += '<input type="text" id="cc-modal-staff-slug" class="cc-input" value="' + escapeAttr(row.slug || '') + '" />';
      html += '</div>';

      var hParts = (row.hours || '').split(' \u2013 ');
      var hStart = hParts[0] ? hParts[0].trim() : '09:00';
      var hEnd = hParts[1] ? hParts[1].trim() : '17:00';

      html += '<div class="cc-form-row" style="display:flex;gap:12px;">';
      html += '<div class="cc-form-group" style="flex:1">';
      html += '<label class="cc-label">Work Hours Start</label>';
      html += '<input type="time" id="cc-modal-staff-hours-start" class="cc-input" value="' + escapeAttr(hStart) + '" />';
      html += '</div>';
      html += '<div class="cc-form-group" style="flex:1">';
      html += '<label class="cc-label">Work Hours End</label>';
      html += '<input type="time" id="cc-modal-staff-hours-end" class="cc-input" value="' + escapeAttr(hEnd) + '" />';
      html += '</div>';
      html += '</div>';

      html += '<div class="cc-form-group">';
      html += '<label class="cc-label">Booking Active</label>';
      html += '<select id="cc-modal-staff-active" class="cc-input">';
      html += '<option value="true"' + (row.bookingActive ? ' selected' : '') + '>Active</option>';
      html += '<option value="false"' + (!row.bookingActive ? ' selected' : '') + '>Inactive</option>';
      html += '</select>';
      html += '</div>';
    }

    html += '</div>';

    showModal('Edit: ' + row.name, html, function(form) {
      return handleUpdateUser(row, form);
    });
  }

  async function handleUpdateUser(row, form) {
    var promises = [];

    var role = form.querySelector('#cc-modal-user-role').value;

    // Update CRM user if applicable
    if (row.id) {
      var isActive = form.querySelector('#cc-modal-user-active').value === 'true';
      promises.push(
        API.admin.updateUser(row.id, { role: role, is_active: isActive })
          .then(function(r) { if (!r.success) throw { error: r.error || 'Failed to update CRM user.' }; })
      );
    } else if (role) {
      // Booking-only user getting a role → create a CRM user record
      promises.push(
        API.admin.createUser({ name: row.name, email: row.email, role: role })
          .then(function(r) { if (!r.success) throw { error: r.error || 'Failed to create CRM user.' }; })
      );
    }

    // Update booking staff if applicable
    if (row.staffId) {
      var slug = form.querySelector('#cc-modal-staff-slug').value.trim();
      var hoursStart = form.querySelector('#cc-modal-staff-hours-start').value;
      var hoursEnd = form.querySelector('#cc-modal-staff-hours-end').value;
      var staffActive = form.querySelector('#cc-modal-staff-active').value === 'true';
      promises.push(
        bookingAdminFetch('staff', {
          action: 'update-staff',
          staffId: row.staffId,
          slug: slug,
          workingHoursStart: hoursStart,
          workingHoursEnd: hoursEnd,
          active: staffActive
        })
      );
    }

    if (promises.length === 0) return true;

    try {
      await Promise.all(promises);
      showToast('Updated successfully.', 'success');
      closeModal();
      fetchStaffUsers();
      return true;
    } catch (err) {
      showToast(err.error || 'Error updating.', 'error');
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEMPLATES TAB
  // ═══════════════════════════════════════════════════════════

  async function fetchTemplates() {
    state.templatesLoading = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading templates...</p></div>';

    try {
      var result = await API.admin.listTemplates();
      if (result.success) {
        state.templates = result.templates || [];
      } else {
        state.templates = [];
        showToast(result.error || 'Failed to load templates.', 'error');
      }
    } catch (err) {
      state.templates = [];
      showToast(err.error || 'Error loading templates.', 'error');
    }

    state.templatesLoading = false;
    renderTemplatesTab();
  }

  function renderTemplatesTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Filter by channel
    var filtered = state.templates;
    if (state.templateFilterChannel) {
      filtered = filtered.filter(function(t) { return t.channel === state.templateFilterChannel; });
    }

    // Sort
    var sorted = filtered.slice().sort(function(a, b) {
      var av = String(a[state.templatesSortKey] || '');
      var bv = String(b[state.templatesSortKey] || '');
      return state.templatesSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    var html = '<div class="cc-admin-templates">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Email & SMS Templates</h3>';
    html += '<div class="cc-admin-template-actions">';

    // Channel filter
    html += '<select id="cc-filter-template-channel" class="cc-input cc-input-sm">';
    html += '<option value="">All Channels</option>';
    CHANNEL_OPTIONS.forEach(function(ch) {
      html += '<option value="' + ch + '"' + (state.templateFilterChannel === ch ? ' selected' : '') + '>' + ch + '</option>';
    });
    html += '</select>';

    html += '<button id="cc-create-template-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ New Template</button>';
    html += '</div>';
    html += '</div>';

    if (sorted.length === 0 && !state.templatesLoading) {
      html += '<div class="cc-empty"><p>No templates found.' +
        (state.templates.length ? ' Try adjusting the filter.' : ' Create your first template.') + '</p></div>';
      html += '</div>';
      content.innerHTML = html;
      bindTemplateFilterEvents();
      return;
    }

    var columns = [
      { key: 'name', label: 'Template Name' },
      { key: 'channel', label: 'Channel' },
      { key: 'subject', label: 'Subject' }
    ];

    html += '<table class="cc-table cc-admin-templates-table">';
    html += '<thead><tr>';
    columns.forEach(function(col) {
      var arrow = '';
      var cls = 'cc-th cc-th-sortable';
      if (state.templatesSortKey === col.key) {
        cls += ' cc-th-sorted';
        arrow = state.templatesSortDir === 'asc' ? ' &#9650;' : ' &#9660;';
      }
      html += '<th class="' + cls + '" data-col="' + col.key + '">' + col.label + arrow + '</th>';
    });
    html += '<th class="cc-th">Preview</th>';
    html += '<th class="cc-th">Actions</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function(t) {
      var channelCls = t.channel === 'EMAIL' ? 'blue' : 'green';
      var bodyPreview = t.channel === 'EMAIL'
        ? truncate(stripHtml(t.body_html || ''), 60)
        : truncate(t.body_text || '', 60);

      html += '<tr data-template-id="' + escapeAttr(t.id) + '">';
      html += '<td class="cc-template-name-cell">' + escapeHtml(t.name || 'Untitled') + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + channelCls + '">' + escapeHtml(t.channel || '') + '</span></td>';
      html += '<td>' + escapeHtml(t.subject || '\u2014') + '</td>';
      html += '<td class="cc-template-preview-cell">' + escapeHtml(bodyPreview || '\u2014') + '</td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-edit-template-btn" data-template-id="' + escapeAttr(t.id) + '">Edit</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    content.innerHTML = html;

    bindTemplateEvents();
    bindTemplateFilterEvents();
  }

  function bindTemplateFilterEvents() {
    var channelEl = $el('cc-filter-template-channel');
    if (channelEl) {
      channelEl.addEventListener('change', function() {
        state.templateFilterChannel = channelEl.value;
        renderTemplatesTab();
      });
    }

    var createBtn = $el('cc-create-template-btn');
    if (createBtn) createBtn.addEventListener('click', showCreateTemplateModal);
  }

  function bindTemplateEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Sort headers
    content.querySelectorAll('.cc-admin-templates-table .cc-th-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var col = th.dataset.col;
        if (state.templatesSortKey === col) {
          state.templatesSortDir = state.templatesSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.templatesSortKey = col;
          state.templatesSortDir = 'asc';
        }
        renderTemplatesTab();
      });
    });

    // Edit buttons
    content.querySelectorAll('.cc-edit-template-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tid = btn.dataset.templateId;
        var tpl = state.templates.find(function(t) { return t.id === tid; });
        if (tpl) showEditTemplateModal(tpl);
      });
    });
  }

  function showCreateTemplateModal() {
    showModal('New Template', buildTemplateForm({}), function(form) {
      return handleCreateTemplate(form);
    });
    initTemplateEditor('');
    bindTokenButtons();
  }

  function showEditTemplateModal(tpl) {
    showModal('Edit Template', buildTemplateForm(tpl), function(form) {
      return handleUpdateTemplate(tpl.id, form);
    });
    initTemplateEditor(tpl.body_html || '');
    bindTokenButtons();
  }

  function bindTokenButtons() {
    var btns = document.querySelectorAll('.cc-token-btn');
    btns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var token = btn.getAttribute('data-token');
        if (_quillEditor) {
          var range = _quillEditor.getSelection(true);
          _quillEditor.insertText(range.index, token);
        } else {
          // Fallback: insert into textarea
          var ta = document.getElementById('cc-modal-tpl-body-html');
          if (!ta) ta = document.getElementById('cc-modal-tpl-body-text');
          if (ta) {
            var start = ta.selectionStart || 0;
            var end = ta.selectionEnd || 0;
            ta.value = ta.value.substring(0, start) + token + ta.value.substring(end);
            ta.selectionStart = ta.selectionEnd = start + token.length;
            ta.focus();
          }
        }
      });
    });
  }

  var PRACTICE_AREA_OPTIONS = ['All', 'Estate Planning', 'Real Estate', 'Probate', 'Business Law', 'Family Law', 'Immigration', 'Litigation', 'Other'];
  var TEMPLATE_TOKENS = [
    { label: 'Client Name', value: '{{Client_Name}}' },
    { label: 'Client Email', value: '{{Client_Email}}' },
    { label: 'Practice Area', value: '{{Practice_Area}}' },
    { label: 'Owner Name', value: '{{Lead_Owner_Name}}' },
    { label: 'Unsubscribe URL', value: '{{Unsubscribe_URL}}' }
  ];

  var _quillEditor = null;

  function ensureQuillLoaded(cb) {
    if (window.Quill) { cb(); return; }
    // Load Quill CSS
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css';
    document.head.appendChild(link);
    // Load Quill JS
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  function initTemplateEditor(bodyHtml) {
    ensureQuillLoaded(function() {
      var container = document.getElementById('cc-modal-tpl-body-html');
      if (!container) return;
      // Replace textarea with a div for Quill
      var editorDiv = document.createElement('div');
      editorDiv.id = 'cc-quill-editor';
      editorDiv.style.cssText = 'height:250px;background:white;';
      container.style.display = 'none';
      container.parentNode.insertBefore(editorDiv, container.nextSibling);

      _quillEditor = new Quill('#cc-quill-editor', {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ color: [] }, { background: [] }],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['link', 'image'],
            [{ align: [] }],
            ['blockquote', 'code-block'],
            ['clean']
          ]
        }
      });
      if (bodyHtml) {
        _quillEditor.root.innerHTML = bodyHtml;
      }
    });
  }

  function destroyTemplateEditor() {
    _quillEditor = null;
    var editorDiv = document.getElementById('cc-quill-editor');
    if (editorDiv) editorDiv.remove();
  }

  function buildTemplateForm(existing) {
    var isEmail = (existing.channel || 'EMAIL') === 'EMAIL';

    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Template Name</label>';
    html += '<input type="text" id="cc-modal-tpl-name" class="cc-input" value="' + escapeAttr(existing.name || '') + '" placeholder="e.g. Welcome Series - Step 1" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Channel</label>';
    html += '<select id="cc-modal-tpl-channel" class="cc-input">';
    CHANNEL_OPTIONS.forEach(function(ch) {
      html += '<option value="' + ch + '"' + (existing.channel === ch ? ' selected' : '') + '>' + ch + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Practice Area</label>';
    html += '<select id="cc-modal-tpl-practice-area" class="cc-input">';
    PRACTICE_AREA_OPTIONS.forEach(function(pa) {
      html += '<option value="' + pa + '"' + (existing.practice_area === pa ? ' selected' : '') + '>' + pa + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div id="cc-modal-tpl-email-fields"' + (isEmail ? '' : ' style="display:none"') + '>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Subject Line</label>';
    html += '<input type="text" id="cc-modal-tpl-subject" class="cc-input" value="' + escapeAttr(existing.subject || '') + '" placeholder="Email subject" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Body (HTML)</label>';
    html += '<textarea id="cc-modal-tpl-body-html" class="cc-input cc-textarea" rows="8" placeholder="HTML email body">' + escapeHtml(existing.body_html || '') + '</textarea>';
    html += '</div>';

    html += '</div>';

    html += '<div id="cc-modal-tpl-sms-fields"' + (!isEmail ? '' : ' style="display:none"') + '>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Body (Text)</label>';
    html += '<textarea id="cc-modal-tpl-body-text" class="cc-input cc-textarea" rows="4" placeholder="SMS text. Use {{Client_Name}} etc. Max 160 chars recommended.">' + escapeHtml(existing.body_text || '') + '</textarea>';
    html += '</div>';

    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Insert Token</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    TEMPLATE_TOKENS.forEach(function(tok) {
      html += '<button type="button" class="cc-btn cc-btn-outline cc-token-btn" data-token="' + escapeAttr(tok.value) + '" style="font-size:12px;padding:4px 10px;border-radius:4px;">' + escapeHtml(tok.label) + '</button>';
    });
    html += '</div>';
    html += '</div>';

    html += '</div>';

    return html;
  }

  async function handleCreateTemplate(form) {
    var name = form.querySelector('#cc-modal-tpl-name').value.trim();
    var channel = form.querySelector('#cc-modal-tpl-channel').value;
    var practiceArea = form.querySelector('#cc-modal-tpl-practice-area').value;

    if (!name) { showToast('Template name is required.', 'error'); return false; }

    var data = { name: name, channel: channel, practice_area: practiceArea };

    if (channel === 'EMAIL') {
      data.subject = form.querySelector('#cc-modal-tpl-subject').value.trim();
      var editor = _quillEditor;
      data.body_html = editor ? editor.root.innerHTML : form.querySelector('#cc-modal-tpl-body-html').value;
    } else {
      data.body_text = form.querySelector('#cc-modal-tpl-body-text').value;
    }

    try {
      var result = await API.admin.createTemplate(data);
      if (result.success) {
        showToast('Template created.', 'success');
        closeModal();
        fetchTemplates();
        return true;
      } else {
        showToast(result.error || 'Failed to create template.', 'error');
        return false;
      }
    } catch (err) {
      showToast(err.error || 'Error creating template.', 'error');
      return false;
    }
  }

  async function handleUpdateTemplate(templateId, form) {
    var name = form.querySelector('#cc-modal-tpl-name').value.trim();
    var channel = form.querySelector('#cc-modal-tpl-channel').value;
    var practiceArea = form.querySelector('#cc-modal-tpl-practice-area').value;

    if (!name) { showToast('Template name is required.', 'error'); return false; }

    var fields = { name: name, channel: channel, practice_area: practiceArea };

    if (channel === 'EMAIL') {
      fields.subject = form.querySelector('#cc-modal-tpl-subject').value.trim();
      var editor = _quillEditor;
      fields.body_html = editor ? editor.root.innerHTML : form.querySelector('#cc-modal-tpl-body-html').value;
    } else {
      fields.body_text = form.querySelector('#cc-modal-tpl-body-text').value;
    }

    try {
      var result = await API.admin.updateTemplate(templateId, fields);
      if (result.success) {
        showToast('Template updated.', 'success');
        closeModal();
        fetchTemplates();
        return true;
      } else {
        showToast(result.error || 'Failed to update template.', 'error');
        return false;
      }
    } catch (err) {
      showToast(err.error || 'Error updating template.', 'error');
      return false;
    }
  }

  // ─── Staff Import Modal (used by Staff & Users tab) ──────

  function bindStaffImportBtn() {
    var btn = $el('cc-import-staff-btn');
    if (btn) btn.addEventListener('click', showStaffImportModal);
  }

  async function showStaffImportModal() {
    var bodyHtml = '<div id="cc-import-staff-list"><div class="cc-loading"><div class="cc-spinner"></div><p>Loading Office 365 users...</p></div></div>';

    showModal('Import from Office 365', bodyHtml, function() { closeModal(); return true; });

    // Replace save button text with "Done"
    var saveBtn = document.querySelector('.cc-modal-save-btn');
    if (saveBtn) saveBtn.textContent = 'Done';

    try {
      var result = await bookingAdminFetch('staff', { action: 'list-office365-users' });
      var users = result.users || [];
      var listEl = document.getElementById('cc-import-staff-list');
      if (!listEl) return;

      if (users.length === 0) {
        listEl.innerHTML = '<p class="cc-admin-hint" style="text-align:center;">No Office 365 users found.</p>';
        return;
      }

      var importedEmails = {};
      state.staffList.forEach(function(s) {
        if (s.email) importedEmails[s.email.toLowerCase()] = true;
      });

      var html = '';
      users.forEach(function(u) {
        var already = importedEmails[(u.mail || '').toLowerCase()] || false;
        var btnHtml = already
          ? '<span class="cc-badge cc-badge-green">Imported</span>'
          : '<button class="cc-btn cc-btn-sm cc-btn-primary cc-import-user-btn" data-userid="' + escapeAttr(u.id) + '" data-name="' + escapeAttr(u.displayName) + '" data-email="' + escapeAttr(u.mail) + '">Import</button>';

        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid #F3F4F6;' + (already ? 'opacity:0.5;' : '') + '">';
        html += '<div><div style="font-weight:500;font-size:0.9rem;">' + escapeHtml(u.displayName || '') + '</div>';
        html += '<div style="font-size:0.8rem;color:#6B7280;">' + escapeHtml(u.mail || '') + (u.jobTitle ? ' &middot; ' + escapeHtml(u.jobTitle) : '') + '</div></div>';
        html += '<div>' + btnHtml + '</div>';
        html += '</div>';
      });
      listEl.innerHTML = html;

      listEl.querySelectorAll('.cc-import-user-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          btn.textContent = 'Importing...';
          btn.disabled = true;
          try {
            var result = await bookingAdminFetch('staff', {
              action: 'import-user',
              userId: btn.dataset.userid,
              displayName: btn.dataset.name,
              email: btn.dataset.email
            });
            if (result.staff) state.staffList.push(result.staff);
            btn.parentElement.innerHTML = '<span class="cc-badge cc-badge-green">Imported</span>';
            renderStaffUsersTab();
          } catch (err) {
            btn.textContent = 'Import';
            btn.disabled = false;
            showToast(err.error || 'Failed to import user.', 'error');
          }
        });
      });
    } catch (err) {
      var listEl = document.getElementById('cc-import-staff-list');
      if (listEl) listEl.innerHTML = '<p style="color:#DC2626;text-align:center;">' + escapeHtml(err.error || 'Failed to load Office 365 users.') + '</p>';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CATEGORIES TAB
  // ═══════════════════════════════════════════════════════════

  async function fetchCategories() {
    state.categoriesLoading = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading categories...</p></div>';

    try {
      var result = await categoriesApiFetch('list');
      state.categories = result.categories || [];
    } catch (err) {
      state.categories = [];
      showToast(err.error || 'Failed to load categories.', 'error');
    }

    state.categoriesLoading = false;
    renderCategoriesTab();
  }

  function renderCategoriesTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    var html = '<div class="cc-admin-categories">';
    html += '<h3 class="cc-admin-section-title">Meeting Type Categories</h3>';
    html += '<p class="cc-admin-hint">Manage the categories available for booking meeting types.</p>';

    // Add form
    html += '<div style="display:flex;gap:0.5rem;margin:1rem 0 1.5rem;align-items:center;">';
    html += '<input id="cc-cat-input" type="text" class="cc-input" placeholder="New category name" style="flex:1;" />';
    html += '<button id="cc-cat-add-btn" class="cc-btn cc-btn-primary cc-btn-sm">Add</button>';
    html += '</div>';

    if (state.categories.length === 0 && !state.categoriesLoading) {
      html += '<div class="cc-empty"><p>No categories yet. Add one above.</p></div>';
      html += '</div>';
      content.innerHTML = html;
      bindCategoryEvents();
      return;
    }

    html += '<table class="cc-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th">Name</th>';
    html += '<th class="cc-th" style="width:140px;">Actions</th>';
    html += '</tr></thead><tbody>';

    state.categories.forEach(function(cat) {
      html += '<tr>';
      html += '<td>' + escapeHtml(cat.name || '') + '</td>';
      html += '<td style="display:flex;gap:4px;">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-cat-edit-btn" data-cat-id="' + cat.id + '" data-cat-name="' + escapeAttr(cat.name) + '">Edit</button>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-cat-delete-btn" data-cat-id="' + cat.id + '" data-cat-name="' + escapeAttr(cat.name) + '">Delete</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    content.innerHTML = html;

    bindCategoryEvents();
  }

  function bindCategoryEvents() {
    var addBtn = $el('cc-cat-add-btn');
    var addInput = $el('cc-cat-input');

    if (addBtn) addBtn.addEventListener('click', handleAddCategory);
    if (addInput) addInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleAddCategory();
    });

    var content = $el('cc-admin-content');
    if (!content) return;
    content.querySelectorAll('.cc-cat-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var newName = prompt('Rename category:', btn.dataset.catName);
        if (newName && newName.trim() && newName.trim() !== btn.dataset.catName) {
          handleEditCategory(btn.dataset.catId, newName.trim());
        }
      });
    });

    content.querySelectorAll('.cc-cat-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (confirm('Delete category "' + btn.dataset.catName + '"?')) {
          handleDeleteCategory(btn.dataset.catId);
        }
      });
    });
  }

  async function handleEditCategory(id, newName) {
    try {
      // API doesn't support update — delete old + add new, then re-fetch
      await categoriesApiFetch('delete', { id: id });
      await categoriesApiFetch('add', { name: newName });
      var result = await categoriesApiFetch('list');
      state.categories = result.categories || [];
      renderCategoriesTab();
      showToast('Category renamed.', 'success');
    } catch (err) {
      // Re-fetch in case partial success
      try { var r = await categoriesApiFetch('list'); state.categories = r.categories || []; renderCategoriesTab(); } catch(e) {}
      showToast(err.error || 'Failed to rename category.', 'error');
    }
  }

  async function handleAddCategory() {
    var input = $el('cc-cat-input');
    if (!input) return;
    var name = input.value.trim();
    if (!name) { input.focus(); return; }

    var addBtn = $el('cc-cat-add-btn');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding...'; }

    try {
      var result = await categoriesApiFetch('add', { name: name });
      state.categories = result.categories || [];
      renderCategoriesTab();
      var newInput = $el('cc-cat-input');
      if (newInput) newInput.focus();
    } catch (err) {
      showToast(err.error || 'Failed to add category.', 'error');
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add'; }
    }
  }

  async function handleDeleteCategory(id) {
    try {
      var result = await categoriesApiFetch('delete', { id: id });
      state.categories = result.categories || [];
      renderCategoriesTab();
    } catch (err) {
      showToast(err.error || 'Failed to delete category.', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // GENERIC CONFIG TAB (Lead Sources, Stages, Dispositions, Activity Types, Entity Types)
  // ═══════════════════════════════════════════════════════════

  async function fetchConfigItems(configKey) {
    state.configLoading[configKey] = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading...</p></div>';

    try {
      var result = await API.admin.config.list(configKey);
      state.configItems[configKey] = result.data || [];
    } catch (err) {
      state.configItems[configKey] = [];
      showToast(err.error || 'Failed to load items.', 'error');
    }

    state.configLoading[configKey] = false;
  }

  function renderConfigTab(configKey, label) {
    var content = $el('cc-admin-content');
    if (!content) return;

    var metaFields = CONFIG_META[configKey] || [];
    var hideOrder = configKey === 'tag';
    var items = (state.configItems[configKey] || []).slice().sort(function(a, b) {
      if (hideOrder) {
        // Tags: sort by category then label
        var mA = {}; try { mA = JSON.parse(a.Meta || '{}'); } catch(e) {}
        var mB = {}; try { mB = JSON.parse(b.Meta || '{}'); } catch(e) {}
        var catA = (mA.category || 'Uncategorized').toLowerCase();
        var catB = (mB.category || 'Uncategorized').toLowerCase();
        if (catA !== catB) return catA < catB ? -1 : 1;
        return (a.Label || '').localeCompare(b.Label || '');
      }
      return (a.Sort_Order || 0) - (b.Sort_Order || 0);
    });

    var html = '<div class="cc-admin-config">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">' + escapeHtml(label) + '</h3>';
    html += '<button id="cc-config-add-btn" class="cc-btn cc-btn-primary cc-btn-sm" data-config-key="' + configKey + '">+ Add New</button>';
    html += '</div>';

    if (items.length === 0 && !state.configLoading[configKey]) {
      html += '<div class="cc-empty"><p>No ' + escapeHtml(label.toLowerCase()) + ' configured yet.</p></div>';
      html += '</div>';
      content.innerHTML = html;
      bindConfigAddBtn(configKey, label, metaFields);
      return;
    }

    html += '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">';
    html += '<table class="cc-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th" style="width:auto;">Label</th>';
    if (!hideOrder) html += '<th class="cc-th" style="width:80px;">Order</th>';
    metaFields.forEach(function(mf) {
      html += '<th class="cc-th">' + escapeHtml(mf.label) + '</th>';
    });
    html += '<th class="cc-th" style="width:80px;">Active</th>';
    html += '<th class="cc-th" style="width:140px;">Actions</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function(item) {
      var meta = {};
      try { meta = JSON.parse(item.Meta || '{}'); } catch(e) {}
      var activeCls = item.Is_Active ? 'green' : 'gray';
      var activeText = item.Is_Active ? 'Yes' : 'No';

      html += '<tr style="border-bottom:1px solid #F3F4F6;transition:background 0.1s;" onmouseover="this.style.background=\'#F9FAFB\'" onmouseout="this.style.background=\'\'">';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;font-weight:500;">' + escapeHtml(item.Label || '') + '</td>';
      if (!hideOrder) html += '<td style="padding:0.6rem 1rem;vertical-align:middle;">' + (item.Sort_Order || 0) + '</td>';
      metaFields.forEach(function(mf) {
        var val = meta[mf.key] || '';
        if (mf.type === 'color' && val) {
          html += '<td style="padding:0.6rem 1rem;vertical-align:middle;"><span class="cc-color-swatch" style="background:' + escapeAttr(val) + '"></span> ' + escapeHtml(val) + '</td>';
        } else {
          html += '<td style="padding:0.6rem 1rem;vertical-align:middle;">' + escapeHtml(String(val)) + '</td>';
        }
      });
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;"><span class="cc-badge cc-badge-' + activeCls + '">' + activeText + '</span></td>';
      html += '<td style="padding:0.6rem 1rem;vertical-align:middle;">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-config-edit-btn" data-item-id="' + escapeAttr(item.id) + '">Edit</button> ';
      if (item.Is_Active) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-config-deactivate-btn" data-item-id="' + escapeAttr(item.id) + '">Deactivate</button>';
      } else {
        html += '<button class="cc-btn cc-btn-sm cc-btn-success-outline cc-config-activate-btn" data-item-id="' + escapeAttr(item.id) + '">Activate</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += '</div>';
    content.innerHTML = html;

    bindConfigAddBtn(configKey, label, metaFields);
    bindConfigTableEvents(configKey, label, metaFields);
  }

  function bindConfigAddBtn(configKey, label, metaFields) {
    var btn = $el('cc-config-add-btn');
    if (btn) btn.addEventListener('click', function() {
      showConfigModal(configKey, label, metaFields, null);
    });
  }

  function bindConfigTableEvents(configKey, label, metaFields) {
    var content = $el('cc-admin-content');
    if (!content) return;

    content.querySelectorAll('.cc-config-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = (state.configItems[configKey] || []).find(function(i) { return i.id === btn.dataset.itemId; });
        if (item) showConfigModal(configKey, label, metaFields, item);
      });
    });

    content.querySelectorAll('.cc-config-deactivate-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Deactivate this item? It will be hidden from dropdowns.')) return;
        try {
          await API.admin.config.delete(btn.dataset.itemId);
          showToast('Item deactivated.', 'success');
          await fetchConfigItems(configKey);
          renderConfigTab(configKey, label);
        } catch (err) {
          showToast(err.error || 'Failed to deactivate.', 'error');
        }
      });
    });

    content.querySelectorAll('.cc-config-activate-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        try {
          await API.admin.config.update(btn.dataset.itemId, { Is_Active: true });
          showToast('Item activated.', 'success');
          await fetchConfigItems(configKey);
          renderConfigTab(configKey, label);
        } catch (err) {
          showToast(err.error || 'Failed to activate.', 'error');
        }
      });
    });
  }

  function showConfigModal(configKey, label, metaFields, existing) {
    var isEdit = !!existing;
    var meta = {};
    if (existing) { try { meta = JSON.parse(existing.Meta || '{}'); } catch(e) {} }

    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Label</label>';
    html += '<input type="text" id="cc-modal-config-label" class="cc-input" value="' + escapeAttr(existing ? existing.Label : '') + '" placeholder="Display label" />';
    html += '</div>';

    if (configKey !== 'tag') {
      html += '<div class="cc-form-group">';
      html += '<label class="cc-label">Sort Order</label>';
      html += '<input type="number" id="cc-modal-config-sort" class="cc-input" value="' + (existing ? (existing.Sort_Order || 0) : 0) + '" />';
      html += '</div>';
    }

    metaFields.forEach(function(mf) {
      html += '<div class="cc-form-group">';
      html += '<label class="cc-label">' + escapeHtml(mf.label) + '</label>';
      if (mf.type === 'color') {
        html += '<input type="color" id="cc-modal-config-meta-' + mf.key + '" class="cc-input" value="' + escapeAttr(meta[mf.key] || '#3B82F6') + '" style="height:38px;padding:2px;" />';
      } else if (mf.type === 'number') {
        html += '<input type="number" id="cc-modal-config-meta-' + mf.key + '" class="cc-input" value="' + escapeAttr(meta[mf.key] || '') + '" />';
      } else if (mf.type === 'select' && mf.choices) {
        html += '<select id="cc-modal-config-meta-' + mf.key + '" class="cc-input">';
        html += '<option value="">— Select —</option>';
        mf.choices.forEach(function(ch) {
          var sel = (meta[mf.key] || '') === ch ? ' selected' : '';
          html += '<option value="' + escapeAttr(ch) + '"' + sel + '>' + escapeHtml(ch) + '</option>';
        });
        html += '</select>';
      } else {
        html += '<input type="text" id="cc-modal-config-meta-' + mf.key + '" class="cc-input" value="' + escapeAttr(meta[mf.key] || '') + '" />';
      }
      html += '</div>';
    });

    html += '</div>';

    var title = isEdit ? 'Edit ' + label.replace(/s$/, '') : 'New ' + label.replace(/s$/, '');
    showModal(title, html, async function(form) {
      var labelVal = form.querySelector('#cc-modal-config-label').value.trim();
      if (!labelVal) { showToast('Label is required.', 'error'); return false; }

      var sortEl = form.querySelector('#cc-modal-config-sort');
      var sortOrder = sortEl ? (parseInt(sortEl.value) || 0) : (existing ? (existing.Sort_Order || 0) : 0);

      var metaObj = {};
      metaFields.forEach(function(mf) {
        var el = form.querySelector('#cc-modal-config-meta-' + mf.key);
        if (el) metaObj[mf.key] = mf.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
      });

      try {
        if (isEdit) {
          await API.admin.config.update(existing.id, {
            Label: labelVal,
            Sort_Order: sortOrder,
            Meta: JSON.stringify(metaObj)
          });
          showToast('Item updated.', 'success');
        } else {
          await API.admin.config.create({
            Config_Key: configKey,
            Label: labelVal,
            Sort_Order: sortOrder,
            Is_Active: true,
            Meta: JSON.stringify(metaObj)
          });
          showToast('Item created.', 'success');
        }
        closeModal();
        await fetchConfigItems(configKey);
        renderConfigTab(configKey, label);
        return true;
      } catch (err) {
        showToast(err.error || 'Failed to save.', 'error');
        return false;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // GENERIC MODAL
  // ═══════════════════════════════════════════════════════════

  var activeModal = null;

  function showModal(title, bodyHtml, onSubmit) {
    closeModal();

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'cc-modal';

    modal.innerHTML =
      '<div class="cc-modal-header">' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        '<button class="cc-modal-close">&times;</button>' +
      '</div>' +
      '<div class="cc-modal-body">' + bodyHtml + '</div>' +
      '<div class="cc-modal-footer">' +
        '<button class="cc-btn cc-btn-outline cc-modal-cancel-btn">Cancel</button>' +
        '<button class="cc-btn cc-btn-primary cc-modal-save-btn">Save</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeModal = overlay;

    // Focus first input
    var firstInput = modal.querySelector('input:not([readonly]), select, textarea');
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);

    // Toggle email/SMS fields on channel change
    var channelSelect = modal.querySelector('#cc-modal-tpl-channel');
    if (channelSelect) {
      channelSelect.addEventListener('change', function() {
        var emailFields = modal.querySelector('#cc-modal-tpl-email-fields');
        var smsFields = modal.querySelector('#cc-modal-tpl-sms-fields');
        if (channelSelect.value === 'EMAIL') {
          if (emailFields) emailFields.style.display = '';
          if (smsFields) smsFields.style.display = 'none';
        } else {
          if (emailFields) emailFields.style.display = 'none';
          if (smsFields) smsFields.style.display = '';
        }
      });
    }

    // Bind close
    overlay.querySelector('.cc-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('.cc-modal-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal();
    });

    // Bind save (with double-click guard)
    overlay.querySelector('.cc-modal-save-btn').addEventListener('click', async function() {
      var saveBtn = this;
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        var formEl = modal.querySelector('.cc-modal-body');
        await onSubmit(formEl);
      } catch (e) {
        // onSubmit handles errors via toast
      } finally {
        if (saveBtn.parentNode) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      }
    });
  }

  function closeModal() {
    destroyTemplateEditor();
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PRICE BOOK TAB
  // ═══════════════════════════════════════════════════════════

  function formatCurrency(val) {
    var n = parseFloat(val) || 0;
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  async function fetchPriceBookItems() {
    state.priceBookLoading = true;
    renderPriceBookTab();
    try {
      var res = await API.priceBook.list(true);
      state.priceBookItems = (res.items || []).sort(function(a, b) {
        return (a.Sort_Order || 0) - (b.Sort_Order || 0);
      });
    } catch (err) {
      showToast(err.error || 'Failed to load price book.', 'error');
      state.priceBookItems = [];
    }
    state.priceBookLoading = false;
    renderPriceBookTab();
  }

  var PB_PRACTICE_AREAS = [
    { key: 'ESTATE_PLANNING', label: 'Estate Planning' },
    { key: 'PROBATE', label: 'Probate' },
    { key: 'REAL_ESTATE', label: 'Real Estate' },
    { key: 'CORPORATE', label: 'Corporate Law' },
    { key: 'FAMILY_LAW', label: 'Family Law' },
    { key: 'COMMISSION_NOTARY', label: 'Commission & Notary' },
    { key: 'OTHER', label: 'Other' }
  ];

  // Build label→key lookup for mapping Airtable Practice_Area values to PB keys
  var PB_LABEL_TO_KEY = {};
  PB_PRACTICE_AREAS.forEach(function(pa) { PB_LABEL_TO_KEY[pa.label] = pa.key; });
  // Extra aliases for Airtable values that don't exactly match labels
  PB_LABEL_TO_KEY['Corporate'] = 'CORPORATE';
  PB_LABEL_TO_KEY['Probat & Estate Admin'] = 'PROBATE';
  PB_LABEL_TO_KEY['Miscellaneous'] = 'OTHER';

  function renderPriceBookTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    var items = state.priceBookItems || [];

    var html = '<div class="cc-admin-config">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Price Book</h3>';
    html += '<button id="cc-pb-add-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ Add Service</button>';
    html += '</div>';

    if (state.priceBookLoading) {
      html += '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading...</p></div></div>';
      content.innerHTML = html;
      return;
    }

    // If detail view, render it
    if (state.priceBookDetail) {
      html += renderPriceBookDetailHtml(state.priceBookDetail);
      html += '</div>';
      content.innerHTML = html;
      bindPriceBookDetailEvents();
      return;
    }

    if (items.length === 0) {
      html += '<div class="cc-empty"><p>No services configured yet.</p></div></div>';
      content.innerHTML = html;
      bindPriceBookAddBtn();
      return;
    }

    // Group items by Practice_Area (map Airtable labels to PB keys)
    var grouped = {};
    PB_PRACTICE_AREAS.forEach(function(pa) { grouped[pa.key] = []; });
    items.forEach(function(item) {
      var raw = item.Practice_Area || '';
      var key = PB_LABEL_TO_KEY[raw] || 'OTHER';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });

    var activePAs = PB_PRACTICE_AREAS.filter(function(pa) {
      return grouped[pa.key] && grouped[pa.key].length > 0;
    });

    // Practice area filter tabs
    var filterPa = state.priceBookFilterPA || 'ALL';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">';
    html += '<button class="cc-pb-pa-filter cc-btn cc-btn-sm' + (filterPa === 'ALL' ? ' cc-btn-primary' : ' cc-btn-outline') + '" data-pa="ALL">All (' + items.length + ')</button>';
    activePAs.forEach(function(pa) {
      var count = grouped[pa.key].length;
      html += '<button class="cc-pb-pa-filter cc-btn cc-btn-sm' + (filterPa === pa.key ? ' cc-btn-primary' : ' cc-btn-outline') + '" ' +
        'data-pa="' + escapeAttr(pa.key) + '">' + escapeHtml(pa.label) + ' (' + count + ')</button>';
    });
    html += '</div>';

    if (filterPa === 'ALL') {
      // Accordion view: each practice area is a collapsible section
      activePAs.forEach(function(pa, idx) {
        var paItems = grouped[pa.key];
        var accId = 'cc-pb-acc-' + pa.key;
        html += '<div style="margin-bottom:8px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">';
        html += '<div class="cc-pb-acc-header" data-target="' + accId + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;cursor:pointer;user-select:none;">';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += '<span class="cc-pb-acc-arrow" style="display:inline-block;transition:transform .2s;transform:rotate(0deg);font-size:12px;color:#64748b;">&#9654;</span>';
        html += '<span style="font-weight:600;font-size:14px;color:#334155;">' + escapeHtml(pa.label) + '</span>';
        html += '<span style="color:#94a3b8;font-size:13px;">(' + paItems.length + ' service' + (paItems.length > 1 ? 's' : '') + ')</span>';
        html += '</div></div>';
        html += '<div id="' + accId + '" style="display:none;">';
        html += renderPriceBookTable(paItems);
        html += '</div></div>';
      });
    } else {
      html += renderPriceBookTable(grouped[filterPa] || []);
    }

    html += '</div>';
    content.innerHTML = html;
    bindPriceBookAddBtn();
    bindPriceBookTableEvents();
    bindPriceBookPAFilter();
  }

  function renderPriceBookTable(tableItems) {
    var html = '<table class="cc-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th">Service Name</th>';
    html += '<th class="cc-th" style="width:120px;">List Price</th>';
    html += '<th class="cc-th" style="width:80px;">Active</th>';
    html += '<th class="cc-th" style="width:260px;">Actions</th>';
    html += '</tr></thead><tbody>';

    tableItems.forEach(function(item) {
      var activeCls = item.Is_Active ? 'green' : 'gray';
      var activeText = item.Is_Active ? 'Yes' : 'No';
      html += '<tr>';
      html += '<td><a href="#" class="cc-pb-detail-link" data-id="' + escapeAttr(item.id) + '">' + escapeHtml(item.Service_Name || '') + '</a></td>';
      html += '<td>' + formatCurrency(item.List_Price) + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + activeCls + '">' + activeText + '</span></td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-pb-edit-btn" data-id="' + escapeAttr(item.id) + '">Edit</button> ';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-pb-cost-btn" data-id="' + escapeAttr(item.id) + '" style="color:#059669;border-color:#059669;">Cost</button> ';
      if (item.Is_Active) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-pb-toggle-btn" data-id="' + escapeAttr(item.id) + '" data-active="false">Deactivate</button>';
      } else {
        html += '<button class="cc-btn cc-btn-sm cc-btn-success-outline cc-pb-toggle-btn" data-id="' + escapeAttr(item.id) + '" data-active="true">Activate</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  function bindPriceBookPAFilter() {
    var content = $el('cc-admin-content');
    if (!content) return;
    content.querySelectorAll('.cc-pb-pa-filter').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.priceBookFilterPA = btn.dataset.pa;
        renderPriceBookTab();
      });
    });
    // Accordion toggle for "All" grouped view
    content.querySelectorAll('.cc-pb-acc-header').forEach(function(header) {
      header.addEventListener('click', function() {
        var targetId = header.dataset.target;
        var body = document.getElementById(targetId);
        var arrow = header.querySelector('.cc-pb-acc-arrow');
        if (!body) return;
        var isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
      });
    });
  }

  function bindPriceBookAddBtn() {
    var btn = $el('cc-pb-add-btn');
    if (btn) btn.addEventListener('click', function() {
      // Pre-select current filter PA if filtering by a specific practice area
      var defaultPa = (state.priceBookFilterPA && state.priceBookFilterPA !== 'ALL') ? state.priceBookFilterPA : null;
      showPriceBookModal(null, defaultPa);
    });
  }

  function bindPriceBookTableEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    content.querySelectorAll('.cc-pb-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = state.priceBookItems.find(function(i) { return i.id === btn.dataset.id; });
        if (item) showPriceBookModal(item);
      });
    });

    content.querySelectorAll('.cc-pb-cost-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openPriceBookDetail(btn.dataset.id);
      });
    });

    content.querySelectorAll('.cc-pb-toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var activate = btn.dataset.active === 'true';
        var label = activate ? 'activate' : 'deactivate';
        if (!confirm('Are you sure you want to ' + label + ' this service?')) return;
        try {
          await API.priceBook.update(btn.dataset.id, { Is_Active: activate });
          showToast('Service ' + label + 'd.', 'success');
          await fetchPriceBookItems();
        } catch (err) {
          showToast(err.error || 'Failed to ' + label + '.', 'error');
        }
      });
    });

    content.querySelectorAll('.cc-pb-detail-link').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        openPriceBookDetail(link.dataset.id);
      });
    });
  }

  async function openPriceBookDetail(serviceId) {
    state.priceBookDetailLoading = true;
    state.priceBookDetail = { id: serviceId };
    renderPriceBookTab();
    try {
      var res = await API.priceBook.get(serviceId);
      state.priceBookDetail = res.item || res;
      state.priceBookDetail.tasks = res.tasks || [];
    } catch (err) {
      showToast(err.error || 'Failed to load service details.', 'error');
      state.priceBookDetail = null;
    }
    state.priceBookDetailLoading = false;
    renderPriceBookTab();
  }

  function renderPriceBookDetailHtml(detail) {
    if (state.priceBookDetailLoading) {
      return '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading details...</p></div>';
    }

    var html = '<div style="margin-bottom:12px;">';
    html += '<button id="cc-pb-back-btn" class="cc-btn cc-btn-sm cc-btn-outline">&larr; Back to Price Book</button>';
    html += '</div>';

    html += '<div class="cc-card" style="margin-bottom:16px;padding:16px;">';
    html += '<h4 style="margin:0 0 8px;">' + escapeHtml(detail.Service_Name || '') + '</h4>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;">';
    html += '<div><strong>Practice Area:</strong> ' + escapeHtml(detail.Practice_Area || '---') + '</div>';
    html += '<div><strong>List Price:</strong> ' + formatCurrency(detail.List_Price) + '</div>';
    html += '<div style="grid-column:1/-1;"><strong>Description:</strong> ' + escapeHtml(detail.Description || '---') + '</div>';
    html += '<div><strong>Active:</strong> ' + (detail.Is_Active ? 'Yes' : 'No') + '</div>';
    html += '</div></div>';

    // Tasks table
    var tasks = (detail.tasks || []).sort(function(a, b) { return (a.Sort_Order || 0) - (b.Sort_Order || 0); });
    html += '<div class="cc-admin-section-header">';
    html += '<h4 class="cc-admin-section-title" style="font-size:15px;">Tasks & Costs</h4>';
    html += '<button id="cc-pb-task-add-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ Add Task</button>';
    html += '</div>';

    if (tasks.length === 0) {
      html += '<div class="cc-empty"><p>No tasks defined for this service.</p></div>';
    } else {
      html += '<table class="cc-table">';
      html += '<thead><tr>';
      html += '<th class="cc-th">Task Name</th>';
      html += '<th class="cc-th" style="width:120px;">Assignee Role</th>';
      html += '<th class="cc-th" style="width:100px;">Est. Hours</th>';
      html += '<th class="cc-th" style="width:100px;">Cost/Hr</th>';
      html += '<th class="cc-th" style="width:100px;">Total Cost</th>';
      html += '<th class="cc-th" style="width:80px;">Order</th>';
      html += '<th class="cc-th" style="width:80px;">Active</th>';
      html += '<th class="cc-th" style="width:140px;">Actions</th>';
      html += '</tr></thead><tbody>';

      tasks.forEach(function(t) {
        var activeCls = t.Is_Active ? 'green' : 'gray';
        html += '<tr>';
        html += '<td>' + escapeHtml(t.Task_Name || '') + '</td>';
        html += '<td>' + escapeHtml(t.Default_Assignee_Role || '---') + '</td>';
        html += '<td>' + (t.Estimated_Hours || 0) + '</td>';
        html += '<td>' + formatCurrency(t.Cost_Per_Hour) + '</td>';
        html += '<td>' + formatCurrency(t.Total_Cost) + '</td>';
        html += '<td>' + (t.Sort_Order || 0) + '</td>';
        html += '<td><span class="cc-badge cc-badge-' + activeCls + '">' + (t.Is_Active ? 'Yes' : 'No') + '</span></td>';
        html += '<td>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-pb-task-edit-btn" data-task-id="' + escapeAttr(t.id) + '">Edit</button> ';
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-pb-task-del-btn" data-task-id="' + escapeAttr(t.id) + '">Delete</button>';
        html += '</td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
    }

    return html;
  }

  function bindPriceBookDetailEvents() {
    var backBtn = $el('cc-pb-back-btn');
    if (backBtn) backBtn.addEventListener('click', function() {
      state.priceBookDetail = null;
      renderPriceBookTab();
    });

    var addBtn = $el('cc-pb-task-add-btn');
    if (addBtn) addBtn.addEventListener('click', function() {
      showPriceBookTaskModal(null, state.priceBookDetail.id);
    });

    var content = $el('cc-admin-content');
    if (!content) return;

    content.querySelectorAll('.cc-pb-task-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var task = (state.priceBookDetail.tasks || []).find(function(t) { return t.id === btn.dataset.taskId; });
        if (task) showPriceBookTaskModal(task, state.priceBookDetail.id);
      });
    });

    content.querySelectorAll('.cc-pb-task-del-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Delete this task? This cannot be undone.')) return;
        try {
          await API.priceBook.deleteTask(btn.dataset.taskId);
          showToast('Task deleted.', 'success');
          await openPriceBookDetail(state.priceBookDetail.id);
        } catch (err) {
          showToast(err.error || 'Failed to delete task.', 'error');
        }
      });
    });

    bindPriceBookAddBtn();
  }

  function showPriceBookModal(existing, defaultPa) {
    closeModal();
    var isEdit = !!existing;
    var title = isEdit ? 'Edit Service' : 'Add Service';
    var rawPa = (existing && existing.Practice_Area) || '';
    var selectedPa = (rawPa && PB_LABEL_TO_KEY[rawPa]) || rawPa || defaultPa || '';

    // Build practice area options from PB_PRACTICE_AREAS
    var paOptions = '<option value="">-- Select --</option>';
    PB_PRACTICE_AREAS.forEach(function(pa) {
      paOptions += '<option value="' + escapeAttr(pa.key) + '"' + (selectedPa === pa.key ? ' selected' : '') + '>' + escapeHtml(pa.label) + '</option>';
    });

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal">' +
        '<div class="cc-modal-header">' +
          '<h3>' + title + '</h3>' +
          '<button class="cc-modal-close">&times;</button>' +
        '</div>' +
        '<div class="cc-modal-body">' +
          '<div class="cc-form-group"><label>Service Name *</label>' +
          '<input type="text" id="cc-pb-name" class="cc-input" value="' + escapeAttr((existing && existing.Service_Name) || '') + '"></div>' +
          '<div class="cc-form-group"><label>Practice Area *</label>' +
          '<select id="cc-pb-pa" class="cc-input">' + paOptions + '</select></div>' +
          '<div class="cc-form-group"><label>List Price ($)</label>' +
          '<input type="number" id="cc-pb-price" class="cc-input" step="0.01" min="0" value="' + ((existing && existing.List_Price) || '') + '"></div>' +
          '<div class="cc-form-group"><label>Description</label>' +
          '<textarea id="cc-pb-desc" class="cc-input" rows="3">' + escapeHtml((existing && existing.Description) || '') + '</textarea></div>' +
          '<div class="cc-form-group"><label>Sort Order</label>' +
          '<input type="number" id="cc-pb-sort" class="cc-input" value="' + ((existing && existing.Sort_Order) || 0) + '"></div>' +
        '</div>' +
        '<div class="cc-modal-footer">' +
          '<button class="cc-btn cc-btn-outline cc-modal-cancel">Cancel</button>' +
          '<button id="cc-pb-save" class="cc-btn cc-btn-primary">' + (isEdit ? 'Update' : 'Create') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    activeModal = overlay;

    overlay.querySelector('.cc-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('.cc-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    $el('cc-pb-save').addEventListener('click', async function() {
      var name = $el('cc-pb-name').value.trim();
      if (!name) { showToast('Service Name is required.', 'error'); return; }

      var data = {
        Service_Name: name,
        Practice_Area: $el('cc-pb-pa').value || undefined,
        List_Price: parseFloat($el('cc-pb-price').value) || 0,
        Description: $el('cc-pb-desc').value.trim(),
        Sort_Order: parseInt($el('cc-pb-sort').value) || 0
      };

      try {
        if (isEdit) {
          await API.priceBook.update(existing.id, data);
          showToast('Service updated.', 'success');
        } else {
          await API.priceBook.create(data);
          showToast('Service created.', 'success');
        }
        closeModal();
        await fetchPriceBookItems();
      } catch (err) {
        showToast(err.error || 'Failed to save service.', 'error');
      }
    });
  }

  function showPriceBookTaskModal(existing, parentServiceId) {
    closeModal();
    var isEdit = !!existing;
    var title = isEdit ? 'Edit Task' : 'Add Task';

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal">' +
        '<div class="cc-modal-header">' +
          '<h3>' + title + '</h3>' +
          '<button class="cc-modal-close">&times;</button>' +
        '</div>' +
        '<div class="cc-modal-body">' +
          '<div class="cc-form-group"><label>Task Name *</label>' +
          '<input type="text" id="cc-pbt-name" class="cc-input" value="' + escapeAttr((existing && existing.Task_Name) || '') + '"></div>' +
          '<div class="cc-form-group"><label>Assignee Role</label>' +
          '<select id="cc-pbt-role" class="cc-input">' +
            '<option value="">-- Select --</option>' +
            '<option value="LAWYER"' + (existing && existing.Default_Assignee_Role === 'LAWYER' ? ' selected' : '') + '>Lawyer</option>' +
            '<option value="PARALEGAL"' + (existing && existing.Default_Assignee_Role === 'PARALEGAL' ? ' selected' : '') + '>Paralegal</option>' +
            '<option value="CLERK"' + (existing && existing.Default_Assignee_Role === 'CLERK' ? ' selected' : '') + '>Clerk</option>' +
          '</select></div>' +
          '<div class="cc-form-group"><label>Estimated Hours</label>' +
          '<input type="number" id="cc-pbt-hours" class="cc-input" step="0.25" min="0" value="' + ((existing && existing.Estimated_Hours) || '') + '"></div>' +
          '<div class="cc-form-group"><label>Cost Per Hour ($)</label>' +
          '<input type="number" id="cc-pbt-costhr" class="cc-input" step="0.01" min="0" value="' + ((existing && existing.Cost_Per_Hour) || '') + '"></div>' +
          '<div class="cc-form-group"><label>Sort Order</label>' +
          '<input type="number" id="cc-pbt-sort" class="cc-input" value="' + ((existing && existing.Sort_Order) || 0) + '"></div>' +
        '</div>' +
        '<div class="cc-modal-footer">' +
          '<button class="cc-btn cc-btn-outline cc-modal-cancel">Cancel</button>' +
          '<button id="cc-pbt-save" class="cc-btn cc-btn-primary">' + (isEdit ? 'Update' : 'Create') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    activeModal = overlay;

    overlay.querySelector('.cc-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('.cc-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    $el('cc-pbt-save').addEventListener('click', async function() {
      var taskName = $el('cc-pbt-name').value.trim();
      if (!taskName) { showToast('Task Name is required.', 'error'); return; }

      var data = {
        Task_Name: taskName,
        Default_Assignee_Role: $el('cc-pbt-role').value || undefined,
        Estimated_Hours: parseFloat($el('cc-pbt-hours').value) || 0,
        Cost_Per_Hour: parseFloat($el('cc-pbt-costhr').value) || 0,
        Sort_Order: parseInt($el('cc-pbt-sort').value) || 0
      };

      try {
        if (isEdit) {
          await API.priceBook.updateTask(existing.id, data);
          showToast('Task updated.', 'success');
        } else {
          data.parent_service_id = parentServiceId;
          await API.priceBook.createTask(data);
          showToast('Task created.', 'success');
        }
        closeModal();
        await openPriceBookDetail(parentServiceId);
      } catch (err) {
        showToast(err.error || 'Failed to save task.', 'error');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // TOAST NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════

  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'cc-toast cc-toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function() {
      toast.classList.add('cc-toast-visible');
    });

    setTimeout(function() {
      toast.classList.remove('cc-toast-visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function stripHtml(html) {
    try { var doc = new DOMParser().parseFromString(html, 'text/html'); return doc.body.textContent || ''; }
    catch (e) { return ''; }
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  function formatPracticeArea(pa) {
    if (!pa) return '\u2014';
    return pa.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
  }

  // ═══════════════════════════════════════════════════════════
  // ASSIGNMENT RULES TAB
  // ═══════════════════════════════════════════════════════════

  var MATCH_FIELD_OPTIONS = [
    { value: 'Practice_Area', label: 'Practice Area' },
    { value: 'Service_Package', label: 'Service Package' },
    { value: 'Source', label: 'Lead Source' }
  ];

  var ASSIGN_TYPE_OPTIONS = [
    { value: 'user', label: 'Specific User' },
    { value: 'role', label: 'Role (first available)' }
  ];

  async function fetchAssignmentRulesData() {
    state.assignmentRulesLoading = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading assignment rules...</p></div>';

    try {
      var results = await Promise.allSettled([
        API.admin.config.list('assignment_rule'),
        API.admin.listUsers(),
        API.admin.config.list('lead_source')
      ]);

      if (results[0].status === 'fulfilled') {
        state.assignmentRules = (results[0].value.data || results[0].value.items || []).sort(function(a, b) {
          return (a.Sort_Order || 0) - (b.Sort_Order || 0);
        });
      } else {
        state.assignmentRules = [];
      }

      if (results[1].status === 'fulfilled' && results[1].value.success) {
        state.assignmentRulesUsers = (results[1].value.users || []).filter(function(u) { return u.is_active !== false; });
      }

      if (results[2].status === 'fulfilled') {
        state.assignmentRulesConfigCache.lead_source = (results[2].value.data || results[2].value.items || []).filter(function(i) { return i.Is_Active !== false; });
      }
    } catch (err) {
      state.assignmentRules = [];
      showToast('Error loading assignment rules.', 'error');
    }

    state.assignmentRulesLoading = false;
    renderAssignmentRulesTab();
  }

  function getMatchValueLabel(meta) {
    if (!meta || !meta.match_value) return '\u2014';
    if (meta.match_value === '*') return 'Any (catch-all)';
    return meta.match_value.replace(/_/g, ' ');
  }

  function getAssignToLabel(meta) {
    if (!meta) return '\u2014';
    if (meta.assign_type === 'role') {
      return 'Role: ' + (meta.assign_to || '').replace(/_/g, ' ');
    }
    return meta.assign_to_label || meta.assign_to || '\u2014';
  }

  function renderAssignmentRulesTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    var rules = state.assignmentRules || [];

    var html = '<div class="cc-admin-config">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Lead Assignment Rules</h3>';
    html += '<button id="cc-assignment-add-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ Add Rule</button>';
    html += '</div>';

    html += '<p style="color:#6B7280;margin:0 0 1rem;font-size:0.875rem;">' +
      'Rules are evaluated in priority order (lowest first). The first matching rule assigns the lead owner and creates an intake task. ' +
      'Use <strong>match value &ldquo;*&rdquo;</strong> as a catch-all fallback.</p>';

    if (rules.length === 0 && !state.assignmentRulesLoading) {
      html += '<div class="cc-empty"><p>No assignment rules configured yet. New leads will default to the creating user as owner.</p></div>';
      html += '</div>';
      content.innerHTML = html;
      bindAssignmentRulesAddBtn();
      return;
    }

    html += '<table class="cc-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th" style="width:60px;">Priority</th>';
    html += '<th class="cc-th">Match Field</th>';
    html += '<th class="cc-th">Match Value</th>';
    html += '<th class="cc-th">Assign To</th>';
    html += '<th class="cc-th">Task (SLA hrs)</th>';
    html += '<th class="cc-th" style="width:70px;">Active</th>';
    html += '<th class="cc-th" style="width:140px;">Actions</th>';
    html += '</tr></thead><tbody>';

    rules.forEach(function(item) {
      var meta = {};
      try { meta = JSON.parse(item.Meta || '{}'); } catch(e) {}
      var activeCls = item.Is_Active ? 'green' : 'gray';
      var activeText = item.Is_Active ? 'Yes' : 'No';

      var matchFieldLabel = (MATCH_FIELD_OPTIONS.find(function(o) { return o.value === meta.match_field; }) || {}).label || meta.match_field || '\u2014';

      html += '<tr>';
      html += '<td style="text-align:center;font-weight:600;">' + (item.Sort_Order || 0) + '</td>';
      html += '<td>' + escapeHtml(matchFieldLabel) + '</td>';
      html += '<td>' + escapeHtml(getMatchValueLabel(meta)) + '</td>';
      html += '<td>';
      if (meta.assign_type === 'role') {
        html += '<span class="cc-badge cc-badge-blue">Role</span> ';
      } else {
        html += '<span class="cc-badge cc-badge-teal">User</span> ';
      }
      html += escapeHtml(getAssignToLabel(meta));
      html += '</td>';
      html += '<td>' + escapeHtml(meta.task_due_hours ? meta.task_due_hours + 'h' : '\u2014') + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + activeCls + '">' + activeText + '</span></td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-assignment-edit-btn" data-item-id="' + escapeAttr(item.id) + '">Edit</button> ';
      if (item.Is_Active) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-assignment-deactivate-btn" data-item-id="' + escapeAttr(item.id) + '">Deactivate</button>';
      } else {
        html += '<button class="cc-btn cc-btn-sm cc-btn-success-outline cc-assignment-activate-btn" data-item-id="' + escapeAttr(item.id) + '">Activate</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    content.innerHTML = html;

    bindAssignmentRulesAddBtn();
    bindAssignmentRulesTableEvents();
  }

  function bindAssignmentRulesAddBtn() {
    var btn = document.getElementById('cc-assignment-add-btn');
    if (btn) btn.addEventListener('click', function() {
      showAssignmentRuleModal(null);
    });
  }

  function bindAssignmentRulesTableEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    content.querySelectorAll('.cc-assignment-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = (state.assignmentRules || []).find(function(i) { return i.id === btn.dataset.itemId; });
        if (item) showAssignmentRuleModal(item);
      });
    });

    content.querySelectorAll('.cc-assignment-deactivate-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Deactivate this rule? It will no longer match incoming leads.')) return;
        try {
          await API.admin.config.delete(btn.dataset.itemId);
          showToast('Rule deactivated.', 'success');
          await fetchAssignmentRulesData();
        } catch (err) {
          showToast(err.error || 'Failed to deactivate.', 'error');
        }
      });
    });

    content.querySelectorAll('.cc-assignment-activate-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        try {
          await API.admin.config.update(btn.dataset.itemId, { Is_Active: true });
          showToast('Rule activated.', 'success');
          await fetchAssignmentRulesData();
        } catch (err) {
          showToast(err.error || 'Failed to activate.', 'error');
        }
      });
    });
  }

  function buildMatchValueOptions(matchField) {
    // Practice Area and Service Package are well-known lists
    var practiceAreas = ['Estate Planning', 'Probate', 'Will POA', 'Trust', 'Estate Planning Will POA', 'Real Estate', 'Corporate', 'Family Law', 'Immigration', 'Other'];
    var servicePackages = ['Basic Will', 'Comprehensive Estate Plan', 'Probate Administration', 'Trust Setup', 'Power of Attorney', 'Other'];

    if (matchField === 'Practice_Area') return practiceAreas;
    if (matchField === 'Service_Package') return servicePackages;
    if (matchField === 'Source') {
      return (state.assignmentRulesConfigCache.lead_source || []).map(function(s) { return s.Label || ''; }).filter(Boolean);
    }
    return [];
  }

  function showAssignmentRuleModal(existing) {
    var isEdit = !!existing;
    var meta = {};
    if (existing) { try { meta = JSON.parse(existing.Meta || '{}'); } catch(e) {} }

    var users = state.assignmentRulesUsers || [];
    var roles = ROLE_OPTIONS;

    var html = '<div class="cc-modal-form">';

    // Priority
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Priority (lower = higher priority)</label>';
    html += '<input type="number" id="cc-ar-priority" class="cc-input" value="' + (existing ? (existing.Sort_Order || 10) : 10) + '" min="1" max="999" />';
    html += '</div>';

    // Match Field
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Match Field</label>';
    html += '<select id="cc-ar-match-field" class="cc-input">';
    html += '<option value="">— Select —</option>';
    MATCH_FIELD_OPTIONS.forEach(function(opt) {
      var sel = meta.match_field === opt.value ? ' selected' : '';
      html += '<option value="' + escapeAttr(opt.value) + '"' + sel + '>' + escapeHtml(opt.label) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Match Value (dynamic based on match field)
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Match Value</label>';
    html += '<div id="cc-ar-match-value-wrap">';
    html += buildMatchValueSelect(meta.match_field || '', meta.match_value || '');
    html += '</div>';
    html += '<p style="font-size:0.75rem;color:#9CA3AF;margin:4px 0 0;">Use * for a catch-all fallback rule.</p>';
    html += '</div>';

    // Assign Type
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Assign To Type</label>';
    html += '<select id="cc-ar-assign-type" class="cc-input">';
    ASSIGN_TYPE_OPTIONS.forEach(function(opt) {
      var sel = (meta.assign_type || 'user') === opt.value ? ' selected' : '';
      html += '<option value="' + escapeAttr(opt.value) + '"' + sel + '>' + escapeHtml(opt.label) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Assign To (dynamic: user list or role list)
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Assign To</label>';
    html += '<div id="cc-ar-assign-to-wrap">';
    html += buildAssignToSelect(meta.assign_type || 'user', meta.assign_to || '', users, roles);
    html += '</div>';
    html += '</div>';

    // Task Title Template
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Task Title</label>';
    html += '<input type="text" id="cc-ar-task-title" class="cc-input" value="' + escapeAttr(meta.task_title || 'New lead — contact within {{due_hours}} hours') + '" />';
    html += '<p style="font-size:0.75rem;color:#9CA3AF;margin:4px 0 0;">Placeholders: {{client_name}}, {{practice_area}}, {{source}}, {{due_hours}}</p>';
    html += '</div>';

    // Task Due Hours
    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Task Due (hours from lead creation)</label>';
    html += '<input type="number" id="cc-ar-task-due" class="cc-input" value="' + (meta.task_due_hours || 4) + '" min="1" max="168" />';
    html += '</div>';

    html += '</div>';

    var title = isEdit ? 'Edit Assignment Rule' : 'New Assignment Rule';
    showModal(title, html, async function(form) {
      var matchField = form.querySelector('#cc-ar-match-field').value;
      var matchValue = form.querySelector('#cc-ar-match-value').value.trim();
      var assignType = form.querySelector('#cc-ar-assign-type').value;
      var assignTo = form.querySelector('#cc-ar-assign-to').value;
      var taskTitle = form.querySelector('#cc-ar-task-title').value.trim();
      var taskDue = parseInt(form.querySelector('#cc-ar-task-due').value) || 4;
      var priority = parseInt(form.querySelector('#cc-ar-priority').value) || 10;

      if (!matchField) { showToast('Match field is required.', 'error'); return false; }
      if (!matchValue) { showToast('Match value is required.', 'error'); return false; }
      if (!assignTo) { showToast('Assign-to selection is required.', 'error'); return false; }

      // Build assign_to_label for user type
      var assignToLabel = '';
      if (assignType === 'user') {
        var u = users.find(function(usr) { return usr.id === assignTo; });
        assignToLabel = u ? (u.name || u.Name || u.email || u.Email) : assignTo;
      } else {
        assignToLabel = assignTo.replace(/_/g, ' ');
      }

      var metaObj = {
        match_field: matchField,
        match_value: matchValue,
        assign_type: assignType,
        assign_to: assignTo,
        assign_to_label: assignToLabel,
        task_title: taskTitle || 'New lead — contact within ' + taskDue + ' hours',
        task_due_hours: taskDue
      };

      // Build descriptive label
      var matchFieldLabel = (MATCH_FIELD_OPTIONS.find(function(o) { return o.value === matchField; }) || {}).label || matchField;
      var ruleLabel = matchFieldLabel + ': ' + matchValue + ' \u2192 ' + assignToLabel;

      try {
        if (isEdit) {
          await API.admin.config.update(existing.id, {
            Label: ruleLabel,
            Sort_Order: priority,
            Meta: JSON.stringify(metaObj)
          });
          showToast('Rule updated.', 'success');
        } else {
          await API.admin.config.create({
            Config_Key: 'assignment_rule',
            Label: ruleLabel,
            Sort_Order: priority,
            Is_Active: true,
            Meta: JSON.stringify(metaObj)
          });
          showToast('Rule created.', 'success');
        }
        closeModal();
        await fetchAssignmentRulesData();
        return true;
      } catch (err) {
        showToast(err.error || 'Failed to save rule.', 'error');
        return false;
      }
    });

    // Bind dynamic field changes after modal is open
    setTimeout(function() {
      var matchFieldEl = document.querySelector('#cc-ar-match-field');
      var assignTypeEl = document.querySelector('#cc-ar-assign-type');

      if (matchFieldEl) {
        matchFieldEl.addEventListener('change', function() {
          var wrap = document.querySelector('#cc-ar-match-value-wrap');
          if (wrap) wrap.innerHTML = buildMatchValueSelect(matchFieldEl.value, '');
        });
      }

      if (assignTypeEl) {
        assignTypeEl.addEventListener('change', function() {
          var wrap = document.querySelector('#cc-ar-assign-to-wrap');
          if (wrap) wrap.innerHTML = buildAssignToSelect(assignTypeEl.value, '', users, roles);
        });
      }
    }, 150);
  }

  function buildMatchValueSelect(matchField, currentValue) {
    var options = buildMatchValueOptions(matchField);
    var html = '<select id="cc-ar-match-value" class="cc-input">';
    html += '<option value="">— Select —</option>';
    html += '<option value="*"' + (currentValue === '*' ? ' selected' : '') + '>* (catch-all)</option>';
    options.forEach(function(opt) {
      var sel = currentValue === opt ? ' selected' : '';
      html += '<option value="' + escapeAttr(opt) + '"' + sel + '>' + escapeHtml(opt) + '</option>';
    });
    // If current value is set but not in the list, show it as selected
    if (currentValue && currentValue !== '*' && options.indexOf(currentValue) === -1) {
      html += '<option value="' + escapeAttr(currentValue) + '" selected>' + escapeHtml(currentValue) + '</option>';
    }
    html += '</select>';
    return html;
  }

  function buildAssignToSelect(assignType, currentValue, users, roles) {
    var html = '<select id="cc-ar-assign-to" class="cc-input">';
    html += '<option value="">— Select —</option>';
    if (assignType === 'role') {
      roles.forEach(function(role) {
        var sel = currentValue === role ? ' selected' : '';
        html += '<option value="' + escapeAttr(role) + '"' + sel + '>' + escapeHtml(role.replace(/_/g, ' ')) + '</option>';
      });
    } else {
      users.forEach(function(u) {
        var name = u.name || u.Name || u.email || u.Email || '';
        var role = u.role || u.Role || '';
        var sel = currentValue === u.id ? ' selected' : '';
        html += '<option value="' + escapeAttr(u.id) + '"' + sel + '>' + escapeHtml(name) + (role ? ' (' + role + ')' : '') + '</option>';
      });
    }
    html += '</select>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // DRIP ENROLLMENT TAB
  // ═══════════════════════════════════════════════════════════

  async function fetchDripData() {
    state.dripLoading = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading">Loading drip campaigns\u2026</div>';

    try {
      var campaignResult = await API.campaigns.list();
      state.dripCampaigns = (campaignResult.campaigns || [])
        .filter(function(c) { return (c.type || c.Type || '').toUpperCase() === 'DRIP'; })
        .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    } catch (err) {
      showToast(err.error || 'Failed to load drip campaigns.', 'error');
    }
    state.dripLoading = false;
    renderDripTab();
  }

  function renderDripTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    if (state.dripLoading) {
      content.innerHTML = '<div class="cc-loading">Loading\u2026</div>';
      return;
    }

    var campaigns = state.dripCampaigns || [];

    var html = '<div class="cc-admin-config">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Active Drip Campaigns</h3>';
    html += '</div>';

    html += '<p style="color:#6B7280;margin:0 0 1.5rem;font-size:0.875rem;">' +
      'Triggers and step sequences are configured on each campaign\u2019s detail page. ' +
      'Go to <a href="/crm/campaigns" style="color:#2563EB">Campaigns</a> to manage drip settings.</p>';

    if (campaigns.length === 0) {
      html += '<div style="padding:1.5rem;text-align:center;background:#F9FAFB;border-radius:0.5rem;color:#9CA3AF;">' +
        'No drip campaigns found. Create a DRIP campaign from the Campaigns page.</div>';
    } else {
      html += '<table class="cc-table"><thead><tr>' +
        '<th>Campaign</th><th>Status</th><th>Trigger</th><th>Steps</th>' +
        '</tr></thead><tbody>';

      campaigns.forEach(function(c) {
        var st = (c.status || c.Status || 'draft').toUpperCase();
        var stColor = st === 'ACTIVE' ? 'green' : st === 'DRAFT' ? 'gray' : 'yellow';
        var triggerLabel = 'Manual';
        try {
          var tc = c.trigger_config || c.Trigger_Config;
          if (tc) {
            var parsed = typeof tc === 'string' ? JSON.parse(tc) : tc;
            if (parsed.type === 'NEW_LEAD') triggerLabel = 'New Lead';
          }
        } catch (e) {}
        var stepCount = c.steps_count || c.Steps_Count || '\u2014';

        html += '<tr>';
        html += '<td><strong>' + escapeHtml(c.name || c.Name || 'Untitled') + '</strong></td>';
        html += '<td><span class="cc-badge cc-badge-' + stColor + '">' + escapeHtml(st) + '</span></td>';
        html += '<td>' + escapeHtml(triggerLabel) + '</td>';
        html += '<td>' + escapeHtml(String(stepCount)) + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
    }

    html += '</div>';
    content.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════════════════

  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    if (!checkRole()) return;

    // Hash-based tab routing (redirect legacy hashes)
    var hash = location.hash.replace('#', '');
    if (hash === 'users' || hash === 'staff') hash = 'staff-users';
    if (hash && (TABS.find(function(t) { return t.key === hash; }) || HIDDEN_TABS.indexOf(hash) !== -1)) {
      state.activeTab = hash;
    }

    renderTabs();
    renderActiveTab();

    // Handle browser back/forward hash changes
    window.addEventListener('hashchange', function() {
      var h = location.hash.replace('#', '');
      if (h === 'users' || h === 'staff') h = 'staff-users';
      if (h && (TABS.find(function(t) { return t.key === h; }) || HIDDEN_TABS.indexOf(h) !== -1)) {
        state.activeTab = h;
        renderTabs();
        renderActiveTab();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
