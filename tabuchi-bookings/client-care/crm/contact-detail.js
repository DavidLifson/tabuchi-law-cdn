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
    priceBookItems: []
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
        API.priceBook.list(true).catch(function() { return { items: [] }; })
      ]);

      var leadResult = results[0];
      var historyResult = results[1];
      var taskResult = results[2];
      var tagResult = results[3];
      var priceBookResult = results[4];

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

      // Tags from config
      state.availableTags = (tagResult.data || []).map(function(t) { return t.Value || t.value || ''; }).filter(Boolean);
      // Price book items for Service Package dropdown
      state.priceBookItems = (priceBookResult.items || []).filter(function(i) { return i.Is_Active !== false; });

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
          ((_u && ((_u.role || '').toUpperCase() === 'ADMIN' || (_u.role || '').toUpperCase() === 'MANAGER')) ? '<button class="cc-btn cc-btn-sm cc-btn-danger" id="cc-delete-contact" style="margin-right:8px;">Delete</button>' : '') +
          '<button class="cc-btn cc-btn-sm" id="cc-edit-toggle">' + (state.editMode ? 'Cancel Edit' : 'Edit') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cc-contact-subheader">' +
        (c.Client_Email ? '<a href="mailto:' + escapeAttr(c.Client_Email) + '">' + escapeHtml(c.Client_Email) + '</a>' : '') +
        (c.Client_Phone ? ' &middot; <a href="tel:' + escapeAttr(c.Client_Phone) + '">' + escapeHtml(c.Client_Phone) + '</a>' : '') +
        (c.Company ? ' &middot; ' + escapeHtml(c.Company) : '') +
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
      { label: 'Referral Source', value: c.Referral_Source },
      { label: 'Practice Area', value: formatPracticeArea(c.Practice_Area) },
      { label: 'Service Package', value: formatPracticeArea(c.Service_Package) },
      { label: 'Lead Source', value: c.Source },
      { label: 'Lead Stage', value: API.util.stageLabel(c.Lead_Stage) },
      { label: 'Disposition', value: c.Disposition || 'OPEN' },
      { label: 'Priority', value: c.Priority },
      { label: 'Owner', value: c.Lead_Owner_Name },
      { label: 'Responsible Lawyer', value: c.Responsible_Lawyer_Name },
      { label: 'Subscribed', value: c.Consent_Status || 'UNKNOWN' },
      { label: 'Lead ID', value: c.Lead_ID || c.id },
      { label: 'Created', value: API.util.formatDateTime(c.Created_At) },
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
    options.forEach(function(opt) {
      var checked = selectedArr.indexOf(opt.key) >= 0 || selectedArr.indexOf(opt.label) >= 0;
      html += '<label class="cc-ms-option' + (checked ? ' cc-ms-option-checked' : '') + '" data-val="' + escapeAttr(opt.key) + '" data-label="' + escapeAttr(opt.label.toLowerCase()) + '">';
      html += '<input type="checkbox" class="cc-ms-cb" value="' + escapeAttr(opt.key) + '"' + (checked ? ' checked' : '') + '> ';
      html += escapeHtml(opt.label);
      html += '</label>';
    });
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
    html += '<div class="cc-edit-field"><label>Referral Source</label>' +
      '<input class="cc-input" id="cc-edit-referral" value="' + escapeAttr(c.Referral_Source || '') + '" /></div>';
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

    html += '<div class="cc-edit-field"><label>Lead Source</label>' +
      '<input class="cc-input" id="cc-edit-source" value="' + escapeAttr(c.Source || '') + '" /></div>';
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

    // Build tag options from available managed tags + any current tags not in the list
    var tagOptions = [];
    var addedKeys = {};
    (state.availableTags || []).forEach(function(t) {
      if (!addedKeys[t]) { tagOptions.push({ key: t, label: t }); addedKeys[t] = true; }
    });
    // Add any current tags that aren't in the managed list
    tags.forEach(function(t) {
      if (!addedKeys[t]) { tagOptions.push({ key: t, label: t }); addedKeys[t] = true; }
    });
    tagOptions.sort(function(a, b) { return a.label.localeCompare(b.label); });

    html += buildMultiSelect('cc-ms-tags', '', tagOptions, tags, { placeholder: 'Select or create tags...', allowCreate: true });
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
      html += '<div class="cc-timeline-item cc-timeline-' + item.kind + '">';
      html += '<div class="cc-timeline-icon">' + item.icon + '</div>';
      html += '<div class="cc-timeline-content">';
      html += '<div class="cc-timeline-header">';
      html += '<span class="cc-timeline-type">' + escapeHtml(item.label) + '</span>';
      html += '<span class="cc-timeline-time">' + escapeHtml(API.util.formatRelativeTime(item.time)) + '</span>';
      html += '</div>';
      html += '<div class="cc-timeline-subject">' + escapeHtml(item.subject) + '</div>';
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
          var pColors = { paid: '#059669', partially_paid: '#D97706', awaiting_payment: '#3B82F6', overdue: '#DC2626', void: '#9CA3AF', draft: '#9CA3AF' };
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
    html += '</div></div>';

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
  }

  // ═══════════════════════════════════════════════════════════
  // INTERACTIVE BINDINGS
  // ═══════════════════════════════════════════════════════════

  // ─── Edit Form ──────────────────────────────────────────────
  function bindEditForm() {
    var saveBtn = document.getElementById('cc-edit-save');
    if (!saveBtn) return;

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
          Source: document.getElementById('cc-edit-source').value.trim(),
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

    form.innerHTML =
      '<h3 class="cc-form-title">Add Task</h3>' +
      '<div class="cc-form-row">' +
        '<input id="cc-task-title" class="cc-input" placeholder="Task title" />' +
        '<input id="cc-task-due" class="cc-input" type="date" />' +
        '<select id="cc-task-type" class="cc-input">' +
          '<option value="CUSTOM">Custom</option>' +
          '<option value="FOLLOW_UP">Follow-up</option>' +
          '<option value="SLA_CONTACT">Service Level Contact</option>' +
          '<option value="MEETING2_SCHEDULE">Schedule Meeting #2</option>' +
          '<option value="DRAFTING">Drafting</option>' +
        '</select>' +
        '<button id="cc-task-submit" class="cc-btn cc-btn-primary">Add</button>' +
      '</div>';

    document.getElementById('cc-task-submit').addEventListener('click', async function() {
      var btn = document.getElementById('cc-task-submit');
      if (btn.disabled) return;
      var title = document.getElementById('cc-task-title').value.trim();
      if (!title) { ccToast('Task title is required.', 'info'); return; }

      btn.disabled = true;
      try {
        var result = await API.tasks.create({
          lead_id: contactId,
          title: title,
          due_at: document.getElementById('cc-task-due').value || '',
          task_type: document.getElementById('cc-task-type').value
        });
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
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
