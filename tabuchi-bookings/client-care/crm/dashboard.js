/**
 * Tabuchi Law Client Care CRM - Dashboard
 * Handles: /crm/dashboard
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Role-based dashboard (Sales vs Admin/Manager)
 * - Pipeline overview with mini funnel
 * - Task summary with overdue/today/upcoming
 * - Service level gauge
 * - Weighted revenue projection
 * - Recent activity feed
 * - Admin: Rep comparison table, revenue timeline, workload
 * - Auto-refresh every 5 minutes
 * - Clickable items navigate to detail pages
 * - Customizable tile layout (drag-to-reorder, show/hide, persisted)
 *
 * Page element IDs:
 * - #cc-dash-root          (main container)
 * - #cc-dash-greeting      (greeting banner)
 * - #cc-dash-stats         (stat cards row)
 * - #cc-dash-tasks         (task summary widget)
 * - #cc-dash-pipeline      (pipeline funnel widget)
 * - #cc-dash-activity      (recent activity widget)
 * - #cc-dash-reps          (admin: rep comparison table)
 * - #cc-dash-timeline      (admin: revenue timeline)
 * - #cc-dash-workload      (admin: workload stats)
 */

(function Dashboard() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

  // Block BOOKINGS-only users from CRM pages
  var _u = ClientCareAPI.auth.getUser();
  if (_u && _u.role === 'BOOKINGS') { window.location.href = '/dashboard'; return; }

  var API = ClientCareAPI;
  var $el = function(id) {
    var all = document.querySelectorAll('#' + id);
    if (!all.length) return null;
    for (var i = 0; i < all.length; i++) {
      if (!all[i].closest('.w-embed')) return all[i];
    }
    return all[all.length - 1];
  };

  // ─── State ───────────────────────────────────────────────────
  var state = {
    data: null,
    bookings: [],
    loading: false,
    role: (_u && _u.role) || '',
    isAdmin: false,
    refreshTimer: null,
    customizing: false
  };
  state.isAdmin = ((state.role || '').toUpperCase() === 'ADMIN' || (state.role || '').toUpperCase() === 'MANAGER' || !!(_u && _u.is_admin));

  var REFRESH_INTERVAL = 300000; // 5 minutes
  var LAYOUT_KEY = 'cc_dash_layout';

  // ─── Tile Definitions ──────────────────────────────────────────
  var TILES = [
    { id: 'bookings', label: 'Upcoming Meetings', admin: false },
    { id: 'recordings', label: 'Recordings', admin: false },
    { id: 'tasks-pipeline', label: 'Tasks & Pipeline', admin: false },
    { id: 'activity-sla', label: 'Activity & Service Level', admin: false },
    { id: 'rep-comparison', label: 'Rep Comparison', admin: true },
    { id: 'revenue-timeline', label: 'Revenue Timeline', admin: true },
    { id: 'workload', label: 'Workload & Won/Lost', admin: true }
  ];

  function getAvailableTiles() {
    return TILES.filter(function(t) { return !t.admin || state.isAdmin; });
  }

  function getDefaultOrder() {
    return getAvailableTiles().map(function(t) { return t.id; });
  }

  function getLayout() {
    try {
      var raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        var layout = JSON.parse(raw);
        if (layout && layout.order) return layout;
      }
    } catch(e) {}
    return { order: getDefaultOrder(), hidden: [] };
  }

  function saveLayout(layout) {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch(e) {}
  }

  function getTileRenderer(tileId) {
    var d = state.data;
    if (!d) return '';
    switch (tileId) {
      case 'bookings': return renderBookings(state.bookings);
      case 'recordings': return renderRecordingsTile(state.recordings);
      case 'tasks-pipeline': return '<div class="cc-dash-grid-2">' + renderTasks(d.tasks) + renderPipeline(d.pipeline) + '</div>';
      case 'activity-sla': return '<div class="cc-dash-grid-2">' + renderActivity(d.recent_activity) + renderSLADetail(d.sla) + '</div>';
      case 'rep-comparison': return renderRepComparison(d.rep_comparison);
      case 'revenue-timeline': return renderRevenueTimeline(d.revenue_timeline);
      case 'workload': return renderWorkload(d.workload, d.pipeline);
      default: return '';
    }
  }

  function getTileLabel(tileId) {
    for (var i = 0; i < TILES.length; i++) {
      if (TILES[i].id === tileId) return TILES[i].label;
    }
    return tileId;
  }

  // Local date helper — avoids UTC timezone mismatch from n8n Cloud
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var BOOKINGS_ENDPOINT = 'https://n8n.tabuchilaw.com/webhook/api/dashboard/bookings';

  // ─── Helpers ─────────────────────────────────────────────────

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function fmtNum(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString('en-CA');
  }

  function fmtCurrency(n) {
    if (n == null) return '$0';
    return '$' + Number(n).toLocaleString('en-CA', { maximumFractionDigits: 0 });
  }

  function fmtPct(n) {
    if (n == null) return '0%';
    return Number(n).toFixed(1) + '%';
  }

  // ─── Data Loading ────────────────────────────────────────────

  async function fetchBookings() {
    try {
      var token = API.auth.getToken();
      var res = await fetch(BOOKINGS_ENDPOINT + '?status=upcoming', {
        headers: { 'X-Dashboard-Token': token }
      });
      var data = await res.json();
      if (data && data.success) {
        state.bookings = data.bookings || [];
      }
    } catch (e) {
      // Bookings fetch is non-critical; fail silently
      state.bookings = [];
    }
  }

  async function fetchRecordings() {
    var allRecs = [];
    // 1. Meeting recordings (Teams/Zoom from CC_Recordings)
    try {
      var result = await API.recordings.list({ limit: 50 });
      var meetingRecs = (result && result.recordings) || (result && result.data) || [];
      meetingRecs.forEach(function(r) { r._source_type = 'meeting'; });
      allRecs = allRecs.concat(meetingRecs);
    } catch (e) {}
    // 2. Call recordings (RC from CC_Activities with Recording_URL)
    try {
      var actResult = await API.activities.list(null, { limit: 50, type: 'CALL' });
      var callActs = (actResult && actResult.activities) || [];
      callActs.forEach(function(a) {
        if (!a.Recording_URL) return;
        allRecs.push({
          id: a.id,
          _source_type: 'call',
          Meeting_Date: a.Occurred_At,
          Created_At: a.Occurred_At,
          Client_Name: a.Lead_Name || '',
          Staff_Name: a.Owner_Name || '',
          Source: 'ringcentral',
          Duration_Seconds: (a.Duration_Minutes || 0) * 60,
          Status: 'completed',
          Lead: a.Lead || [],
          Recording_URL: a.Recording_URL,
          Subject: a.Subject || 'Call Recording'
        });
      });
    } catch (e) {}
    // Sort by date descending
    allRecs.sort(function(a, b) {
      var da = new Date(a.Meeting_Date || a.Created_At || 0);
      var db = new Date(b.Meeting_Date || b.Created_At || 0);
      return db - da;
    });
    state.recordings = allRecs;
  }

  async function loadDashboard(showSkeleton) {
    if (state.loading) return;
    state.loading = true;
    var root = $el('cc-dash-root');
    if (!root) return;

    if (showSkeleton) {
      root.innerHTML = renderSkeleton();
      updateProgress(1, 'Loading dashboard data\u2026');
    }

    try {
      // Fire all requests in parallel
      var dashPromise = API.dashboard.get();
      var bookingsPromise = fetchBookings();
      var recordingsPromise = fetchRecordings();

      if (showSkeleton) updateProgress(2, 'Fetching pipeline & tasks\u2026');

      var result = await dashPromise;
      if (!result || !result.success) {
        throw new Error((result && result.error) || 'Failed to load dashboard');
      }
      state.data = result.data;
      state.role = result.role || state.role;
      state.isAdmin = ((state.role || '').toUpperCase() === 'ADMIN' || (state.role || '').toUpperCase() === 'MANAGER' || !!(_u && _u.is_admin));

      if (showSkeleton) updateProgress(4, 'Rendering dashboard\u2026');

      // Wait for bookings (non-blocking — dashboard renders even if this is slow)
      await bookingsPromise;
      // Recordings: wait but don't block if it fails
      try { await recordingsPromise; } catch(e) { state.recordings = []; }

      if (showSkeleton) {
        updateProgress(5, 'Almost there\u2026');
        renderProgressive(root);
      } else {
        render();
      }
    } catch (err) {
      root.innerHTML = '<div class="cc-error"><p>' + escapeHtml(err.message || 'Error loading dashboard') + '</p>' +
        '<button class="cc-btn cc-btn-sm" onclick="location.reload()">Retry</button></div>';
    } finally {
      state.loading = false;
    }
  }

  // Render sections progressively so the user sees content appearing
  function renderProgressive(root) {
    if (!state.data) { render(); return; }
    var d = state.data;

    // Phase 1: Greeting + stats (instant)
    var html = renderGreeting(d.greeting);
    html += renderStatCards(d);
    root.innerHTML = html;
    bindEvents();
    updateProgress(6, 'Done');

    // Phase 2+: Render tiles in order
    var layout = getLayout();
    var order = layout.order || getDefaultOrder();
    var hidden = layout.hidden || [];
    var available = getAvailableTiles().map(function(t) { return t.id; });

    // Add any new tiles not in saved layout
    for (var a = 0; a < available.length; a++) {
      if (order.indexOf(available[a]) === -1) order.push(available[a]);
    }

    // Render tiles synchronously (rAF was failing silently in some environments)
    try {
      var tilesDiv = document.createElement('div');
      tilesDiv.id = 'cc-dash-tiles';
      tilesDiv.className = 'cc-dash-tiles';

      for (var i = 0; i < order.length; i++) {
        var tileId = order[i];
        if (available.indexOf(tileId) === -1) continue;
        if (hidden.indexOf(tileId) !== -1) continue;
        try {
          var content = getTileRenderer(tileId);
          if (!content) continue;
          var wrapper = document.createElement('div');
          wrapper.className = 'cc-dash-tile';
          wrapper.setAttribute('data-tile-id', tileId);
          wrapper.innerHTML = content;
          tilesDiv.appendChild(wrapper);
        } catch(tileErr) {
          console.error('Tile render error (' + tileId + '):', tileErr);
        }
      }

      root.appendChild(tilesDiv);
      // Bind recordings tile after it's in the DOM
      bindRecordingsTile();
    } catch(renderErr) {
      console.error('Dashboard tile render error:', renderErr);
    }
  }

  // ─── Progress Loader ─────────────────────────────────────────

  var progressState = { current: 0, total: 6, status: '' };

  function updateProgress(step, status) {
    progressState.current = step;
    progressState.status = status;
    var bar = document.getElementById('cc-dash-progress-fill');
    var label = document.getElementById('cc-dash-progress-label');
    if (bar) bar.style.width = Math.round((step / progressState.total) * 100) + '%';
    if (label) label.textContent = status;
  }

  function renderSkeleton() {
    return '<div class="cc-dash-skeleton">' +
      // Progress bar
      '<div class="cc-dash-progress">' +
        '<div class="cc-dash-progress-bar">' +
          '<div class="cc-dash-progress-fill" id="cc-dash-progress-fill" style="width:5%"></div>' +
        '</div>' +
        '<div class="cc-dash-progress-label" id="cc-dash-progress-label">Connecting to server\u2026</div>' +
      '</div>' +
      // Skeleton placeholders
      '<div class="cc-dash-greeting-skel cc-skel-pulse" style="height:48px;margin-bottom:1.5rem;border-radius:8px;background:#1F2937;"></div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem;">' +
        '<div class="cc-skel-pulse" style="height:100px;border-radius:8px;background:#1F2937;"></div>'.repeat(4) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">' +
        '<div class="cc-skel-pulse" style="height:280px;border-radius:8px;background:#1F2937;"></div>'.repeat(2) +
      '</div>' +
    '</div>';
  }

  // ─── Main Render ─────────────────────────────────────────────

  function render() {
    var root = $el('cc-dash-root');
    if (!root || !state.data) return;
    var d = state.data;

    var html = '';

    // Greeting (always first)
    html += renderGreeting(d.greeting);

    // Stat cards (always second)
    html += renderStatCards(d);

    // Tiles in user-configured order
    var layout = getLayout();
    var order = layout.order || getDefaultOrder();
    var hidden = layout.hidden || [];
    var available = getAvailableTiles().map(function(t) { return t.id; });

    // Add any new tiles not in saved layout
    for (var a = 0; a < available.length; a++) {
      if (order.indexOf(available[a]) === -1) order.push(available[a]);
    }

    html += '<div id="cc-dash-tiles" class="cc-dash-tiles">';
    for (var i = 0; i < order.length; i++) {
      var tileId = order[i];
      if (available.indexOf(tileId) === -1) continue;
      if (hidden.indexOf(tileId) !== -1) continue;
      var content = getTileRenderer(tileId);
      if (!content) continue;
      html += '<div class="cc-dash-tile" data-tile-id="' + tileId + '">' + content + '</div>';
    }
    html += '</div>';

    root.innerHTML = html;
    bindEvents();
  }

  // ─── Greeting ────────────────────────────────────────────────

  function renderGreeting(g) {
    if (!g) return '';
    var now = new Date();
    var hour = now.getHours();
    var tod = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    // Compute date client-side to avoid n8n UTC timezone mismatch
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var dayOfWeek = days[now.getDay()];
    var localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    return '<div class="cc-dash-greeting">' +
      '<div>' +
        '<h2 class="cc-dash-greeting-text">' + escapeHtml(tod + ', ' + (g.name || '')) + '</h2>' +
        '<span class="cc-dash-greeting-date">' + escapeHtml(dayOfWeek + ', ' + API.util.formatDate(localDate)) + '</span>' +
      '</div>' +
      '<div class="cc-dash-actions">' +
        '<a href="/crm/kanban" class="cc-btn cc-btn-sm" style="background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.35);text-decoration:none;">Kanban</a> ' +
        '<a href="/crm/reports" class="cc-btn cc-btn-sm" style="background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.35);text-decoration:none;">Reports</a> ' +
        '<button class="cc-btn cc-btn-sm" id="cc-dash-customize" title="Customize dashboard layout" style="background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.35);">&#9881; Customize</button> ' +
        '<button class="cc-btn cc-btn-sm" id="cc-dash-refresh" title="Refresh" style="background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.35);">&#8635; Refresh</button>' +
      '</div>' +
    '</div>';
  }

  // ─── Stat Cards ──────────────────────────────────────────────

  function renderStatCards(d) {
    var pipe = d.pipeline || {};
    var rev = d.revenue || {};
    var sla = d.sla || {};
    var tasks = d.tasks || {};

    var slaPct = sla.compliance_pct != null ? sla.compliance_pct : 0;
    var slaClass = slaPct >= 90 ? 'green' : slaPct >= 75 ? 'yellow' : 'red';

    var overdueClass = (tasks.overdue || 0) > 0 ? 'red' : 'green';

    // Count today's meetings from bookings (use local date, skip phantom records)
    var todayStr = localToday();
    var todayMeetings = 0;
    var totalUpcoming = 0;
    if (state.bookings && state.bookings.length) {
      for (var i = 0; i < state.bookings.length; i++) {
        if (!state.bookings[i].date) continue; // skip phantom records
        if (state.bookings[i].date === todayStr) todayMeetings++;
        totalUpcoming++;
      }
    }
    var meetingColor = todayMeetings > 0 ? 'teal' : 'gray';

    return '<div class="cc-dash-stats">' +
      statCard('Open Pipeline', fmtNum(pipe.total_open), 'leads in funnel', 'blue', { href: '/crm' }) +
      statCard('Weighted Revenue', fmtCurrency(rev.weighted_total), fmtNum(rev.eligible_leads) + ' eligible leads', 'purple', { href: '/crm/reports' }) +
      statCard('Today\'s Meetings', fmtNum(todayMeetings), fmtNum(totalUpcoming) + ' total upcoming', meetingColor, { scroll: 'bookings' }) +
      statCard('Service Level', fmtPct(slaPct), fmtNum(sla.within_sla) + '/' + fmtNum(sla.total) + ' within SLA', slaClass, { scroll: 'activity-sla' }) +
      statCard('Overdue Tasks', fmtNum(tasks.overdue), fmtNum(tasks.total_open) + ' total open', overdueClass, { scroll: 'tasks-pipeline' }) +
    '</div>';
  }

  function statCard(label, value, sub, color, opts) {
    opts = opts || {};
    var tag = opts.href ? 'a' : 'div';
    var hrefAttr = opts.href ? ' href="' + opts.href + '"' : '';
    var scrollAttr = opts.scroll ? ' data-scroll-tile="' + opts.scroll + '"' : '';
    return '<' + tag + ' class="cc-rpt-stat cc-dash-stat cc-dash-stat-clickable"' + hrefAttr + scrollAttr + '>' +
      '<div class="cc-rpt-stat-label">' + escapeHtml(label) + '</div>' +
      '<div class="cc-rpt-stat-value cc-text-' + color + '">' + escapeHtml(value) + '</div>' +
      '<div class="cc-rpt-stat-sub">' + escapeHtml(sub) + '</div>' +
    '</' + tag + '>';
  }

  // ─── Tasks Widget ────────────────────────────────────────────

  function renderTasks(t) {
    if (!t) return '<div class="cc-dash-card"><h3 class="cc-dash-card-title">Tasks</h3><p class="cc-muted">No task data</p></div>';

    var html = '<div class="cc-dash-card" id="cc-dash-tasks-widget">' +
      '<h3 class="cc-dash-card-title">Tasks</h3>' +
      '<div class="cc-dash-task-summary">' +
        taskBadge(t.overdue, 'Overdue', 'red') +
        taskBadge(t.due_today, 'Due Today', 'yellow') +
        taskBadge(t.upcoming_7d, 'Next 7 Days', 'blue') +
      '</div>';

    // Overdue items list
    if (t.overdue_items && t.overdue_items.length) {
      html += '<div class="cc-dash-task-list">';
      html += '<h4 class="cc-dash-sub-title cc-text-red">Overdue</h4>';
      for (var i = 0; i < t.overdue_items.length && i < 5; i++) {
        var item = t.overdue_items[i];
        html += taskRow(item, 'red');
      }
      html += '</div>';
    }

    // Today items list
    if (t.today_items && t.today_items.length) {
      html += '<div class="cc-dash-task-list">';
      html += '<h4 class="cc-dash-sub-title cc-text-yellow">Due Today</h4>';
      for (var j = 0; j < t.today_items.length && j < 5; j++) {
        html += taskRow(t.today_items[j], 'yellow');
      }
      html += '</div>';
    }

    if ((!t.overdue_items || !t.overdue_items.length) && (!t.today_items || !t.today_items.length)) {
      html += '<p class="cc-muted" style="margin-top:0.75rem;">No overdue or due-today tasks</p>';
    }

    html += '</div>';
    return html;
  }

  function taskBadge(count, label, color) {
    return '<div class="cc-dash-task-badge">' +
      '<span class="cc-badge cc-badge-' + color + '">' + fmtNum(count || 0) + '</span>' +
      '<span class="cc-dash-task-badge-label">' + escapeHtml(label) + '</span>' +
    '</div>';
  }

  function taskRow(item, color) {
    var leadId = item.lead_id || '';
    var taskId = item.task_id || item.id || '';
    var href = leadId ? '/crm/lead?id=' + encodeURIComponent(leadId) + '&tab=tasks' : '#';
    return '<div class="cc-dash-task-row" style="display:flex;align-items:center;gap:0.5rem;">' +
      '<button type="button" class="cc-dash-task-check" data-task-id="' + escapeHtml(taskId) + '" title="Mark complete" ' +
        'style="flex-shrink:0;width:18px;height:18px;border:1.5px solid #D1D5DB;border-radius:4px;background:white;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" ' +
        'onmouseover="this.style.borderColor=\'#1A2F4B\';this.style.background=\'#F3F0EB\'" ' +
        'onmouseout="this.style.borderColor=\'#D1D5DB\';this.style.background=\'white\'"></button>' +
      '<a href="' + href + '" style="flex:1;text-decoration:none;color:inherit;display:flex;align-items:center;gap:0.4rem;min-width:0;">' +
        '<span class="cc-dash-task-dot cc-bg-' + color + '"></span>' +
        '<span class="cc-dash-task-title">' + escapeHtml(item.title || 'Untitled') + '</span>' +
        '<span class="cc-dash-task-meta">' + escapeHtml(item.lead_name || '') +
          (item.due_at ? ' &middot; ' + escapeHtml(API.util.formatDate(item.due_at)) : '') +
        '</span>' +
      '</a>' +
    '</div>';
  }

  // Wire up task-complete checkboxes
  document.addEventListener('click', function(ev) {
    var btn = ev.target.closest('.cc-dash-task-check');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    var taskId = btn.getAttribute('data-task-id');
    if (!taskId) return;
    btn.disabled = true;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1A2F4B" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
    var token = localStorage.getItem('app_token') || '';
    fetch('https://n8n.tabuchilaw.com/webhook/cc/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token },
      body: JSON.stringify({ action: 'update', id: taskId, fields: { Status: 'COMPLETED' } })
    }).then(function(r) { return r.json(); }).then(function(d) {
      var row = btn.closest('.cc-dash-task-row');
      if (row) { row.style.opacity = '0.4'; row.style.textDecoration = 'line-through'; }
    }).catch(function() {
      btn.disabled = false;
      btn.innerHTML = '';
      alert('Failed to mark complete. Please try again.');
    });
  });

  // ─── Pipeline Funnel ─────────────────────────────────────────

  function renderPipeline(p) {
    if (!p) return '<div class="cc-dash-card"><h3 class="cc-dash-card-title">Pipeline</h3><p class="cc-muted">No data</p></div>';

    var stages = p.stages || [];
    var maxCount = 0;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].count > maxCount) maxCount = stages[i].count;
    }

    var html = '<div class="cc-dash-card">' +
      '<h3 class="cc-dash-card-title"><a href="/crm" class="cc-dash-link">Pipeline</a> <span class="cc-muted">(' + fmtNum(p.total_open) + ' open)</span></h3>' +
      '<div class="cc-dash-funnel">';

    for (var s = 0; s < stages.length; s++) {
      var st = stages[s];
      var pct = maxCount > 0 ? Math.max((st.count / maxCount) * 100, 4) : 4;
      var color = API.util.stageColor(st.stage) || 'blue';
      var stageParam = encodeURIComponent(st.stage || '');
      html += '<a href="/crm?stage=' + stageParam + '" class="cc-dash-funnel-row cc-dash-funnel-clickable">' +
        '<span class="cc-dash-funnel-label">' + escapeHtml(st.label || st.stage) + '</span>' +
        '<div class="cc-dash-funnel-bar-wrap">' +
          '<div class="cc-dash-funnel-bar cc-bg-' + color + '" style="width:' + pct.toFixed(1) + '%"></div>' +
        '</div>' +
        '<span class="cc-dash-funnel-count">' + fmtNum(st.count) + '</span>' +
      '</a>';
    }

    html += '</div>';

    // Won/Lost this month
    html += '<div class="cc-dash-wonlost">' +
      '<span class="cc-text-green">Won this month: ' + fmtNum(p.won_this_month) + '</span>' +
      '<span class="cc-text-red" style="margin-left:1rem;">Lost: ' + fmtNum(p.lost_this_month) + '</span>' +
    '</div>';

    html += '</div>';
    return html;
  }

  // ─── Recent Activity ─────────────────────────────────────────

  function renderActivity(activities) {
    var html = '<div class="cc-dash-card">' +
      '<h3 class="cc-dash-card-title">Recent Activity</h3>';

    if (!activities || !activities.length) {
      html += '<p class="cc-muted">No recent activity</p>';
    } else {
      html += '<div class="cc-dash-activity-list">';
      for (var i = 0; i < activities.length && i < 10; i++) {
        var a = activities[i];
        var leadId = a.lead_id || '';
        var tag = leadId ? 'a' : 'div';
        var hrefAttr = leadId ? ' href="/crm/lead?id=' + encodeURIComponent(leadId) + '"' : '';
        html += '<' + tag + ' class="cc-dash-activity-row' + (leadId ? ' cc-dash-activity-clickable' : '') + '"' + hrefAttr + '>' +
          '<span class="cc-badge cc-badge-' + activityColor(a.type) + ' cc-badge-sm">' + escapeHtml(a.type || '?') + '</span>' +
          '<div class="cc-dash-activity-detail">' +
            '<span class="cc-dash-activity-name">' + escapeHtml(a.lead_name || '') + '</span>' +
            '<span class="cc-dash-activity-summary">' + escapeHtml(a.summary || '') + '</span>' +
          '</div>' +
          '<span class="cc-dash-activity-time">' + escapeHtml(API.util.formatRelativeTime(a.created_at)) + '</span>' +
        '</' + tag + '>';
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function activityColor(type) {
    var map = { NOTE: 'blue', EMAIL: 'purple', CALL: 'green', MEETING: 'teal', STATUS_CHANGE: 'yellow', TASK: 'cyan' };
    return map[type] || 'gray';
  }

  // ─── SLA Detail ──────────────────────────────────────────────

  function renderSLADetail(sla) {
    if (!sla) return '<div class="cc-dash-card"><h3 class="cc-dash-card-title">Service Level</h3><p class="cc-muted">No data</p></div>';

    var pct = sla.compliance_pct != null ? sla.compliance_pct : 0;
    var color = pct >= 90 ? '#10B981' : pct >= 75 ? '#F59E0B' : '#EF4444';
    var circumference = 2 * Math.PI * 45;
    var offset = circumference * (1 - pct / 100);

    return '<div class="cc-dash-card">' +
      '<h3 class="cc-dash-card-title">Service Level</h3>' +
      '<div class="cc-dash-sla-gauge">' +
        '<svg viewBox="0 0 100 100" class="cc-dash-sla-ring">' +
          '<circle cx="50" cy="50" r="45" fill="none" stroke="#374151" stroke-width="8"/>' +
          '<circle cx="50" cy="50" r="45" fill="none" stroke="' + color + '" stroke-width="8" ' +
            'stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" ' +
            'stroke-linecap="round" transform="rotate(-90 50 50)"/>' +
          '<text x="50" y="54" text-anchor="middle" fill="' + color + '" font-size="18" font-weight="700">' + fmtPct(pct) + '</text>' +
        '</svg>' +
      '</div>' +
      '<div class="cc-dash-sla-details">' +
        '<div class="cc-dash-sla-row"><span>Within SLA</span><span class="cc-text-green">' + fmtNum(sla.within_sla) + '</span></div>' +
        '<div class="cc-dash-sla-row"><span>Breached</span><span class="cc-text-red">' + fmtNum(sla.breached) + '</span></div>' +
        '<div class="cc-dash-sla-row"><span>Never Contacted</span><span class="cc-text-yellow">' + fmtNum(sla.never_contacted) + '</span></div>' +
        '<div class="cc-dash-sla-row"><span>Total</span><span>' + fmtNum(sla.total) + '</span></div>' +
      '</div>' +
    '</div>';
  }

  // ─── Recordings Tile ────────────────────────────────────────

  var _recFilter = 'all'; // 'all', 'unmatched', 'matched'

  function renderRecordingsTile(recordings) {
    if (!recordings) recordings = [];
    var filtered = recordings;
    if (_recFilter === 'unmatched') {
      filtered = recordings.filter(function(r) { return !r.Lead || !r.Lead.length; });
    } else if (_recFilter === 'matched') {
      filtered = recordings.filter(function(r) { return r.Lead && r.Lead.length > 0; });
    }
    var totalCount = recordings.length;
    var unmatchedCount = recordings.filter(function(r) { return !r.Lead || !r.Lead.length; }).length;

    var html = '<div class="cc-dash-card">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h3 class="cc-dash-card-title" style="margin:0;">Recordings <span style="font-size:0.8rem;font-weight:400;color:#6B7280;">' + totalCount + ' total' + (unmatchedCount ? ', <span style="color:#EF4444;">' + unmatchedCount + ' unmatched</span>' : '') + '</span></h3>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<button class="cc-btn cc-btn-sm' + (_recFilter === 'all' ? ' cc-btn-primary' : ' cc-btn-outline') + '" data-rec-filter="all">All</button>';
    html += '<button class="cc-btn cc-btn-sm' + (_recFilter === 'unmatched' ? ' cc-btn-primary' : ' cc-btn-outline') + '" data-rec-filter="unmatched">Unmatched</button>';
    html += '<button class="cc-btn cc-btn-sm' + (_recFilter === 'matched' ? ' cc-btn-primary' : ' cc-btn-outline') + '" data-rec-filter="matched">Matched</button>';
    html += '</div></div>';

    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:2rem;color:#9CA3AF;">No ' + (_recFilter === 'all' ? '' : _recFilter + ' ') + 'recordings found.</div>';
    } else {
      html += '<div style="overflow-x:auto;max-height:400px;overflow-y:auto;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
      html += '<thead><tr style="border-bottom:2px solid #E5E7EB;text-align:left;">' +
        '<th style="padding:6px 8px;font-weight:600;color:#6B7280;">Date</th>' +
        '<th style="padding:6px 8px;font-weight:600;color:#6B7280;">Client</th>' +
        '<th style="padding:6px 8px;font-weight:600;color:#6B7280;">Source</th>' +
        '<th style="padding:6px 8px;font-weight:600;color:#6B7280;">Duration</th>' +
        '<th style="padding:6px 8px;font-weight:600;color:#6B7280;">Status</th>' +
        '<th style="padding:6px 8px;font-weight:600;color:#6B7280;">Actions</th>' +
        '</tr></thead><tbody>';

      filtered.forEach(function(r) {
        var date = r.Meeting_Date || r.Created_At || '';
        var dateStr = date ? API.util.formatDate(date) : '—';
        var client = r.Client_Name || '—';
        var isMatched = r.Lead && r.Lead.length > 0;
        var source = (r.Source || 'unknown').toLowerCase();
        var sourceBadge = source === 'teams' ? '<span style="background:#DBEAFE;color:#1D4ED8;padding:2px 6px;border-radius:4px;font-size:0.75rem;">Teams</span>' :
          source === 'ringcentral' ? '<span style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-size:0.75rem;">RC</span>' :
          '<span style="background:#F3E8FF;color:#6B21A8;padding:2px 6px;border-radius:4px;font-size:0.75rem;">' + escapeHtml(source) + '</span>';
        var dur = r.Duration_Seconds ? Math.floor(r.Duration_Seconds / 60) + ':' + ('0' + (r.Duration_Seconds % 60)).slice(-2) : '—';
        var statusColor = r.Status === 'completed' ? '#059669' : r.Status === 'failed' ? '#EF4444' : '#F59E0B';
        var statusBadge = '<span style="color:' + statusColor + ';font-weight:500;font-size:0.8rem;">' + escapeHtml(r.Status || 'unknown') + '</span>';

        // Action buttons
        var actions = '';
        if (!isMatched) {
          actions += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-rec-match-btn" data-rec-id="' + escapeAttr(r.id) + '" style="font-size:0.75rem;padding:2px 8px;">Match to Lead</button> ';
        } else {
          actions += '<a href="/crm/lead?id=' + escapeAttr(r.Lead[0]) + '&tab=recordings" style="color:#2563EB;font-size:0.75rem;text-decoration:underline;">View Lead</a> ';
        }
        if (r.Status === 'completed' && r.Will_Status !== 'UPLOADED_TO_CLIO') {
          actions += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-rec-clio-btn" data-rec-id="' + escapeAttr(r.id) + '" style="font-size:0.75rem;padding:2px 8px;">Upload to Clio</button>';
        } else if (r.Will_Status === 'UPLOADED_TO_CLIO') {
          actions += '<span style="color:#059669;font-size:0.75rem;">✓ In Clio</span>';
        }

        html += '<tr style="border-bottom:1px solid #F3F4F6;">' +
          '<td style="padding:6px 8px;">' + escapeHtml(dateStr) + '</td>' +
          '<td style="padding:6px 8px;font-weight:500;">' + escapeHtml(client) + (isMatched ? '' : ' <span style="color:#EF4444;font-size:0.7rem;">⚠ unmatched</span>') + '</td>' +
          '<td style="padding:6px 8px;">' + sourceBadge + '</td>' +
          '<td style="padding:6px 8px;">' + dur + '</td>' +
          '<td style="padding:6px 8px;">' + statusBadge + '</td>' +
          '<td style="padding:6px 8px;white-space:nowrap;">' + actions + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  function bindRecordingsTile() {
    // Filter buttons
    document.querySelectorAll('[data-rec-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _recFilter = btn.getAttribute('data-rec-filter');
        // Re-render just the recordings tile
        var tile = document.querySelector('[data-tile-id="recordings"]');
        if (tile) {
          tile.innerHTML = renderRecordingsTile(state.recordings);
          bindRecordingsTile();
        }
      });
    });

    // Match to Lead buttons
    document.querySelectorAll('.cc-rec-match-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var recId = btn.getAttribute('data-rec-id');
        var leadId = prompt('Enter Lead ID to match this recording to:');
        if (!leadId || !leadId.trim()) return;
        btn.disabled = true;
        btn.textContent = 'Matching...';
        API.recordings.linkLead(recId, leadId.trim()).then(function(res) {
          if (res && res.success) {
            ccToast('Recording matched to lead.', 'success');
            fetchRecordings().then(function() {
              var tile = document.querySelector('[data-tile-id="recordings"]');
              if (tile) {
                tile.innerHTML = renderRecordingsTile(state.recordings);
                bindRecordingsTile();
              }
            });
          } else {
            ccToast('Match failed: ' + (res && res.error || 'Unknown error'), 'error');
            btn.disabled = false;
            btn.textContent = 'Match to Lead';
          }
        }).catch(function(err) {
          ccToast('Match failed: ' + (err.error || 'Network error'), 'error');
          btn.disabled = false;
          btn.textContent = 'Match to Lead';
        });
      });
    });

    // Upload to Clio buttons
    document.querySelectorAll('.cc-rec-clio-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var recId = btn.getAttribute('data-rec-id');
        if (!confirm('Upload this recording to Clio?')) return;
        btn.disabled = true;
        btn.textContent = 'Uploading...';
        API.recordings.uploadToClio(recId).then(function(res) {
          if (res && res.success) {
            ccToast('Recording uploaded to Clio.', 'success');
            fetchRecordings().then(function() {
              var tile = document.querySelector('[data-tile-id="recordings"]');
              if (tile) {
                tile.innerHTML = renderRecordingsTile(state.recordings);
                bindRecordingsTile();
              }
            });
          } else {
            ccToast('Upload failed: ' + (res && res.error || 'Unknown error'), 'error');
            btn.disabled = false;
            btn.textContent = 'Upload to Clio';
          }
        }).catch(function(err) {
          ccToast('Upload failed: ' + (err.error || 'Network error'), 'error');
          btn.disabled = false;
          btn.textContent = 'Upload to Clio';
        });
      });
    });
  }

  // ─── Bookings Widget ────────────────────────────────────────

  function renderBookings(bookings) {
    var today = localToday();
    var todayList = [];
    var upcomingList = [];

    if (bookings && bookings.length) {
      for (var i = 0; i < bookings.length; i++) {
        var b = bookings[i];
        if (!b.date) continue; // skip phantom records from empty API results
        if (b.date === today) {
          todayList.push(b);
        } else {
          upcomingList.push(b);
        }
      }
    }

    var html = '<div class="cc-dash-card cc-dash-full">' +
      '<h3 class="cc-dash-card-title">Upcoming Meetings' +
        '<span class="cc-muted" style="font-weight:400;font-size:0.85rem;margin-left:0.5rem;">' +
          (todayList.length ? todayList.length + ' today' : '') +
          (todayList.length && upcomingList.length ? ' &middot; ' : '') +
          (upcomingList.length ? upcomingList.length + ' upcoming' : '') +
        '</span>' +
      '</h3>';

    if (!todayList.length && !upcomingList.length) {
      html += '<p class="cc-muted" style="margin:0.5rem 0;">No upcoming meetings scheduled</p>';
    }

    if (todayList.length) {
      html += '<h4 class="cc-dash-sub-title">Today</h4>';
      html += '<div class="cc-dash-booking-list">';
      for (var t = 0; t < todayList.length; t++) {
        html += bookingRow(todayList[t]);
      }
      html += '</div>';
    }

    if (upcomingList.length) {
      html += '<h4 class="cc-dash-sub-title" style="margin-top:1rem;">Upcoming</h4>';
      html += '<div class="cc-dash-booking-list">';
      var limit = Math.min(upcomingList.length, 8);
      for (var u = 0; u < limit; u++) {
        html += bookingRow(upcomingList[u]);
      }
      if (upcomingList.length > 8) {
        html += '<div class="cc-muted" style="padding:0.4rem 0;">+ ' + (upcomingList.length - 8) + ' more</div>';
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function bookingRow(b) {
    var timeStr = formatBookingTime(b.startTime || b.time);
    var endStr = b.endTime ? ' \u2013 ' + formatBookingTime(b.endTime) : '';
    var dateStr = b.date ? API.util.formatDate(b.date) : '';
    var statusCls = b.status === 'confirmed' ? 'green' : b.status === 'cancelled' ? 'red' : 'yellow';
    var statusLabel = b.status === 'pending_approval' ? 'Pending' : (b.status || 'Unknown');
    statusLabel = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);

    // Make row clickable if we have a lead_id
    var leadId = b.lead_id || b.leadId || '';
    var tag = leadId ? 'a' : 'div';
    var hrefAttr = leadId ? ' href="/crm/lead?id=' + encodeURIComponent(leadId) + '"' : '';
    var clickClass = leadId ? ' cc-dash-booking-clickable' : '';

    var html = '<' + tag + ' class="cc-dash-booking-row' + clickClass + '"' + hrefAttr + '>' +
      '<div class="cc-dash-booking-time">' + escapeHtml(timeStr + endStr) + '</div>' +
      '<div class="cc-dash-booking-info">' +
        '<span class="cc-dash-booking-client">' + escapeHtml(b.clientName || '\u2014') + '</span>' +
        '<span class="cc-dash-booking-service">' + escapeHtml(b.meetingTypeName || b.serviceName || '') +
          (dateStr && b.date !== localToday() ? ' &middot; ' + escapeHtml(dateStr) : '') +
        '</span>' +
      '</div>' +
      '<div class="cc-dash-booking-actions">' +
        '<span class="cc-badge cc-badge-' + statusCls + ' cc-badge-sm">' + escapeHtml(statusLabel) + '</span>';

    if (b.meetingLink) {
      html += ' <a href="' + escapeHtml(b.meetingLink) + '" target="_blank" rel="noopener" class="cc-btn cc-btn-sm cc-btn-outline" style="font-size:0.75rem;padding:0.15rem 0.5rem;" onclick="event.stopPropagation();">Join</a>';
    }

    html += '</div></' + tag + '>';
    return html;
  }

  function formatBookingTime(time) {
    if (!time) return '';
    var parts = time.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1] || '00';
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ampm;
  }

  // ─── Admin: Rep Comparison ───────────────────────────────────

  function renderRepComparison(reps) {
    if (!reps || !reps.length) return '';

    var html = '<div class="cc-dash-card cc-dash-full">' +
      '<h3 class="cc-dash-card-title">Rep Comparison</h3>' +
      '<div class="cc-table-wrap">' +
      '<table class="cc-table">' +
      '<thead><tr>' +
        '<th>Rep</th><th>Open Leads</th><th>Won (30d)</th><th>Weighted Revenue</th><th>Service Level %</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < reps.length; i++) {
      var r = reps[i];
      var slaCls = (r.sla_pct >= 90) ? 'green' : (r.sla_pct >= 75) ? 'yellow' : 'red';
      html += '<tr>' +
        '<td>' + escapeHtml(r.rep_name || '\u2014') + '</td>' +
        '<td>' + fmtNum(r.open_leads) + '</td>' +
        '<td>' + fmtNum(r.won_30d) + '</td>' +
        '<td>' + fmtCurrency(r.weighted_revenue) + '</td>' +
        '<td><span class="cc-text-' + slaCls + '">' + fmtPct(r.sla_pct) + '</span></td>' +
      '</tr>';
    }

    html += '</tbody></table></div></div>';
    return html;
  }

  // ─── Admin: Revenue Timeline ─────────────────────────────────

  function renderRevenueTimeline(timeline) {
    if (!timeline || !timeline.horizons || !timeline.horizons.length) return '';

    var horizons = timeline.horizons;
    var maxVal = 0;
    for (var i = 0; i < horizons.length; i++) {
      if (horizons[i].weighted > maxVal) maxVal = horizons[i].weighted;
    }

    var html = '<div class="cc-dash-card cc-dash-full">' +
      '<h3 class="cc-dash-card-title">Revenue Timeline (Weighted)</h3>' +
      '<div class="cc-dash-timeline">';

    for (var h = 0; h < horizons.length; h++) {
      var hz = horizons[h];
      var pct = maxVal > 0 ? Math.max((hz.weighted / maxVal) * 100, 3) : 3;
      html += '<div class="cc-dash-timeline-row">' +
        '<span class="cc-dash-timeline-label">' + escapeHtml(hz.label) + '</span>' +
        '<div class="cc-dash-funnel-bar-wrap">' +
          '<div class="cc-dash-funnel-bar cc-bg-purple" style="width:' + pct.toFixed(1) + '%"></div>' +
        '</div>' +
        '<span class="cc-dash-timeline-val">' + fmtCurrency(hz.weighted) + '</span>' +
      '</div>';
    }

    html += '</div></div>';
    return html;
  }

  // ─── Admin: Workload ─────────────────────────────────────────

  function renderWorkload(wl, pipe) {
    if (!wl) return '';

    var html = '<div class="cc-dash-grid-2">';

    // Workload stats
    html += '<div class="cc-dash-card">' +
      '<h3 class="cc-dash-card-title">Workload</h3>' +
      '<div class="cc-dash-sla-details">' +
        '<div class="cc-dash-sla-row"><span>New Leads (7d)</span><span>' + fmtNum(wl.new_leads_7d) + '</span></div>' +
        '<div class="cc-dash-sla-row"><span>New Leads (30d)</span><span>' + fmtNum(wl.new_leads_30d) + '</span></div>' +
        '<div class="cc-dash-sla-row"><span>Avg Leads/Rep</span><span>' + fmtNum(wl.avg_leads_per_rep) + '</span></div>' +
      '</div>';
    if (wl.busiest_rep) {
      html += '<div class="cc-dash-workload-note">Busiest: <strong>' + escapeHtml(wl.busiest_rep.name) + '</strong> (' + fmtNum(wl.busiest_rep.open_leads) + ' leads)</div>';
    }
    if (wl.lightest_rep) {
      html += '<div class="cc-dash-workload-note">Lightest: <strong>' + escapeHtml(wl.lightest_rep.name) + '</strong> (' + fmtNum(wl.lightest_rep.open_leads) + ' leads)</div>';
    }
    html += '</div>';

    // Won/Lost card
    html += '<div class="cc-dash-card">' +
      '<h3 class="cc-dash-card-title">Won / Lost This Month</h3>' +
      '<div style="display:flex;gap:2rem;align-items:center;justify-content:center;padding:1.5rem 0;">' +
        '<div style="text-align:center;">' +
          '<div class="cc-rpt-stat-value cc-text-green" style="font-size:2.5rem;">' + fmtNum(pipe && pipe.won_this_month) + '</div>' +
          '<div class="cc-rpt-stat-sub">Won</div>' +
        '</div>' +
        '<div style="text-align:center;">' +
          '<div class="cc-rpt-stat-value cc-text-red" style="font-size:2.5rem;">' + fmtNum(pipe && pipe.lost_this_month) + '</div>' +
          '<div class="cc-rpt-stat-sub">Lost</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    html += '</div>';
    return html;
  }

  // ─── Customize Panel ─────────────────────────────────────────

  function openCustomizePanel() {
    state.customizing = true;
    var layout = getLayout();
    var available = getAvailableTiles();
    var order = layout.order || getDefaultOrder();
    var hidden = layout.hidden || [];

    // Ensure all available tiles are in order
    for (var a = 0; a < available.length; a++) {
      if (order.indexOf(available[a].id) === -1) order.push(available[a].id);
    }

    var html = '<div class="cc-dash-customize-overlay" id="cc-dash-customize-overlay">' +
      '<div class="cc-dash-customize-panel">' +
        '<div class="cc-dash-customize-header">' +
          '<h3>Customize Dashboard</h3>' +
          '<p class="cc-muted" style="margin:0.25rem 0 0;font-size:0.8rem;">Drag to reorder. Toggle tiles on or off.</p>' +
        '</div>' +
        '<div class="cc-dash-customize-list" id="cc-dash-customize-list">';

    for (var i = 0; i < order.length; i++) {
      var tileId = order[i];
      // Skip tiles not available to this user
      var isTileAvailable = false;
      for (var j = 0; j < available.length; j++) {
        if (available[j].id === tileId) { isTileAvailable = true; break; }
      }
      if (!isTileAvailable) continue;

      var isHidden = hidden.indexOf(tileId) !== -1;
      html += '<div class="cc-dash-customize-item" draggable="true" data-tile-id="' + tileId + '">' +
        '<span class="cc-dash-customize-handle" title="Drag to reorder">&#9776;</span>' +
        '<span class="cc-dash-customize-label">' + escapeHtml(getTileLabel(tileId)) + '</span>' +
        '<label class="cc-dash-toggle">' +
          '<input type="checkbox"' + (isHidden ? '' : ' checked') + ' data-toggle-tile="' + tileId + '">' +
          '<span class="cc-dash-toggle-slider"></span>' +
        '</label>' +
      '</div>';
    }

    html += '</div>' +
        '<div class="cc-dash-customize-footer">' +
          '<button class="cc-btn cc-btn-sm" id="cc-dash-customize-reset">Reset to Default</button>' +
          '<div style="display:flex;gap:0.5rem;">' +
            '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-dash-customize-cancel">Cancel</button>' +
            '<button class="cc-btn cc-btn-sm cc-btn-primary" id="cc-dash-customize-save">Save Layout</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Insert overlay
    var overlay = document.createElement('div');
    overlay.innerHTML = html;
    document.body.appendChild(overlay.firstChild);

    bindCustomizeEvents();
  }

  function bindCustomizeEvents() {
    var overlay = document.getElementById('cc-dash-customize-overlay');
    var list = document.getElementById('cc-dash-customize-list');
    if (!overlay || !list) return;

    // Close on overlay click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeCustomizePanel();
    });

    // Cancel
    var cancelBtn = document.getElementById('cc-dash-customize-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeCustomizePanel);

    // Reset
    var resetBtn = document.getElementById('cc-dash-customize-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        saveLayout({ order: getDefaultOrder(), hidden: [] });
        closeCustomizePanel();
        render();
      });
    }

    // Save
    var saveBtn = document.getElementById('cc-dash-customize-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        var items = list.querySelectorAll('.cc-dash-customize-item');
        var newOrder = [];
        var newHidden = [];
        for (var i = 0; i < items.length; i++) {
          var tid = items[i].getAttribute('data-tile-id');
          newOrder.push(tid);
          var cb = items[i].querySelector('input[type="checkbox"]');
          if (cb && !cb.checked) newHidden.push(tid);
        }
        saveLayout({ order: newOrder, hidden: newHidden });
        closeCustomizePanel();
        render();
      });
    }

    // Drag and drop within the list
    var dragItem = null;

    list.addEventListener('dragstart', function(e) {
      dragItem = e.target.closest('.cc-dash-customize-item');
      if (dragItem) {
        dragItem.classList.add('cc-dash-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragItem.getAttribute('data-tile-id'));
      }
    });

    list.addEventListener('dragend', function() {
      if (dragItem) dragItem.classList.remove('cc-dash-dragging');
      dragItem = null;
      // Remove all drop indicators
      var items = list.querySelectorAll('.cc-dash-customize-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('cc-dash-drop-above', 'cc-dash-drop-below');
      }
    });

    list.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var target = e.target.closest('.cc-dash-customize-item');
      if (!target || target === dragItem) return;

      // Clear all indicators
      var items = list.querySelectorAll('.cc-dash-customize-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('cc-dash-drop-above', 'cc-dash-drop-below');
      }

      // Show indicator based on cursor position
      var rect = target.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        target.classList.add('cc-dash-drop-above');
      } else {
        target.classList.add('cc-dash-drop-below');
      }
    });

    list.addEventListener('drop', function(e) {
      e.preventDefault();
      var target = e.target.closest('.cc-dash-customize-item');
      if (!target || !dragItem || target === dragItem) return;

      var rect = target.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        list.insertBefore(dragItem, target);
      } else {
        list.insertBefore(dragItem, target.nextSibling);
      }

      // Clear indicators
      var items = list.querySelectorAll('.cc-dash-customize-item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('cc-dash-drop-above', 'cc-dash-drop-below');
      }
    });
  }

  function closeCustomizePanel() {
    state.customizing = false;
    var overlay = document.getElementById('cc-dash-customize-overlay');
    if (overlay) overlay.remove();
  }

  // ─── Event Binding ───────────────────────────────────────────

  function bindEvents() {
    var refreshBtn = $el('cc-dash-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        API.cache.invalidate();
        loadDashboard(false);
      });
    }

    // Customize button
    var customizeBtn = document.getElementById('cc-dash-customize');
    if (customizeBtn) {
      customizeBtn.addEventListener('click', function() {
        openCustomizePanel();
      });
    }

    // Stat cards that scroll to tiles
    var scrollCards = document.querySelectorAll('[data-scroll-tile]');
    for (var i = 0; i < scrollCards.length; i++) {
      scrollCards[i].addEventListener('click', function(e) {
        var tileId = this.getAttribute('data-scroll-tile');
        var tileEl = document.querySelector('[data-tile-id="' + tileId + '"]');
        if (tileEl) {
          tileEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          tileEl.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.3)';
          tileEl.style.transition = 'box-shadow 0.3s ease';
          setTimeout(function() { tileEl.style.boxShadow = ''; }, 2000);
        }
      });
    }

    // Recordings tile
    bindRecordingsTile();
  }

  // ─── Auto-refresh ────────────────────────────────────────────

  function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function() {
      API.cache.invalidate();
      loadDashboard(false);
    }, REFRESH_INTERVAL);
  }

  // ─── Initialize ──────────────────────────────────────────────
  loadDashboard(true);
  startAutoRefresh();
})();
