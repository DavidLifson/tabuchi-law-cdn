/**
 * Tabuchi Law Client Care CRM - Contact List
 * Handles: /crm/contacts (contact-centric list view)
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Sortable columns (click header to toggle asc/desc/clear)
 * - Filters: contact status, practice area, tags, consent, source, search
 * - Date range filter with presets
 * - Pagination
 * - Tag pills in each row
 * - Bulk operations: add/remove tags, change status
 * - Click row to navigate to contact detail
 *
 * Page element IDs:
 * - #cc-page-root              (page container)
 * - #cc-contact-table-body     (tbody for contact rows)
 * - #cc-contact-count          (total count display)
 * - #cc-filter-search          (search input)
 * - #cc-filter-contact-status  (contact status dropdown)
 * - #cc-filter-practice        (practice area dropdown)
 * - #cc-filter-tags            (tags input, comma-separated)
 * - #cc-filter-consent         (consent status dropdown)
 * - #cc-filter-source          (source dropdown)
 * - #cc-filter-start-date      (date input)
 * - #cc-filter-end-date        (date input)
 * - #cc-date-presets            (preset buttons container)
 * - #cc-pagination             (pagination container)
 * - #cc-bulk-bar               (bulk action bar)
 * - #cc-user-name              (user name display)
 */

(function ContactList() {
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

  // ─── State ───────────────────────────────────────────────────
  var state = {
    contacts: [],
    totalCount: 0,
    sortBy: sessionStorage.getItem('cc_contact_sort_by') || 'Created_At',
    sortDir: sessionStorage.getItem('cc_contact_sort_dir') || 'desc',
    filters: {
      search: '',
      contact_status: '',
      practice_area: '',
      tags: '',
      consent: '',
      source: '',
      start_date: '',
      end_date: ''
    },
    offset: 0,
    limit: 50,
    loading: false,
    selectedIds: [],
    bulkMode: false
  };

  // ─── Column Definitions ──────────────────────────────────────
  var COLUMNS = [
    { key: 'checkbox',          label: '☐',             sortable: false, width: '3%' },
    { key: 'Client_Name',      label: 'Contact',        sortable: true,  width: '18%' },
    { key: 'Tags',             label: 'Tags',            sortable: false, width: '16%' },
    { key: 'Contact_Status',   label: 'Status',          sortable: true,  width: '10%' },
    { key: 'Practice_Area',    label: 'Practice Area',   sortable: true,  width: '12%' },
    { key: 'Source',           label: 'Source',           sortable: true,  width: '8%' },
    { key: 'Consent_Status',   label: 'Consent',         sortable: true,  width: '8%' },
    { key: 'Last_Contacted_At', label: 'Last Contact',   sortable: true,  width: '10%' },
    { key: 'Created_At',      label: 'Created',          sortable: true,  width: '10%' }
  ];

  // ─── Date Presets ────────────────────────────────────────────
  function getDatePreset(preset) {
    var now = new Date();
    var start, end = now.toISOString().split('T')[0];

    switch (preset) {
      case '7d':
        start = new Date(now - 7 * 86400000).toISOString().split('T')[0]; break;
      case '30d':
        start = new Date(now - 30 * 86400000).toISOString().split('T')[0]; break;
      case '90d':
        start = new Date(now - 90 * 86400000).toISOString().split('T')[0]; break;
      case 'mtd':
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]; break;
      case 'qtd':
        var qMonth = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), qMonth, 1).toISOString().split('T')[0]; break;
      case 'ytd':
        start = now.getFullYear() + '-01-01'; break;
      case 'all':
        start = ''; end = ''; break;
      default:
        return null;
    }
    return { start_date: start, end_date: end };
  }

  // ─── Fetch Contacts ────────────────────────────────────────
  async function fetchContacts() {
    if (state.loading) return;
    state.loading = true;

    var countEl = $el('cc-contact-count');
    var tbody = $el('cc-contact-table-body');

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
        state.contacts = result.leads || [];
        state.totalCount = result.total || state.contacts.length;
        renderTable();
        renderPagination();
      } else {
        if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-error-cell">Failed to load contacts.</td></tr>';
      }
    } catch (err) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-error-cell">' + escapeHtml(err.error || 'Error loading contacts.') + '</td></tr>';
    }

    state.loading = false;
    if (countEl) countEl.textContent = state.totalCount + ' contact' + (state.totalCount !== 1 ? 's' : '');
  }

  // ─── Tag Pills Rendering ──────────────────────────────────
  function renderTagPills(tags) {
    if (!tags || !tags.length) return '<span class="cc-text-muted">—</span>';
    var maxShow = 3;
    var html = '';
    var shown = tags.slice(0, maxShow);
    shown.forEach(function(tag) {
      html += '<span class="cc-tag-pill">' + escapeHtml(tag) + '</span>';
    });
    if (tags.length > maxShow) {
      html += '<span class="cc-tag-more">+' + (tags.length - maxShow) + '</span>';
    }
    return html;
  }

  // ─── Consent Icon ─────────────────────────────────────────
  function consentIcon(status) {
    if (status === 'SUBSCRIBED' || status === 'subscribed') return '<span class="cc-consent-yes" title="Subscribed">✓</span>';
    if (status === 'UNSUBSCRIBED' || status === 'unsubscribed') return '<span class="cc-consent-no" title="Unsubscribed">✗</span>';
    return '<span class="cc-consent-unknown" title="Unknown">?</span>';
  }

  // ─── Render Table ──────────────────────────────────────────
  function renderTable() {
    var tbody = $el('cc-contact-table-body');
    if (!tbody) return;

    if (state.contacts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" class="cc-empty-cell">No contacts found matching your filters.</td></tr>';
      return;
    }

    var html = '';
    state.contacts.forEach(function(contact) {
      var isSelected = state.selectedIds.indexOf(contact.id) !== -1;
      html += '<tr class="cc-contact-row' + (isSelected ? ' cc-row-selected' : '') + '" data-id="' + contact.id + '">';

      // Checkbox
      html += '<td class="cc-cell-checkbox"><input type="checkbox" class="cc-row-check" data-id="' + contact.id + '"' + (isSelected ? ' checked' : '') + '></td>';

      // Contact name + email
      html += '<td class="cc-cell-name">';
      html += '<div class="cc-contact-name">' + escapeHtml(contact.Client_Name || '—') + '</div>';
      html += '<div class="cc-contact-email">' + escapeHtml(contact.Client_Email || '') + '</div>';
      html += '</td>';

      // Tags
      html += '<td class="cc-cell-tags">' + renderTagPills(contact.Tags) + '</td>';

      // Contact Status
      var statusColor = API.util.contactStatusColor(contact.Contact_Status);
      var statusLabel = API.util.contactStatusLabel(contact.Contact_Status);
      if (contact.Contact_Status) {
        html += '<td><span class="cc-badge cc-badge-' + statusColor + '">' + escapeHtml(statusLabel) + '</span></td>';
      } else {
        html += '<td><span class="cc-text-muted">—</span></td>';
      }

      // Practice Area
      html += '<td>' + escapeHtml(formatPracticeArea(contact.Practice_Area)) + '</td>';

      // Source
      html += '<td>' + escapeHtml(contact.Source || '—') + '</td>';

      // Consent
      html += '<td>' + consentIcon(contact.Consent_Status) + '</td>';

      // Last Contact
      html += '<td>' + escapeHtml(API.util.formatRelativeTime(contact.Last_Contacted_At)) + '</td>';

      // Created
      html += '<td>' + escapeHtml(API.util.formatDate(contact.Created_At)) + '</td>';

      html += '</tr>';
    });
    tbody.innerHTML = html;

    // Attach row click handlers (not on checkbox cell)
    tbody.querySelectorAll('.cc-contact-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        // Don't navigate if clicking checkbox or its cell
        if (e.target.closest('.cc-cell-checkbox') || e.target.classList.contains('cc-row-check')) return;
        window.location.href = '/crm/contact?id=' + row.dataset.id;
      });
      row.style.cursor = 'pointer';
    });

    // Attach checkbox handlers
    tbody.querySelectorAll('.cc-row-check').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var id = cb.dataset.id;
        if (cb.checked) {
          if (state.selectedIds.indexOf(id) === -1) state.selectedIds.push(id);
        } else {
          state.selectedIds = state.selectedIds.filter(function(sid) { return sid !== id; });
        }
        updateBulkBar();
        // Toggle row highlight
        var row = cb.closest('.cc-contact-row');
        if (row) row.classList.toggle('cc-row-selected', cb.checked);
      });
    });

    // Make checkbox cell clicks toggle the checkbox
    tbody.querySelectorAll('.cc-cell-checkbox').forEach(function(cell) {
      cell.addEventListener('click', function(e) {
        if (e.target.tagName === 'INPUT') return; // Already handled by change event
        var cb = cell.querySelector('.cc-row-check');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        }
      });
    });
  }

  // ─── Render Sort Headers ──────────────────────────────────
  function renderHeaders() {
    var theadAll = document.querySelectorAll('#cc-contact-table thead tr');
    var thead = theadAll.length ? theadAll[theadAll.length - 1] : null;
    if (!thead) return;

    var html = '';
    COLUMNS.forEach(function(col) {
      if (col.key === 'checkbox') {
        html += '<th class="cc-th" style="width:' + col.width + '"><input type="checkbox" id="cc-select-all"></th>';
        return;
      }
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

    // Select all checkbox
    var selectAll = thead.querySelector('#cc-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', function() {
        state.selectedIds = selectAll.checked ? state.contacts.map(function(c) { return c.id; }) : [];
        renderTable();
        updateBulkBar();
      });
    }

    // Attach sort click handlers
    thead.querySelectorAll('.cc-th-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var field = th.dataset.sort;
        if (state.sortBy === field) {
          if (state.sortDir === 'asc') {
            state.sortDir = 'desc';
          } else {
            state.sortBy = 'Created_At';
            state.sortDir = 'desc';
            field = null;
          }
        } else {
          state.sortBy = field;
          state.sortDir = 'asc';
        }

        sessionStorage.setItem('cc_contact_sort_by', state.sortBy);
        sessionStorage.setItem('cc_contact_sort_dir', state.sortDir);

        renderHeaders();
        state.offset = 0;
        fetchContacts();
      });
    });
  }

  // ─── Render Pagination ────────────────────────────────────
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
        fetchContacts();
      });
    });
  }

  // ─── Bulk Action Bar ──────────────────────────────────────
  function updateBulkBar() {
    var bar = $el('cc-bulk-bar');
    if (!bar) return;

    if (state.selectedIds.length === 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    bar.innerHTML =
      '<span class="cc-bulk-count">' + state.selectedIds.length + ' selected</span>' +
      '<button class="cc-bulk-btn" id="cc-bulk-add-tags">+ Add Tags</button>' +
      '<button class="cc-bulk-btn" id="cc-bulk-remove-tags">- Remove Tags</button>' +
      '<button class="cc-bulk-btn" id="cc-bulk-status">Change Status</button>' +
      '<button class="cc-bulk-btn cc-bulk-clear" id="cc-bulk-clear">Clear</button>';

    document.getElementById('cc-bulk-add-tags').addEventListener('click', function() {
      var input = prompt('Enter tags to add (comma-separated):');
      if (!input) return;
      var tags = input.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      if (!tags.length) return;
      handleBulkTags('add', tags);
    });

    document.getElementById('cc-bulk-remove-tags').addEventListener('click', function() {
      var input = prompt('Enter tags to remove (comma-separated):');
      if (!input) return;
      var tags = input.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      if (!tags.length) return;
      handleBulkTags('remove', tags);
    });

    document.getElementById('cc-bulk-status').addEventListener('click', function() {
      var status = prompt('Enter new status (PROSPECT, ACTIVE_CLIENT, FORMER_CLIENT, OTHER):');
      if (!status) return;
      status = status.toUpperCase().trim();
      if (!['PROSPECT', 'ACTIVE_CLIENT', 'FORMER_CLIENT', 'OTHER'].includes(status)) {
        alert('Invalid status. Use: PROSPECT, ACTIVE_CLIENT, FORMER_CLIENT, or OTHER');
        return;
      }
      handleBulkStatus(status);
    });

    document.getElementById('cc-bulk-clear').addEventListener('click', function() {
      state.selectedIds = [];
      renderTable();
      updateBulkBar();
    });
  }

  async function handleBulkTags(action, tags) {
    try {
      var result = await API.contacts.bulkUpdateTags(state.selectedIds, action, tags);
      if (result.success) {
        state.selectedIds = [];
        fetchContacts();
      } else {
        alert(result.error || 'Failed to update tags');
      }
    } catch (err) {
      alert(err.error || 'Error updating tags');
    }
  }

  async function handleBulkStatus(status) {
    try {
      var result = await API.contacts.bulkUpdateStatus(state.selectedIds, status);
      if (result.success) {
        state.selectedIds = [];
        fetchContacts();
      } else {
        alert(result.error || 'Failed to update status');
      }
    } catch (err) {
      alert(err.error || 'Error updating status');
    }
  }

  // ─── Bind Filters ─────────────────────────────────────────
  function bindFilters() {
    var debounceTimer;

    // Dropdown filters
    ['cc-filter-contact-status', 'cc-filter-practice', 'cc-filter-consent', 'cc-filter-source'].forEach(function(id) {
      var el = $el(id);
      if (!el) return;
      var filterKey = id.replace('cc-filter-', '').replace(/-/g, '_');
      if (filterKey === 'practice') filterKey = 'practice_area';
      if (filterKey === 'contact_status') filterKey = 'contact_status';
      if (state.filters[filterKey]) el.value = state.filters[filterKey];
      el.addEventListener('change', function() {
        state.filters[filterKey] = el.value;
        state.offset = 0;
        fetchContacts();
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
          fetchContacts();
        }, 400);
      });
    }

    // Tags filter (debounced, comma-separated)
    var tagsEl = $el('cc-filter-tags');
    if (tagsEl) {
      tagsEl.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          state.filters.tags = tagsEl.value.trim();
          state.offset = 0;
          fetchContacts();
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
        fetchContacts();
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

        var startEl = $el('cc-filter-start-date');
        var endEl = $el('cc-filter-end-date');
        if (startEl) startEl.value = preset.start_date;
        if (endEl) endEl.value = preset.end_date;

        presetsContainer.querySelectorAll('[data-preset]').forEach(function(b) {
          b.classList.remove('cc-preset-active');
        });
        btn.classList.add('cc-preset-active');

        state.offset = 0;
        fetchContacts();
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPracticeArea(pa) {
    if (!pa) return '—';
    return pa.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
  }

  // ─── Initialize ───────────────────────────────────────────
  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) {
      userNameEl.textContent = user.name || user.email;
    }

    renderHeaders();
    bindFilters();
    updateBulkBar();
    fetchContacts();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
