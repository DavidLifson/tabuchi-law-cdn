/**
 * Tabuchi Law Client Care CRM - Contact Detail (360° View)
 * Handles: /crm/contact?id=xxx
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - 3-tab layout: Overview, History, Conversion
 * - Contact header with status badge and tag pills
 * - Info grid with all contact fields
 * - Inline tag management (add/remove)
 * - Editable notes
 * - Edit mode for Company, Address, Contact Status, Consent
 * - Unified activity + campaign send timeline
 * - Log activity form (call, email, meeting, note)
 * - Add task form with complete/overdue tracking
 * - Conversion status hero card and key dates
 *
 * Page element IDs:
 * - #cc-contact-detail     (main container)
 * - #cc-contact-header     (name, status, tags)
 * - #cc-contact-tabs       (tab navigation)
 * - #cc-contact-tab-content (tab content area)
 * - #cc-back-btn           (back to contacts list)
 * - #cc-user-name          (user name display)
 */

(function ContactDetail() {
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

  // Lead Sources — loaded from config API
  var LEAD_SOURCE_OPTIONS = [''];

  async function loadLeadSources() {
    try {
      var result = await API.admin.config.list('lead_source');
      var items = (result.data || []).filter(function(i) { return i.Is_Active !== false; }).sort(function(a, b) { return (a.Sort_Order || 0) - (b.Sort_Order || 0); });
      LEAD_SOURCE_OPTIONS = [''];
      items.forEach(function(i) { LEAD_SOURCE_OPTIONS.push(i.Label || i.Value); });
      LEAD_SOURCE_OPTIONS.push('Other');
    } catch (e) {
      LEAD_SOURCE_OPTIONS = ['', 'Other'];
    }
  }

  // Pick visible element, avoiding hidden .w-embed duplicate
  var $el = function(id) {
    var all = document.querySelectorAll('#' + id);
    if (!all.length) return null;
    for (var i = 0; i < all.length; i++) {
      if (!all[i].closest('.w-embed')) return all[i];
    }
    return all[all.length - 1];
  };

  // Extract contact ID from URL: /crm/contact?id=xxx
  var params = API.util.getUrlParams();
  var contactId = params.id || '';

  if (!contactId) {
    window.location.href = '/crm/contacts';
    return;
  }

  // ─── State ───────────────────────────────────────────────────
  var state = {
    contact: null,
    activities: [],
    campaignSends: [],
    purchases: [],
    tasks: [],
    conversion: null,
    activeTab: 'overview',
    loading: true,
    user: API.auth.getUser(),
    editMode: false,
    availableTags: [],
    priceBookItems: [],
    crmUsers: []
  };

  var TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'history', label: 'History' },
    { key: 'conversion', label: 'Conversion' }
  ];

  // ─── Load All Data ──────────────────────────────────────────
  async function loadData() {
    state.loading = true;
    var container = $el('cc-contact-detail');
    if (container) container.classList.add('cc-loading-state');

    try {
      var results = await Promise.all([
        API.leads.get(contactId),
        API.contacts.getHistory(contactId),
        API.tasks.list({ lead_id: contactId }),
        API.admin.config.list('tag').catch(function() { return { data: [] }; }),
        API.priceBook.list(true).catch(function() { return { items: [] }; }),
        API.admin.listUsers().catch(function() { return { users: [] }; })
      ]);

      var leadResult = results[0];
      var historyResult = results[1];
      var taskResult = results[2];
      var tagResult = results[3];
      var priceBookResult = results[4];
      var usersResult = results[5];

      if (leadResult.success && leadResult.lead) {
        state.contact = leadResult.lead;
      } else {
        showError('Contact not found or access denied.');
        return;
      }

      if (historyResult.success) {
        state.activities = historyResult.activities || [];
        state.campaignSends = historyResult.campaign_sends || [];
        state.purchases = historyResult.purchases || [];
        state.conversion = historyResult.conversion || { converted: false };
      }

      state.tasks = (taskResult.success && taskResult.tasks) || [];

      // Tags from config (store full objects for category grouping)
      state.tagConfig = (tagResult.data || []).filter(function(t) { return t.Label || t.label; });
      state.availableTags = state.tagConfig.map(function(t) { return t.Label || t.label || ''; }).filter(Boolean);
      // Price book items for Service Package dropdown
      state.priceBookItems = (priceBookResult.items || []).filter(function(i) { return i.Is_Active !== false; });
      state.crmUsers = (usersResult.users || []).filter(function(u) { return u.is_active; });

      render();
    } catch (err) {
      showError(err.error || 'Failed to load contact details.');
    }

    state.loading = false;
    if (container) container.classList.remove('cc-loading-state');
  }

  // ─── Selective Re-fetch Helpers ────────────────────────────
  async function reloadContact() {
    try {
      if (API.cache) API.cache.invalidate('/cc/leads');
      var result = await API.leads.get(contactId);
      if (result.success && result.lead) {
        state.contact = result.lead;
        renderHeader();
        renderTabContent();
      }
    } catch (err) { /* silently fail, data will be stale */ }
  }

  async function reloadHistory() {
    try {
      if (API.cache) API.cache.invalidate('/cc/contacts');
      if (API.cache) API.cache.invalidate('/cc/activities');
      var result = await API.contacts.getHistory(contactId);
      if (result.success) {
        state.activities = result.activities || [];
        state.campaignSends = result.campaign_sends || [];
        state.purchases = result.purchases || [];
        state.conversion = result.conversion || { converted: false };
        if (state.activeTab === 'history') renderTabContent();
      }
    } catch (err) { /* silently fail */ }
  }

  async function reloadTasks() {
    try {
      if (API.cache) API.cache.invalidate('/cc/tasks');
      var result = await API.tasks.list({ lead_id: contactId });
      state.tasks = (result.success && result.tasks) || [];
      if (state.activeTab === 'history') renderTabContent();
    } catch (err) { /* silently fail */ }
  }

  // ─── Render All Sections ────────────────────────────────────
  function render() {
    renderHeader();
    renderTabs();
    renderTabContent();
  }

  // ─── Header ─────────────────────────────────────────────────
  function renderHeader() {
    var el = $el('cc-contact-header');
    if (!el || !state.contact) return;
    var c = state.contact;

    var statusBadge = '';
    if (c.Contact_Status) {
      var sColor = API.util.contactStatusColor(c.Contact_Status);
      var sLabel = API.util.contactStatusLabel(c.Contact_Status);
      statusBadge = ' <span class="cc-badge cc-badge-' + sColor + '">' + escapeHtml(sLabel) + '</span>';
    }

    var tagPills = '';
    if (c.Tags && c.Tags.length) {
      c.Tags.forEach(function(tag) {
        tagPills += '<span class="cc-tag-pill">' + escapeHtml(tag) + '</span>';
      });
    }

    el.innerHTML =
      '<div class="cc-contact-header-top">' +
        '<div class="cc-contact-header-left">' +
          '<h1 class="cc-contact-title">' + escapeHtml(c.Client_Name || 'Unnamed Contact') + '</h1>' +
          statusBadge +
          (c.Priority ? ' <span class="cc-badge cc-badge-' + API.util.priorityColor(c.Priority) + '">' + escapeHtml(c.Priority) + '</span>' : '') +
          (c.Disposition === 'WON' ? ' <span class="cc-badge cc-badge-green">WON</span>' : '') +
          (c.Disposition === 'LOST' ? ' <span class="cc-badge cc-badge-red">LOST</span>' : '') +
        '</div>' +
        '<div class="cc-contact-header-actions">' +
          ((_u && ((_u.role || '').toUpperCase() === 'ADMIN' || (_u.role || '').toUpperCase() === 'MANAGER' || _u.is_admin)) ? '<button class="cc-btn cc-btn-sm cc-btn-danger" id="cc-delete-contact" style="margin-right:8px;">Delete</button>' : '') +
          '<button class="cc-btn cc-btn-sm" id="cc-edit-toggle">' + (state.editMode ? 'Cancel Edit' : 'Edit') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cc-contact-subheader">' +
        (c.Client_Email ? '<a href="mailto:' + escapeAttr(c.Client_Email) + '">' + escapeHtml(c.Client_Email) + '</a>' : '') +
        (c.Client_Phone ? ' &middot; <a href="tel:' + escapeAttr(c.Client_Phone) + '">' + escapeHtml(c.Client_Phone) + '</a>' : '') +
        (c.Company ? ' &middot; ' + escapeHtml(c.Company) : '') +
        '<span class="cc-action-btns">' +
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-call" title="Call Now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg> Call</button>' +
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-email" title="Email Now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email</button>' +
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-sms" title="Send SMS"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> SMS</button>' +
        '</span>' +
      '</div>' +
      (tagPills ? '<div class="cc-contact-tags-inline">' + tagPills + '</div>' : '');

    // Bind edit toggle
    var editBtn = document.getElementById('cc-edit-toggle');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        state.editMode = !state.editMode;
        render();
      });
    }

    // Bind delete button
    var delBtn = document.getElementById('cc-delete-contact');
    if (delBtn) {
      delBtn.addEventListener('click', async function() {
        var name = c.Client_Name || 'this contact';
        if (!confirm('Are you sure you want to delete this contact? This will also remove all associated activities and tasks.')) return;
        if (!confirm('This action cannot be undone. Delete "' + name + '" permanently?')) return;
        try {
          delBtn.disabled = true;
          delBtn.textContent = 'Deleting…';
          var result = await API.leads.delete(contactId);
          if (result.success) {
            ccToast('Contact deleted successfully.', 'success');
            window.location.href = '/crm/contacts';
          } else {
            ccToast('Delete failed: ' + (result.error || 'Unknown error'), 'error');
            delBtn.disabled = false;
            delBtn.textContent = 'Delete';
          }
        } catch (err) {
          ccToast('Delete failed: ' + (err.error || err.message || 'Unknown error'), 'error');
          delBtn.disabled = false;
          delBtn.textContent = 'Delete';
        }
      });
    }

    // Bind action buttons
    var callBtn = document.getElementById('cc-action-call');
    if (callBtn) callBtn.addEventListener('click', function() {
      if (!state.contact.Client_Phone) { ccToast('No phone number on file. Add a phone number first.', 'error'); return; }
      showCallDialog(state.contact);
    });
    var emailBtn = document.getElementById('cc-action-email');
    if (emailBtn) emailBtn.addEventListener('click', function() {
      if (!state.contact.Client_Email) { ccToast('No email address on file. Add an email first.', 'error'); return; }
      showEmailModal(state.contact);
    });
    var smsBtn = document.getElementById('cc-action-sms');
    if (smsBtn) smsBtn.addEventListener('click', function() {
      if (!state.contact.Client_Phone) { ccToast('No phone number on file. Add a phone number first.', 'error'); return; }
      showSmsModal(state.contact);
    });
  }

  // ─── Tabs ───────────────────────────────────────────────────
  function renderTabs() {
    var el = $el('cc-contact-tabs');
    if (!el) return;

    var html = '<div class="cc-tabs">';
    TABS.forEach(function(tab) {
      var cls = 'cc-tab' + (state.activeTab === tab.key ? ' cc-tab-active' : '');
      html += '<button class="' + cls + '" data-tab="' + tab.key + '">' + tab.label + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('.cc-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.activeTab = btn.dataset.tab;
        renderTabs();
        renderTabContent();
      });
    });
  }

  // ─── Tab Content Router ─────────────────────────────────────
  function renderTabContent() {
    var el = $el('cc-contact-tab-content');
    if (!el || !state.contact) return;

    switch (state.activeTab) {
      case 'overview':  renderOverview(el); break;
      case 'history':   renderHistory(el);  break;
      case 'conversion': renderConversion(el); break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 1: OVERVIEW
  // ═══════════════════════════════════════════════════════════
  function renderOverview(container) {
    var c = state.contact;
    var html = '';

    // Edit form replaces info grid in edit mode (no redundant display)
    if (state.editMode) {
      html += buildEditForm(c);
    } else {
      html += buildInfoGrid(c);
    }

    // Tags section
    html += buildTagsSection(c);

    // Notes section
    html += buildNotesSection(c);

    container.innerHTML = html;

    // Bind interactive elements
    if (state.editMode) bindEditForm();
    bindTagControls();
    bindNotesControls();
  }

  function buildInfoGrid(c) {
    var fields = [
      { label: 'Email', value: c.Client_Email },
      { label: 'Phone', value: c.Client_Phone },
      { label: 'Company', value: c.Company },
      { label: 'Occupation', value: c.Occupation },
      { label: 'Address', value: c.Client_Address },
      { label: 'Address 2', value: c.Address_2 },
      { label: 'City', value: c.City },
      { label: 'Province', value: c.Province },
      { label: 'Postal Code', value: c.Postal_Code },
      { label: 'Country', value: c.Country },
      { label: 'Date of Birth', value: c.Date_of_Birth ? API.util.formatDate(c.Date_of_Birth) : null },
      { label: 'Spouse Name', value: c.Spouse_Name },
      { label: 'Marital Status', value: c.Marital_Status },
      { label: 'Preferred Language', value: c.Preferred_Language },
      { label: 'Referred By', value: c.Referral_Source },
      { label: 'Practice Area', value: formatPracticeArea(c.Practice_Area) },
      { label: 'Service Package', value: formatPracticeArea(c.Service_Package) },
      { label: 'Lead Source', value: c.Source },
      { label: 'Lead Stage', value: API.util.stageLabel(c.Lead_Stage) },
      { label: 'Disposition', value: c.Disposition || 'OPEN' },
      { label: 'Priority', value: c.Priority },
      { label: 'Owner', value: c.Lead_Owner_Name },
      { label: 'Responsible Lawyer', value: c.Responsible_Lawyer_Name },
      { label: 'Subscribed', value: c.Consent_Status || 'UNKNOWN' },
      { label: 'Date Created', value: API.util.formatDateTime(c.Created_At) },
      { label: 'Last Updated', value: c.Updated_At ? API.util.formatDateTime(c.Updated_At) : '—' },
      { label: 'Last Contact', value: API.util.formatRelativeTime(c.Last_Contacted_At) },
      { label: 'Next Action', value: API.util.formatDateTime(c.Next_Action_At) }
    ];

    if (c.Clio_Contact_ID) fields.push({ label: 'Clio Contact', value: c.Clio_Contact_ID });
    if (c.Clio_Matter_ID) fields.push({ label: 'Clio Matter', value: c.Clio_Matter_ID });

    var html = '<div class="cc-section"><h3 class="cc-section-title">Contact Information</h3>';
    html += '<div class="cc-info-grid">';
    fields.forEach(function(f) {
      html += '<div class="cc-info-item">' +
        '<span class="cc-info-label">' + escapeHtml(f.label) + '</span>' +
        '<span class="cc-info-value">' + escapeHtml(f.value || '—') + '</span>' +
      '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ─── Multi-Select Dropdown Builder ──────────────────────────
  // Renders a searchable multi-select dropdown with pills display
  // options: [{ key: 'KEY', label: 'Label' }]
  // selected: ['KEY1', 'KEY2']
  // id: unique id prefix
  // opts: { placeholder, allowCreate }
  function buildMultiSelect(id, label, options, selected, opts) {
    opts = opts || {};
    var placeholder = opts.placeholder || 'Select...';
    var selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : []);

    var html = '<div class="cc-edit-field cc-multiselect-wrap" data-ms-id="' + id + '">';
    html += '<label>' + escapeHtml(label) + '</label>';
    html += '<div class="cc-ms-control cc-input" id="' + id + '-control" tabindex="0">';
    html += '<div class="cc-ms-pills" id="' + id + '-pills">';

    selectedArr.forEach(function(key) {
      var opt = options.find(function(o) { return o.key === key || o.label === key; });
      var display = opt ? opt.label : key;
      html += '<span class="cc-ms-pill">' + escapeHtml(display) + '<button class="cc-ms-pill-x" data-val="' + escapeAttr(key) + '">&times;</button></span>';
    });

    html += '<input class="cc-ms-search" id="' + id + '-search" placeholder="' + (selectedArr.length ? '' : escapeAttr(placeholder)) + '" autocomplete="off" />';
    html += '</div>';
    html += '<span class="cc-ms-arrow">&#9662;</span>';
    html += '</div>';

    html += '<div class="cc-ms-dropdown" id="' + id + '-dropdown">';
    if (opts.groups && opts.groups.length) {
      // Render options grouped by category
      opts.groups.forEach(function(group) {
        html += '<div class="cc-ms-group" data-group="' + escapeAttr(group.label.toLowerCase()) + '">';
        html += '<div class="cc-ms-group-label">' + escapeHtml(group.label) + '</div>';
        group.options.forEach(function(opt) {
          var checked = selectedArr.indexOf(opt.key) >= 0 || selectedArr.indexOf(opt.label) >= 0;
          html += '<label class="cc-ms-option' + (checked ? ' cc-ms-option-checked' : '') + '" data-val="' + escapeAttr(opt.key) + '" data-label="' + escapeAttr(opt.label.toLowerCase()) + '" data-group="' + escapeAttr(group.label.toLowerCase()) + '">';
          html += '<input type="checkbox" class="cc-ms-cb" value="' + escapeAttr(opt.key) + '"' + (checked ? ' checked' : '') + '> ';
          html += escapeHtml(opt.label);
          html += '</label>';
        });
        html += '</div>';
      });
    } else {
      options.forEach(function(opt) {
        var checked = selectedArr.indexOf(opt.key) >= 0 || selectedArr.indexOf(opt.label) >= 0;
        html += '<label class="cc-ms-option' + (checked ? ' cc-ms-option-checked' : '') + '" data-val="' + escapeAttr(opt.key) + '" data-label="' + escapeAttr(opt.label.toLowerCase()) + '">';
        html += '<input type="checkbox" class="cc-ms-cb" value="' + escapeAttr(opt.key) + '"' + (checked ? ' checked' : '') + '> ';
        html += escapeHtml(opt.label);
        html += '</label>';
      });
    }
    if (opts.allowCreate) {
      html += '<div class="cc-ms-create-row" id="' + id + '-create" style="display:none"><button class="cc-ms-create-btn">+ Create "<span class="cc-ms-create-val"></span>"</button></div>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  // Binds events for a multi-select dropdown
  function bindMultiSelect(id, opts) {
    opts = opts || {};
    var wrap = document.querySelector('[data-ms-id="' + id + '"]');
    if (!wrap) return;
    var control = document.getElementById(id + '-control');
    var dropdown = document.getElementById(id + '-dropdown');
    var searchInput = document.getElementById(id + '-search');
    var pillsContainer = document.getElementById(id + '-pills');
    var isOpen = false;

    function toggleDropdown(open) {
      isOpen = typeof open === 'boolean' ? open : !isOpen;
      dropdown.style.display = isOpen ? 'block' : 'none';
      if (isOpen) {
        searchInput.focus();
        searchInput.placeholder = '';
      } else {
        searchInput.value = '';
        filterOptions('');
        updatePlaceholder();
      }
    }

    function updatePlaceholder() {
      var pills = pillsContainer.querySelectorAll('.cc-ms-pill');
      searchInput.placeholder = pills.length ? '' : (opts.placeholder || 'Select...');
    }

    function getSelectedValues() {
      var vals = [];
      dropdown.querySelectorAll('.cc-ms-cb:checked').forEach(function(cb) { vals.push(cb.value); });
      return vals;
    }

    function refreshPills() {
      // Remove existing pills
      pillsContainer.querySelectorAll('.cc-ms-pill').forEach(function(p) { p.remove(); });
      // Re-add from checked boxes
      dropdown.querySelectorAll('.cc-ms-cb:checked').forEach(function(cb) {
        var optLabel = cb.parentElement;
        var display = optLabel ? optLabel.textContent.trim() : cb.value;
        var pill = document.createElement('span');
        pill.className = 'cc-ms-pill';
        pill.innerHTML = escapeHtml(display) + '<button class="cc-ms-pill-x" data-val="' + escapeAttr(cb.value) + '">&times;</button>';
        pillsContainer.insertBefore(pill, searchInput);
      });
      updatePlaceholder();
    }

    function filterOptions(query) {
      var q = query.toLowerCase().trim();
      var anyVisible = false;
      dropdown.querySelectorAll('.cc-ms-option').forEach(function(opt) {
        var match = !q || opt.dataset.label.indexOf(q) >= 0;
        opt.style.display = match ? '' : 'none';
        if (match) anyVisible = true;
      });
      // Show/hide group headers based on visible children
      dropdown.querySelectorAll('.cc-ms-group').forEach(function(grp) {
        var hasVisible = grp.querySelector('.cc-ms-option:not([style*="display: none"])');
        grp.style.display = hasVisible ? '' : 'none';
      });
      // Show create row if allowCreate and no exact match
      if (opts.allowCreate && q) {
        var createRow = document.getElementById(id + '-create');
        if (createRow) {
          var exactMatch = false;
          dropdown.querySelectorAll('.cc-ms-option').forEach(function(opt) {
            if (opt.dataset.label === q) exactMatch = true;
          });
          if (!exactMatch) {
            createRow.style.display = 'block';
            createRow.querySelector('.cc-ms-create-val').textContent = query;
          } else {
            createRow.style.display = 'none';
          }
        }
      }
    }

    // Toggle on control click
    control.addEventListener('click', function(e) {
      if (e.target.classList.contains('cc-ms-pill-x')) return;
      toggleDropdown();
    });

    // Search input
    searchInput.addEventListener('input', function() {
      filterOptions(searchInput.value);
      if (!isOpen) toggleDropdown(true);
    });

    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') toggleDropdown(false);
    });

    // Checkbox changes
    dropdown.addEventListener('change', function(e) {
      if (e.target.classList.contains('cc-ms-cb')) {
        e.target.parentElement.classList.toggle('cc-ms-option-checked', e.target.checked);
        refreshPills();
      }
    });

    // Pill remove
    pillsContainer.addEventListener('click', function(e) {
      if (e.target.classList.contains('cc-ms-pill-x')) {
        e.preventDefault();
        e.stopPropagation();
        var val = e.target.dataset.val;
        var cb = dropdown.querySelector('.cc-ms-cb[value="' + val + '"]');
        if (cb) {
          cb.checked = false;
          cb.parentElement.classList.remove('cc-ms-option-checked');
        }
        e.target.parentElement.remove();
        updatePlaceholder();
      }
    });

    // Create new tag
    if (opts.allowCreate) {
      var createRow = document.getElementById(id + '-create');
      if (createRow) {
        createRow.addEventListener('click', function() {
          var newVal = searchInput.value.trim();
          if (!newVal) return;
          // Add option to dropdown
          var newOpt = document.createElement('label');
          newOpt.className = 'cc-ms-option cc-ms-option-checked';
          newOpt.dataset.val = newVal;
          newOpt.dataset.label = newVal.toLowerCase();
          newOpt.innerHTML = '<input type="checkbox" class="cc-ms-cb" value="' + escapeAttr(newVal) + '" checked> ' + escapeHtml(newVal);
          dropdown.insertBefore(newOpt, createRow);
          refreshPills();
          searchInput.value = '';
          filterOptions('');
          createRow.style.display = 'none';
        });
      }
    }

    // Close on click outside
    document.addEventListener('click', function(e) {
      if (!wrap.contains(e.target)) toggleDropdown(false);
    });

    // Return helper to get values
    wrap._getValues = getSelectedValues;
    return { getValues: getSelectedValues };
  }

  function buildEditForm(c) {
    var html = '<div class="cc-section cc-edit-section">';
    html += '<h3 class="cc-section-title">Edit Contact</h3>';

    // ── Identity ──
    html += '<div class="cc-edit-group-label">Identity</div>';
    html += '<div class="cc-edit-grid">';
    html += '<div class="cc-edit-field"><label>Name</label>' +
      '<input class="cc-input" id="cc-edit-name" value="' + escapeAttr(c.Client_Name || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Email</label>' +
      '<input type="email" class="cc-input" id="cc-edit-email" value="' + escapeAttr(c.Client_Email || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Phone</label>' +
      '<input class="cc-input" id="cc-edit-phone" value="' + escapeAttr(c.Client_Phone || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Company</label>' +
      '<input class="cc-input" id="cc-edit-company" value="' + escapeAttr(c.Company || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Occupation</label>' +
      '<input class="cc-input" id="cc-edit-occupation" value="' + escapeAttr(c.Occupation || '') + '" /></div>';
    html += '</div>';

    // ── Address ──
    html += '<div class="cc-edit-group-label">Address</div>';
    html += '<div class="cc-edit-grid">';
    html += '<div class="cc-edit-field"><label>Address</label>' +
      '<input class="cc-input" id="cc-edit-address" value="' + escapeAttr(c.Client_Address || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Address 2</label>' +
      '<input class="cc-input" id="cc-edit-address2" value="' + escapeAttr(c.Address_2 || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>City</label>' +
      '<input class="cc-input" id="cc-edit-city" value="' + escapeAttr(c.City || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Province</label>' +
      '<input class="cc-input" id="cc-edit-province" value="' + escapeAttr(c.Province || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Postal Code</label>' +
      '<input class="cc-input" id="cc-edit-postalcode" value="' + escapeAttr(c.Postal_Code || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Country</label>' +
      '<input class="cc-input" id="cc-edit-country" value="' + escapeAttr(c.Country || 'Canada') + '" /></div>';
    html += '</div>';

    // ── Personal ──
    html += '<div class="cc-edit-group-label">Personal</div>';
    html += '<div class="cc-edit-grid">';
    html += '<div class="cc-edit-field"><label>Date of Birth</label>' +
      '<input type="date" class="cc-input" id="cc-edit-dob" value="' + escapeAttr(c.Date_of_Birth || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Spouse Name</label>' +
      '<input class="cc-input" id="cc-edit-spouse" value="' + escapeAttr(c.Spouse_Name || '') + '" /></div>';
    html += '<div class="cc-edit-field"><label>Marital Status</label>' +
      '<select class="cc-input" id="cc-edit-marital">' +
      '<option value="">— Select —</option>';
    ['Single', 'Married', 'Common-Law', 'Divorced', 'Widowed', 'Separated'].forEach(function(s) {
      html += '<option value="' + s + '"' + (c.Marital_Status === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="cc-edit-field"><label>Preferred Language</label>' +
      '<select class="cc-input" id="cc-edit-language">' +
      '<option value="">— Select —</option>';
    ['English', 'French', 'Mandarin', 'Cantonese', 'Other'].forEach(function(s) {
      html += '<option value="' + s + '"' + (c.Preferred_Language === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="cc-edit-field"><label>Referred By</label>' +
      '<input class="cc-input" id="cc-edit-referral" value="' + escapeAttr(c.Referral_Source || '') + '" placeholder="Who referred them?" /></div>';
    html += '</div>';

    // ── CRM Pipeline ──
    html += '<div class="cc-edit-group-label">Pipeline</div>';
    html += '<div class="cc-edit-grid">';
    var practiceAreas = [
      { key: 'ESTATE_PLANNING_WILL_POA', label: 'Estate Planning (Will & POA)' },
      { key: 'TRUSTS_HENSON_SPOUSAL', label: 'Trusts (Henson/Spousal)' },
      { key: 'GUARDIANSHIP_MINORS', label: 'Guardianship (Minors)' },
      { key: 'PROBATE_ESTATE_ADMIN', label: 'Probate & Estate Admin' },
      { key: 'BUSINESS_SUCCESSION', label: 'Business Succession' },
      { key: 'REAL_ESTATE', label: 'Real Estate' },
      { key: 'CORPORATE', label: 'Corporate' },
      { key: 'FAMILY_LAW', label: 'Family Law' }
    ];
    var currentPAs = Array.isArray(c.Practice_Area) ? c.Practice_Area : (c.Practice_Area ? [c.Practice_Area] : []);
    html += buildMultiSelect('cc-ms-pa', 'Practice Area', practiceAreas, currentPAs, { placeholder: 'Select practice areas...' });

    // Service Packages from Price Book data
    var spOptions = (state.priceBookItems || []).map(function(item) {
      return { key: item.Service_Code || item.id, label: item.Service_Name || item.Name || item.Service_Code || '' };
    });
    // Fallback if no price book items loaded
    if (!spOptions.length) {
      spOptions = [
        { key: 'SIMPLE_WILL_POA', label: 'Simple Will & POA' },
        { key: 'COUPLES_WILLS_POA', label: 'Couples Wills & POA' },
        { key: 'BLENDED_FAMILY_PLAN', label: 'Blended Family Plan' },
        { key: 'MINORS_GUARDIANSHIP_PLAN', label: 'Minors Guardianship Plan' },
        { key: 'HENSON_TRUST_PLAN', label: 'Henson Trust Plan' },
        { key: 'SPOUSAL_TRUST_PLAN', label: 'Spousal Trust Plan' },
        { key: 'PROBATE_APPLICATION', label: 'Probate Application' },
        { key: 'PROBATE_FULL_ADMIN', label: 'Probate Full Admin' }
      ];
    }
    var currentSPs = Array.isArray(c.Service_Package) ? c.Service_Package : (c.Service_Package ? [c.Service_Package] : []);
    html += buildMultiSelect('cc-ms-sp', 'Service Package', spOptions, currentSPs, { placeholder: 'Select service packages...' });

    // Lead Source dropdown with Other
    var srcVal = c.Source || '';
    var srcIsOther = srcVal && LEAD_SOURCE_OPTIONS.indexOf(srcVal) === -1;
    var srcSelectVal = srcIsOther ? 'Other' : srcVal;
    html += '<div class="cc-edit-field"><label>Lead Source</label>' +
      '<select class="cc-input" id="cc-edit-source">';
    LEAD_SOURCE_OPTIONS.forEach(function(opt) {
      var lbl = opt || '— Select —';
      html += '<option value="' + escapeAttr(opt) + '"' + (opt === srcSelectVal ? ' selected' : '') + '>' + escapeHtml(lbl) + '</option>';
    });
    html += '</select>' +
      '<input class="cc-input" id="cc-edit-source-other" placeholder="Specify lead source" ' +
      'value="' + escapeAttr(srcIsOther ? srcVal : '') + '" style="margin-top:6px;display:' + (srcIsOther ? 'block' : 'none') + '" />' +
      '</div>';
    html += '<div class="cc-edit-field"><label>Lead Stage</label>' +
      '<select class="cc-input" id="cc-edit-stage">' +
      '<option value="">— Select —</option>';
    var stageLabels = API.util.STAGE_LABELS || {};
    Object.keys(stageLabels).forEach(function(key) {
      html += '<option value="' + key + '"' + (c.Lead_Stage === key ? ' selected' : '') + '>' + escapeHtml(stageLabels[key]) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="cc-edit-field"><label>Disposition</label>' +
      '<select class="cc-input" id="cc-edit-disposition">' +
      '<option value="">— Select —</option>';
    ['OPEN', 'WON', 'LOST', 'DISQUALIFIED'].forEach(function(s) {
      html += '<option value="' + s + '"' + ((c.Disposition || 'OPEN') === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="cc-edit-field"><label>Priority</label>' +
      '<select class="cc-input" id="cc-edit-priority">' +
      '<option value="">— Select —</option>';
    ['LOW', 'NORMAL', 'HIGH', 'URGENT'].forEach(function(s) {
      html += '<option value="' + s + '"' + (c.Priority === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    });
    html += '</select></div>';
    html += '</div>';

    // ── Status ──
    html += '<div class="cc-edit-group-label">Status</div>';
    html += '<div class="cc-edit-grid">';
    html += '<div class="cc-edit-field"><label>Contact Status</label>' +
      '<select class="cc-input" id="cc-edit-status">' +
      '<option value=""' + (!c.Contact_Status ? ' selected' : '') + '>— Select —</option>';
    ['PROSPECT', 'ACTIVE_CLIENT', 'FORMER_CLIENT', 'OTHER'].forEach(function(s) {
      html += '<option value="' + s + '"' + (c.Contact_Status === s ? ' selected' : '') + '>' + escapeHtml(API.util.contactStatusLabel(s)) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="cc-edit-field"><label>Subscribed</label>' +
      '<select class="cc-input" id="cc-edit-consent">';
    ['UNKNOWN', 'SUBSCRIBED', 'UNSUBSCRIBED'].forEach(function(s) {
      html += '<option value="' + s + '"' + (c.Consent_Status === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="cc-edit-field"><label>Next Action Date</label>' +
      '<input type="date" class="cc-input" id="cc-edit-nextaction" value="' + escapeAttr(c.Next_Action_Date || '') + '" /></div>';
    html += '</div>';

    html += '<div class="cc-edit-actions">' +
      '<button class="cc-btn cc-btn-secondary" id="cc-edit-cancel-btn">Cancel</button>' +
      '<button class="cc-btn cc-btn-primary" id="cc-edit-save">Save Changes</button>' +
    '</div>';
    html += '</div>'; // close section
    return html;
  }

  function buildTagsSection(c) {
    var tags = c.Tags || [];
    var html = '<div class="cc-section"><h3 class="cc-section-title">Tags</h3>';

    // Build tag options grouped by category
    var tagOptions = [];
    var addedKeys = {};
    var categoryMap = {}; // { categoryName: [{ key, label }] }

    (state.tagConfig || []).forEach(function(t) {
      var label = t.Label || t.label || '';
      if (!label || addedKeys[label]) return;
      addedKeys[label] = true;
      var meta = {};
      try { meta = JSON.parse(t.Meta || '{}'); } catch(e) {}
      var cat = meta.category || 'Other';
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push({ key: label, label: label });
      tagOptions.push({ key: label, label: label });
    });

    // Add any current tags that aren't in the managed list
    tags.forEach(function(t) {
      if (!addedKeys[t]) {
        tagOptions.push({ key: t, label: t });
        addedKeys[t] = true;
        if (!categoryMap['Other']) categoryMap['Other'] = [];
        categoryMap['Other'].push({ key: t, label: t });
      }
    });

    // Build groups sorted by category name, with each group's options sorted alphabetically
    var categoryOrder = ['Client Type', 'Marketing', 'Case Status', 'Practice Area', 'Internal', 'Other'];
    var groups = [];
    categoryOrder.forEach(function(cat) {
      if (categoryMap[cat] && categoryMap[cat].length) {
        categoryMap[cat].sort(function(a, b) { return a.label.localeCompare(b.label); });
        groups.push({ label: cat, options: categoryMap[cat] });
      }
    });
    // Any categories not in the predefined order
    Object.keys(categoryMap).forEach(function(cat) {
      if (categoryOrder.indexOf(cat) === -1 && categoryMap[cat].length) {
        categoryMap[cat].sort(function(a, b) { return a.label.localeCompare(b.label); });
        groups.push({ label: cat, options: categoryMap[cat] });
      }
    });

    html += buildMultiSelect('cc-ms-tags', '', tagOptions, tags, { placeholder: 'Select or create tags...', allowCreate: true, groups: groups });
    html += '<button class="cc-btn cc-btn-sm cc-btn-primary" id="cc-tag-save-btn" style="margin-top:8px;">Save Tags</button>';
    html += '</div>';
    return html;
  }

  function buildNotesSection(c) {
    var html = '<div class="cc-section"><h3 class="cc-section-title">Notes</h3>';
    html += '<textarea class="cc-input cc-textarea" id="cc-notes-field" rows="4" placeholder="Add notes about this contact...">' + escapeHtml(c.Notes || '') + '</textarea>';
    html += '<button class="cc-btn cc-btn-sm" id="cc-notes-save" style="margin-top:8px;">Save Notes</button>';
    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 2: HISTORY
  // ═══════════════════════════════════════════════════════════
  function renderHistory(container) {
    var html = '';

    // Unified timeline
    html += '<div class="cc-section"><h3 class="cc-section-title">Activity Timeline</h3>';
    html += buildTimeline();
    html += '</div>';

    // Task list
    html += '<div class="cc-section"><h3 class="cc-section-title">Tasks</h3>';
    html += buildTaskList();
    html += '</div>';

    // Log activity form placeholder
    html += '<div id="cc-log-activity-form" class="cc-section"></div>';

    // Add task form placeholder
    html += '<div id="cc-add-task-form" class="cc-section"></div>';

    container.innerHTML = html;

    // Bind forms and buttons after innerHTML is set
    bindTimelineExpand();
    bindTaskCompleteButtons();
    bindLogActivityForm();
    bindAddTaskForm();
  }

  function buildTimeline() {
    // Merge activities + campaign sends into one sorted list
    var items = [];

    state.activities.forEach(function(a) {
      items.push({
        sortDate: a.created_at || '',
        kind: 'activity',
        icon: getActivityIcon(a.type),
        label: a.type || 'Activity',
        subject: a.subject || '',
        body: a.body || '',
        time: a.created_at,
        duration: a.duration_minutes,
        outcome: a.outcome,
        loggedBy: a.logged_by
      });
    });

    state.campaignSends.forEach(function(cs) {
      items.push({
        sortDate: cs.sent_at || cs.created_at || '',
        kind: 'campaign',
        icon: '&#9993;',
        label: 'Campaign Email',
        subject: cs.campaign_name || cs.subject || 'Campaign',
        body: '',
        time: cs.sent_at || cs.created_at,
        duration: 0,
        outcome: cs.status || '',
        loggedBy: ''
      });
    });

    state.purchases.forEach(function(p) {
      var amt = p.amount ? '$' + Number(p.amount).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
      items.push({
        sortDate: p.invoice_date || p.paid_date || '',
        kind: 'purchase',
        icon: '&#128176;',
        label: 'Invoice',
        subject: (p.invoice_number ? p.invoice_number + ' — ' : '') + (p.matter_description || p.service_description || 'Invoice'),
        body: amt ? 'Amount: ' + amt : '',
        time: p.invoice_date || p.paid_date,
        duration: 0,
        outcome: p.status || '',
        loggedBy: '',
        amount: p.amount,
        amountOutstanding: p.amount_outstanding
      });
    });

    // Sort by date descending
    items.sort(function(a, b) {
      return new Date(b.sortDate || 0) - new Date(a.sortDate || 0);
    });

    if (items.length === 0) {
      return '<div class="cc-empty">No activity recorded yet.</div>';
    }

    var html = '<div class="cc-timeline">';
    items.forEach(function(item) {
      // Check if this item has expandable details
      var hasDetails = item.body || item.duration || item.outcome || item.loggedBy ||
        (item.kind === 'purchase' && item.amountOutstanding && item.amountOutstanding > 0);

      html += '<div class="cc-timeline-item cc-timeline-' + item.kind + (hasDetails ? ' cc-timeline-clickable' : '') + '"' +
        (hasDetails ? ' style="cursor:pointer;" tabindex="0" role="button" aria-expanded="false"' : '') + '>';
      html += '<div class="cc-timeline-icon">' + item.icon + '</div>';
      html += '<div class="cc-timeline-content">';
      html += '<div class="cc-timeline-header">';
      html += '<span class="cc-timeline-type">' + escapeHtml(item.label) + '</span>';
      html += '<span class="cc-timeline-time">' + escapeHtml(API.util.formatRelativeTime(item.time)) + '</span>';
      if (hasDetails) html += '<span class="cc-timeline-chevron" style="margin-left:auto;font-size:0.7rem;color:#9CA3AF;transition:transform .2s;">&#9660;</span>';
      html += '</div>';
      html += '<div class="cc-timeline-subject">' + escapeHtml(item.subject) + '</div>';
      // Collapsible detail section
      html += '<div class="cc-timeline-details" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #E5E7EB;">';
      if (item.body) html += '<div class="cc-timeline-body">' + escapeHtml(item.body) + '</div>';
      if (item.duration) html += '<div class="cc-timeline-meta">' + item.duration + ' min</div>';
      // Campaign send status badges
      if (item.kind === 'campaign' && item.outcome) {
        var csColors = { SENT: '#3B82F6', DELIVERED: '#06B6D4', OPENED: '#059669', CLICKED: '#059669', BOUNCED: '#DC2626', SKIPPED: '#9CA3AF' };
        var csColor = csColors[item.outcome.toUpperCase()] || '#6B7280';
        html += '<div class="cc-timeline-meta"><span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:.7rem;font-weight:600;color:white;background:' + csColor + ';">' + escapeHtml(item.outcome) + '</span></div>';
      // Purchase outstanding amount
      } else if (item.kind === 'purchase') {
        if (item.outcome) {
          var pColors = { paid: '#059669', partial: '#D97706', partially_paid: '#D97706', awaiting_payment: '#3B82F6', overdue: '#DC2626', void: '#9CA3AF', draft: '#9CA3AF' };
          var pColor = pColors[item.outcome.toLowerCase()] || '#6B7280';
          html += '<div class="cc-timeline-meta"><span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:.7rem;font-weight:600;color:white;background:' + pColor + ';">' + escapeHtml(item.outcome) + '</span></div>';
        }
        if (item.amountOutstanding && item.amountOutstanding > 0) {
          html += '<div class="cc-timeline-meta" style="color:#DC2626;font-weight:500;">Outstanding: $' + Number(item.amountOutstanding).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</div>';
        }
      } else {
        if (item.outcome) html += '<div class="cc-timeline-meta">Outcome: ' + escapeHtml(item.outcome) + '</div>';
      }
      if (item.loggedBy) html += '<div class="cc-timeline-meta">By: ' + escapeHtml(item.loggedBy) + '</div>';
      html += '</div>'; // end cc-timeline-details
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function buildTaskList() {
    if (state.tasks.length === 0) {
      return '<div class="cc-empty">No tasks for this contact.</div>';
    }

    var html = '<div class="cc-task-list">';
    state.tasks.forEach(function(t) {
      var isDone = t.Status === 'DONE';
      var isOverdue = !isDone && t.Due_At && new Date(t.Due_At) < new Date();
      var cls = 'cc-task-item' + (isDone ? ' cc-task-done' : '') + (isOverdue ? ' cc-task-overdue' : '');

      html += '<div class="' + cls + '" data-task-id="' + escapeAttr(t.id) + '">';
      html += '<div class="cc-task-check">';
      if (!isDone) {
        html += '<button class="cc-task-complete-btn" data-task-id="' + escapeAttr(t.id) + '" title="Mark complete">&#9744;</button>';
      } else {
        html += '<span class="cc-task-completed-icon">&#9745;</span>';
      }
      html += '</div>';
      html += '<div class="cc-task-info">';
      html += '<div class="cc-task-title">' + escapeHtml(t.Title || '') + '</div>';
      if (t.Description) html += '<div class="cc-task-desc">' + escapeHtml(t.Description) + '</div>';
      html += '<div class="cc-task-meta">';
      if (t.Due_At) html += '<span class="' + (isOverdue ? 'cc-text-red' : '') + '">Due: ' + escapeHtml(API.util.formatDate(t.Due_At)) + '</span>';
      if (t.Task_Type) html += ' &middot; ' + escapeHtml(t.Task_Type);
      if (t.Owner_Name) html += ' &middot; <span style="color:#6B7280;">Assigned: ' + escapeHtml(t.Owner_Name) + '</span>';
      html += '</div>';
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 3: CONVERSION
  // ═══════════════════════════════════════════════════════════
  function renderConversion(container) {
    var c = state.contact;
    var conv = state.conversion || { converted: false };
    var html = '';

    // Hero status card
    html += '<div class="cc-section">';
    html += '<div class="cc-conversion-hero cc-conversion-' + (conv.converted ? 'won' : 'prospect') + '">';
    if (conv.converted) {
      html += '<div class="cc-conversion-icon">&#9989;</div>';
      html += '<h2 class="cc-conversion-title">Active Client</h2>';
      if (conv.date) html += '<p class="cc-conversion-date">Converted on ' + escapeHtml(API.util.formatDate(conv.date)) + '</p>';
      if (conv.campaign_name) html += '<p class="cc-conversion-campaign">Via: ' + escapeHtml(conv.campaign_name) + '</p>';
    } else {
      html += '<div class="cc-conversion-icon">&#128161;</div>';
      html += '<h2 class="cc-conversion-title">Prospect</h2>';
      html += '<p class="cc-conversion-subtitle">Not yet converted to client</p>';
    }
    html += '</div>';

    // Action buttons (only for non-converted, open disposition contacts)
    if (!conv.converted && (c.Disposition || 'OPEN') === 'OPEN') {
      html += '<div style="display:flex;gap:12px;justify-content:center;margin-top:16px;">';
      html += '<button class="cc-btn cc-btn-primary" id="cc-convert-now-btn" style="font-size:1rem;padding:10px 24px;">Convert Now</button>';
      html += '<button class="cc-btn cc-btn-danger" id="cc-contact-deal-lost-btn" style="font-size:1rem;padding:10px 24px;">Deal Lost</button>';
      html += '</div>';
    } else if (c.Disposition === 'LOST') {
      html += '<div style="text-align:center;margin-top:12px;"><span class="cc-badge cc-badge-red" style="font-size:0.95rem;padding:6px 16px;">LOST</span></div>';
    }

    html += '</div>';

    // Key dates timeline
    html += '<div class="cc-section"><h3 class="cc-section-title">Key Dates</h3>';
    html += '<div class="cc-key-dates">';

    var dates = [
      { label: 'Created', date: c.Created_At, icon: '&#128197;' },
      { label: 'First Contacted', date: c.Last_Contacted_At, icon: '&#128222;' }
    ];
    if (c.Next_Action_At) dates.push({ label: 'Next Action', date: c.Next_Action_At, icon: '&#9200;' });
    if (c.Intake_Received_At) dates.push({ label: 'Intake Received', date: c.Intake_Received_At, icon: '&#128203;' });
    if (conv.converted && conv.date) dates.push({ label: 'Converted', date: conv.date, icon: '&#127942;' });

    dates.forEach(function(d) {
      if (!d.date) return;
      html += '<div class="cc-key-date-item">';
      html += '<span class="cc-key-date-icon">' + d.icon + '</span>';
      html += '<span class="cc-key-date-label">' + escapeHtml(d.label) + '</span> ';
      html += '<span class="cc-key-date-value">' + escapeHtml(API.util.formatDateTime(d.date)) + '</span>';
      html += '</div>';
    });

    html += '</div></div>';

    // Pipeline status summary
    html += '<div class="cc-section"><h3 class="cc-section-title">Pipeline Status</h3>';
    html += '<div class="cc-info-grid">';
    html += '<div class="cc-info-item"><span class="cc-info-label">Lead Stage</span><span class="cc-info-value">' + escapeHtml(API.util.stageLabel(c.Lead_Stage)) + '</span></div>';
    html += '<div class="cc-info-item"><span class="cc-info-label">Disposition</span><span class="cc-info-value">' + escapeHtml(c.Disposition || 'OPEN') + '</span></div>';
    if (c.Close_Reason) {
      html += '<div class="cc-info-item"><span class="cc-info-label">Close Reason</span><span class="cc-info-value">' + escapeHtml(c.Close_Reason) + '</span></div>';
    }
    if (c.Contact_Status) {
      html += '<div class="cc-info-item"><span class="cc-info-label">Contact Status</span><span class="cc-info-value">' + escapeHtml(API.util.contactStatusLabel(c.Contact_Status)) + '</span></div>';
    }
    html += '</div></div>';

    container.innerHTML = html;

    // Bind Convert Now button (placeholder — will connect later)
    var convertBtn = document.getElementById('cc-convert-now-btn');
    if (convertBtn) {
      convertBtn.addEventListener('click', function() {
        ccToast('Convert Now — coming soon.', 'info');
      });
    }

    // Bind Deal Lost button
    var dealLostBtn = document.getElementById('cc-contact-deal-lost-btn');
    if (dealLostBtn) {
      dealLostBtn.addEventListener('click', function() {
        showContactDealLostModal();
      });
    }
  }

  // ─── Contact Deal Lost Modal ────────────────────────────────
  function showContactDealLostModal() {
    var c = state.contact;
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal" style="max-width:480px">' +
        '<div class="cc-modal-header"><h3>Deal Lost</h3>' +
          '<button class="cc-modal-close" id="cc-cdl-close">&times;</button></div>' +
        '<div class="cc-modal-body">' +
          '<div style="margin-bottom:12px;">' +
            '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem;">Close Reason</label>' +
            '<select id="cc-cdl-reason" class="cc-input" style="width:100%">' +
              '<option value="">— Select reason —</option>' +
              '<option value="PRICE">Price</option>' +
              '<option value="NOT_QUALIFIED">Not Qualified</option>' +
              '<option value="NO_RESPONSE">No Response</option>' +
              '<option value="TIMING">Timing</option>' +
              '<option value="COMPETITOR">Competitor</option>' +
              '<option value="DUPLICATE">Duplicate</option>' +
              '<option value="OTHER">Other</option>' +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem;">Explanation <span style="color:#DC2626;">*</span></label>' +
            '<textarea id="cc-cdl-notes" class="cc-input cc-textarea" rows="4" placeholder="Please explain why this deal was lost (required)" style="width:100%;resize:vertical;"></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="cc-modal-footer">' +
          '<button class="cc-btn cc-btn-danger" id="cc-cdl-confirm">Mark Deal Lost</button> ' +
          '<button class="cc-btn" id="cc-cdl-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('cc-cdl-close').addEventListener('click', function() { overlay.remove(); });
    document.getElementById('cc-cdl-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    document.getElementById('cc-cdl-confirm').addEventListener('click', async function() {
      var reason = document.getElementById('cc-cdl-reason').value;
      var notes = document.getElementById('cc-cdl-notes').value.trim();
      if (!reason) { ccToast('Please select a close reason.', 'info'); return; }
      if (!notes) { ccToast('Explanation is required. Please explain why this deal was lost.', 'info'); return; }

      var btn = document.getElementById('cc-cdl-confirm');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        // Log the explanation as an activity
        await API.activities.create({
          lead_id: c.id,
          type: 'NOTE',
          subject: 'Deal Lost — ' + reason,
          body: notes,
          outcome: 'DEAL_LOST'
        });
        // Update the lead disposition to LOST
        await API.leads.update(c.id, { Disposition: 'LOST', Close_Reason: reason });
        overlay.remove();
        ccToast('Deal marked as lost.', 'success');
        // Refresh the page data
        loadData();
      } catch (err) {
        ccToast('Failed: ' + (err.error || 'Network error'), 'error');
        btn.disabled = false;
        btn.textContent = 'Mark Deal Lost';
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // INTERACTIVE BINDINGS
  // ═══════════════════════════════════════════════════════════

  // ─── Edit Form ──────────────────────────────────────────────
  function bindEditForm() {
    var saveBtn = document.getElementById('cc-edit-save');
    if (!saveBtn) return;

    // Bind lead source Other toggle
    var srcSel = document.getElementById('cc-edit-source');
    var srcOth = document.getElementById('cc-edit-source-other');
    if (srcSel && srcOth) {
      srcSel.addEventListener('change', function() {
        if (srcSel.value === 'Other') {
          srcOth.style.display = 'block';
          srcOth.focus();
          srcOth.value = '';
        } else {
          srcOth.style.display = 'none';
          srcOth.value = '';
        }
      });
    }

    // Initialize multi-select dropdowns
    bindMultiSelect('cc-ms-pa', { placeholder: 'Select practice areas...' });
    bindMultiSelect('cc-ms-sp', { placeholder: 'Select service packages...' });
    bindMultiSelect('cc-ms-tags', { placeholder: 'Select or create tags...', allowCreate: true });


    // Cancel button
    var cancelBtn = document.getElementById('cc-edit-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        state.editMode = false;
        renderTabs();
      });
    }

    saveBtn.addEventListener('click', async function() {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        var updates = {
          Client_Name: document.getElementById('cc-edit-name').value.trim(),
          Client_Email: document.getElementById('cc-edit-email').value.trim(),
          Client_Phone: document.getElementById('cc-edit-phone').value.trim(),
          Company: document.getElementById('cc-edit-company').value.trim(),
          Client_Address: document.getElementById('cc-edit-address').value.trim(),
          Address_2: document.getElementById('cc-edit-address2').value.trim(),
          City: document.getElementById('cc-edit-city').value.trim(),
          Province: document.getElementById('cc-edit-province').value.trim(),
          Postal_Code: document.getElementById('cc-edit-postalcode').value.trim(),
          Country: document.getElementById('cc-edit-country').value.trim(),
          Occupation: document.getElementById('cc-edit-occupation').value.trim(),
          Date_of_Birth: document.getElementById('cc-edit-dob').value,
          Spouse_Name: document.getElementById('cc-edit-spouse').value.trim(),
          Marital_Status: document.getElementById('cc-edit-marital').value,
          Preferred_Language: document.getElementById('cc-edit-language').value,
          Referral_Source: document.getElementById('cc-edit-referral').value.trim(),
          Practice_Area: (function() { var w = document.querySelector('[data-ms-id="cc-ms-pa"]'); return w && w._getValues ? w._getValues() : []; })(),
          Service_Package: (function() { var w = document.querySelector('[data-ms-id="cc-ms-sp"]'); return w && w._getValues ? w._getValues() : []; })(),
          Source: (function() { var sel = document.getElementById('cc-edit-source'); var oth = document.getElementById('cc-edit-source-other'); return sel && sel.value === 'Other' && oth ? oth.value.trim() : (sel ? sel.value.trim() : ''); })(),
          Lead_Stage: document.getElementById('cc-edit-stage').value,
          Disposition: document.getElementById('cc-edit-disposition').value,
          Priority: document.getElementById('cc-edit-priority').value,
          Next_Action_Date: document.getElementById('cc-edit-nextaction').value,
          Contact_Status: document.getElementById('cc-edit-status').value,
          Consent_Status: document.getElementById('cc-edit-consent').value
        };

        var result = await API.leads.update(contactId, updates);
        if (result.success) {
          state.editMode = false;
          reloadContact();
        } else {
          ccToast(result.error || 'Failed to save changes', 'error');
        }
      } catch (err) {
        ccToast(err.error || 'Error saving changes', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
  }

  // ─── Tag Controls ───────────────────────────────────────────
  function bindTagControls() {
    // Bind the tags multi-select
    var msTagsHandle = bindMultiSelect('cc-ms-tags', { placeholder: 'Select or create tags...', allowCreate: true });

    // Save Tags button
    var saveBtn = document.getElementById('cc-tag-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        var wrap = document.querySelector('[data-ms-id="cc-ms-tags"]');
        var selectedTags = wrap && wrap._getValues ? wrap._getValues() : [];

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          var result = await API.leads.update(contactId, { Tags: selectedTags });
          if (result.success) {
            ccToast('Tags saved', 'success');
            reloadContact();
          } else {
            ccToast(result.error || 'Failed to save tags', 'error');
          }
        } catch (err) {
          ccToast('Failed to save tags: ' + (err.error || 'Unknown error'), 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Tags';
        }
      });
    }
  }

  // ─── Notes Controls ─────────────────────────────────────────
  function bindNotesControls() {
    var saveBtn = document.getElementById('cc-notes-save');
    var field = document.getElementById('cc-notes-field');
    if (!saveBtn || !field) return;

    saveBtn.addEventListener('click', async function() {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        var result = await API.leads.update(contactId, { Notes: field.value });
        if (result.success) {
          state.contact.Notes = field.value;
          saveBtn.textContent = 'Saved \u2713';
          setTimeout(function() { saveBtn.textContent = 'Save Notes'; }, 2000);
        } else {
          ccToast(result.error || 'Failed to save notes', 'error');
          saveBtn.textContent = 'Save Notes';
        }
      } catch (err) {
        ccToast(err.error || 'Error saving notes', 'error');
        saveBtn.textContent = 'Save Notes';
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // ─── Task Complete Buttons ──────────────────────────────────
  function bindTimelineExpand() {
    document.querySelectorAll('.cc-timeline-clickable').forEach(function(item) {
      item.addEventListener('click', function() {
        var details = item.querySelector('.cc-timeline-details');
        var chevron = item.querySelector('.cc-timeline-chevron');
        if (!details) return;
        var isOpen = details.style.display !== 'none';
        details.style.display = isOpen ? 'none' : 'block';
        item.setAttribute('aria-expanded', String(!isOpen));
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });
  }

  function bindTaskCompleteButtons() {
    document.querySelectorAll('.cc-task-complete-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var taskId = btn.dataset.taskId;
        try {
          var result = await API.tasks.update(taskId, { status: 'DONE' });
          if (result.success) reloadTasks();
        } catch (err) {
          ccToast('Failed to complete task: ' + (err.error || 'Unknown error'), 'error');
        }
      });
    });
  }

  // ─── Log Activity Form ──────────────────────────────────────
  function bindLogActivityForm() {
    var form = document.getElementById('cc-log-activity-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = 'true';

    form.innerHTML =
      '<h3 class="cc-form-title">Log Activity</h3>' +
      '<div class="cc-form-row">' +
        '<select id="cc-act-type" class="cc-input">' +
          '<option value="CALL">Call</option>' +
          '<option value="EMAIL">Email</option>' +
          '<option value="MEETING">Meeting</option>' +
          '<option value="SMS">SMS</option>' +
          '<option value="NOTE" selected>Note</option>' +
        '</select>' +
        '<input id="cc-act-subject" class="cc-input" placeholder="Subject" />' +
      '</div>' +
      '<textarea id="cc-act-body" class="cc-input cc-textarea" placeholder="Details (optional)"></textarea>' +
      '<div class="cc-form-row">' +
        '<input id="cc-act-duration" class="cc-input cc-input-sm" type="number" placeholder="Duration (min)" />' +
        '<input id="cc-act-outcome" class="cc-input" placeholder="Outcome (optional)" />' +
        '<button id="cc-act-submit" class="cc-btn cc-btn-primary">Log</button>' +
      '</div>';

    document.getElementById('cc-act-submit').addEventListener('click', async function() {
      var btn = document.getElementById('cc-act-submit');
      if (btn.disabled) return;
      var subject = document.getElementById('cc-act-subject').value.trim();
      if (!subject) { ccToast('Subject is required.', 'info'); return; }

      btn.disabled = true;
      try {
        var result = await API.activities.create({
          lead_id: contactId,
          type: document.getElementById('cc-act-type').value,
          subject: subject,
          body: document.getElementById('cc-act-body').value.trim(),
          duration_minutes: parseInt(document.getElementById('cc-act-duration').value) || 0,
          outcome: document.getElementById('cc-act-outcome').value.trim()
        });
        if (result.success) {
          document.getElementById('cc-act-subject').value = '';
          document.getElementById('cc-act-body').value = '';
          document.getElementById('cc-act-duration').value = '';
          document.getElementById('cc-act-outcome').value = '';
          reloadHistory();
        }
      } catch (err) {
        ccToast('Failed: ' + (err.error || 'Unknown error'), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ─── Add Task Form ──────────────────────────────────────────
  function bindAddTaskForm() {
    var form = document.getElementById('cc-add-task-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = 'true';

    // Build assign-to options
    var ROLES = [
      { value: 'ADMIN', label: 'Admin' },
      { value: 'MANAGER', label: 'Manager' },
      { value: 'SALES_INTAKE', label: 'Sales / Intake' },
      { value: 'LAWYER', label: 'Lawyer' },
      { value: 'MARKETING', label: 'Marketing' }
    ];

    var assignTypeHtml = '<select id="cc-task-assign-type" class="cc-input" style="min-width:90px;">' +
      '<option value="user">User</option>' +
      '<option value="role">Role</option>' +
      '</select>';

    var userOpts = '<option value="">— Me (default) —</option>';
    (state.crmUsers || []).forEach(function(u) {
      userOpts += '<option value="' + escapeAttr(u.id) + '">' + escapeHtml(u.name) + ' (' + escapeHtml(u.role) + ')</option>';
    });

    var roleOpts = '';
    ROLES.forEach(function(r) {
      roleOpts += '<option value="' + escapeAttr(r.value) + '">' + escapeHtml(r.label) + '</option>';
    });

    form.innerHTML =
      '<h3 class="cc-form-title">Add Task</h3>' +
      '<div class="cc-form-row" style="flex-wrap:wrap;gap:0.5rem;">' +
        '<input id="cc-task-title" class="cc-input" placeholder="Task title" style="flex:2;min-width:150px;" />' +
        '<input id="cc-task-due" class="cc-input" type="date" style="min-width:130px;" />' +
        '<select id="cc-task-type" class="cc-input" style="min-width:110px;">' +
          '<option value="CUSTOM">Custom</option>' +
          '<option value="FOLLOW_UP">Follow-up</option>' +
          '<option value="SLA_CONTACT">Service Level Contact</option>' +
          '<option value="MEETING2_SCHEDULE">Schedule Meeting #2</option>' +
          '<option value="DRAFTING">Drafting</option>' +
          '<option value="ASSIGNMENT">Assignment</option>' +
        '</select>' +
      '</div>' +
      '<div class="cc-form-row" style="margin-top:0.5rem;gap:0.5rem;align-items:flex-end;">' +
        '<div style="display:flex;gap:0.5rem;align-items:center;">' +
          '<label style="font-size:0.8rem;font-weight:600;color:#6B7280;white-space:nowrap;">Assign to:</label>' +
          assignTypeHtml +
          '<select id="cc-task-assign-user" class="cc-input" style="min-width:160px;">' + userOpts + '</select>' +
          '<select id="cc-task-assign-role" class="cc-input" style="min-width:130px;display:none;">' + roleOpts + '</select>' +
        '</div>' +
        '<button id="cc-task-submit" class="cc-btn cc-btn-primary">Add</button>' +
      '</div>';

    // Toggle assign type
    document.getElementById('cc-task-assign-type').addEventListener('change', function() {
      var isRole = this.value === 'role';
      document.getElementById('cc-task-assign-user').style.display = isRole ? 'none' : '';
      document.getElementById('cc-task-assign-role').style.display = isRole ? '' : 'none';
    });

    document.getElementById('cc-task-submit').addEventListener('click', async function() {
      var btn = document.getElementById('cc-task-submit');
      if (btn.disabled) return;
      var title = document.getElementById('cc-task-title').value.trim();
      if (!title) { ccToast('Task title is required.', 'info'); return; }

      // Resolve assignment
      var assignType = document.getElementById('cc-task-assign-type').value;
      var ownerId = '';
      if (assignType === 'user') {
        ownerId = document.getElementById('cc-task-assign-user').value;
      } else if (assignType === 'role') {
        var role = document.getElementById('cc-task-assign-role').value;
        var roleUser = (state.crmUsers || []).find(function(u) { return u.role === role; });
        ownerId = roleUser ? roleUser.id : '';
      }

      btn.disabled = true;
      try {
        var taskData = {
          lead_id: contactId,
          title: title,
          due_at: document.getElementById('cc-task-due').value || '',
          task_type: document.getElementById('cc-task-type').value
        };
        if (ownerId) taskData.owner = ownerId;
        var result = await API.tasks.create(taskData);
        if (result.success) {
          document.getElementById('cc-task-title').value = '';
          document.getElementById('cc-task-due').value = '';
          reloadTasks();
        }
      } catch (err) {
        ccToast('Failed: ' + (err.error || 'Unknown error'), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ─── Back Button ────────────────────────────────────────────
  function bindBackButton() {
    var btn = $el('cc-back-btn');
    if (btn) {
      btn.addEventListener('click', function() {
        window.location.href = '/crm/contacts';
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatPracticeArea(pa) {
    if (!pa) return '—';
    var items = Array.isArray(pa) ? pa : [pa];
    return items.map(function(item) {
      return item.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
    }).join(', ');
  }

  function getActivityIcon(type) {
    var icons = {
      CALL: '&#128222;', MEETING: '&#128197;', EMAIL: '&#9993;',
      SMS: '&#128172;', NOTE: '&#128221;', TASK_COMPLETED: '&#9989;',
      STATUS_CHANGE: '&#128260;', FORM_SUBMISSION: '&#128203;'
    };
    return icons[type] || '&#128196;';
  }

  function showError(msg) {
    var el = $el('cc-contact-detail');
    if (el) {
      el.innerHTML = '<div class="cc-error"><p>' + escapeHtml(msg) + '</p>' +
        '<button class="cc-btn" onclick="window.location.href=\'/crm/contacts\'">Back to Contacts</button></div>';
    }
  }

  // ─── Communication Modals ───────────────────────────────────

  var _icons = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
  };

  // ── RingCentral Embeddable Integration ────────────────────
  function _ensureRCWidget(cb) {
    if (window.ClientCareRC && window.ClientCareRC.isLoaded()) { cb(true); return; }
    if (!window.ClientCareRC) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/gh/DavidLifson/tabuchi-law-cdn@main/tabuchi-bookings/client-care/shared/rc-widget.js?v=20260318';
      s.onload = function() {
        if (window.ClientCareRC) {
          window.ClientCareRC.autoInit().then(function(ok) { cb(ok); });
        } else { cb(false); }
      };
      s.onerror = function() { cb(false); };
      document.body.appendChild(s);
    } else {
      window.ClientCareRC.autoInit().then(function(ok) { cb(ok); });
    }
  }

  function showCallDialog(record) {
    if (!record.Client_Phone) { ccToast('No phone number available.', 'error'); return; }

    _ensureRCWidget(function(rcAvailable) {
      if (rcAvailable) {
        ccToast('Dialing ' + escapeHtml(record.Client_Phone) + ' via RingCentral...', 'info');
        window.ClientCareRC.dial(record.Client_Phone, function(result) {
          if (result.error) {
            ccToast(result.error, 'error');
            _fallbackCall(record);
            return;
          }
          showCallLogModal({
            lead_id: contactId,
            duration_minutes: result.duration_minutes || 0,
            outcome: result.outcome || 'COMPLETED',
            recording_url: result.recording_url || '',
            rc_call_id: result.session_id || '',
            fromRC: true
          });
        });
      } else {
        _fallbackCall(record);
      }
    });
  }

  function _fallbackCall(record) {
    var a = document.createElement('a');
    a.href = 'tel:' + encodeURIComponent(record.Client_Phone);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    ccToast('Opening phone app for ' + escapeHtml(record.Client_Phone) + '...', 'info');
    showCallLogModal({ lead_id: contactId });
  }

  function showCallLogModal(callData) {
    var _timerStart = Date.now();
    var _timerInterval = null;
    var isFromRC = !!callData.fromRC;

    var timerHtml;
    if (isFromRC && callData.duration_minutes > 0) {
      var rcMins = Math.floor((callData.duration_minutes * 60) / 60);
      var rcSecs = Math.round((callData.duration_minutes * 60) % 60);
      timerHtml =
        '<div class="cc-call-timer" style="text-align:center;margin-bottom:16px;padding:12px;background:#ECFDF5;border-radius:8px;">' +
          '<div style="font-size:0.75rem;color:#059669;margin-bottom:4px;">Call Completed</div>' +
          '<div style="font-size:1.8rem;font-weight:700;color:#059669;font-variant-numeric:tabular-nums;">' + String(rcMins).padStart(2, '0') + ':' + String(rcSecs).padStart(2, '0') + '</div>' +
          '<div style="font-size:0.7rem;color:#6B7280;margin-top:2px;">Duration captured from RingCentral' + (callData.recording_url ? ' &middot; Recording captured' : '') + '</div>' +
        '</div>';
    } else {
      timerHtml =
        '<div class="cc-call-timer" style="text-align:center;margin-bottom:16px;padding:12px;background:#F0F9FF;border-radius:8px;">' +
          '<div style="font-size:0.75rem;color:#6B7280;margin-bottom:4px;">Call Duration</div>' +
          '<div id="cc-cl-timer-display" style="font-size:1.8rem;font-weight:700;color:#2563EB;font-variant-numeric:tabular-nums;">00:00</div>' +
          '<div style="font-size:0.7rem;color:#9CA3AF;margin-top:2px;">Timer started when call was placed</div>' +
        '</div>';
    }

    var recordingHtml;
    if (isFromRC && callData.recording_url) {
      recordingHtml =
        '<div style="margin-top:12px;">' +
          '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.85rem;">Recording <span style="color:#059669;font-weight:400;">&#10003; Captured</span></label>' +
          '<input type="url" id="cc-cl-recording" class="cc-input" value="' + escapeAttr(callData.recording_url) + '" style="background:#F9FAFB;color:#6B7280;" readonly>' +
        '</div>';
    } else {
      recordingHtml =
        '<div style="margin-top:12px;">' +
          '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.85rem;">Recording URL</label>' +
          '<input type="url" id="cc-cl-recording" class="cc-input" placeholder="https://app.ringcentral.com/..." value="">' +
          '<div style="font-size:0.7rem;color:#9CA3AF;margin-top:2px;">Paste the RingCentral recording link after the call ends</div>' +
        '</div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal" style="max-width:480px">' +
        '<div class="cc-modal-header"><h3>' + _icons.phone + 'Log Call</h3>' +
          '<button class="cc-modal-close" id="cc-cl-close">&times;</button></div>' +
        '<div class="cc-modal-body">' +
          timerHtml +
          '<div class="cc-call-log-grid">' +
            '<div class="cc-edit-field">' +
              '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.85rem;">Duration (min)</label>' +
              '<input type="number" id="cc-cl-duration" class="cc-input" value="' + (callData.duration_minutes || 0) + '" min="0">' +
            '</div>' +
            '<div class="cc-edit-field">' +
              '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.85rem;">Outcome</label>' +
              '<select id="cc-cl-outcome" class="cc-input">' +
                '<option value="COMPLETED"' + (callData.outcome === 'COMPLETED' ? ' selected' : '') + '>Completed</option>' +
                '<option value="NO_ANSWER"' + (callData.outcome === 'NO_ANSWER' ? ' selected' : '') + '>No Answer</option>' +
                '<option value="LEFT_VOICEMAIL"' + (callData.outcome === 'LEFT_VOICEMAIL' ? ' selected' : '') + '>Left Voicemail</option>' +
                '<option value="BUSY"' + (callData.outcome === 'BUSY' ? ' selected' : '') + '>Busy</option>' +
                '<option value="WRONG_NUMBER">Wrong Number</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          recordingHtml +
          '<div style="margin-top:12px;">' +
            '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.85rem;">Notes</label>' +
            '<textarea id="cc-cl-notes" class="cc-input cc-textarea" rows="3" placeholder="Call notes..."></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="cc-modal-footer">' +
          '<button class="cc-btn cc-btn-primary" id="cc-cl-save">Save Call Log</button> ' +
          '<button class="cc-btn cc-btn-secondary" id="cc-cl-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    if (!isFromRC || !callData.duration_minutes) {
      function updateTimer() {
        var elapsed = Math.floor((Date.now() - _timerStart) / 1000);
        var mins = Math.floor(elapsed / 60);
        var secs = elapsed % 60;
        var display = document.getElementById('cc-cl-timer-display');
        if (display) display.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        var durInput = document.getElementById('cc-cl-duration');
        if (durInput && !durInput._manualEdit) durInput.value = Math.ceil(elapsed / 60);
      }
      _timerInterval = setInterval(updateTimer, 1000);
      updateTimer();
      var durField = document.getElementById('cc-cl-duration');
      if (durField) durField.addEventListener('input', function() { durField._manualEdit = true; });
    }

    var close = function() { if (_timerInterval) clearInterval(_timerInterval); overlay.remove(); };
    document.getElementById('cc-cl-close').addEventListener('click', close);
    document.getElementById('cc-cl-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    document.getElementById('cc-cl-save').addEventListener('click', async function() {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Saving...';
      if (_timerInterval) clearInterval(_timerInterval);
      try {
        await API.comms.logCall({
          lead_id: callData.lead_id,
          duration_minutes: parseInt(document.getElementById('cc-cl-duration').value) || 0,
          outcome: document.getElementById('cc-cl-outcome').value,
          notes: document.getElementById('cc-cl-notes').value.trim(),
          rc_call_id: callData.rc_call_id || '',
          recording_url: (document.getElementById('cc-cl-recording').value || '').trim()
        });
        ccToast('Call logged successfully.', 'success');
        close();
        reloadHistory();
      } catch (err) {
        ccToast('Failed to log call: ' + (err.error || 'Network error'), 'error');
        btn.disabled = false; btn.textContent = 'Save Call Log';
        if (!isFromRC) _timerInterval = setInterval(updateTimer, 1000);
      }
    });
  }

  // ── Email Modal ────────────────────────────────────────────
  function showEmailModal(record) {
    if (!record.Client_Email) { ccToast('No email address available.', 'error'); return; }
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal" style="max-width:600px">' +
        '<div class="cc-modal-header"><h3>' + _icons.email + 'Email ' + escapeHtml(record.Client_Name || record.Client_Email) + '</h3>' +
          '<button class="cc-modal-close" id="cc-em-close">&times;</button></div>' +
        '<div class="cc-modal-body">' +
          '<div class="cc-email-choice">' +
            '<div class="cc-email-choice-btn" id="cc-em-template-btn">' +
              '<h4>Use Template</h4>' +
              '<p>Pick a pre-built email template</p>' +
            '</div>' +
            '<div class="cc-email-choice-btn" id="cc-em-custom-btn">' +
              '<h4>Custom Email</h4>' +
              '<p>Open Outlook to compose</p>' +
            '</div>' +
          '</div>' +
          '<div id="cc-em-template-area" style="display:none;">' +
            '<div id="cc-em-template-list" class="cc-email-template-list"><p style="color:#9CA3AF;text-align:center;">Loading templates...</p></div>' +
            '<div id="cc-em-preview" style="display:none;">' +
              '<div class="cc-email-subject-row">' +
                '<label>Subject:</label>' +
                '<input type="text" id="cc-em-subject" class="cc-input" readonly>' +
              '</div>' +
              '<div class="cc-email-preview" id="cc-em-preview-body"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cc-modal-footer" id="cc-em-footer" style="display:none;">' +
          '<button class="cc-btn cc-btn-primary" id="cc-em-send">Send Email</button> ' +
          '<button class="cc-btn cc-btn-secondary" id="cc-em-back">Back</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var close = function() { overlay.remove(); };
    document.getElementById('cc-em-close').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    var selectedTemplateId = null;
    var templates = [];

    document.getElementById('cc-em-custom-btn').addEventListener('click', function() {
      var mailto = 'mailto:' + encodeURIComponent(record.Client_Email) +
        '?subject=' + encodeURIComponent('Tabuchi Law — ');
      window.open(mailto, '_blank');

      // Replace modal content with log form
      var choiceBtns = overlay.querySelectorAll('.cc-email-choice-btn');
      for (var i = 0; i < choiceBtns.length; i++) choiceBtns[i].style.display = 'none';
      document.getElementById('cc-em-template-area').style.display = 'none';

      var body = overlay.querySelector('.cc-modal-body');
      body.innerHTML =
        '<p style="margin-bottom:12px;color:#6B7280;">Outlook has been opened. After you send your email, log it below:</p>' +
        '<div style="margin-bottom:10px;">' +
          '<label style="display:block;font-weight:600;margin-bottom:4px;">Subject</label>' +
          '<input type="text" id="cc-em-log-subject" class="cc-input" placeholder="Email subject line" value="Tabuchi Law — ">' +
        '</div>' +
        '<div style="margin-bottom:10px;">' +
          '<label style="display:block;font-weight:600;margin-bottom:4px;">Notes (optional)</label>' +
          '<textarea id="cc-em-log-notes" class="cc-input" rows="3" placeholder="Brief summary of what was discussed"></textarea>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="cc-btn cc-btn-primary" id="cc-em-log-save">Log Email Activity</button>' +
          '<button class="cc-btn" id="cc-em-log-skip">Skip</button>' +
        '</div>';

      document.getElementById('cc-em-log-skip').addEventListener('click', function() {
        close();
      });

      document.getElementById('cc-em-log-save').addEventListener('click', async function() {
        var btn = this;
        var subject = document.getElementById('cc-em-log-subject').value.trim();
        var notes = document.getElementById('cc-em-log-notes').value.trim();
        if (!subject) { ccToast('Please enter the email subject.', 'error'); return; }
        btn.disabled = true;
        btn.textContent = 'Logging...';
        try {
          await API.activities.create({
            lead_id: contactId,
            type: 'EMAIL',
            subject: subject,
            body: notes || 'Sent via Outlook',
            outcome: 'SENT'
          });
          close();
          ccToast('Email activity logged.', 'success');
          reloadHistory();
        } catch (err) {
          ccToast('Failed to log: ' + (err.error || 'Network error'), 'error');
          btn.disabled = false;
          btn.textContent = 'Log Email Activity';
        }
      });
    });

    document.getElementById('cc-em-template-btn').addEventListener('click', async function() {
      var choiceBtns = overlay.querySelectorAll('.cc-email-choice-btn');
      for (var i = 0; i < choiceBtns.length; i++) choiceBtns[i].style.display = 'none';
      document.getElementById('cc-em-template-area').style.display = 'block';

      try {
        var result = await API.campaignTemplates.list();
        templates = (result.templates || result.data || []);
        var listEl = document.getElementById('cc-em-template-list');
        if (!templates.length) {
          listEl.innerHTML = '<p style="color:#9CA3AF;text-align:center;">No templates available.</p>';
          return;
        }
        var html = '';
        templates.forEach(function(t) {
          html += '<div class="cc-email-template-card" data-tid="' + escapeAttr(t.id) + '">' +
            '<h5>' + escapeHtml(t.Name || t.name || 'Untitled') + '</h5>' +
            '<p>' + escapeHtml(t.Category || t.category || '') + (t.Subject ? ' — ' + escapeHtml(t.Subject) : '') + '</p>' +
          '</div>';
        });
        listEl.innerHTML = html;

        listEl.querySelectorAll('.cc-email-template-card').forEach(function(card) {
          card.addEventListener('click', function() {
            selectedTemplateId = this.getAttribute('data-tid');
            listEl.querySelectorAll('.cc-email-template-card').forEach(function(c) { c.classList.remove('selected'); });
            this.classList.add('selected');

            var tpl = templates.find(function(t) { return t.id === selectedTemplateId; });
            if (tpl) {
              var subject = (tpl.Subject || tpl.subject || '').replace(/\{\{client_name\}\}/gi, record.Client_Name || '').replace(/\{\{client_email\}\}/gi, record.Client_Email || '');
              var body = (tpl.Body_HTML || tpl.body_html || tpl.Body || tpl.body || '').replace(/\{\{client_name\}\}/gi, escapeHtml(record.Client_Name || '')).replace(/\{\{client_email\}\}/gi, escapeHtml(record.Client_Email || '')).replace(/\{\{practice_area\}\}/gi, escapeHtml(record.Practice_Area || '')).replace(/\{\{service_package\}\}/gi, escapeHtml(record.Service_Package || ''));
              document.getElementById('cc-em-subject').value = subject;
              document.getElementById('cc-em-preview-body').innerHTML = body;
              document.getElementById('cc-em-preview').style.display = 'block';
              document.getElementById('cc-em-footer').style.display = 'flex';
            }
          });
        });
      } catch (err) {
        document.getElementById('cc-em-template-list').innerHTML = '<p style="color:#DC2626;">Failed to load templates.</p>';
      }
    });

    document.getElementById('cc-em-back').addEventListener('click', function() {
      document.getElementById('cc-em-template-area').style.display = 'none';
      document.getElementById('cc-em-preview').style.display = 'none';
      document.getElementById('cc-em-footer').style.display = 'none';
      var choiceBtns = overlay.querySelectorAll('.cc-email-choice-btn');
      for (var i = 0; i < choiceBtns.length; i++) choiceBtns[i].style.display = '';
      selectedTemplateId = null;
    });

    document.getElementById('cc-em-send').addEventListener('click', async function() {
      if (!selectedTemplateId) { ccToast('Please select a template.', 'info'); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        await API.comms.sendEmail({
          lead_id: contactId,
          template_id: selectedTemplateId,
          subject: document.getElementById('cc-em-subject').value,
          body_html: document.getElementById('cc-em-preview-body').innerHTML
        });
        ccToast('Email sent successfully.', 'success');
        close();
        reloadHistory();
      } catch (err) {
        ccToast('Failed to send email: ' + (err.error || 'Network error'), 'error');
        btn.disabled = false; btn.textContent = 'Send Email';
      }
    });
  }

  // ── SMS Modal (Conversation Thread) ────────────────────────
  function showSmsModal(record) {
    if (!record.Client_Phone) { ccToast('No phone number available.', 'error'); return; }
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal" style="max-width:500px;display:flex;flex-direction:column;max-height:80vh;">' +
        '<div class="cc-modal-header"><h3>' + _icons.sms + 'SMS — ' + escapeHtml(record.Client_Name || record.Client_Phone) + '</h3>' +
          '<button class="cc-modal-close" id="cc-sms-close">&times;</button></div>' +
        '<div id="cc-sms-thread" class="cc-sms-thread" style="flex:1;min-height:200px;">' +
          '<p class="cc-sms-thread-empty">Loading messages...</p>' +
        '</div>' +
        '<div class="cc-sms-compose">' +
          '<textarea id="cc-sms-input" class="cc-input" placeholder="Type a message..." rows="2"></textarea>' +
          '<button class="cc-btn cc-btn-primary" id="cc-sms-send" style="align-self:flex-end;">Send</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var close = function() { overlay.remove(); };
    document.getElementById('cc-sms-close').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    var threadEl = document.getElementById('cc-sms-thread');

    async function loadThread() {
      try {
        var result = await API.comms.getSmsThread(contactId);
        var messages = result.messages || [];
        if (!messages.length) {
          threadEl.innerHTML = '<p class="cc-sms-thread-empty">No messages yet. Send the first SMS below.</p>';
          return;
        }
        var html = '';
        messages.forEach(function(m) {
          var isOut = (m.Direction === 'OUTBOUND');
          html += '<div>' +
            '<div class="cc-sms-bubble ' + (isOut ? 'cc-sms-bubble-out' : 'cc-sms-bubble-in') + '">' + escapeHtml(m.Body || '') + '</div>' +
            '<div class="cc-sms-time ' + (isOut ? 'cc-sms-time-out' : '') + '">' + (m.Sent_At ? API.util.formatRelativeTime(m.Sent_At) : '') + '</div>' +
          '</div>';
        });
        threadEl.innerHTML = html;
        threadEl.scrollTop = threadEl.scrollHeight;
      } catch (err) {
        threadEl.innerHTML = '<p class="cc-sms-thread-empty" style="color:#DC2626;">Failed to load messages.</p>';
      }
    }

    loadThread();

    document.getElementById('cc-sms-send').addEventListener('click', async function() {
      var input = document.getElementById('cc-sms-input');
      var body = input.value.trim();
      if (!body) return;
      var btn = this;
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        await API.comms.sendSms({ lead_id: contactId, body: body });
        input.value = '';
        ccToast('SMS sent.', 'success');
        await loadThread();
        reloadHistory();
      } catch (err) {
        ccToast('Failed to send SMS: ' + (err.error || 'Network error'), 'error');
      }
      btn.disabled = false; btn.textContent = 'Send';
    });

    document.getElementById('cc-sms-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('cc-sms-send').click();
      }
    });
  }

  // ─── Inject Edit Form Styles ──────────────────────────────────
  function injectEditStyles() {
    if (document.getElementById('cc-edit-styles')) return;
    var s = document.createElement('style');
    s.id = 'cc-edit-styles';
    s.textContent =
      '.cc-section{background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:1.25rem;margin-bottom:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.05)}' +
      '.cc-section-title{font-size:.95rem;font-weight:600;color:#1F2937;margin:0 0 1rem;padding-bottom:.5rem;border-bottom:1px solid #F3F4F6}' +
      '.cc-edit-section{background:#FAFBFC;border:1px solid #E5E7EB}' +
      '.cc-edit-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem}' +
      '.cc-edit-field{display:flex;flex-direction:column}' +
      '.cc-edit-field label{display:block;font-size:.75rem;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.03em;margin-bottom:.3rem}' +
      '.cc-edit-field .cc-input{width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:.9rem;color:#1F2937;background:#fff;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}' +
      '.cc-edit-field .cc-input:focus{outline:none;border-color:#3B82F6;box-shadow:0 0 0 3px rgba(59,130,246,.12)}' +
      '.cc-edit-field .cc-input::placeholder{color:#9CA3AF}' +
      '.cc-checkbox-group{display:flex;flex-wrap:wrap;gap:.5rem}' +
      '.cc-checkbox-label{display:flex;align-items:center;gap:.3rem;font-size:.85rem;color:#374151;cursor:pointer;padding:.15rem 0}' +
      '.cc-edit-actions{margin-top:1.25rem;padding-top:1rem;border-top:1px solid #E5E7EB;display:flex;justify-content:flex-end;gap:.75rem}' +
      '.cc-edit-group-label{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#3B82F6;margin:1.25rem 0 .5rem;padding-bottom:.25rem;border-bottom:1px solid #EFF6FF}' +
      '.cc-edit-group-label:first-child{margin-top:0}' +
      '.cc-multiselect-wrap{position:relative}' +
      '.cc-ms-control{display:flex;align-items:center;min-height:38px;padding:4px 8px 4px 6px;cursor:pointer;position:relative;flex-wrap:wrap;gap:3px}' +
      '.cc-ms-pills{display:flex;flex-wrap:wrap;gap:3px;flex:1;align-items:center;min-width:0}' +
      '.cc-ms-pill{display:inline-flex;align-items:center;gap:2px;padding:2px 6px;border-radius:4px;font-size:.78rem;font-weight:500;background:#EDE9FE;color:#5B21B6;white-space:nowrap}' +
      '.cc-ms-pill-x{background:none;border:none;cursor:pointer;font-size:.85rem;color:#7C3AED;padding:0 1px;line-height:1;opacity:.7}' +
      '.cc-ms-pill-x:hover{opacity:1;color:#DC2626}' +
      '.cc-ms-search{border:none;outline:none;font-size:.85rem;flex:1;min-width:60px;padding:2px 0;background:transparent;color:#1F2937}' +
      '.cc-ms-search::placeholder{color:#9CA3AF}' +
      '.cc-ms-arrow{color:#9CA3AF;font-size:.7rem;flex-shrink:0;margin-left:4px}' +
      '.cc-ms-dropdown{display:none;position:absolute;left:0;right:0;top:100%;z-index:50;background:white;border:1px solid #D1D5DB;border-top:none;border-radius:0 0 6px 6px;box-shadow:0 4px 12px rgba(0,0,0,.1);max-height:240px;overflow-y:auto}' +
      '.cc-ms-option{display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;font-size:.85rem;color:#374151;transition:background .1s}' +
      '.cc-ms-option:hover{background:#F3F4F6}' +
      '.cc-ms-option-checked{background:#EFF6FF}' +
      '.cc-ms-option-checked:hover{background:#DBEAFE}' +
      '.cc-ms-cb{accent-color:#3B82F6;margin:0;cursor:pointer}' +
      '.cc-ms-create-row{border-top:1px solid #E5E7EB;padding:6px 10px}' +
      '.cc-ms-create-btn{background:none;border:none;color:#2563EB;font-size:.85rem;cursor:pointer;font-weight:500;padding:0}' +
      '.cc-ms-create-btn:hover{text-decoration:underline}';
    document.head.appendChild(s);
  }

  // ─── Initialize ──────────────────────────────────────────────
  function init() {
    injectEditStyles();
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    bindBackButton();
    loadLeadSources();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
