/**
 * Tabuchi Law Client Care CRM - Lead List (Sortable Table)
 * Handles: /crm (main CRM page — lead list view)
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Sortable columns (click header to toggle asc/desc/clear)
 * - Filters: stage, disposition, practice area, search
 * - Date range filter with presets
 * - Pagination
 * - New lead button (modal or redirect)
 * - Click row to navigate to lead detail
 *
 * Page element IDs:
 * - #cc-page-root          (page container)
 * - #cc-lead-table-body    (tbody for lead rows)
 * - #cc-lead-count         (total count display)
 * - #cc-filter-stage       (stage dropdown)
 * - #cc-filter-disposition (disposition dropdown)
 * - #cc-filter-practice    (practice area dropdown)
 * - #cc-filter-search      (search input)
 * - #cc-filter-start-date  (date input)
 * - #cc-filter-end-date    (date input)
 * - #cc-date-presets        (preset buttons container)
 * - #cc-pagination         (pagination container)
 * - #cc-new-lead-btn       (create lead button)
 */

(function LeadList() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

  // Block BOOKINGS-only users from CRM pages
  var _u = ClientCareAPI.auth.getUser();
  if (_u && _u.role === 'BOOKINGS') { window.location.href = '/dashboard'; return; }

  var API = ClientCareAPI;
  var $el = function(id) { return document.getElementById(id); };

  // ─── State ───────────────────────────────────────────────────
  var state = {
    leads: [],
    totalCount: 0,
    sortBy: sessionStorage.getItem('cc_lead_sort_by') || 'Created_At',
    sortDir: sessionStorage.getItem('cc_lead_sort_dir') || 'desc',
    filters: {
      stage: '',
      disposition: 'OPEN',
      practice_area: '',
      search: '',
      start_date: '',
      end_date: ''
    },
    offset: 0,
    limit: 50,
    loading: false
  };

  // ─── Column Definitions ──────────────────────────────────────
  var COLUMNS = [
    { key: 'Client_Name',    label: 'Client',        sortable: true, width: '18%' },
    { key: 'Lead_Stage',     label: 'Stage',          sortable: true, width: '14%' },
    { key: 'Practice_Area',  label: 'Practice Area',  sortable: true, width: '14%' },
    { key: 'Priority',       label: 'Priority',       sortable: true, width: '8%' },
    { key: 'Lead_Owner',     label: 'Owner',          sortable: true, width: '12%' },
    { key: 'Source',         label: 'Source',          sortable: true, width: '8%' },
    { key: 'Last_Contacted_At', label: 'Last Contact', sortable: true, width: '12%' },
    { key: 'Created_At',    label: 'Created',         sortable: true, width: '10%' }
  ];

  // ─── Date Presets ────────────────────────────────────────────
  function getDatePreset(preset) {
    var now = new Date();
    var start, end = now.toISOString().split('T')[0];

    switch (preset) {
      case '7d':
        start = new Date(now - 7 * 86400000).toISOString().split('T')[0];
        break;
      case '30d':
        start = new Date(now - 30 * 86400000).toISOString().split('T')[0];
        break;
      case '90d':
        start = new Date(now - 90 * 86400000).toISOString().split('T')[0];
        break;
      case 'mtd':
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        break;
      case 'qtd':
        var qMonth = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), qMonth, 1).toISOString().split('T')[0];
        break;
      case 'ytd':
        start = now.getFullYear() + '-01-01';
        break;
      case 'all':
        start = '';
        end = '';
        break;
      default:
        return null;
    }
    return { start_date: start, end_date: end };
  }

  // ─── Fetch Leads ─────────────────────────────────────────────
  async function fetchLeads() {
    if (state.loading) return;
    state.loading = true;

    var countEl = $el('cc-lead-count');
    var tbody = $el('cc-lead-table-body');

    if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-loading-cell"><div class="cc-spinner"></div> Loading...</td></tr>';

    try {
      var params = {
        sort_by: state.sortBy,
        sort_dir: state.sortDir,
        offset: state.offset,
        limit: state.limit
      };

      // Apply filters
      Object.entries(state.filters).forEach(function(entry) {
        if (entry[1]) params[entry[0]] = entry[1];
      });

      var result = await API.leads.list(params);

      if (result.success) {
        state.leads = result.leads || [];
        state.totalCount = result.total || state.leads.length;
        renderTable();
        renderPagination();
      } else {
        if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-error-cell">Failed to load leads.</td></tr>';
      }
    } catch (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-error-cell">' + (err.error || 'Error loading leads.') + '</td></tr>';
    }

    state.loading = false;
    if (countEl) countEl.textContent = state.totalCount + ' lead' + (state.totalCount !== 1 ? 's' : '');
  }

  // ─── Render Table ────────────────────────────────────────────
  function renderTable() {
    var tbody = $el('cc-lead-table-body');
    if (!tbody) return;

    if (state.leads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-empty-cell">No leads found matching your filters.</td></tr>';
      return;
    }

    var html = '';
    state.leads.forEach(function(lead) {
      html += '<tr class="cc-lead-row" data-id="' + lead.id + '">';
      html += '<td class="cc-cell-name">';
      html += '<div class="cc-lead-name">' + escapeHtml(lead.Client_Name || '—') + '</div>';
      html += '<div class="cc-lead-email">' + escapeHtml(lead.Client_Email || '') + '</div>';
      html += '</td>';
      html += '<td><span class="cc-badge cc-badge-' + API.util.stageColor(lead.Lead_Stage) + '">' + API.util.stageLabel(lead.Lead_Stage) + '</span></td>';
      html += '<td>' + formatPracticeArea(lead.Practice_Area) + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + API.util.priorityColor(lead.Priority) + '">' + (lead.Priority || '—') + '</span></td>';
      html += '<td>' + escapeHtml(lead.Lead_Owner_Name || '—') + '</td>';
      html += '<td>' + escapeHtml(lead.Source || '—') + '</td>';
      html += '<td>' + API.util.formatRelativeTime(lead.Last_Contacted_At) + '</td>';
      html += '<td>' + API.util.formatDate(lead.Created_At) + '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;

    // Attach row click handlers
    tbody.querySelectorAll('.cc-lead-row').forEach(function(row) {
      row.addEventListener('click', function() {
        window.location.href = '/crm/lead?id=' + row.dataset.id;
      });
      row.style.cursor = 'pointer';
    });
  }

  // ─── Render Sort Headers ─────────────────────────────────────
  function renderHeaders() {
    var thead = document.querySelector('#cc-lead-table thead tr');
    if (!thead) return;

    var html = '';
    COLUMNS.forEach(function(col) {
      var cls = 'cc-th';
      var arrow = '';
      if (col.sortable) {
        cls += ' cc-th-sortable';
        if (state.sortBy === col.key) {
          cls += ' cc-th-sorted';
          arrow = state.sortDir === 'asc' ? ' <span class="cc-sort-arrow">&#9650;</span>' : ' <span class="cc-sort-arrow">&#9660;</span>';
        }
      }
      html += '<th class="' + cls + '" data-sort="' + col.key + '" style="width:' + (col.width || 'auto') + '">';
      html += col.label + arrow;
      html += '</th>';
    });
    thead.innerHTML = html;

    // Attach sort click handlers
    thead.querySelectorAll('.cc-th-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var field = th.dataset.sort;
        if (state.sortBy === field) {
          if (state.sortDir === 'asc') {
            state.sortDir = 'desc';
          } else {
            // Clear sort, revert to default
            state.sortBy = 'Created_At';
            state.sortDir = 'desc';
            field = null;
          }
        } else {
          state.sortBy = field;
          state.sortDir = 'asc';
        }

        // Persist sort preference
        sessionStorage.setItem('cc_lead_sort_by', state.sortBy);
        sessionStorage.setItem('cc_lead_sort_dir', state.sortDir);

        renderHeaders();
        state.offset = 0;
        fetchLeads();
      });
    });
  }

  // ─── Render Pagination ───────────────────────────────────────
  function renderPagination() {
    var container = $el('cc-pagination');
    if (!container) return;

    var totalPages = Math.ceil(state.totalCount / state.limit);
    var currentPage = Math.floor(state.offset / state.limit) + 1;

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    var html = '<div class="cc-pagination">';
    html += '<button class="cc-page-btn" data-page="prev" ' + (currentPage <= 1 ? 'disabled' : '') + '>&laquo; Prev</button>';
    html += '<span class="cc-page-info">Page ' + currentPage + ' of ' + totalPages + '</span>';
    html += '<button class="cc-page-btn" data-page="next" ' + (currentPage >= totalPages ? 'disabled' : '') + '>Next &raquo;</button>';
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.cc-page-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.dataset.page === 'prev' && currentPage > 1) {
          state.offset -= state.limit;
        } else if (btn.dataset.page === 'next' && currentPage < totalPages) {
          state.offset += state.limit;
        }
        fetchLeads();
      });
    });
  }

  // ─── Bind Filters ────────────────────────────────────────────
  function bindFilters() {
    var debounceTimer;

    // Dropdown filters
    ['cc-filter-stage', 'cc-filter-disposition', 'cc-filter-practice'].forEach(function(id) {
      var el = $el(id);
      if (!el) return;
      var filterKey = id.replace('cc-filter-', '').replace('-', '_');
      // Map shortened names
      if (filterKey === 'practice') filterKey = 'practice_area';
      el.addEventListener('change', function() {
        state.filters[filterKey] = el.value;
        state.offset = 0;
        fetchLeads();
      });
    });

    // Search input (debounced)
    var searchEl = $el('cc-filter-search');
    if (searchEl) {
      searchEl.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          state.filters.search = searchEl.value.trim();
          state.offset = 0;
          fetchLeads();
        }, 400);
      });
    }

    // Date inputs
    ['cc-filter-start-date', 'cc-filter-end-date'].forEach(function(id) {
      var el = $el(id);
      if (!el) return;
      var key = id.includes('start') ? 'start_date' : 'end_date';
      el.addEventListener('change', function() {
        state.filters[key] = el.value;
        state.offset = 0;
        fetchLeads();
      });
    });

    // Date preset buttons
    var presetsContainer = $el('cc-date-presets');
    if (presetsContainer) {
      presetsContainer.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-preset]');
        if (!btn) return;

        var preset = getDatePreset(btn.dataset.preset);
        if (!preset) return;

        state.filters.start_date = preset.start_date;
        state.filters.end_date = preset.end_date;

        // Update date inputs to reflect preset
        var startEl = $el('cc-filter-start-date');
        var endEl = $el('cc-filter-end-date');
        if (startEl) startEl.value = preset.start_date;
        if (endEl) endEl.value = preset.end_date;

        // Highlight active preset
        presetsContainer.querySelectorAll('[data-preset]').forEach(function(b) {
          b.classList.remove('cc-preset-active');
        });
        btn.classList.add('cc-preset-active');

        state.offset = 0;
        fetchLeads();
      });
    }

    // New lead button
    var newBtn = $el('cc-new-lead-btn');
    if (newBtn) {
      newBtn.addEventListener('click', function() {
        window.location.href = '/crm/lead?id=new';
      });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPracticeArea(pa) {
    if (!pa) return '—';
    return pa.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
  }

  // ─── Initialize ──────────────────────────────────────────────
  function init() {
    // Show user info in nav if available
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) {
      userNameEl.textContent = user.name || user.email;
    }

    renderHeaders();
    bindFilters();
    fetchLeads();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
