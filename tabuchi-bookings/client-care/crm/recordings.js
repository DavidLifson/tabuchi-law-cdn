/**
 * Tabuchi Law Client Care CRM - Recordings Queue
 * Handles: /crm/recordings — recording transcription queue view
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Sortable columns (click header to toggle asc/desc/clear)
 * - Filters: status, source, "unmatched only" toggle, search
 * - Auto-refresh every 15s when pending/processing rows exist
 * - Pagination
 * - Click row to navigate to lead detail recordings tab
 *
 * Page element IDs:
 * - #cc-page-root              (page container)
 * - #cc-recording-table-body   (tbody for recording rows)
 * - #cc-recording-count        (total count display)
 * - #cc-filter-status          (status dropdown)
 * - #cc-filter-source          (source dropdown)
 * - #cc-filter-unmatched       (unmatched checkbox)
 * - #cc-filter-search          (search input)
 * - #cc-filter-start-date      (date input)
 * - #cc-filter-end-date        (date input)
 * - #cc-date-presets            (preset buttons container)
 * - #cc-pagination             (pagination container)
 */

(function RecordingsList() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── State ───────────────────────────────────────────────────
  var state = {
    recordings: [],
    totalCount: 0,
    sortBy: sessionStorage.getItem('cc_rec_sort_by') || 'Created_At',
    sortDir: sessionStorage.getItem('cc_rec_sort_dir') || 'desc',
    filters: {
      status: '',
      source: '',
      unmatched_only: false,
      search: '',
      start_date: '',
      end_date: ''
    },
    offset: 0,
    limit: 50,
    loading: false,
    refreshTimer: null
  };

  // ─── Column Definitions ──────────────────────────────────────
  var COLUMNS = [
    { key: 'Meeting_Date',   label: 'Date',      sortable: true,  width: '12%' },
    { key: 'Client_Name',    label: 'Client',     sortable: true,  width: '18%' },
    { key: 'Staff_Name',     label: 'Staff',      sortable: false, width: '12%' },
    { key: 'Source',          label: 'Source',     sortable: true,  width: '8%' },
    { key: 'Duration',        label: 'Duration',   sortable: true,  width: '8%' },
    { key: 'Status',          label: 'Status',     sortable: true,  width: '14%' },
    { key: 'AI_Client_Intent',label: 'Intent',     sortable: true,  width: '10%' },
    { key: 'Will_Status',     label: 'Will',       sortable: true,  width: '10%' }
  ];

  // ─── Status / Intent Badge Colors ─────────────────────────────
  var STATUS_COLORS = {
    pending: 'yellow', downloading: 'yellow', transcribing: 'blue',
    analyzing: 'blue', completed: 'green', failed: 'red'
  };

  var INTENT_COLORS = {
    PROCEED: 'green', UNDECIDED: 'yellow', DECLINED: 'red', NEEDS_FOLLOWUP: 'orange'
  };

  var WILL_COLORS = {
    NOT_APPLICABLE: 'gray', PENDING_REVIEW: 'yellow', GENERATING: 'blue',
    GENERATED: 'green', UPLOADED_TO_CLIO: 'green'
  };

  // ─── Date Presets ────────────────────────────────────────────
  function getDatePreset(preset) {
    var now = new Date();
    var start, end = now.toISOString().split('T')[0];
    switch (preset) {
      case '7d':  start = new Date(now - 7 * 86400000).toISOString().split('T')[0]; break;
      case '30d': start = new Date(now - 30 * 86400000).toISOString().split('T')[0]; break;
      case '90d': start = new Date(now - 90 * 86400000).toISOString().split('T')[0]; break;
      case 'all': start = ''; end = ''; break;
      default: return null;
    }
    return { start_date: start, end_date: end };
  }

  // ─── Fetch Recordings ──────────────────────────────────────────
  async function fetchRecordings() {
    if (state.loading) return;
    state.loading = true;

    var countEl = $el('cc-rec-count');
    var tbody = $el('cc-rec-table-body');

    if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-loading-cell"><div class="cc-spinner"></div> Loading...</td></tr>';

    try {
      var params = {
        sort_by: state.sortBy,
        sort_dir: state.sortDir,
        offset: state.offset,
        limit: state.limit
      };

      Object.keys(state.filters).forEach(function(key) {
        if (state.filters[key]) params[key] = state.filters[key];
      });

      var result = await API.recordings.list(params);

      if (result.success) {
        state.recordings = result.recordings || [];
        state.totalCount = result.total || state.recordings.length;
        renderTable();
        renderPagination();
        scheduleAutoRefresh();
      } else {
        if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-error-cell">Failed to load recordings.</td></tr>';
      }
    } catch (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-error-cell">' + escapeHtml(err.error || 'Error loading recordings.') + '</td></tr>';
    }

    state.loading = false;
    if (countEl) countEl.textContent = state.totalCount + ' recording' + (state.totalCount !== 1 ? 's' : '');
  }

  // ─── Auto Refresh ─────────────────────────────────────────────
  function scheduleAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);

    var hasPending = state.recordings.some(function(r) {
      var s = (r.Status || '').toLowerCase();
      return s === 'pending' || s === 'downloading' || s === 'transcribing' || s === 'analyzing';
    });

    if (hasPending) {
      state.refreshTimer = setInterval(function() {
        API.cache.invalidate('/cc/recordings');
        fetchRecordings();
      }, 15000);
    }
  }

  // ─── Format Duration ──────────────────────────────────────────
  function formatDuration(seconds) {
    if (!seconds) return '—';
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ─── Render Table ─────────────────────────────────────────────
  function renderTable() {
    var tbody = $el('cc-rec-table-body');
    if (!tbody) return;

    if (state.recordings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-empty-cell">No recordings found.</td></tr>';
      return;
    }

    var html = '';
    state.recordings.forEach(function(rec) {
      var status = rec.Status || 'pending';
      var statusColor = STATUS_COLORS[status] || 'gray';
      var intentColor = INTENT_COLORS[rec.AI_Client_Intent] || 'gray';
      var willStatus = rec.Will_Status || 'NOT_APPLICABLE';
      var willColor = WILL_COLORS[willStatus] || 'gray';
      var hasLead = rec.Lead && rec.Lead.length > 0;
      var leadId = hasLead ? rec.Lead[0] : null;
      var clientName = rec.Client_Name || (hasLead ? 'Linked' : 'Unmatched');
      var staffName = rec.Staff_Name || '—';
      var source = (rec.Source || 'teams').charAt(0).toUpperCase() + (rec.Source || 'teams').slice(1);
      var meetingDate = rec.Meeting_Date || rec.Created_At || '';

      html += '<tr class="cc-recording-row" data-id="' + rec.id + '"' + (leadId ? ' data-lead="' + leadId + '"' : '') + '>';
      html += '<td>' + escapeHtml(API.util.formatDate(meetingDate)) + '</td>';
      html += '<td>';
      if (!hasLead) {
        html += '<span class="cc-badge cc-badge-orange">Unmatched</span>';
      } else {
        html += '<div class="cc-lead-name">' + escapeHtml(clientName) + '</div>';
      }
      html += '</td>';
      html += '<td>' + escapeHtml(staffName) + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + (source === 'Teams' ? 'blue' : 'purple') + '">' + escapeHtml(source) + '</span></td>';
      html += '<td>' + formatDuration(rec.Duration_Seconds) + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + statusColor + '">' + escapeHtml(status) + '</span></td>';
      html += '<td>';
      if (rec.AI_Client_Intent) {
        html += '<span class="cc-badge cc-badge-' + intentColor + '">' + escapeHtml(rec.AI_Client_Intent) + '</span>';
      } else {
        html += '—';
      }
      html += '</td>';
      html += '<td><span class="cc-badge cc-badge-' + willColor + '">' + escapeHtml(willStatus.replace(/_/g, ' ')) + '</span></td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;

    // Attach row click handlers
    tbody.querySelectorAll('.cc-recording-row').forEach(function(row) {
      row.addEventListener('click', function() {
        var leadId = row.dataset.lead;
        var recId = row.dataset.id;
        if (leadId) {
          window.location.href = '/crm/lead?id=' + leadId + '&tab=recordings';
        } else {
          // For unmatched recordings, show detail in a simple view
          window.location.href = '/crm/recordings?detail=' + recId;
        }
      });
      row.style.cursor = 'pointer';
    });
  }

  // ─── Render Sort Headers ──────────────────────────────────────
  function renderHeaders() {
    var theadAll = document.querySelectorAll('#cc-rec-table thead tr');
    var thead = theadAll.length ? theadAll[theadAll.length - 1] : null;
    if (!thead) return;

    var html = '';
    COLUMNS.forEach(function(col) {
      var isSorted = state.sortBy === col.key;
      var arrow = '';
      if (isSorted) {
        arrow = state.sortDir === 'asc' ? ' &#9650;' : ' &#9660;';
      }
      var cls = 'cc-th' + (col.sortable ? ' cc-th-sortable' : '') + (isSorted ? ' cc-th-active' : '');
      html += '<th class="' + cls + '" data-key="' + col.key + '" style="width:' + col.width + '">';
      html += escapeHtml(col.label) + (col.sortable ? arrow : '');
      html += '</th>';
    });
    thead.innerHTML = html;

    // Bind sort click handlers
    thead.querySelectorAll('.cc-th-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var key = th.dataset.key;
        if (state.sortBy === key) {
          if (state.sortDir === 'asc') {
            state.sortDir = 'desc';
          } else if (state.sortDir === 'desc') {
            state.sortBy = 'Created_At';
            state.sortDir = 'desc';
          }
        } else {
          state.sortBy = key;
          state.sortDir = 'asc';
        }
        sessionStorage.setItem('cc_rec_sort_by', state.sortBy);
        sessionStorage.setItem('cc_rec_sort_dir', state.sortDir);
        renderHeaders();
        state.offset = 0;
        fetchRecordings();
      });
      th.style.cursor = 'pointer';
    });
  }

  // ─── Render Pagination ────────────────────────────────────────
  function renderPagination() {
    var container = $el('cc-pagination');
    if (!container) return;

    var totalPages = Math.ceil(state.totalCount / state.limit) || 1;
    var currentPage = Math.floor(state.offset / state.limit) + 1;

    if (totalPages <= 1) { container.innerHTML = ''; return; }

    var html = '<div class="cc-pagination">';
    html += '<button class="cc-page-btn" data-page="prev"' + (currentPage <= 1 ? ' disabled' : '') + '>&laquo; Prev</button>';
    html += '<span class="cc-page-info">Page ' + currentPage + ' of ' + totalPages + '</span>';
    html += '<button class="cc-page-btn" data-page="next"' + (currentPage >= totalPages ? ' disabled' : '') + '>Next &raquo;</button>';
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.cc-page-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.disabled) return;
        if (btn.dataset.page === 'prev') {
          state.offset = Math.max(0, state.offset - state.limit);
        } else {
          state.offset += state.limit;
        }
        fetchRecordings();
      });
    });
  }

  // ─── Bind Filters ─────────────────────────────────────────────
  function bindFilters() {
    var debounceTimer = null;
    function debounce(fn, ms) {
      return function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fn, ms);
      };
    }

    var statusEl = $el('cc-filter-status');
    if (statusEl) {
      statusEl.addEventListener('change', function() {
        state.filters.status = statusEl.value;
        state.offset = 0;
        fetchRecordings();
      });
    }

    var sourceEl = $el('cc-filter-source');
    if (sourceEl) {
      sourceEl.addEventListener('change', function() {
        state.filters.source = sourceEl.value;
        state.offset = 0;
        fetchRecordings();
      });
    }

    var unmatchedEl = $el('cc-filter-unmatched');
    if (unmatchedEl) {
      unmatchedEl.addEventListener('change', function() {
        state.filters.unmatched_only = unmatchedEl.checked;
        state.offset = 0;
        fetchRecordings();
      });
    }

    var searchEl = $el('cc-filter-search');
    if (searchEl) {
      searchEl.addEventListener('input', debounce(function() {
        state.filters.search = searchEl.value.trim();
        state.offset = 0;
        fetchRecordings();
      }, 400));
    }

    var startDateEl = $el('cc-filter-start-date');
    var endDateEl = $el('cc-filter-end-date');
    if (startDateEl) {
      startDateEl.addEventListener('change', function() {
        state.filters.start_date = startDateEl.value;
        state.offset = 0;
        fetchRecordings();
      });
    }
    if (endDateEl) {
      endDateEl.addEventListener('change', function() {
        state.filters.end_date = endDateEl.value;
        state.offset = 0;
        fetchRecordings();
      });
    }

    // Date preset buttons
    var presetsEl = $el('cc-date-presets');
    if (presetsEl) {
      presetsEl.querySelectorAll('[data-preset]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var preset = getDatePreset(btn.dataset.preset);
          if (!preset) return;
          state.filters.start_date = preset.start_date;
          state.filters.end_date = preset.end_date;
          if (startDateEl) startDateEl.value = preset.start_date;
          if (endDateEl) endDateEl.value = preset.end_date;
          state.offset = 0;
          fetchRecordings();
        });
      });
    }
  }

  // ─── Detail Drawer (for unmatched recordings) ────────────────
  function checkDetailParam() {
    var params = API.util.getUrlParams();
    if (params.detail) {
      showRecordingDetail(params.detail);
    }
  }

  async function showRecordingDetail(recId) {
    try {
      var result = await API.recordings.get(recId);
      if (!result.success || !result.recording) return;

      var rec = result.recording;
      var root = $el('cc-page-root');
      if (!root) return;

      // Build a simple detail panel above the table
      var existing = document.getElementById('cc-recording-detail');
      if (existing) existing.remove();

      var panel = document.createElement('div');
      panel.id = 'cc-recording-detail';
      panel.className = 'cc-detail-panel';
      panel.style.cssText = 'background:#1F2937;border:1px solid #374151;border-radius:8px;padding:20px;margin-bottom:20px;';

      var summary = rec.AI_Summary || 'No summary available';
      var intent = rec.AI_Client_Intent || '—';
      var status = rec.Status || 'pending';

      var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
      h += '<h3 style="margin:0;color:#F9FAFB;">' + escapeHtml(rec.Client_Name || 'Unmatched Recording') + '</h3>';
      h += '<button id="cc-detail-close" style="background:none;border:none;color:#9CA3AF;font-size:18px;cursor:pointer;">&times;</button>';
      h += '</div>';
      h += '<p style="color:#D1D5DB;margin:0 0 8px;">' + escapeHtml(summary) + '</p>';
      h += '<div style="display:flex;gap:12px;margin-top:12px;">';
      h += '<span class="cc-badge cc-badge-' + (STATUS_COLORS[status] || 'gray') + '">' + escapeHtml(status) + '</span>';
      h += '<span class="cc-badge cc-badge-' + (INTENT_COLORS[intent] || 'gray') + '">' + escapeHtml(intent) + '</span>';
      h += '</div>';

      // Link lead button (for unmatched)
      if (!rec.Lead || rec.Lead.length === 0) {
        h += '<div style="margin-top:16px;"><button id="cc-link-lead-btn" class="cc-btn cc-btn-primary" style="font-size:0.85rem;padding:6px 14px;">Link to Lead</button></div>';
      }

      panel.innerHTML = h;
      root.insertBefore(panel, root.firstChild);

      document.getElementById('cc-detail-close').addEventListener('click', function() {
        panel.remove();
        window.history.replaceState(null, '', '/crm/recordings');
      });

      var linkBtn = document.getElementById('cc-link-lead-btn');
      if (linkBtn) {
        linkBtn.addEventListener('click', function() {
          var leadId = prompt('Enter the Lead record ID (recXXX):');
          if (leadId && leadId.startsWith('rec')) {
            API.recordings.linkLead(recId, leadId).then(function(r) {
              if (r.success) {
                panel.remove();
                API.cache.invalidate('/cc/recordings');
                fetchRecordings();
              } else {
                alert('Failed to link lead: ' + (r.error || 'Unknown error'));
              }
            });
          }
        });
      }
    } catch (err) {
      // Silently fail
    }
  }

  // ─── Initialize ───────────────────────────────────────────────
  renderHeaders();
  bindFilters();
  fetchRecordings();
  checkDetailParam();
})();
