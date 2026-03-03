/**
 * Tabuchi Law Client Care CRM - Reports Dashboard
 * Handles: /crm/reports
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Date range selector with presets (7d, 30d, 90d, MTD, QTD, YTD, All)
 * - Date field toggle (Created At / Closed At)
 * - Report tabs: Close Ratio, Funnel, Stage Aging, Rep Performance, Source, SLA, Lost Reasons
 * - All tables sortable
 *
 * Page element IDs:
 * - #cc-report-container   (main container)
 * - #cc-report-filters     (date range controls)
 * - #cc-report-tabs        (report type tabs)
 * - #cc-report-content     (report data output)
 */

(function Reports() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

  var API = ClientCareAPI;
  var $el = function(id) { return document.getElementById(id); };

  // ─── State ───────────────────────────────────────────────────
  var state = {
    activeReport: 'close-ratio',
    startDate: '',
    endDate: '',
    dateField: 'Created_At',
    practiceArea: '',
    source: '',
    data: null,
    loading: false
  };

  var REPORT_TYPES = [
    { key: 'close-ratio', label: 'Close Ratio' },
    { key: 'funnel', label: 'Pipeline Funnel' },
    { key: 'stage-aging', label: 'Stage Aging' },
    { key: 'rep-performance', label: 'Rep Performance' },
    { key: 'source-attribution', label: 'Source Attribution' },
    { key: 'sla-compliance', label: 'SLA Compliance' },
    { key: 'lost-reasons', label: 'Lost Reasons' }
  ];

  // ─── Date Presets ──────────────────────────────────────────
  function applyPreset(preset) {
    var now = new Date();
    var end = now.toISOString().split('T')[0];
    var start = '';

    switch (preset) {
      case '7d':  start = new Date(now - 7 * 86400000).toISOString().split('T')[0]; break;
      case '30d': start = new Date(now - 30 * 86400000).toISOString().split('T')[0]; break;
      case '90d': start = new Date(now - 90 * 86400000).toISOString().split('T')[0]; break;
      case 'mtd': start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]; break;
      case 'qtd':
        var qMonth = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), qMonth, 1).toISOString().split('T')[0];
        break;
      case 'ytd': start = now.getFullYear() + '-01-01'; break;
      case 'all': start = ''; end = ''; break;
    }

    state.startDate = start;
    state.endDate = end;

    var startEl = $el('cc-rpt-start');
    var endEl = $el('cc-rpt-end');
    if (startEl) startEl.value = start;
    if (endEl) endEl.value = end;

    // Highlight active preset
    document.querySelectorAll('.cc-rpt-preset').forEach(function(b) {
      b.classList.toggle('cc-preset-active', b.dataset.preset === preset);
    });

    fetchReport();
  }

  // ─── Fetch Report ──────────────────────────────────────────
  async function fetchReport() {
    if (state.loading) return;
    state.loading = true;

    var content = $el('cc-report-content');
    if (content) content.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading report...</p></div>';

    try {
      var params = { date_field: state.dateField };
      if (state.startDate) params.start_date = state.startDate;
      if (state.endDate) params.end_date = state.endDate;
      if (state.practiceArea) params.practice_area = state.practiceArea;
      if (state.source) params.source = state.source;

      var result = await API.reports.get(state.activeReport, params);
      state.data = result;

      if (result.success) {
        renderReport();
      } else {
        if (content) content.innerHTML = '<div class="cc-error">' + escapeHtml(result.error || 'Failed to load report.') + '</div>';
      }
    } catch (err) {
      if (content) content.innerHTML = '<div class="cc-error">' + escapeHtml(err.error || 'Error loading report.') + '</div>';
    }

    state.loading = false;
  }

  // ─── Render Filters ────────────────────────────────────────
  function renderFilters() {
    var el = $el('cc-report-filters');
    if (!el) return;

    el.innerHTML =
      '<div class="cc-rpt-date-row">' +
        '<div class="cc-rpt-presets">' +
          '<button class="cc-rpt-preset" data-preset="7d">7 Days</button>' +
          '<button class="cc-rpt-preset cc-preset-active" data-preset="30d">30 Days</button>' +
          '<button class="cc-rpt-preset" data-preset="90d">90 Days</button>' +
          '<button class="cc-rpt-preset" data-preset="mtd">MTD</button>' +
          '<button class="cc-rpt-preset" data-preset="qtd">QTD</button>' +
          '<button class="cc-rpt-preset" data-preset="ytd">YTD</button>' +
          '<button class="cc-rpt-preset" data-preset="all">All Time</button>' +
        '</div>' +
        '<div class="cc-rpt-custom-dates">' +
          '<input type="date" id="cc-rpt-start" class="cc-input cc-input-sm" />' +
          '<span> to </span>' +
          '<input type="date" id="cc-rpt-end" class="cc-input cc-input-sm" />' +
        '</div>' +
        '<div class="cc-rpt-date-field">' +
          '<select id="cc-rpt-date-field" class="cc-input cc-input-sm">' +
            '<option value="Created_At">By Created Date</option>' +
            '<option value="Intake_Received_At">By Closed Date</option>' +
          '</select>' +
        '</div>' +
      '</div>';

    // Bind presets
    el.querySelectorAll('.cc-rpt-preset').forEach(function(btn) {
      btn.addEventListener('click', function() { applyPreset(btn.dataset.preset); });
    });

    // Bind custom dates
    var startEl = $el('cc-rpt-start');
    var endEl = $el('cc-rpt-end');
    if (startEl) startEl.addEventListener('change', function() {
      state.startDate = startEl.value;
      clearPresetHighlight();
      fetchReport();
    });
    if (endEl) endEl.addEventListener('change', function() {
      state.endDate = endEl.value;
      clearPresetHighlight();
      fetchReport();
    });

    // Bind date field
    var fieldEl = $el('cc-rpt-date-field');
    if (fieldEl) fieldEl.addEventListener('change', function() {
      state.dateField = fieldEl.value;
      fetchReport();
    });
  }

  function clearPresetHighlight() {
    document.querySelectorAll('.cc-rpt-preset').forEach(function(b) {
      b.classList.remove('cc-preset-active');
    });
  }

  // ─── Render Tabs ───────────────────────────────────────────
  function renderTabs() {
    var el = $el('cc-report-tabs');
    if (!el) return;

    var html = '<div class="cc-rpt-tabs">';
    REPORT_TYPES.forEach(function(r) {
      var cls = 'cc-rpt-tab' + (r.key === state.activeReport ? ' cc-rpt-tab-active' : '');
      html += '<button class="' + cls + '" data-report="' + r.key + '">' + r.label + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('.cc-rpt-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.activeReport = btn.dataset.report;
        renderTabs();
        fetchReport();
      });
    });
  }

  // ─── Render Report Data ────────────────────────────────────
  function renderReport() {
    var content = $el('cc-report-content');
    if (!content || !state.data) return;

    var d = state.data.data;
    var html = '<div class="cc-rpt-meta">Total leads in range: ' + (state.data.total_leads || 0) + '</div>';

    switch (state.activeReport) {
      case 'close-ratio':
        html += renderCloseRatio(d);
        break;
      case 'funnel':
        html += renderFunnel(d);
        break;
      case 'stage-aging':
        html += renderStageAging(d);
        break;
      case 'rep-performance':
        html += renderRepPerformance(d);
        break;
      case 'source-attribution':
        html += renderSourceAttribution(d);
        break;
      case 'sla-compliance':
        html += renderSLACompliance(d);
        break;
      case 'lost-reasons':
        html += renderLostReasons(d);
        break;
      default:
        html += '<p>Unknown report type.</p>';
    }

    content.innerHTML = html;
  }

  function renderCloseRatio(d) {
    if (!d) return '';
    var html = '<div class="cc-rpt-headline">' +
      '<div class="cc-rpt-stat"><div class="cc-rpt-stat-value">' + d.close_ratio_pct + '%</div><div class="cc-rpt-stat-label">Close Ratio</div></div>' +
      '<div class="cc-rpt-stat"><div class="cc-rpt-stat-value">' + d.total + '</div><div class="cc-rpt-stat-label">Total</div></div>' +
      '<div class="cc-rpt-stat cc-text-green"><div class="cc-rpt-stat-value">' + d.won + '</div><div class="cc-rpt-stat-label">Won</div></div>' +
      '<div class="cc-rpt-stat cc-text-red"><div class="cc-rpt-stat-value">' + d.lost + '</div><div class="cc-rpt-stat-label">Lost</div></div>' +
      '<div class="cc-rpt-stat"><div class="cc-rpt-stat-value">' + d.open + '</div><div class="cc-rpt-stat-label">Open</div></div>' +
    '</div>';

    if (d.by_practice_area && d.by_practice_area.length) {
      html += '<h3>By Practice Area</h3>';
      html += buildSortableTable(d.by_practice_area, [
        { key: 'practice_area', label: 'Practice Area' },
        { key: 'total', label: 'Total' },
        { key: 'won', label: 'Won' },
        { key: 'lost', label: 'Lost' },
        { key: 'ratio', label: 'Close %' }
      ], 'rpt-pa');
    }

    if (d.by_source && d.by_source.length) {
      html += '<h3>By Source</h3>';
      html += buildSortableTable(d.by_source, [
        { key: 'source', label: 'Source' },
        { key: 'total', label: 'Total' },
        { key: 'won', label: 'Won' },
        { key: 'lost', label: 'Lost' },
        { key: 'ratio', label: 'Close %' }
      ], 'rpt-src');
    }

    return html;
  }

  function renderFunnel(d) {
    if (!d || !d.stages) return '';
    var html = '<div class="cc-rpt-funnel">';
    d.stages.forEach(function(s) {
      var widthPct = Math.max(s.pct_of_total, 5);
      html += '<div class="cc-funnel-row">';
      html += '<div class="cc-funnel-label">' + API.util.stageLabel(s.stage) + '</div>';
      html += '<div class="cc-funnel-bar-wrap"><div class="cc-funnel-bar" style="width:' + widthPct + '%"></div></div>';
      html += '<div class="cc-funnel-count">' + s.reached_or_beyond + ' (' + s.pct_of_total + '%)</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderStageAging(d) {
    if (!d || !d.stages) return '';
    return buildSortableTable(d.stages, [
      { key: 'stage', label: 'Stage', format: function(v) { return API.util.stageLabel(v); } },
      { key: 'count', label: 'Leads' },
      { key: 'avg_days', label: 'Avg Days' },
      { key: 'median_days', label: 'Median Days' },
      { key: 'max_days', label: 'Max Days' }
    ], 'rpt-aging');
  }

  function renderRepPerformance(d) {
    if (!d || !d.reps) return '';
    return buildSortableTable(d.reps, [
      { key: 'name', label: 'Rep' },
      { key: 'total', label: 'Total' },
      { key: 'won', label: 'Won' },
      { key: 'lost', label: 'Lost' },
      { key: 'open', label: 'Open' },
      { key: 'close_ratio_pct', label: 'Close %' }
    ], 'rpt-rep');
  }

  function renderSourceAttribution(d) {
    if (!d || !d.sources) return '';
    return buildSortableTable(d.sources, [
      { key: 'source', label: 'Source' },
      { key: 'total', label: 'Total' },
      { key: 'won', label: 'Won' },
      { key: 'lost', label: 'Lost' },
      { key: 'open', label: 'Open' },
      { key: 'close_ratio_pct', label: 'Close %' }
    ], 'rpt-source');
  }

  function renderSLACompliance(d) {
    if (!d) return '';
    var html = '<div class="cc-rpt-headline">' +
      '<div class="cc-rpt-stat"><div class="cc-rpt-stat-value">' + d.compliance_pct + '%</div><div class="cc-rpt-stat-label">SLA Compliance</div></div>' +
      '<div class="cc-rpt-stat"><div class="cc-rpt-stat-value">' + d.total + '</div><div class="cc-rpt-stat-label">Total</div></div>' +
      '<div class="cc-rpt-stat cc-text-green"><div class="cc-rpt-stat-value">' + d.within_sla + '</div><div class="cc-rpt-stat-label">Within ' + d.sla_hours + 'h</div></div>' +
      '<div class="cc-rpt-stat cc-text-red"><div class="cc-rpt-stat-value">' + d.breached + '</div><div class="cc-rpt-stat-label">Breached</div></div>' +
      '<div class="cc-rpt-stat"><div class="cc-rpt-stat-value">' + d.never_contacted + '</div><div class="cc-rpt-stat-label">Never Contacted</div></div>' +
    '</div>';
    return html;
  }

  function renderLostReasons(d) {
    if (!d || !d.reasons) return '';
    var html = '<div class="cc-rpt-meta">Total lost: ' + d.total_lost + '</div>';
    html += buildSortableTable(d.reasons, [
      { key: 'reason', label: 'Reason' },
      { key: 'count', label: 'Count' },
      { key: 'pct', label: '% of Lost' }
    ], 'rpt-lost');
    return html;
  }

  // ─── Sortable Table Builder ────────────────────────────────
  var tableSortState = {};

  function buildSortableTable(rows, columns, tableId) {
    if (!rows || rows.length === 0) return '<p class="cc-empty">No data available.</p>';

    // Get sort state for this table
    var sortKey = (tableSortState[tableId] || {}).key || '';
    var sortDir = (tableSortState[tableId] || {}).dir || 'asc';

    // Sort rows
    if (sortKey) {
      rows = rows.slice().sort(function(a, b) {
        var av = a[sortKey];
        var bv = b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        av = String(av || '');
        bv = String(bv || '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    var html = '<table class="cc-table cc-rpt-table" data-table-id="' + tableId + '">';
    html += '<thead><tr>';
    columns.forEach(function(col) {
      var arrow = '';
      var cls = 'cc-th cc-th-sortable';
      if (sortKey === col.key) {
        cls += ' cc-th-sorted';
        arrow = sortDir === 'asc' ? ' &#9650;' : ' &#9660;';
      }
      html += '<th class="' + cls + '" data-col="' + col.key + '">' + col.label + arrow + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function(row) {
      html += '<tr>';
      columns.forEach(function(col) {
        var val = row[col.key];
        if (col.format) val = col.format(val);
        html += '<td>' + escapeHtml(String(val !== undefined && val !== null ? val : '')) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';

    return html;
  }

  // Delegate sort clicks on report content
  function bindTableSorts() {
    var content = $el('cc-report-content');
    if (!content) return;

    content.addEventListener('click', function(e) {
      var th = e.target.closest('.cc-th-sortable');
      if (!th) return;
      var table = th.closest('.cc-rpt-table');
      if (!table) return;
      var tableId = table.dataset.tableId;
      var col = th.dataset.col;

      var current = tableSortState[tableId] || {};
      if (current.key === col) {
        tableSortState[tableId] = { key: col, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      } else {
        tableSortState[tableId] = { key: col, dir: 'asc' };
      }

      renderReport();
    });
  }

  // ─── Helpers ────────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Initialize ─────────────────────────────────────────────
  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    renderFilters();
    renderTabs();
    bindTableSorts();

    // Default: last 30 days
    applyPreset('30d');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
