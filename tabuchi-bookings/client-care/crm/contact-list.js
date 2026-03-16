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

  function ccToast(msg, type) {
    type = type || 'info';
    if (!document.getElementById('cc-toast-style')) {
      var s = document.createElement('style');
      s.id = 'cc-toast-style';
      s.textContent = '@keyframes ccToastIn{from{opacity:0;transform:translateX(1rem)}to{opacity:1;transform:translateX(0)}}';
      document.head.appendChild(s);
    }
    var colors = { success: '#059669', error: '#DC2626', info: '#2563EB' };
    var dur = type === 'error' ? 6000 : 4000;
    var container = document.getElementById('cc-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'cc-toast-container';
      container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:10000;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;';
      document.body.appendChild(container);
    }
    var el = document.createElement('div');
    el.style.cssText = 'pointer-events:auto;padding:0.75rem 1rem;border-radius:8px;color:white;font-size:0.9rem;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,0.15);display:flex;align-items:flex-start;gap:0.5rem;animation:ccToastIn 0.3s ease;background:' + (colors[type] || colors.info) + ';';
    el.innerHTML = '<span style="flex:1;">' + msg.replace(/</g, '&lt;') + '</span><button style="background:none;border:none;color:white;font-size:1.1rem;cursor:pointer;padding:0;line-height:1;" onclick="this.parentElement.remove()">&times;</button>';
    container.appendChild(el);
    setTimeout(function() { if (el.parentElement) el.remove(); }, dur);
  }

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
    bulkMode: false,
    tagConfig: []  // populated from admin config
  };

  // ─── Column Definitions ──────────────────────────────────────
  var COLUMNS = [
    { key: 'checkbox',          label: '☐',             sortable: false, width: '3%' },
    { key: 'Client_Name',      label: 'Contact',        sortable: true,  width: '18%' },
    { key: 'Tags',             label: 'Tags',            sortable: true,  width: '16%' },
    { key: 'Contact_Status',   label: 'Status',          sortable: true,  width: '10%' },
    { key: 'Practice_Area',    label: 'Practice Area',   sortable: true,  width: '12%' },
    { key: 'Source',           label: 'Lead Source',      sortable: true,  width: '8%' },
    { key: 'Consent_Status',   label: 'Subscribed',      sortable: true,  width: '8%' },
    { key: 'Last_Contacted_At', label: 'Last Contact',   sortable: true,  width: '9%' },
    { key: 'Created_At',      label: 'Date Created',     sortable: true,  width: '9%' },
    { key: 'Updated_At',      label: 'Last Updated',     sortable: true,  width: '9%' }
  ];

  var PRACTICE_LABELS = {
    ESTATE_PLANNING: 'Estate Planning',
    PROBATE: 'Probate',
    REAL_ESTATE: 'Real Estate',
    CORPORATE: 'Corporate',
    FAMILY_LAW: 'Family Law',
    COMMISSION_NOTARY: 'Commission Notary',
    OTHER: 'Other'
  };

  var SOURCE_LABELS = {
    WEBFORM: 'Webform',
    REFERRAL: 'Referral',
    COLD_CALL: 'Cold Call',
    WEBSITE: 'Website',
    SOCIAL_MEDIA: 'Social Media',
    ADVERTISING: 'Advertising',
    EVENT: 'Event',
    OTHER: 'Other'
  };

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
    if (!tags || !tags.length) return '';
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
    if (status === 'SUBSCRIBED' || status === 'subscribed') return '<span class="cc-consent-yes" title="Subscribed" style="color:#16a34a;font-weight:600;">&#10003; Yes</span>';
    if (status === 'UNSUBSCRIBED' || status === 'unsubscribed') return '<span class="cc-consent-no" title="Unsubscribed" style="color:#dc2626;font-weight:600;">&#10007; No</span>';
    return '<span class="cc-consent-unknown" title="Unknown" style="color:#9ca3af;">—</span>';
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
      var cDisplayName = contact.Client_Name || contact.Client_Email || contact.Client_Phone || 'Unnamed';
      html += '<div class="cc-contact-name">' + escapeHtml(cDisplayName) + '</div>';
      html += contact.Client_Name && contact.Client_Email ? '<div class="cc-contact-email">' + escapeHtml(contact.Client_Email) + '</div>' : '';
      html += '</td>';

      // Tags
      html += '<td class="cc-cell-tags">' + renderTagPills(contact.Tags) + '</td>';

      // Contact Status
      var statusColor = API.util.contactStatusColor(contact.Contact_Status);
      var statusLabel = API.util.contactStatusLabel(contact.Contact_Status);
      if (contact.Contact_Status) {
        html += '<td><span class="cc-badge cc-badge-' + statusColor + '">' + escapeHtml(statusLabel) + '</span></td>';
      } else {
        html += '<td></td>';
      }

      // Practice Area
      html += '<td>' + escapeHtml(formatPracticeArea(contact.Practice_Area)) + '</td>';

      // Source
      html += '<td>' + (contact.Source ? escapeHtml(contact.Source) : '') + '</td>';

      // Consent
      html += '<td>' + consentIcon(contact.Consent_Status) + '</td>';

      // Last Contact
      html += '<td>' + (contact.Last_Contacted_At ? escapeHtml(API.util.formatRelativeTime(contact.Last_Contacted_At)) : '') + '</td>';

      // Date Created
      html += '<td>' + escapeHtml(API.util.formatDate(contact.Created_At)) + '</td>';

      // Last Updated
      html += '<td>' + (contact.Updated_At ? escapeHtml(API.util.formatRelativeTime(contact.Updated_At)) : '') + '</td>';

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
      showBulkTagModal('add');
    });

    document.getElementById('cc-bulk-remove-tags').addEventListener('click', function() {
      showBulkTagModal('remove');
    });

    document.getElementById('cc-bulk-status').addEventListener('click', function() {
      showBulkStatusModal();
    });

    document.getElementById('cc-bulk-clear').addEventListener('click', function() {
      state.selectedIds = [];
      renderTable();
      updateBulkBar();
    });
  }

  // ─── Bulk Tag Modal ──────────────────────────────────────
  function showBulkTagModal(action) {
    var isAdd = action === 'add';
    var title = isAdd ? 'Add Tags' : 'Remove Tags';

    // Build grouped tag options from config
    var categoryOrder = ['Client Type', 'Marketing', 'Case Status', 'Practice Area', 'Internal', 'Other'];
    var categoryMap = {};
    var addedKeys = {};

    (state.tagConfig || []).forEach(function(t) {
      var label = t.Label || t.label || '';
      if (!label || addedKeys[label]) return;
      addedKeys[label] = true;
      var meta = {};
      try { meta = JSON.parse(t.Meta || '{}'); } catch(e) {}
      var cat = meta.category || 'Other';
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(label);
    });

    // Build modal HTML
    var html = '<div class="cc-modal-overlay" id="cc-bulk-tag-modal">' +
      '<div class="cc-modal" style="max-width:480px;">' +
      '<div class="cc-modal-header"><h3>' + title + '</h3>' +
      '<button class="cc-modal-close" id="cc-bulk-tag-close">&times;</button></div>' +
      '<div class="cc-modal-body" style="max-height:400px;overflow-y:auto;">';

    var hasTags = false;
    categoryOrder.forEach(function(cat) {
      if (!categoryMap[cat] || !categoryMap[cat].length) return;
      hasTags = true;
      html += '<div style="margin-bottom:0.75rem;"><div style="font-weight:600;font-size:0.8rem;color:#6B7280;text-transform:uppercase;margin-bottom:0.375rem;">' + escapeHtml(cat) + '</div>';
      categoryMap[cat].sort().forEach(function(tag) {
        html += '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;cursor:pointer;">' +
          '<input type="checkbox" class="cc-bulk-tag-cb" value="' + escapeHtml(tag) + '"> ' +
          escapeHtml(tag) + '</label>';
      });
      html += '</div>';
    });
    // Add remaining categories not in predefined order
    Object.keys(categoryMap).forEach(function(cat) {
      if (categoryOrder.indexOf(cat) >= 0) return;
      if (!categoryMap[cat] || !categoryMap[cat].length) return;
      hasTags = true;
      html += '<div style="margin-bottom:0.75rem;"><div style="font-weight:600;font-size:0.8rem;color:#6B7280;text-transform:uppercase;margin-bottom:0.375rem;">' + escapeHtml(cat) + '</div>';
      categoryMap[cat].sort().forEach(function(tag) {
        html += '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;cursor:pointer;">' +
          '<input type="checkbox" class="cc-bulk-tag-cb" value="' + escapeHtml(tag) + '"> ' +
          escapeHtml(tag) + '</label>';
      });
      html += '</div>';
    });

    if (!hasTags) {
      html += '<p style="color:#6B7280;text-align:center;">No tags configured. Add tags under Admin &rarr; Options Lists &rarr; Tags.</p>';
    }

    html += '</div><div class="cc-modal-footer">' +
      '<button class="cc-btn cc-btn-secondary" id="cc-bulk-tag-cancel">Cancel</button>' +
      '<button class="cc-btn cc-btn-primary" id="cc-bulk-tag-apply">' + title + '</button>' +
      '</div></div></div>';

    // Remove any existing modal
    var existing = document.getElementById('cc-bulk-tag-modal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', html);

    var modal = document.getElementById('cc-bulk-tag-modal');
    function closeModal() { modal.remove(); }
    document.getElementById('cc-bulk-tag-close').addEventListener('click', closeModal);
    document.getElementById('cc-bulk-tag-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

    document.getElementById('cc-bulk-tag-apply').addEventListener('click', function() {
      var selected = [];
      modal.querySelectorAll('.cc-bulk-tag-cb:checked').forEach(function(cb) { selected.push(cb.value); });
      if (!selected.length) { ccToast('Please select at least one tag.', 'info'); return; }
      closeModal();
      handleBulkTags(action, selected);
    });
  }

  // ─── Bulk Status Modal ──────────────────────────────────
  function showBulkStatusModal() {
    var statuses = [
      { value: 'PROSPECT', label: 'Prospect' },
      { value: 'ACTIVE_CLIENT', label: 'Active Client' },
      { value: 'FORMER_CLIENT', label: 'Former Client' },
      { value: 'OTHER', label: 'Other' }
    ];

    var html = '<div class="cc-modal-overlay" id="cc-bulk-status-modal">' +
      '<div class="cc-modal" style="max-width:360px;">' +
      '<div class="cc-modal-header"><h3>Change Status</h3>' +
      '<button class="cc-modal-close" id="cc-bulk-status-close">&times;</button></div>' +
      '<div class="cc-modal-body">';

    statuses.forEach(function(s) {
      html += '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;cursor:pointer;">' +
        '<input type="radio" name="cc-bulk-status-val" value="' + s.value + '"> ' +
        s.label + '</label>';
    });

    html += '</div><div class="cc-modal-footer">' +
      '<button class="cc-btn cc-btn-secondary" id="cc-bulk-status-cancel">Cancel</button>' +
      '<button class="cc-btn cc-btn-primary" id="cc-bulk-status-apply">Apply</button>' +
      '</div></div></div>';

    var existing = document.getElementById('cc-bulk-status-modal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', html);

    var modal = document.getElementById('cc-bulk-status-modal');
    function closeModal() { modal.remove(); }
    document.getElementById('cc-bulk-status-close').addEventListener('click', closeModal);
    document.getElementById('cc-bulk-status-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

    document.getElementById('cc-bulk-status-apply').addEventListener('click', function() {
      var checked = modal.querySelector('input[name="cc-bulk-status-val"]:checked');
      if (!checked) { ccToast('Please select a status.', 'info'); return; }
      closeModal();
      handleBulkStatus(checked.value);
    });
  }

  async function handleBulkTags(action, tags) {
    try {
      var result = await API.contacts.bulkUpdateTags(state.selectedIds, action, tags);
      if (result.success) {
        state.selectedIds = [];
        fetchContacts();
      } else {
        ccToast(result.error || 'Failed to update tags', 'error');
      }
    } catch (err) {
      ccToast(err.error || 'Error updating tags', 'error');
    }
  }

  async function handleBulkStatus(status) {
    try {
      var result = await API.contacts.bulkUpdateStatus(state.selectedIds, status);
      if (result.success) {
        state.selectedIds = [];
        fetchContacts();
      } else {
        ccToast(result.error || 'Failed to update status', 'error');
      }
    } catch (err) {
      ccToast(err.error || 'Error updating status', 'error');
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
    if (!pa) return '';
    var items = Array.isArray(pa) ? pa : [pa];
    return items.map(function(item) {
      return item.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
    }).join(', ');
  }

  // ─── Populate Dropdowns ──────────────────────────────────
  function populateDropdowns() {
    var paEl = $el('cc-filter-practice');
    if (paEl && paEl.options.length <= 1) {
      Object.keys(PRACTICE_LABELS).forEach(function(key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = PRACTICE_LABELS[key];
        paEl.appendChild(opt);
      });
    }

    var srcEl = $el('cc-filter-source');
    if (srcEl && srcEl.options.length <= 1) {
      Object.keys(SOURCE_LABELS).forEach(function(key) {
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = SOURCE_LABELS[key];
        srcEl.appendChild(opt);
      });
    }
  }

  // ─── Fetch Tag Config ────────────────────────────────────
  async function fetchTagConfig() {
    try {
      var res = await API.admin.config.list('tag');
      state.tagConfig = (res.configs || res.items || res || []).filter(function(c) {
        return c.Is_Active !== false && c.is_active !== false;
      });
    } catch(e) {
      state.tagConfig = [];
    }
  }

  // ─── Initialize ───────────────────────────────────────────
  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) {
      userNameEl.textContent = user.name || user.email;
    }

    renderHeaders();
    populateDropdowns();
    bindFilters();
    updateBulkBar();
    fetchContacts();
    fetchTagConfig(); // load tag options for bulk modal
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
