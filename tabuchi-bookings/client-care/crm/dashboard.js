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
 * - SLA compliance gauge
 * - Weighted revenue projection
 * - Recent activity feed
 * - Admin: Rep comparison table, revenue timeline, workload
 * - Auto-refresh every 5 minutes
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
    refreshTimer: null
  };
  state.isAdmin = ((state.role || '').toUpperCase() === 'ADMIN' || (state.role || '').toUpperCase() === 'MANAGER');

  var REFRESH_INTERVAL = 300000; // 5 minutes

  // Local date helper — avoids UTC timezone mismatch from n8n Cloud
  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var BOOKINGS_ENDPOINT = 'https://tabuchilaw.app.n8n.cloud/webhook/api/dashboard/bookings';

  // ─── Helpers ─────────────────────────────────────────────────

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
      // Fire both requests in parallel
      var dashPromise = API.dashboard.get();
      var bookingsPromise = fetchBookings();

      if (showSkeleton) updateProgress(2, 'Fetching pipeline & tasks\u2026');

      var result = await dashPromise;
      if (!result || !result.success) {
        throw new Error((result && result.error) || 'Failed to load dashboard');
      }
      state.data = result.data;
      state.role = result.role || state.role;
      state.isAdmin = ((state.role || '').toUpperCase() === 'ADMIN' || (state.role || '').toUpperCase() === 'MANAGER');

      if (showSkeleton) updateProgress(4, 'Rendering dashboard\u2026');

      // Wait for bookings (non-blocking — dashboard renders even if this is slow)
      await bookingsPromise;

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

    // Phase 2: Bookings + Tasks/Pipeline (next frame)
    requestAnimationFrame(function() {
      var frag = document.createDocumentFragment();

      var bookingsDiv = document.createElement('div');
      bookingsDiv.innerHTML = renderBookings(state.bookings);
      while (bookingsDiv.firstChild) frag.appendChild(bookingsDiv.firstChild);

      var gridDiv = document.createElement('div');
      gridDiv.innerHTML = '<div class="cc-dash-grid-2">' + renderTasks(d.tasks) + renderPipeline(d.pipeline) + '</div>';
      while (gridDiv.firstChild) frag.appendChild(gridDiv.firstChild);

      root.appendChild(frag);

      // Phase 3: Activity + SLA + Admin (next frame)
      requestAnimationFrame(function() {
        var frag2 = document.createDocumentFragment();

        var actDiv = document.createElement('div');
        actDiv.innerHTML = '<div class="cc-dash-grid-2">' + renderActivity(d.recent_activity) + renderSLADetail(d.sla) + '</div>';
        while (actDiv.firstChild) frag2.appendChild(actDiv.firstChild);

        if (state.isAdmin) {
          var adminDiv = document.createElement('div');
          adminDiv.innerHTML = renderRepComparison(d.rep_comparison) +
            renderRevenueTimeline(d.revenue_timeline) +
            renderWorkload(d.workload, d.pipeline);
          while (adminDiv.firstChild) frag2.appendChild(adminDiv.firstChild);
        }

        root.appendChild(frag2);
      });
    });
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

    // Greeting
    html += renderGreeting(d.greeting);

    // Stat cards
    html += renderStatCards(d);

    // Bookings — prominent position right after stats
    html += renderBookings(state.bookings);

    // Two-column: Tasks + Pipeline
    html += '<div class="cc-dash-grid-2">';
    html += renderTasks(d.tasks);
    html += renderPipeline(d.pipeline);
    html += '</div>';

    // Two-column: Activity + SLA detail
    html += '<div class="cc-dash-grid-2">';
    html += renderActivity(d.recent_activity);
    html += renderSLADetail(d.sla);
    html += '</div>';

    // Admin sections
    if (state.isAdmin) {
      html += renderRepComparison(d.rep_comparison);
      html += renderRevenueTimeline(d.revenue_timeline);
      html += renderWorkload(d.workload, d.pipeline);
    }

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
        '<a href="/crm/kanban" class="cc-btn cc-btn-sm cc-btn-outline">Kanban</a> ' +
        '<a href="/crm/reports" class="cc-btn cc-btn-sm cc-btn-outline">Reports</a> ' +
        '<button class="cc-btn cc-btn-sm" id="cc-dash-refresh" title="Refresh">&#8635; Refresh</button>' +
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
      statCard('Open Pipeline', fmtNum(pipe.total_open), 'leads in funnel', 'blue') +
      statCard('Weighted Revenue', fmtCurrency(rev.weighted_total), fmtNum(rev.eligible_leads) + ' eligible leads', 'purple') +
      statCard('Today\'s Meetings', fmtNum(todayMeetings), fmtNum(totalUpcoming) + ' total upcoming', meetingColor) +
      statCard('SLA Compliance', fmtPct(slaPct), fmtNum(sla.within_sla) + '/' + fmtNum(sla.total) + ' within SLA', slaClass) +
      statCard('Overdue Tasks', fmtNum(tasks.overdue), fmtNum(tasks.total_open) + ' total open', overdueClass) +
    '</div>';
  }

  function statCard(label, value, sub, color) {
    return '<div class="cc-rpt-stat cc-dash-stat">' +
      '<div class="cc-rpt-stat-label">' + escapeHtml(label) + '</div>' +
      '<div class="cc-rpt-stat-value cc-text-' + color + '">' + escapeHtml(value) + '</div>' +
      '<div class="cc-rpt-stat-sub">' + escapeHtml(sub) + '</div>' +
    '</div>';
  }

  // ─── Tasks Widget ────────────────────────────────────────────

  function renderTasks(t) {
    if (!t) return '<div class="cc-dash-card"><h3 class="cc-dash-card-title">Tasks</h3><p class="cc-muted">No task data</p></div>';

    var html = '<div class="cc-dash-card">' +
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
    var leadId = item.lead_id || item.id || '';
    var href = leadId ? '/crm/lead?id=' + encodeURIComponent(leadId) : '#';
    return '<a href="' + href + '" class="cc-dash-task-row">' +
      '<span class="cc-dash-task-dot cc-bg-' + color + '"></span>' +
      '<span class="cc-dash-task-title">' + escapeHtml(item.title || 'Untitled') + '</span>' +
      '<span class="cc-dash-task-meta">' + escapeHtml(item.lead_name || '') +
        (item.due_at ? ' &middot; ' + escapeHtml(API.util.formatDate(item.due_at)) : '') +
      '</span>' +
    '</a>';
  }

  // ─── Pipeline Funnel ─────────────────────────────────────────

  function renderPipeline(p) {
    if (!p) return '<div class="cc-dash-card"><h3 class="cc-dash-card-title">Pipeline</h3><p class="cc-muted">No data</p></div>';

    var stages = p.stages || [];
    var maxCount = 0;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].count > maxCount) maxCount = stages[i].count;
    }

    var html = '<div class="cc-dash-card">' +
      '<h3 class="cc-dash-card-title">Pipeline <span class="cc-muted">(' + fmtNum(p.total_open) + ' open)</span></h3>' +
      '<div class="cc-dash-funnel">';

    for (var s = 0; s < stages.length; s++) {
      var st = stages[s];
      var pct = maxCount > 0 ? Math.max((st.count / maxCount) * 100, 4) : 4;
      var color = API.util.stageColor(st.stage) || 'blue';
      html += '<div class="cc-dash-funnel-row">' +
        '<span class="cc-dash-funnel-label">' + escapeHtml(st.label || st.stage) + '</span>' +
        '<div class="cc-dash-funnel-bar-wrap">' +
          '<div class="cc-dash-funnel-bar cc-bg-' + color + '" style="width:' + pct.toFixed(1) + '%"></div>' +
        '</div>' +
        '<span class="cc-dash-funnel-count">' + fmtNum(st.count) + '</span>' +
      '</div>';
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
        html += '<div class="cc-dash-activity-row">' +
          '<span class="cc-badge cc-badge-' + activityColor(a.type) + ' cc-badge-sm">' + escapeHtml(a.type || '?') + '</span>' +
          '<div class="cc-dash-activity-detail">' +
            '<span class="cc-dash-activity-name">' + escapeHtml(a.lead_name || '') + '</span>' +
            '<span class="cc-dash-activity-summary">' + escapeHtml(a.summary || '') + '</span>' +
          '</div>' +
          '<span class="cc-dash-activity-time">' + escapeHtml(API.util.formatRelativeTime(a.created_at)) + '</span>' +
        '</div>';
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
    if (!sla) return '<div class="cc-dash-card"><h3 class="cc-dash-card-title">SLA Compliance</h3><p class="cc-muted">No data</p></div>';

    var pct = sla.compliance_pct != null ? sla.compliance_pct : 0;
    var color = pct >= 90 ? '#10B981' : pct >= 75 ? '#F59E0B' : '#EF4444';
    var circumference = 2 * Math.PI * 45;
    var offset = circumference * (1 - pct / 100);

    return '<div class="cc-dash-card">' +
      '<h3 class="cc-dash-card-title">SLA Compliance</h3>' +
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
    var endStr = b.endTime ? ' – ' + formatBookingTime(b.endTime) : '';
    var dateStr = b.date ? API.util.formatDate(b.date) : '';
    var statusCls = b.status === 'confirmed' ? 'green' : b.status === 'cancelled' ? 'red' : 'yellow';
    var statusLabel = b.status === 'pending_approval' ? 'Pending' : (b.status || 'Unknown');
    statusLabel = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);

    var html = '<div class="cc-dash-booking-row">' +
      '<div class="cc-dash-booking-time">' + escapeHtml(timeStr + endStr) + '</div>' +
      '<div class="cc-dash-booking-info">' +
        '<span class="cc-dash-booking-client">' + escapeHtml(b.clientName || '—') + '</span>' +
        '<span class="cc-dash-booking-service">' + escapeHtml(b.meetingTypeName || b.serviceName || '') +
          (dateStr && b.date !== localToday() ? ' &middot; ' + escapeHtml(dateStr) : '') +
        '</span>' +
      '</div>' +
      '<div class="cc-dash-booking-actions">' +
        '<span class="cc-badge cc-badge-' + statusCls + ' cc-badge-sm">' + escapeHtml(statusLabel) + '</span>';

    if (b.meetingLink) {
      html += ' <a href="' + escapeHtml(b.meetingLink) + '" target="_blank" rel="noopener" class="cc-btn cc-btn-sm cc-btn-outline" style="font-size:0.75rem;padding:0.15rem 0.5rem;">Join</a>';
    }

    html += '</div></div>';
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
        '<th>Rep</th><th>Open Leads</th><th>Won (30d)</th><th>Weighted Revenue</th><th>SLA %</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < reps.length; i++) {
      var r = reps[i];
      var slaCls = (r.sla_pct >= 90) ? 'green' : (r.sla_pct >= 75) ? 'yellow' : 'red';
      html += '<tr>' +
        '<td>' + escapeHtml(r.rep_name || '—') + '</td>' +
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

  // ─── Event Binding ───────────────────────────────────────────

  function bindEvents() {
    var refreshBtn = $el('cc-dash-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        API.cache.invalidate();
        loadDashboard(false);
      });
    }
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
