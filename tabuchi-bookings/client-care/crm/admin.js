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
    { key: 'categories', label: 'Categories' },
    { key: 'lead-sources', label: 'Lead Sources' },
    { key: 'stages', label: 'Stages' },
    { key: 'dispositions', label: 'Dispositions' },
    { key: 'activity-types', label: 'Activity Types' },
    { key: 'entity-types', label: 'Entity Types' },
    { key: 'roles', label: 'Roles' },
    { key: 'price-book', label: 'Price Books' }
  ];

  // Tabs grouped under the "Options Lists" dropdown in the tab bar
  var OPTIONS_LIST_TABS = ['categories', 'stages', 'lead-sources', 'dispositions', 'activity-types', 'entity-types', 'roles'];

  // Tabs accessible via hash but hidden from tab bar (accessed via Campaigns nav dropdown)
  var HIDDEN_TABS = ['drip-enrollment'];

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
    'entity_type': [],
    'role': [
      { key: 'cost', label: 'Cost ($/hr)', type: 'number' }
    ]
  };

  function tabToConfigKey(tabKey) {
    var map = { 'lead-sources': 'lead_source', 'stages': 'stage', 'dispositions': 'disposition', 'activity-types': 'activity_type', 'entity-types': 'entity_type', 'roles': 'role' };
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
    // Templates
    templates: [],
    templatesLoading: false,
    templatesSortKey: 'name',
    templatesSortDir: 'asc',
    templateFilterChannel: '',
    // Clio sync failures
    clioFailures: [],
    clioLoading: false,
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
    dripLoading: false
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
      case 'categories':     renderCategoriesTab(); break;
      case 'price-book':     renderPriceBookTab(); break;
      case 'drip-enrollment': renderDripTab(); break;
      case 'lead-sources':
      case 'stages':
      case 'dispositions':
      case 'activity-types':
      case 'entity-types':
      case 'roles':
        renderConfigTab(tabToConfigKey(state.activeTab), TABS.find(function(t) { return t.key === state.activeTab; }).label);
        break;
    }
    // Fetch fresh data for the active tab
    switch (state.activeTab) {
      case 'system-status': fetchOverviewData(); break;
      case 'staff-users':   fetchStaffUsers(); break;
      case 'templates':     fetchTemplates(); break;
      case 'categories':    fetchCategories(); break;
      case 'price-book':    fetchPriceBookItems(); break;
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
        loadPermissionsConfig()
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
      { key: 'permissions', label: 'Permissions' }
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

    if (state.usersSubTab === 'manage-users') {
      html += renderManageUsersContent();
    } else {
      html += renderInteractivePermissions();
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

    if (state.usersSubTab === 'manage-users') {
      bindStaffUsersEvents();
    } else {
      bindPermissionsEvents();
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
          Label: 'role_permissions',
          Config_Key: 'permissions',
          Meta: meta
        });
      } else {
        var res = await API.admin.config.create({
          Label: 'role_permissions',
          Config_Key: 'permissions',
          Sort_Order: 1,
          Is_Active: true,
          Meta: meta
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
    var sortColLabel = configKey === 'role' ? 'Booking Priority' : 'Order';
    html += '<th class="cc-th" style="width:80px;">' + sortColLabel + '</th>';
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
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-config-edit-btn" data-item-id="' + escapeAttr(item.id) + '">Edit</button> ';
      if (item.Is_Active) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger-outline cc-config-deactivate-btn" data-item-id="' + escapeAttr(item.id) + '">Deactivate</button>';
      } else {
        html += '<button class="cc-btn cc-btn-sm cc-btn-success-outline cc-config-activate-btn" data-item-id="' + escapeAttr(item.id) + '">Activate</button>';
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
    var sortLabel = configKey === 'role' ? 'Booking Priority' : 'Sort Order';
    html += '<label class="cc-label">' + sortLabel + '</label>';
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
    var selectedPa = (existing && existing.Practice_Area) || defaultPa || '';

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
