/**
 * Tabuchi Law Client Care CRM - Admin Configuration
 * Handles: /crm/admin
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - System overview dashboard (pipeline stats, Clio sync failures, SLA breaches)
 * - User management (list, update roles/teams, activate/deactivate)
 * - Template management (list, create, edit email/SMS templates)
 * - System configuration (SLA thresholds, integration status)
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
    { key: 'overview', label: 'Overview' },
    { key: 'users', label: 'Users' },
    { key: 'templates', label: 'Templates' },
    { key: 'system', label: 'System' },
    { key: 'staff', label: 'Staff' },
    { key: 'categories', label: 'Categories' },
    { key: 'lead-sources', label: 'Lead Sources' },
    { key: 'stages', label: 'Stages' },
    { key: 'dispositions', label: 'Dispositions' },
    { key: 'activity-types', label: 'Activity Types' },
    { key: 'entity-types', label: 'Entity Types' }
  ];

  var CONFIG_META = {
    'lead_source': [],
    'stage': [
      { key: 'percentage', label: 'Percentage (%)', type: 'number' },
      { key: 'color', label: 'Color', type: 'color' }
    ],
    'disposition': [
      { key: 'color', label: 'Color', type: 'color' }
    ],
    'activity_type': [],
    'entity_type': []
  };

  function tabToConfigKey(tabKey) {
    var map = { 'lead-sources': 'lead_source', 'stages': 'stage', 'dispositions': 'disposition', 'activity-types': 'activity_type', 'entity-types': 'entity_type' };
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
    var j = await r.json();
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
    var j = await r.json();
    if (!r.ok) throw Object.assign({ status: r.status }, j);
    return j;
  }

  // ─── State ─────────────────────────────────────────────────
  var state = {
    activeTab: 'overview',
    user: API.auth.getUser(),
    // Overview
    stats: null,
    statsLoading: false,
    // Users
    users: [],
    usersLoading: false,
    usersSortKey: 'name',
    usersSortDir: 'asc',
    // Templates
    templates: [],
    templatesLoading: false,
    templatesSortKey: 'name',
    templatesSortDir: 'asc',
    templateFilterChannel: '',
    // Clio sync failures
    clioFailures: [],
    clioLoading: false,
    // Staff Management
    staffList: [],
    staffLoading: false,
    // Categories
    categories: [],
    categoriesLoading: false,
    // Config items (generic for lead sources, stages, etc.)
    configItems: {},
    configLoading: {}
  };

  // ─── Role Gate ─────────────────────────────────────────────
  function checkRole() {
    var u = state.user || {};
    if (u.role !== 'ADMIN' && !u.is_admin) {
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

    var html = '<div class="cc-admin-tab-bar">';
    TABS.forEach(function(tab) {
      var cls = 'cc-admin-tab' + (state.activeTab === tab.key ? ' cc-admin-tab-active' : '');
      html += '<button class="' + cls + '" data-tab="' + tab.key + '">' + tab.label + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('.cc-admin-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.activeTab = btn.dataset.tab;
        location.hash = '#' + btn.dataset.tab;
        renderTabs();
        renderActiveTab();
      });
    });
  }

  function renderActiveTab() {
    switch (state.activeTab) {
      case 'overview':       renderOverview(); break;
      case 'users':          renderUsersTab(); break;
      case 'templates':      renderTemplatesTab(); break;
      case 'system':         renderSystemTab(); break;
      case 'staff':          renderStaffTab(); break;
      case 'categories':     renderCategoriesTab(); break;
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
      case 'overview':    fetchOverviewData(); break;
      case 'users':       fetchUsers(); break;
      case 'templates':   fetchTemplates(); break;
      case 'staff':       fetchStaff(); break;
      case 'categories':  fetchCategories(); break;
      // system tab is static, no fetch needed
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
  // OVERVIEW TAB
  // ═══════════════════════════════════════════════════════════

  async function fetchOverviewData() {
    state.statsLoading = true;
    state.clioLoading = true;

    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading overview...</p></div>';

    try {
      // Fetch system stats and Clio failures in parallel
      var results = await Promise.allSettled([
        API.admin.getSystemStats(),
        API.leads.list({ disposition: 'WON', limit: 100 })
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
    } catch (err) {
      state.stats = null;
      state.clioFailures = [];
    }

    state.statsLoading = false;
    state.clioLoading = false;
    renderOverview();
  }

  function renderOverview() {
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
      // Fallback — stats endpoint may not be built yet
      html += '<div class="cc-admin-stat-card cc-admin-stat-gray">';
      html += '<div class="cc-admin-stat-label">Stats</div>';
      html += '<div class="cc-admin-stat-value">Pending backend (CC-15)</div>';
      html += '</div>';
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
        html += '<td><a href="/crm/lead/' + lead.id + '" class="cc-link">View Lead</a></td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
    } else {
      html += '<p class="cc-admin-success">No Clio sync failures. All WON leads are linked.</p>';
    }

    html += '</div>';
    content.innerHTML = html;
  }

  function renderStatCard(label, value, color) {
    return '<div class="cc-admin-stat-card cc-admin-stat-' + color + '">' +
      '<div class="cc-admin-stat-value">' + escapeHtml(String(value)) + '</div>' +
      '<div class="cc-admin-stat-label">' + escapeHtml(label) + '</div>' +
      '</div>';
  }

  // ═══════════════════════════════════════════════════════════
  // USERS TAB
  // ═══════════════════════════════════════════════════════════

  async function fetchUsers() {
    state.usersLoading = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading users...</p></div>';

    try {
      var result = await API.admin.listUsers();
      if (result.success) {
        state.users = result.users || [];
      } else {
        state.users = [];
        showToast(result.error || 'Failed to load users.', 'error');
      }
    } catch (err) {
      state.users = [];
      showToast(err.error || 'Error loading users.', 'error');
    }

    state.usersLoading = false;
    renderUsersTab();
  }

  function renderUsersTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Sort users
    var sorted = state.users.slice().sort(function(a, b) {
      var av = a[state.usersSortKey];
      var bv = b[state.usersSortKey];
      av = String(av || '');
      bv = String(bv || '');
      return state.usersSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    var html = '<div class="cc-admin-users">';
    html += '<h3 class="cc-admin-section-title">User Management</h3>';
    html += '<p class="cc-admin-hint">Manage CRM user roles and access. Users are provisioned via Microsoft Entra SSO on first login.</p>';

    if (sorted.length === 0 && !state.usersLoading) {
      html += '<div class="cc-empty"><p>No users found. Users are created automatically on first SSO login.</p></div>';
      html += '</div>';
      content.innerHTML = html;
      return;
    }

    var columns = [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'team_name', label: 'Team' },
      { key: 'is_active', label: 'Status' },
      { key: 'last_login_at', label: 'Last Login' }
    ];

    html += '<table class="cc-table cc-admin-users-table">';
    html += '<thead><tr>';
    columns.forEach(function(col) {
      var arrow = '';
      var cls = 'cc-th cc-th-sortable';
      if (state.usersSortKey === col.key) {
        cls += ' cc-th-sorted';
        arrow = state.usersSortDir === 'asc' ? ' &#9650;' : ' &#9660;';
      }
      html += '<th class="' + cls + '" data-col="' + col.key + '">' + col.label + arrow + '</th>';
    });
    html += '<th class="cc-th">Actions</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function(u) {
      var roleCls = ROLE_COLORS[u.role] || 'gray';
      var statusBadge = u.is_active
        ? '<span class="cc-badge cc-badge-green">Active</span>'
        : '<span class="cc-badge cc-badge-gray">Inactive</span>';

      html += '<tr data-user-id="' + u.id + '">';
      html += '<td>' + escapeHtml(u.name || '') + '</td>';
      html += '<td>' + escapeHtml(u.email || '') + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + roleCls + '">' + escapeHtml(u.role || '') + '</span></td>';
      html += '<td>' + escapeHtml(u.team_name || '\u2014') + '</td>';
      html += '<td>' + statusBadge + '</td>';
      html += '<td>' + (u.last_login_at ? API.util.formatRelativeTime(u.last_login_at) : 'Never') + '</td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-edit-user-btn" data-user-id="' + u.id + '">Edit</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    content.innerHTML = html;

    bindUsersEvents();
  }

  function bindUsersEvents() {
    var content = $el('cc-admin-content');
    if (!content) return;

    // Sort headers
    content.querySelectorAll('.cc-admin-users-table .cc-th-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var col = th.dataset.col;
        if (state.usersSortKey === col) {
          state.usersSortDir = state.usersSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.usersSortKey = col;
          state.usersSortDir = 'asc';
        }
        renderUsersTab();
      });
    });

    // Edit buttons
    content.querySelectorAll('.cc-edit-user-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var userId = btn.dataset.userId;
        var user = state.users.find(function(u) { return u.id === userId; });
        if (user) showEditUserModal(user);
      });
    });
  }

  function showEditUserModal(user) {
    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Name</label>';
    html += '<input type="text" id="cc-modal-user-name" class="cc-input" value="' + escapeAttr(user.name) + '" readonly />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Email</label>';
    html += '<input type="text" class="cc-input" value="' + escapeAttr(user.email) + '" readonly />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Role</label>';
    html += '<select id="cc-modal-user-role" class="cc-input">';
    ROLE_OPTIONS.forEach(function(r) {
      html += '<option value="' + r + '"' + (user.role === r ? ' selected' : '') + '>' + r + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Active</label>';
    html += '<select id="cc-modal-user-active" class="cc-input">';
    html += '<option value="true"' + (user.is_active ? ' selected' : '') + '>Active</option>';
    html += '<option value="false"' + (!user.is_active ? ' selected' : '') + '>Inactive</option>';
    html += '</select>';
    html += '</div>';

    html += '</div>';

    showModal('Edit User: ' + user.name, html, function(form) {
      return handleUpdateUser(user.id, form);
    });
  }

  async function handleUpdateUser(userId, form) {
    var role = form.querySelector('#cc-modal-user-role').value;
    var isActive = form.querySelector('#cc-modal-user-active').value === 'true';

    try {
      var result = await API.admin.updateUser(userId, { role: role, is_active: isActive });
      if (result.success) {
        showToast('User updated.', 'success');
        closeModal();
        fetchUsers();
        return true;
      } else {
        showToast(result.error || 'Failed to update user.', 'error');
        return false;
      }
    } catch (err) {
      showToast(err.error || 'Error updating user.', 'error');
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

      html += '<tr data-template-id="' + t.id + '">';
      html += '<td class="cc-template-name-cell">' + escapeHtml(t.name || 'Untitled') + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + channelCls + '">' + escapeHtml(t.channel || '') + '</span></td>';
      html += '<td>' + escapeHtml(t.subject || '\u2014') + '</td>';
      html += '<td class="cc-template-preview-cell">' + escapeHtml(bodyPreview || '\u2014') + '</td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-edit-template-btn" data-template-id="' + t.id + '">Edit</button>';
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
  }

  function showEditTemplateModal(tpl) {
    showModal('Edit Template', buildTemplateForm(tpl), function(form) {
      return handleUpdateTemplate(tpl.id, form);
    });
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

    html += '<div id="cc-modal-tpl-email-fields"' + (isEmail ? '' : ' style="display:none"') + '>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Subject Line</label>';
    html += '<input type="text" id="cc-modal-tpl-subject" class="cc-input" value="' + escapeAttr(existing.subject || '') + '" placeholder="Email subject" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Body (HTML)</label>';
    html += '<textarea id="cc-modal-tpl-body-html" class="cc-input cc-textarea" rows="8" placeholder="HTML email body. Use {{Client_Name}}, {{Practice_Area}} etc.">' + escapeHtml(existing.body_html || '') + '</textarea>';
    html += '</div>';

    html += '</div>';

    html += '<div id="cc-modal-tpl-sms-fields"' + (!isEmail ? '' : ' style="display:none"') + '>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Body (Text)</label>';
    html += '<textarea id="cc-modal-tpl-body-text" class="cc-input cc-textarea" rows="4" placeholder="SMS text. Use {{Client_Name}} etc. Max 160 chars recommended.">' + escapeHtml(existing.body_text || '') + '</textarea>';
    html += '</div>';

    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Available Tokens</label>';
    html += '<p class="cc-admin-hint">{{Client_Name}}, {{Client_Email}}, {{Practice_Area}}, {{Lead_Owner_Name}}, {{Unsubscribe_URL}}</p>';
    html += '</div>';

    html += '</div>';

    return html;
  }

  async function handleCreateTemplate(form) {
    var name = form.querySelector('#cc-modal-tpl-name').value.trim();
    var channel = form.querySelector('#cc-modal-tpl-channel').value;

    if (!name) { showToast('Template name is required.', 'error'); return false; }

    var data = { name: name, channel: channel };

    if (channel === 'EMAIL') {
      data.subject = form.querySelector('#cc-modal-tpl-subject').value.trim();
      data.body_html = form.querySelector('#cc-modal-tpl-body-html').value;
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

    if (!name) { showToast('Template name is required.', 'error'); return false; }

    var fields = { name: name, channel: channel };

    if (channel === 'EMAIL') {
      fields.subject = form.querySelector('#cc-modal-tpl-subject').value.trim();
      fields.body_html = form.querySelector('#cc-modal-tpl-body-html').value;
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

  // ═══════════════════════════════════════════════════════════
  // SYSTEM TAB
  // ═══════════════════════════════════════════════════════════

  function renderSystemTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    var html = '<div class="cc-admin-system">';

    // SLA Configuration
    html += '<h3 class="cc-admin-section-title">SLA Configuration</h3>';
    html += '<div class="cc-admin-config-card">';
    html += '<table class="cc-table cc-admin-config-table">';
    html += '<thead><tr><th class="cc-th">Setting</th><th class="cc-th">Value</th><th class="cc-th">Description</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td>Initial Contact SLA</td><td><strong>4 hours</strong></td><td>New leads must be contacted within this window (CC-13 checks every 15 min)</td></tr>';
    html += '<tr><td>Follow-Up SLA</td><td><strong>48 hours</strong></td><td>Maximum time between touchpoints for open leads</td></tr>';
    html += '<tr><td>Form Session Expiry</td><td><strong>7 days</strong></td><td>Intake form save/resume sessions expire after this period</td></tr>';
    html += '<tr><td>Clio Retry Attempts</td><td><strong>3</strong></td><td>Number of retries before marking as MANUAL_REVIEW (CC-08 runs every 15 min)</td></tr>';
    html += '<tr><td>Drip Sender Interval</td><td><strong>1 hour</strong></td><td>CC-14 checks for pending drip steps every hour</td></tr>';
    html += '</tbody></table>';
    html += '<p class="cc-admin-hint">SLA thresholds are configured in n8n workflows. To change, edit the CC-13 (SLA Checker) and CC-08 (Clio Retry) workflows.</p>';
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
    html += '<tr><td>Microsoft Graph (Mail)</td><td><span class="cc-badge cc-badge-green">Connected</span></td><td>Mail.Send permission granted. Used for drip campaigns & SLA notifications.</td></tr>';
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
      { key: 'MEETING1_BOOKED', label: 'Meeting #1 Booked', gate: 'None' },
      { key: 'MEETING1_COMPLETED', label: 'Meeting #1 Completed', gate: 'Meeting notes required' },
      { key: 'INTAKE_COMPLETE_READY_TO_DRAFT', label: 'Ready to Draft', gate: 'Checklist complete' },
      { key: 'CLOSED_INTAKE_RECEIVED', label: 'Intake Received (Closed)', gate: 'Disposition + Clio sync (CC-07)' }
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
      { id: 'CC-13', name: 'SLA Breach Checker', trigger: 'Schedule (15 min)' },
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
  }

  // ═══════════════════════════════════════════════════════════
  // STAFF MANAGEMENT TAB
  // ═══════════════════════════════════════════════════════════

  async function fetchStaff() {
    state.staffLoading = true;
    var content = $el('cc-admin-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading staff...</p></div>';

    try {
      var result = await bookingAdminFetch('staff', { action: 'list-staff' });
      state.staffList = result.staff || [];
    } catch (err) {
      state.staffList = [];
      showToast(err.error || 'Failed to load staff.', 'error');
    }

    state.staffLoading = false;
    renderStaffTab();
  }

  function renderStaffTab() {
    var content = $el('cc-admin-content');
    if (!content) return;

    var html = '<div class="cc-admin-staff">';
    html += '<div class="cc-admin-section-header">';
    html += '<h3 class="cc-admin-section-title">Staff Management</h3>';
    html += '<button id="cc-import-staff-btn" class="cc-btn cc-btn-primary cc-btn-sm">Import from Office 365</button>';
    html += '</div>';
    html += '<p class="cc-admin-hint">Manage booking staff members. Import users from Office 365 and toggle active status.</p>';

    if (state.staffList.length === 0 && !state.staffLoading) {
      html += '<div class="cc-empty"><p>No staff members yet. Click "Import from Office 365" to add staff.</p></div>';
      html += '</div>';
      content.innerHTML = html;
      bindStaffImportBtn();
      return;
    }

    html += '<table class="cc-table cc-admin-staff-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th">Name</th>';
    html += '<th class="cc-th">Email</th>';
    html += '<th class="cc-th">Slug</th>';
    html += '<th class="cc-th">Hours</th>';
    html += '<th class="cc-th">Status</th>';
    html += '<th class="cc-th">Action</th>';
    html += '</tr></thead><tbody>';

    state.staffList.forEach(function(s) {
      var statusCls = s.active ? 'green' : 'red';
      var statusText = s.active ? 'Active' : 'Inactive';
      var btnText = s.active ? 'Deactivate' : 'Activate';
      var btnCls = s.active ? 'cc-btn-danger-outline' : 'cc-btn-success-outline';
      var hours = (s.workingHoursStart && s.workingHoursEnd) ? (s.workingHoursStart + ' \u2013 ' + s.workingHoursEnd) : '\u2014';

      html += '<tr>';
      html += '<td>' + escapeHtml(s.name || '') + '</td>';
      html += '<td>' + escapeHtml(s.email || '') + '</td>';
      html += '<td><code>' + escapeHtml(s.slug || '') + '</code></td>';
      html += '<td>' + hours + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + statusCls + '">' + statusText + '</span></td>';
      html += '<td><button class="cc-btn cc-btn-sm ' + btnCls + ' cc-toggle-staff-btn" data-staff-id="' + s.id + '" data-active="' + (s.active ? 'true' : 'false') + '">' + btnText + '</button></td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
    content.innerHTML = html;

    bindStaffImportBtn();
    bindStaffToggleButtons();
  }

  function bindStaffImportBtn() {
    var btn = $el('cc-import-staff-btn');
    if (btn) btn.addEventListener('click', showStaffImportModal);
  }

  function bindStaffToggleButtons() {
    var content = $el('cc-admin-content');
    if (!content) return;
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
          renderStaffTab();
        } catch (err) {
          btn.textContent = currentActive ? 'Deactivate' : 'Activate';
          btn.disabled = false;
          showToast(err.error || 'Failed to toggle staff status.', 'error');
        }
      });
    });
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
            renderStaffTab();
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
    html += '<th class="cc-th" style="width:80px;">Actions</th>';
    html += '</tr></thead><tbody>';

    state.categories.forEach(function(cat) {
      html += '<tr>';
      html += '<td>' + escapeHtml(cat.name || '') + '</td>';
      html += '<td><button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-cat-delete-btn" data-cat-id="' + cat.id + '" data-cat-name="' + escapeAttr(cat.name) + '">Delete</button></td>';
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
    content.querySelectorAll('.cc-cat-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (confirm('Delete category "' + btn.dataset.catName + '"?')) {
          handleDeleteCategory(btn.dataset.catId);
        }
      });
    });
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

    var items = (state.configItems[configKey] || []).slice().sort(function(a, b) {
      return (a.Sort_Order || 0) - (b.Sort_Order || 0);
    });
    var metaFields = CONFIG_META[configKey] || [];

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

    html += '<table class="cc-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th">Label</th>';
    html += '<th class="cc-th" style="width:80px;">Order</th>';
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

      html += '<tr>';
      html += '<td>' + escapeHtml(item.Label || '') + '</td>';
      html += '<td>' + (item.Sort_Order || 0) + '</td>';
      metaFields.forEach(function(mf) {
        var val = meta[mf.key] || '';
        if (mf.type === 'color' && val) {
          html += '<td><span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:' + escapeAttr(val) + ';vertical-align:middle;margin-right:4px;border:1px solid #D1D5DB;"></span> ' + escapeHtml(val) + '</td>';
        } else {
          html += '<td>' + escapeHtml(String(val)) + '</td>';
        }
      });
      html += '<td><span class="cc-badge cc-badge-' + activeCls + '">' + activeText + '</span></td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-config-edit-btn" data-item-id="' + item.id + '">Edit</button> ';
      if (item.Is_Active) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-config-deactivate-btn" data-item-id="' + item.id + '">Deactivate</button>';
      } else {
        html += '<button class="cc-btn cc-btn-sm cc-btn-success-outline cc-config-activate-btn" data-item-id="' + item.id + '">Activate</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
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

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Sort Order</label>';
    html += '<input type="number" id="cc-modal-config-sort" class="cc-input" value="' + (existing ? (existing.Sort_Order || 0) : 0) + '" />';
    html += '</div>';

    metaFields.forEach(function(mf) {
      html += '<div class="cc-form-group">';
      html += '<label class="cc-label">' + escapeHtml(mf.label) + '</label>';
      if (mf.type === 'color') {
        html += '<input type="color" id="cc-modal-config-meta-' + mf.key + '" class="cc-input" value="' + escapeAttr(meta[mf.key] || '#3B82F6') + '" style="height:38px;padding:2px;" />';
      } else if (mf.type === 'number') {
        html += '<input type="number" id="cc-modal-config-meta-' + mf.key + '" class="cc-input" value="' + escapeAttr(meta[mf.key] || '') + '" />';
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

      var sortOrder = parseInt(form.querySelector('#cc-modal-config-sort').value) || 0;

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

    // Bind save
    overlay.querySelector('.cc-modal-save-btn').addEventListener('click', function() {
      var formEl = modal.querySelector('.cc-modal-body');
      onSubmit(formEl);
    });
  }

  function closeModal() {
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
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
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function stripHtml(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  function formatPracticeArea(pa) {
    if (!pa) return '\u2014';
    return pa.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
  }

  // ═══════════════════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════════════════

  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    if (!checkRole()) return;

    // Hash-based tab routing
    var hash = location.hash.replace('#', '');
    if (hash && TABS.find(function(t) { return t.key === hash; })) {
      state.activeTab = hash;
    }

    renderTabs();
    renderActiveTab();

    // Handle browser back/forward hash changes
    window.addEventListener('hashchange', function() {
      var h = location.hash.replace('#', '');
      if (h && TABS.find(function(t) { return t.key === h; })) {
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
