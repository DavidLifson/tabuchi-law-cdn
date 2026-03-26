/**
 * Tabuchi Law Client Care CRM - Contact Detail (360° View)
 * Handles: /crm/contact?id=xxx
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - 5-tab layout: Overview, Activity & Tasks, Recordings, Conversion, Documents
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
    crmUsers: [],
    documents: [],
    documentsLoading: false,
    documentCreators: [],
    docCreatorStep: 0,
    docCreatorSources: {},
    docCreatorFieldData: null,
    recordings: [],
    recordingsLoaded: false,
    _recRefreshTimer: null,
    _pendingUploads: []
  };

  var TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'history', label: 'Activity & Tasks' },
    { key: 'recordings', label: 'Recordings' },
    { key: 'conversion', label: 'Conversion' },
    { key: 'documents', label: 'Documents' }
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
        API.admin.listUsers().catch(function() { return { users: [] }; }),
        API.admin.config.list('practice_area').catch(function() { return { data: [] }; }),
        API.documents.list(contactId).catch(function() { return { data: [] }; }),
        API.documents.listCreators().catch(function() { return { data: [] }; })
      ]);

      var leadResult = results[0];
      var historyResult = results[1];
      var taskResult = results[2];
      var tagResult = results[3];
      var priceBookResult = results[4];
      var usersResult = results[5];
      var paResult = results[6];
      var docsResult = results[7];
      var creatorsResult = results[8];

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
      // Practice area options from practice_area config list
      state.practiceAreaOptions = (paResult.data || []).filter(function(i) { return i.Is_Active !== false; }).sort(function(a, b) { return (a.Sort_Order || 0) - (b.Sort_Order || 0); }).map(function(i) { return { key: i.Label, label: i.Label }; });
      // Price book items for Service Package dropdown
      state.priceBookItems = (priceBookResult.items || []).filter(function(i) { return i.Is_Active !== false; });
      state.crmUsers = (usersResult.users || []).filter(function(u) { return u.is_active; });
      state.documents = (docsResult.data || []).filter(function(d) { return d.status !== 'archived'; });
      state.documentCreators = creatorsResult.data || [];

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
        // Self-heal: if Last_Contacted_At is empty but activities exist, backfill it
        if (!state.contact.Last_Contacted_At && state.activities.length > 0) {
          var latest = state.activities[0].Occurred_At || state.activities[0].Created_At;
          if (latest) {
            state.contact.Last_Contacted_At = latest;
            if (state.activeTab === 'overview') renderTabContent();
            API.leads.update(contactId, { Last_Contacted_At: latest }).catch(function() {});
          }
        }
      }
    } catch (err) { /* silently fail */ }
  }

  async function reloadTasks() {
    try {
      if (API.cache) API.cache.invalidate('/cc/tasks');
      var result = await API.tasks.list({ lead_id: contactId });
      state.tasks = (result.success && result.tasks) || [];
      if (state.activeTab === 'history') renderTabContent();
      syncNextAction();
    } catch (err) { /* silently fail */ }
  }

  function syncNextAction() {
    var earliest = null;
    state.tasks.forEach(function(t) {
      if (t.Status === 'DONE' || !t.Due_At) return;
      var d = new Date(t.Due_At);
      if (!earliest || d < earliest) earliest = d;
    });
    var newVal = earliest ? earliest.toISOString() : null;
    var current = state.contact.Next_Action_At || state.contact.Next_Action_Date || null;
    var currentDate = current ? new Date(current).toISOString().slice(0, 10) : null;
    var newDate = newVal ? new Date(newVal).toISOString().slice(0, 10) : null;
    if (currentDate !== newDate) {
      state.contact.Next_Action_At = newVal;
      state.contact.Next_Action_Date = newVal;
      if (state.activeTab === 'overview') renderTabContent();
      API.leads.update(contactId, { Next_Action_Date: newDate || '' }).catch(function() {});
    }
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
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-send-form" title="Send Intake Form"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Send Intake</button>' +
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
    var formBtn = document.getElementById('cc-action-send-form');
    if (formBtn) formBtn.addEventListener('click', function() {
      if (!state.contact.Client_Email) { ccToast('No email address on file. Add an email first.', 'error'); return; }
      showSendFormModal(state.contact);
    });
  }

  // ─── Tabs ───────────────────────────────────────────────────
  function renderTabs() {
    var el = $el('cc-contact-tabs');
    if (!el) return;

    var html = '<div class="cc-tabs">';
    TABS.forEach(function(tab) {
      var cls = 'cc-tab' + (state.activeTab === tab.key ? ' cc-tab-active' : '');
      var badge = '';
      if (tab.key === 'recordings' && state.recordings.length > 0) {
        badge = ' <span class="cc-tab-badge">' + state.recordings.length + '</span>';
      }
      html += '<button class="' + cls + '" data-tab="' + tab.key + '">' + tab.label + badge + '</button>';
    });
    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('.cc-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var prevTab = state.activeTab;
        state.activeTab = btn.dataset.tab;
        renderTabs();
        renderTabContent();
        // Lazy-load recordings on first switch
        if (btn.dataset.tab === 'recordings' && !state.recordingsLoaded) {
          loadContactRecordings();
        }
        // Manage auto-refresh
        if (btn.dataset.tab === 'recordings') startRecRefresh();
        else if (prevTab === 'recordings') stopRecRefresh();
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
      case 'recordings': renderRecordingsTab(el); break;
      case 'conversion': renderConversion(el); break;
      case 'documents': renderDocuments(el); break;
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
    bindConsentField();
    bindTagControls();
    bindNotesControls();
  }

  function renderConsentField(c) {
    var val = (c.Consent_Status || 'UNKNOWN').toUpperCase();
    var opts = [
      { value: 'UNKNOWN', label: 'Unknown' },
      { value: 'SUBSCRIBED', label: 'Subscribed' },
      { value: 'UNSUBSCRIBED', label: 'Unsubscribed' }
    ];
    var html = '<select class="cc-info-input cc-select" id="cc-consent-select" autocomplete="off">';
    opts.forEach(function(o) {
      html += '<option value="' + o.value + '"' + (o.value === val ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
    });
    html += '</select>';
    return html;
  }

  function bindConsentField() {
    var sel = document.getElementById('cc-consent-select');
    if (!sel) return;
    sel.addEventListener('change', async function() {
      var newVal = sel.value;
      try {
        await API.leads.update(contactId, { Consent_Status: newVal });
        state.contact.Consent_Status = newVal;
        ccToast('Subscription status updated.', 'success');
      } catch (e) {
        ccToast('Failed to update subscription status.', 'error');
      }
    });
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
      { label: 'Subscribed', html: renderConsentField(c) },
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
      var valHtml = f.html ? f.html : '<span class="cc-info-value">' + escapeHtml(f.value || '—') + '</span>';
      html += '<div class="cc-info-item">' +
        '<span class="cc-info-label">' + escapeHtml(f.label) + '</span>' +
        valHtml +
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

    // Practice Area multi-select from admin config
    var paOptions = state.practiceAreaOptions || [];
    var currentPAs = Array.isArray(c.Practice_Area) ? c.Practice_Area : (c.Practice_Area ? [c.Practice_Area] : []);
    html += buildMultiSelect('cc-ms-pa', 'Practice Area', paOptions, currentPAs, { placeholder: 'Select practice areas...' });

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

    // Log activity form placeholder
    html += '<div id="cc-log-activity-form" class="cc-section"></div>';

    // Unified timeline
    html += '<div class="cc-section"><h3 class="cc-section-title">Activity Timeline</h3>';
    html += buildTimeline();
    html += '</div>';

    // Add task form placeholder
    html += '<div id="cc-add-task-form" class="cc-section"></div>';

    // Task list
    html += '<div class="cc-section"><h3 class="cc-section-title">Tasks</h3>';
    html += buildTaskList();
    html += '</div>';

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
        loggedBy: a.logged_by,
        recording_url: a.recording_url || ''
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
      // Recording badge
      if (item.recording_url) {
        html += '<a href="' + escapeAttr(item.recording_url) + '" target="_blank" rel="noopener" ' +
          'style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:3px 8px;background:#EEF2FF;color:#4F46E5;border-radius:4px;font-size:0.75rem;text-decoration:none;font-weight:500;" ' +
          'onclick="event.stopPropagation();">' +
          '&#9654; Play Recording</a>';
      }
      // Collapsible detail section
      html += '<div class="cc-timeline-details" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #E5E7EB;">';
      if (item.body) html += '<div class="cc-timeline-body">' + escapeHtml(item.body) + '</div>';
      // Document links for Meeting Summary Generated activities
      if (item.subject === 'Meeting Summary Generated' && item.body) {
        var internalMatch = item.body.match(/Internal Doc ID: (rec\w+)/);
        var clientMatch = item.body.match(/Client Doc ID: (rec\w+)/);
        if (internalMatch || clientMatch) {
          html += '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">';
          if (internalMatch) {
            html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-activity-doc-btn" data-doc-id="' + escapeAttr(internalMatch[1]) + '" style="font-size:0.78rem;" onclick="event.stopPropagation();">&#128196; View Internal Summary</button>';
          }
          if (clientMatch) {
            html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-activity-doc-btn" data-doc-id="' + escapeAttr(clientMatch[1]) + '" style="font-size:0.78rem;" onclick="event.stopPropagation();">&#128196; View Client Summary</button>';
          }
          html += '</div>';
        }
      }
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
  // TAB 3: RECORDINGS
  // ═══════════════════════════════════════════════════════════

  async function loadContactRecordings() {
    var el = $el('cc-contact-tab-content');
    if (!el || state.activeTab !== 'recordings') return;

    el.innerHTML = '<div style="text-align:center;padding:2rem;color:#6B7280;">Loading recordings...</div>';

    try {
      var result = await API.recordings.list({ lead_id: contactId });
      if (result.success) {
        state.recordings = result.recordings || [];
        state.recordingsLoaded = true;
        renderRecordingsTab(el);
        renderTabs(); // Update badge count
      } else {
        el.innerHTML = '<div class="cc-error">' + escapeHtml(result.error || 'Failed to load recordings') + '</div>';
      }
    } catch (err) {
      el.innerHTML = '<div class="cc-error">' + escapeHtml(err.error || 'Failed to load recordings') + '</div>';
    }
  }

  async function reloadContactRecordings() {
    try {
      var result = await API.recordings.list({ lead_id: contactId });
      if (result.success) {
        state.recordings = result.recordings || [];
        if (state.activeTab === 'recordings') renderRecordingsTab($el('cc-contact-tab-content'));
        renderTabs();
      }
    } catch (err) { /* silently fail */ }
  }

  function startRecRefresh() {
    stopRecRefresh();
    var hasPending = state.recordings.some(function(r) {
      return ['pending', 'downloading', 'transcribing', 'analyzing'].indexOf((r.Status || '').toLowerCase()) >= 0;
    });
    if (hasPending) {
      state._recRefreshTimer = setInterval(reloadContactRecordings, 15000);
    }
  }

  function stopRecRefresh() {
    if (state._recRefreshTimer) {
      clearInterval(state._recRefreshTimer);
      state._recRefreshTimer = null;
    }
  }

  // ─── Notification-Aware Polling ──────────────────────────────
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification(title, {
          body: body,
          icon: 'https://davidlifson.github.io/tabuchi-law-cdn/tabuchi-bookings/webflow/shared/logo.png',
          tag: 'cc-recording-done'
        });
        n.onclick = function() { window.focus(); n.close(); };
      } catch (e) { /* mobile/insecure context fallback */ }
    }
  }

  function startRecRefreshWithNotify() {
    stopRecRefresh();
    // Track which recordings are currently pending
    var pendingIds = {};
    state.recordings.forEach(function(r) {
      var st = (r.Status || '').toLowerCase();
      if (['pending', 'downloading', 'transcribing', 'analyzing'].indexOf(st) >= 0) {
        pendingIds[r.id] = st;
      }
    });

    if (Object.keys(pendingIds).length === 0) return;

    state._recRefreshTimer = setInterval(async function() {
      try {
        var result = await API.recordings.list({ lead_id: contactId });
        if (!result.success) return;

        var newRecordings = result.recordings || [];
        // Check if any previously-pending recordings are now completed
        newRecordings.forEach(function(r) {
          if (pendingIds[r.id] && (r.Status === 'completed' || r.Status === 'analyzed')) {
            delete pendingIds[r.id];
            var subject = r.Meeting_Subject || r.File_Name || 'Recording';
            ccToast('Transcription complete: ' + subject, 'success');
            sendBrowserNotification('Transcription Complete', subject + ' is ready for review.');
          } else if (pendingIds[r.id] && r.Status === 'failed') {
            delete pendingIds[r.id];
            ccToast('Transcription failed: ' + (r.Meeting_Subject || 'Recording'), 'error');
          }
        });

        state.recordings = newRecordings;
        if (state.activeTab === 'recordings') renderRecordingsTab($el('cc-contact-tab-content'));
        renderTabs();

        // Stop polling if nothing pending
        if (Object.keys(pendingIds).length === 0) {
          stopRecRefresh();
        }
      } catch (err) { /* silently fail */ }
    }, 15000);
  }

  function recStatusColor(status) {
    var map = { completed: 'green', pending: 'gray', downloading: 'blue', transcribing: 'blue', analyzing: 'blue', error: 'red' };
    return map[(status || '').toLowerCase()] || 'gray';
  }
  function recIntentColor(intent) {
    var map = { PROCEED: 'green', UNDECIDED: 'yellow', DECLINED: 'red', NEEDS_FOLLOWUP: 'blue' };
    return map[intent] || 'gray';
  }
  function recWillColor(wst) {
    var map = { PENDING_REVIEW: 'yellow', GENERATING: 'blue', GENERATED: 'green', UPLOADED_TO_CLIO: 'green', NOT_APPLICABLE: 'gray' };
    return map[wst] || 'gray';
  }
  function recFormatDuration(seconds) {
    if (!seconds) return '';
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function recParseJson(str) {
    if (!str) return null;
    if (Array.isArray(str)) return str;
    try { return JSON.parse(str); } catch (e) { return null; }
  }

  function renderRecordingsTab(container) {
    if (!container) return;

    // Inject spinner animation once
    if (!document.getElementById('cc-rec-spin-style')) {
      var spinStyle = document.createElement('style');
      spinStyle.id = 'cc-rec-spin-style';
      spinStyle.textContent = '@keyframes cc-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(spinStyle);
    }

    // If not loaded yet, trigger lazy load
    if (!state.recordingsLoaded) {
      loadContactRecordings();
      return;
    }

    var rcRecordings = (state.activities || []).filter(function(a) { return a.recording_url || a.Recording_URL; });
    var html = '';

    // Upload button bar
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h3 class="cc-section-title" style="margin:0;">Recordings</h3>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button id="cc-rec-upload-btn" class="cc-btn cc-btn-primary" style="font-size:13px;padding:6px 14px;">&#128190; Upload Recording</button>';
    html += '<button id="cc-rec-refresh-btn" class="cc-btn cc-btn-outline cc-btn-sm" title="Refresh" style="padding:4px 10px;font-size:0.8rem;">&#8635; Refresh</button>';
    html += '</div></div>';

    // Upload form (hidden by default)
    html += '<div id="cc-rec-upload-form" style="display:none;margin-bottom:16px;padding:16px;border:2px dashed #CBD5E1;border-radius:8px;background:#F8FAFC;">';
    html += '<p style="margin:0 0 12px;font-size:14px;font-weight:600;">Upload an audio or video file for transcription</p>';
    html += '<input type="file" id="cc-rec-file-input" accept="audio/*,video/*,.mp3,.mp4,.m4a,.wav,.webm,.ogg,.flac" style="margin-bottom:12px;" />';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">';
    html += '<div><label style="font-size:12px;color:#555;">Subject / Title</label><input id="cc-rec-upload-subject" class="cc-input" placeholder="e.g. Initial consultation call" style="font-size:13px;" /></div>';
    html += '<div><label style="font-size:12px;color:#555;">Source</label>';
    html += '<select id="cc-rec-upload-source" class="cc-input" style="font-size:13px;"><option value="upload">File Upload</option><option value="phone">Phone Recording</option><option value="teams">Teams Meeting</option><option value="zoom">Zoom Meeting</option></select></div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button id="cc-rec-upload-submit" class="cc-btn cc-btn-primary" style="font-size:13px;">Upload &amp; Transcribe</button>';
    html += '<button id="cc-rec-upload-cancel" class="cc-btn cc-btn-outline" style="font-size:13px;">Cancel</button>';
    html += '</div>';
    html += '<div id="cc-rec-upload-progress" style="display:none;margin-top:12px;padding:12px;background:#EFF6FF;border-radius:6px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<span id="cc-rec-upload-status" style="font-size:13px;color:#1D4ED8;font-weight:500;">Preparing upload...</span>';
    html += '<span id="cc-rec-upload-pct" style="font-size:13px;color:#1D4ED8;font-weight:600;">0%</span>';
    html += '</div>';
    html += '<div style="background:#BFDBFE;border-radius:4px;height:8px;overflow:hidden;">';
    html += '<div id="cc-rec-upload-bar" style="background:#2563EB;height:100%;width:0%;transition:width 0.3s ease;border-radius:4px;"></div>';
    html += '</div>';
    html += '<div id="cc-rec-upload-eta" style="font-size:11px;color:#6B7280;margin-top:4px;"></div>';
    html += '</div>';
    html += '</div>';

    // Pending uploads / processing cards
    if (state._pendingUploads.length > 0) {
      state._pendingUploads.forEach(function(pu) {
        html += '<div class="cc-rec-card" style="margin-bottom:0.75rem;border-left:4px solid #3B82F6;">';
        html += '<div class="cc-rec-card-header">';
        html += '<span class="cc-badge cc-badge-blue" style="font-size:.7rem;">UPLOADING</span>';
        html += '<span style="font-size:0.9rem;font-weight:600;margin-left:8px;">' + escapeHtml(pu.name) + '</span>';
        html += '<span class="cc-rec-card-meta" style="margin-left:auto;">' + escapeHtml(pu.sizeMB + ' MB') + '</span>';
        html += '</div>';
        html += '<div style="padding:8px 0;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
        html += '<span id="cc-pu-status-' + pu.id + '" style="font-size:13px;color:#1D4ED8;font-weight:500;">' + escapeHtml(pu.status || 'Preparing...') + '</span>';
        html += '<span id="cc-pu-pct-' + pu.id + '" style="font-size:13px;color:#1D4ED8;font-weight:600;">' + (pu.pct || 0) + '%</span>';
        html += '</div>';
        html += '<div style="background:#BFDBFE;border-radius:4px;height:8px;overflow:hidden;">';
        html += '<div id="cc-pu-bar-' + pu.id + '" style="background:#2563EB;height:100%;width:' + (pu.pct || 0) + '%;transition:width 0.3s ease;border-radius:4px;"></div>';
        html += '</div>';
        html += '<div id="cc-pu-eta-' + pu.id + '" style="font-size:11px;color:#6B7280;margin-top:4px;">' + escapeHtml(pu.eta || '') + '</div>';
        html += '</div></div>';
      });
    }

    if (state.recordings.length === 0 && rcRecordings.length === 0 && state._pendingUploads.length === 0) {
      html += '<div class="cc-empty" style="padding:2rem;text-align:center;">';
      html += '<p style="margin:0 0 .5rem;font-size:1.1rem;color:#6B7280;">No recordings linked to this contact.</p>';
      html += '<p style="margin:0;font-size:.85rem;color:#9CA3AF;">Upload a recording or recordings from calls and meetings will appear here automatically.</p>';
      html += '</div>';
    } else {
      // Call Recordings (from Activities with Recording_URL)
      if (rcRecordings.length > 0) {
        html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.75rem;font-size:0.95rem;color:#374151;">Call Recordings</h4>';
        rcRecordings.forEach(function(a) {
          var date = API.util.formatDateTime(a.created_at || a.Occurred_At);
          var duration = a.duration_minutes || a.Duration_Minutes;
          var durationStr = duration ? duration + ' min' : '';
          var recUrl = a.recording_url || a.Recording_URL;

          html += '<div class="cc-rec-card" style="margin-bottom:0.5rem;">';
          html += '<div class="cc-rec-card-header">';
          html += '<span class="cc-badge cc-badge-green" style="font-size:.7rem;">RINGCENTRAL</span>';
          html += '<span class="cc-badge cc-badge-gray">' + escapeHtml(a.outcome || a.Outcome || 'Completed') + '</span>';
          html += '<span class="cc-rec-card-meta" style="margin-left:auto;">' + escapeHtml(date) + (durationStr ? ' &middot; ' + durationStr : '') + '</span>';
          html += '</div>';
          html += '<div style="padding:0.5rem 0;">';
          html += '<div style="font-size:0.9rem;font-weight:500;margin-bottom:0.25rem;">' + escapeHtml(a.subject || a.Subject || 'Phone Call') + '</div>';
          if (a.body || a.Body) html += '<div style="font-size:0.85rem;color:#4B5563;margin-bottom:0.5rem;white-space:pre-wrap;">' + escapeHtml((a.body || a.Body || '').substring(0, 200)) + '</div>';
          html += '<a href="' + escapeAttr(recUrl) + '" target="_blank" rel="noopener" ' +
            'style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:#4F46E5;color:white;border-radius:6px;font-size:0.8rem;text-decoration:none;font-weight:500;">' +
            '&#9654; Play Recording</a>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      // Meeting / Uploaded Recordings
      if (state.recordings.length > 0) {
        html += '<div><h4 style="margin:0 0 0.75rem;font-size:0.95rem;color:#374151;">Meeting &amp; Uploaded Recordings</h4>';

        state.recordings.forEach(function(rec, idx) {
          var statusCls = recStatusColor(rec.Status);
          var intentCls = recIntentColor(rec.AI_Client_Intent);
          var willCls = recWillColor(rec.Will_Status);
          var duration = recFormatDuration(rec.Duration_Seconds);
          var date = API.util.formatDateTime(rec.Meeting_Date || rec.Created_At);
          var source = (rec.Source || 'teams').toUpperCase();

          var recTitle = rec.Meeting_Subject || rec.File_Name || rec.Subject || 'Recording';
          var isProcessing = rec.Status === 'pending' || rec.Status === 'transcribing' || rec.Status === 'analyzing';
          // Count completed transcription docs for this recording
          var recDocCount = (state.documents || []).filter(function(d) {
            var ct = (d.creator_type || d.Creator_Type || '').toLowerCase();
            if (ct.indexOf('meeting_summary') < 0) return false;
            try { var sd = d.source_data_json || d.Source_Data_JSON || ''; var p = typeof sd === 'string' ? JSON.parse(sd) : sd; return p && p.transcription_id === rec.id; } catch (e) { return false; }
          }).length;

          html += '<div class="cc-rec-card" data-rec-id="' + escapeAttr(rec.id) + '" style="margin-bottom:0.75rem;">';

          // ── Accordion Header (always visible, clickable) ──
          html += '<div class="cc-rec-accordion-header" data-rec-idx="' + idx + '" style="display:flex;align-items:center;gap:8px;padding:10px 0;cursor:pointer;user-select:none;">';
          html += '<span class="cc-rec-chevron" id="cc-rec-chevron-' + idx + '" style="font-size:12px;color:#6B7280;transition:transform 0.2s;transform:rotate(0deg);">&#9654;</span>';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
          html += '<span style="font-weight:600;font-size:0.9rem;color:#1F2937;">' + escapeHtml(recTitle) + '</span>';
          html += '<span class="cc-badge cc-badge-' + (source === 'ZOOM' ? 'blue' : 'purple') + '" style="font-size:.65rem;">' + escapeHtml(source) + '</span>';
          html += '<span class="cc-badge cc-badge-' + statusCls + '" style="font-size:.65rem;">' + escapeHtml(rec.Status || 'pending') + '</span>';
          if (rec.AI_Client_Intent) html += '<span class="cc-badge cc-badge-' + intentCls + '" style="font-size:.65rem;">' + escapeHtml(rec.AI_Client_Intent) + '</span>';
          if (recDocCount > 0) html += '<span class="cc-badge" style="font-size:.65rem;background:#EDE9FE;color:#7C3AED;">' + recDocCount + ' doc' + (recDocCount > 1 ? 's' : '') + '</span>';
          html += '</div>';
          html += '<div style="font-size:0.75rem;color:#9CA3AF;margin-top:2px;">' + escapeHtml(date) + (duration ? ' &middot; ' + duration : '') + '</div>';
          html += '</div>';
          if (isProcessing) {
            html += '<span style="display:inline-block;width:14px;height:14px;border:2px solid #D97706;border-top-color:transparent;border-radius:50%;animation:cc-spin 1s linear infinite;flex-shrink:0;"></span>';
          }
          html += '</div>';

          // ── Accordion Body (collapsed by default) ──
          html += '<div class="cc-rec-accordion-body" id="cc-rec-body-' + idx + '" style="display:none;padding:0 0 8px 20px;border-top:1px solid #F3F4F6;">';

          // Processing status
          if (isProcessing) {
            var statusMsg = rec.Status === 'pending' ? 'Waiting to start...' : rec.Status === 'transcribing' ? 'Transcribing audio (est. 5-15 min)...' : 'AI analysis in progress (est. 2-5 min)...';
            html += '<div style="padding:8px 0;font-size:0.85rem;color:#D97706;display:flex;align-items:center;gap:6px;">';
            html += '<span style="display:inline-block;width:12px;height:12px;border:2px solid #D97706;border-top-color:transparent;border-radius:50%;animation:cc-spin 1s linear infinite;"></span>';
            html += escapeHtml(statusMsg);
            html += '</div>';
          }

          // File name (if different from title)
          var fileName = rec.File_Name || '';
          if (fileName && fileName !== recTitle) {
            html += '<div style="font-size:0.8rem;color:#6B7280;padding:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + escapeAttr(fileName) + '">' + escapeHtml(fileName) + '</div>';
          }

          // AI Summary
          if (rec.AI_Summary) {
            html += '<div class="cc-rec-summary" style="margin-top:8px;">' + escapeHtml(rec.AI_Summary) + '</div>';
          }

          // Action Items
          var actionItems = recParseJson(rec.AI_Action_Items);
          if (actionItems && actionItems.length > 0) {
            html += '<details style="margin:.5rem 0;">';
            html += '<summary style="font-size:.85rem;font-weight:600;color:#374151;cursor:pointer;">Action Items (' + actionItems.length + ')</summary>';
            html += '<ul class="cc-rec-items">';
            actionItems.forEach(function(item) {
              var text = typeof item === 'string' ? item : (item.description || item.text || JSON.stringify(item));
              html += '<li>' + escapeHtml(text) + '</li>';
            });
            html += '</ul></details>';
          }

          // Transcript toggle
          if (rec.Status === 'completed') {
            html += '<div class="cc-transcript-panel" id="cc-transcript-panel-' + idx + '">';
            html += '<button class="cc-transcript-toggle" data-rec-idx="' + idx + '" data-rec-id="' + escapeAttr(rec.id) + '">';
            html += '<span style="transition:transform .15s;" id="cc-transcript-arrow-' + idx + '">&#9654;</span> View Transcript</button>';
            html += '<div class="cc-transcript-body" id="cc-transcript-body-' + idx + '" style="display:none;"></div>';
            html += '</div>';
          }

          // Actions row
          html += '<div class="cc-rec-actions">';
          if (rec.Status === 'completed') {
            html += '<button class="cc-btn cc-btn-sm" onclick="window.open(\'' + escapeAttr(rec.Blob_Transcript_URL || '#') + '\')">Download Transcript</button>';
            html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-rec-summary-btn" data-rec-id="' + escapeAttr(rec.id) + '" style="background:#7C3AED;border-color:#7C3AED;">Generate Summary</button>';
          }
          if (rec.Status === 'error') {
            html += '<button class="cc-btn cc-btn-sm cc-btn-warning cc-rec-retry-btn" data-rec-id="' + escapeAttr(rec.id) + '">Retry Processing</button>';
          }
          if (rec.Reviewed_By) {
            html += '<span class="cc-rec-card-meta">Reviewed by ' + escapeHtml(rec.Reviewed_By_Name || rec.Reviewed_By) + '</span>';
          }
          html += '<button class="cc-btn cc-btn-sm cc-rec-delete-btn" data-rec-id="' + escapeAttr(rec.id) + '" data-rec-name="' + escapeAttr(rec.Subject || rec.Meeting_Subject || 'this recording') + '" style="color:#DC2626;border:1px solid #FCA5A5;background:white;margin-left:auto;" title="Delete recording">Delete</button>';
          html += '</div>';

          // Completed Transcription Documents (matched from state.documents)
          var recDocs = (state.documents || []).filter(function(d) {
            var ct = (d.creator_type || d.Creator_Type || '').toLowerCase();
            if (ct.indexOf('meeting_summary') < 0) return false;
            try {
              var sd = d.source_data_json || d.Source_Data_JSON || '';
              var parsed = typeof sd === 'string' ? JSON.parse(sd) : sd;
              return parsed && parsed.transcription_id === rec.id;
            } catch (e) { return false; }
          });
          if (recDocs.length > 0) {
            html += '<div style="margin-top:8px;border:1px solid #E5E7EB;border-radius:8px;background:#FAFAFA;">';
            html += '<div style="padding:8px 12px;font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #E5E7EB;">Completed Transcriptions (' + recDocs.length + ')</div>';
            recDocs.forEach(function(doc) {
              var creatorType = (doc.creator_type || doc.Creator_Type || '').toLowerCase();
              var docLabel = creatorType.indexOf('client') >= 0 ? 'Client Copy of Summary' : 'Internal Summary';
              var docIcon = creatorType.indexOf('client') >= 0 ? '&#128196;' : '&#128203;';
              var labelColor = creatorType.indexOf('client') >= 0 ? 'color:#059669;background:#ECFDF5;border:1px solid #A7F3D0' : 'color:#7C3AED;background:#EDE9FE;border:1px solid #C4B5FD';
              var docId = doc.id || doc.record_id || '';
              var docName = doc.document_name || doc.Document_Name || docLabel;
              var statusVal = (doc.status || doc.Status || 'draft').toLowerCase();
              var hasHtml = !!(doc.document_html || doc.Document_HTML);
              var genDate = (doc.generated_at || doc.Generated_At) ? API.util.formatDate(doc.generated_at || doc.Generated_At) : '';

              html += '<div style="padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #F3F4F6;">';
              html += '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">';
              html += '<span style="font-size:14px;">' + docIcon + '</span>';
              html += '<span class="cc-badge" style="' + labelColor + ';font-size:11px;padding:2px 8px;border-radius:4px;">' + escapeHtml(docLabel) + '</span>';
              html += '<span class="cc-badge cc-badge-' + (statusVal === 'final' ? 'green' : 'yellow') + '" style="font-size:10px;">' + escapeHtml(statusVal === 'final' ? 'Final' : 'Draft') + '</span>';
              if (genDate) html += '<span style="font-size:11px;color:#9CA3AF;">' + escapeHtml(genDate) + '</span>';
              html += '</div>';
              html += '<div style="display:flex;gap:6px;flex-shrink:0;">';
              if (hasHtml) {
                html += '<button class="cc-btn cc-btn-sm cc-doc-view-btn" data-doc-id="' + escapeAttr(docId) + '" style="font-size:11px;padding:3px 8px;">View</button>';
                html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-doc-download-btn" data-doc-id="' + escapeAttr(docId) + '" data-doc-name="' + escapeAttr(docName) + '" style="font-size:11px;padding:3px 8px;">Download</button>';
              }
              html += '</div>';
              html += '</div>';
            });
            html += '</div>';
          }

          html += '</div>'; // end accordion body
          html += '</div>'; // end card
        });

        html += '</div>'; // close Meeting Recordings section
      }
    }

    container.innerHTML = html;
    bindRecordingActions();
  }

  function bindRecordingActions() {
    // Accordion toggle for recording cards
    document.querySelectorAll('.cc-rec-accordion-header').forEach(function(header) {
      header.addEventListener('click', function(e) {
        // Don't toggle if clicking a badge or button inside the header
        if (e.target.closest('button') || e.target.closest('a')) return;
        var idx = header.dataset.recIdx;
        var body = document.getElementById('cc-rec-body-' + idx);
        var chevron = document.getElementById('cc-rec-chevron-' + idx);
        if (!body) return;
        var isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
      });
    });

    // Upload button toggle
    var uploadBtn = document.getElementById('cc-rec-upload-btn');
    var uploadForm = document.getElementById('cc-rec-upload-form');
    if (uploadBtn && uploadForm) {
      uploadBtn.addEventListener('click', function() {
        uploadForm.style.display = uploadForm.style.display === 'none' ? '' : 'none';
      });
    }

    // Upload cancel
    var cancelBtn = document.getElementById('cc-rec-upload-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        if (uploadForm) uploadForm.style.display = 'none';
      });
    }

    // Upload submit
    var submitBtn = document.getElementById('cc-rec-upload-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', handleRecordingUpload);
    }

    // Refresh button
    var refreshBtn = document.getElementById('cc-rec-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        await reloadContactRecordings();
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '&#8635; Refresh';
      });
    }

    // Transcript toggles
    document.querySelectorAll('.cc-transcript-toggle').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = btn.dataset.recIdx;
        var recId = btn.dataset.recId;
        var body = document.getElementById('cc-transcript-body-' + idx);
        var arrow = document.getElementById('cc-transcript-arrow-' + idx);
        if (!body) return;

        if (body.style.display === 'none') {
          body.style.display = '';
          if (arrow) arrow.style.transform = 'rotate(90deg)';
          if (!body.dataset.loaded) {
            body.innerHTML = '<div style="color:#6B7280;padding:.5rem;">Loading transcript...</div>';
            loadContactTranscript(recId, body);
          }
        } else {
          body.style.display = 'none';
          if (arrow) arrow.style.transform = '';
        }
      });
    });

    // Approve review buttons
    document.querySelectorAll('.cc-rec-approve-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          var res = await API.recordings.approveReview(btn.dataset.recId);
          if (res.success) reloadContactRecordings();
          else ccToast('Failed: ' + (res.error || 'Unknown error'), 'error');
        } catch (err) {
          ccToast('Failed: ' + (err.error || 'Network error'), 'error');
        }
        btn.disabled = false;
      });
    });

    // Retry buttons
    document.querySelectorAll('.cc-rec-retry-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        btn.disabled = true;
        btn.textContent = 'Retrying...';
        try {
          var res = await API.recordings.retryProcessing(btn.dataset.recId);
          if (res.success) reloadContactRecordings();
          else ccToast('Failed: ' + (res.error || 'Unknown error'), 'error');
        } catch (err) {
          ccToast('Failed: ' + (err.error || 'Network error'), 'error');
        }
        btn.disabled = false;
      });
    });

    // Generate Summary buttons
    document.querySelectorAll('.cc-rec-summary-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var recId = btn.dataset.recId;
        btn.disabled = true;
        btn.textContent = 'Generating...';
        btn.style.opacity = '0.7';
        try {
          var res = await API.recordings.generateSummary(recId);
          if (res.success) {
            ccToast('Meeting summaries generated successfully!', 'success');
            if (res.internal_html) {
              openDocViewerModal(res.internal_html);
            }
            reloadContactRecordings();
            // Refresh documents list
            API.documents.list(contactId).then(function(r) {
              state.documents = ((r.data || []).filter(function(d) { return d.status !== 'archived'; }));
              if (state.activeTab === 'documents') renderDocuments($el('cc-contact-tab-content'));
            }).catch(function() {});
          } else {
            ccToast('Generation failed: ' + (res.error || 'Unknown error'), 'error');
          }
        } catch (err) {
          ccToast('Generation failed: ' + (err.error || err.message || 'Network error'), 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Generate Summary';
        btn.style.opacity = '';
      });
    });

    // View Summary document buttons — fetch from documents API
    document.querySelectorAll('.cc-summary-view-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.preventDefault();
        var recId = btn.dataset.recId;
        var docType = btn.dataset.docType;
        var rec = state.recordings.find(function(r) { return r.id === recId; });
        var sourceData = recParseJson(rec && rec.Source_Data_JSON);
        var docId = docType === 'internal'
          ? (rec && rec.Summary_Internal_Doc_ID) || (sourceData && sourceData.internal_doc_id)
          : (rec && rec.Summary_Client_Doc_ID) || (sourceData && sourceData.client_doc_id);

        btn.textContent = 'Loading...';
        try {
          if (docId) {
            var res = await API.documents.get(docId);
            var docHtml = '';
            if (res.data) {
              docHtml = res.data.document_html || res.data.Document_HTML || '';
            } else if (res.document_html || res.Document_HTML) {
              docHtml = res.document_html || res.Document_HTML;
            }
            if (docHtml) {
              openDocViewerModal(docHtml);
            } else {
              ccToast('No ' + docType + ' summary content found.', 'info');
            }
          } else {
            // Fallback: re-generate
            var res = await API.recordings.generateSummary(recId);
            if (res.success) {
              var html = docType === 'internal' ? res.internal_html : res.client_html;
              if (html) {
                openDocViewerModal(html);
              } else {
                ccToast('No ' + docType + ' summary available.', 'info');
              }
              reloadContactRecordings();
            } else {
              ccToast('Failed to load summary: ' + (res.error || 'Unknown error'), 'error');
            }
          }
        } catch (err) {
          ccToast('Failed: ' + (err.error || err.message || 'Network error'), 'error');
        }
        btn.textContent = docType === 'internal' ? 'Internal Summary' : 'Client Summary';
      });
    });

    // Doc view/download buttons on recording cards (completed transcription docs)
    document.querySelectorAll('.cc-rec-card .cc-doc-view-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = btn.dataset.docId;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          var res = await API.documents.get(docId);
          var docHtml = (res.data && (res.data.document_html || res.data.Document_HTML)) || res.document_html || res.Document_HTML || '';
          if (docHtml) openDocViewerModal(docHtml);
          else ccToast('No content available.', 'info');
        } catch (err) { ccToast('Failed to load document.', 'error'); }
        btn.disabled = false;
        btn.textContent = 'View';
      });
    });
    document.querySelectorAll('.cc-rec-card .cc-doc-download-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = btn.dataset.docId;
        var docName = btn.dataset.docName || 'document';
        btn.disabled = true;
        btn.textContent = '...';
        try {
          var res = await API.documents.get(docId);
          var docHtml = (res.data && (res.data.document_html || res.data.Document_HTML)) || res.document_html || res.Document_HTML || '';
          if (docHtml) contactDownloadHtmlFile(docHtml, docName.replace(/[^a-zA-Z0-9_\- ]/g, '') + '.html');
          else ccToast('No content available for download.', 'info');
        } catch (err) { ccToast('Failed to download.', 'error'); }
        btn.disabled = false;
        btn.textContent = 'Download';
      });
    });

    // Delete buttons
    document.querySelectorAll('.cc-rec-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var recName = btn.dataset.recName || 'this recording';
        if (!confirm('Delete "' + recName + '"? This cannot be undone.')) return;
        btn.disabled = true;
        btn.textContent = 'Deleting...';
        try {
          var res = await API.recordings.delete(btn.dataset.recId);
          if (res.success) {
            ccToast('Recording deleted.', 'success');
            reloadContactRecordings();
          } else {
            ccToast('Failed: ' + (res.error || 'Unknown error'), 'error');
            btn.disabled = false;
            btn.textContent = 'Delete';
          }
        } catch (err) {
          ccToast('Failed: ' + (err.error || 'Network error'), 'error');
          btn.disabled = false;
          btn.textContent = 'Delete';
        }
      });
    });
  }

  async function loadContactTranscript(recId, bodyEl) {
    try {
      var res = await API.recordings.get(recId);
      if (res.success && res.recording) {
        var transcript = res.recording.Transcript_Text || '';
        if (!transcript && res.recording.Blob_Transcript_URL) {
          bodyEl.innerHTML = '<div style="color:#6B7280;">Transcript available for download. <a href="' +
            escapeAttr(res.recording.Blob_Transcript_URL) + '" target="_blank">Open transcript file</a></div>';
        } else if (transcript) {
          bodyEl.innerHTML = escapeHtml(transcript).replace(/^(Speaker \d+):/gm, '<span style="font-weight:600;color:#2563EB;">$1:</span>');
        } else {
          bodyEl.innerHTML = '<div style="color:#9CA3AF;">No transcript text available.</div>';
        }
      } else {
        bodyEl.innerHTML = '<div style="color:#EF4444;">Failed to load transcript.</div>';
      }
    } catch (err) {
      bodyEl.innerHTML = '<div style="color:#EF4444;">Error loading transcript.</div>';
    }
    bodyEl.dataset.loaded = 'true';
  }

  async function handleRecordingUpload() {
    var fileInput = document.getElementById('cc-rec-file-input');
    var subjectInput = document.getElementById('cc-rec-upload-subject');
    var sourceSelect = document.getElementById('cc-rec-upload-source');
    var progressDiv = document.getElementById('cc-rec-upload-progress');
    var submitBtn = document.getElementById('cc-rec-upload-submit');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      ccToast('Please select a file to upload.', 'info');
      return;
    }

    var file = fileInput.files[0];
    // Limit to 500MB for hour-long meeting recordings
    if (file.size > 500 * 1024 * 1024) {
      ccToast('File is too large. Maximum size is 500MB.', 'error');
      return;
    }

    submitBtn.disabled = true;
    var fileSizeMB = Math.round(file.size / 1024 / 1024);
    var uploadId = 'pu-' + Date.now();
    var subject = (subjectInput ? subjectInput.value : '') || file.name;

    // Hide upload form and inject a progress card directly (don't re-render entire tab)
    var uploadForm = document.getElementById('cc-rec-upload-form');
    if (uploadForm) uploadForm.style.display = 'none';

    // Insert progress card right after the upload form
    var progressCard = document.createElement('div');
    progressCard.id = 'cc-upload-card-' + uploadId;
    progressCard.className = 'cc-rec-card';
    progressCard.style.cssText = 'margin-bottom:0.75rem;border-left:4px solid #3B82F6;';
    progressCard.innerHTML =
      '<div class="cc-rec-card-header">' +
        '<span class="cc-badge cc-badge-blue" style="font-size:.7rem;">UPLOADING</span>' +
        '<span style="font-size:0.9rem;font-weight:600;margin-left:8px;">' + escapeHtml(subject) + '</span>' +
        '<span class="cc-rec-card-meta" style="margin-left:auto;">' + escapeHtml(fileSizeMB + ' MB') + '</span>' +
      '</div>' +
      '<div style="padding:8px 0;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
          '<span id="cc-pu-status-' + uploadId + '" style="font-size:13px;color:#1D4ED8;font-weight:500;">Creating record...</span>' +
          '<span id="cc-pu-pct-' + uploadId + '" style="font-size:13px;color:#1D4ED8;font-weight:600;">0%</span>' +
        '</div>' +
        '<div style="background:#BFDBFE;border-radius:4px;height:8px;overflow:hidden;">' +
          '<div id="cc-pu-bar-' + uploadId + '" style="background:#2563EB;height:100%;width:0%;transition:width 0.3s ease;border-radius:4px;"></div>' +
        '</div>' +
        '<div id="cc-pu-eta-' + uploadId + '" style="font-size:11px;color:#6B7280;margin-top:4px;"></div>' +
        '<div id="cc-pu-debug-' + uploadId + '" style="font-size:11px;color:#9CA3AF;margin-top:4px;font-family:monospace;"></div>' +
      '</div>';
    var insertTarget = uploadForm ? uploadForm.parentNode : $el('cc-contact-tab-content');
    if (uploadForm && uploadForm.nextSibling) {
      insertTarget.insertBefore(progressCard, uploadForm.nextSibling);
    } else if (insertTarget) {
      insertTarget.appendChild(progressCard);
    }

    function updateUploadCard(pct, status, eta, debug) {
      var bar = document.getElementById('cc-pu-bar-' + uploadId);
      var pctEl = document.getElementById('cc-pu-pct-' + uploadId);
      var statusEl = document.getElementById('cc-pu-status-' + uploadId);
      var etaEl = document.getElementById('cc-pu-eta-' + uploadId);
      var debugEl = document.getElementById('cc-pu-debug-' + uploadId);
      if (bar) bar.style.width = Math.round(pct) + '%';
      if (pctEl) pctEl.textContent = Math.round(pct) + '%';
      if (statusEl) statusEl.textContent = status;
      if (etaEl) etaEl.textContent = eta || '';
      if (debugEl && debug) debugEl.textContent = debug;
      console.log('[Upload] ' + Math.round(pct) + '% — ' + status + (debug ? ' | ' + debug : ''));
    }

    var uploadStartTime = Date.now();
    try {
      var result = await API.recordings.uploadFile({
        lead_id: contactId,
        file: file,
        file_name: file.name,
        file_type: file.type,
        subject: subject,
        source: sourceSelect ? sourceSelect.value : 'upload',
        onProgress: function(pct) {
          var mins = '';
          if (pct > 5 && pct < 95) {
            var elapsed = (Date.now() - uploadStartTime) / 1000;
            var totalEst = elapsed / (pct / 100);
            var remaining = Math.max(0, Math.round(totalEst - elapsed));
            if (remaining > 60) mins = Math.round(remaining / 60) + ' min remaining';
            else if (remaining > 5) mins = remaining + ' sec remaining';
            else mins = 'Almost done...';
          }
          updateUploadCard(pct, 'Uploading (' + fileSizeMB + ' MB)...', mins, 'Step 2/3: Blob upload ' + Math.round(pct) + '%');
        }
      });

      if (result.success) {
        var debugMsg = 'transcription_id=' + (result.transcription_id || '?') + ' status=' + (result.status || '?');
        if (result.speech_job_id) debugMsg += ' job=' + result.speech_job_id;
        updateUploadCard(100, 'Upload complete — transcription in progress...', 'This may take a few minutes. Refresh to check status.', 'Step 3/3 done. ' + debugMsg);
        requestNotificationPermission();
        // Reset form
        fileInput.value = '';
        if (subjectInput) subjectInput.value = '';
        // Auto-refresh recordings after a short delay
        setTimeout(function() {
          var card = document.getElementById('cc-upload-card-' + uploadId);
          if (card) card.remove();
          reloadContactRecordings();
          startRecRefreshWithNotify();
        }, 4000);
      } else {
        updateUploadCard(0, 'Upload failed: ' + (result.error || 'Unknown error'), '', 'Error: ' + JSON.stringify(result).substring(0, 200));
        ccToast('Upload failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      updateUploadCard(0, 'Upload failed: ' + (err.message || err.error || 'Network error'), '', 'Exception: ' + (err.message || err.error || ''));
      ccToast('Upload failed: ' + (err.message || err.error || 'Network error'), 'error');
    }

    submitBtn.disabled = false;
    if (progressDiv) progressDiv.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 4: CONVERSION
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

  // ═══════════════════════════════════════════════════════════
  // TAB 4: DOCUMENTS
  // ═══════════════════════════════════════════════════════════

  var WILL_SCHEMA_SECTIONS = [
    { key: 'testator', label: 'Testator Information', fields: [
      { id: 'testator.full_legal_name', label: 'Full Legal Name', type: 'text', required: true },
      { id: 'testator.date_of_birth', label: 'Date of Birth', type: 'date' },
      { id: 'testator.address.street', label: 'Street Address', type: 'text' },
      { id: 'testator.address.city', label: 'City', type: 'text' },
      { id: 'testator.address.province', label: 'Province', type: 'text', default: 'Ontario' },
      { id: 'testator.address.postal_code', label: 'Postal Code', type: 'text' },
      { id: 'testator.marital_status', label: 'Marital Status', type: 'select', options: ['single','married','common_law','divorced','widowed','separated'] },
      { id: 'testator.occupation', label: 'Occupation', type: 'text' }
    ]},
    { key: 'spouse', label: 'Spouse / Partner', fields: [
      { id: 'spouse.name', label: 'Spouse Name', type: 'text' },
      { id: 'spouse.relationship', label: 'Relationship', type: 'select', options: ['spouse','common_law'] }
    ]},
    { key: 'executor', label: 'Executor & Guardian', fields: [
      { id: 'executor.name', label: 'Executor Name', type: 'text', required: true },
      { id: 'executor.relationship', label: 'Relationship', type: 'text' },
      { id: 'executor.address', label: 'Executor Address', type: 'text' },
      { id: 'executor.alternate_executor.name', label: 'Alternate Executor', type: 'text' },
      { id: 'executor.alternate_executor.relationship', label: 'Alt. Executor Relationship', type: 'text' },
      { id: 'guardian.name', label: 'Guardian (for minors)', type: 'text' },
      { id: 'guardian.relationship', label: 'Guardian Relationship', type: 'text' },
      { id: 'guardian.alternate_guardian.name', label: 'Alternate Guardian', type: 'text' },
      { id: 'guardian.alternate_guardian.relationship', label: 'Alt. Guardian Relationship', type: 'text' }
    ]},
    { key: 'residual', label: 'Residual Estate & Trusts', fields: [
      { id: 'residual_estate.distribution', label: 'Residual Estate Distribution', type: 'textarea' },
      { id: 'special_instructions', label: 'Special Instructions', type: 'textarea' }
    ]},
    { key: 'poa', label: 'Powers of Attorney', fields: [
      { id: 'poa_property.attorney', label: 'POA Property - Attorney', type: 'text' },
      { id: 'poa_property.alternate_attorney', label: 'POA Property - Alternate', type: 'text' },
      { id: 'poa_property.conditions', label: 'POA Property - Conditions', type: 'textarea' },
      { id: 'poa_personal_care.attorney', label: 'POA Personal Care - Attorney', type: 'text' },
      { id: 'poa_personal_care.alternate_attorney', label: 'POA Personal Care - Alternate', type: 'text' },
      { id: 'poa_personal_care.conditions', label: 'POA Personal Care - Conditions', type: 'textarea' }
    ]},
    { key: 'funeral', label: 'Funeral Wishes', fields: [
      { id: 'funeral_wishes.preference', label: 'Preference', type: 'select', options: ['burial','cremation','other'] },
      { id: 'funeral_wishes.details', label: 'Details', type: 'textarea' }
    ]}
  ];

  // Array field sections (children, beneficiaries, assets, specific_bequests) rendered dynamically
  var WILL_ARRAY_SECTIONS = [
    { key: 'children', label: 'Children', itemFields: [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'date_of_birth', label: 'Date of Birth', type: 'date' },
      { id: 'relationship', label: 'Relationship', type: 'select', options: ['child','stepchild','adopted'] },
      { id: 'is_minor', label: 'Minor?', type: 'checkbox' }
    ]},
    { key: 'beneficiaries', label: 'Beneficiaries', itemFields: [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'relationship', label: 'Relationship', type: 'text' },
      { id: 'bequest_type', label: 'Bequest Type', type: 'select', options: ['specific','residual','percentage'] },
      { id: 'description', label: 'Description', type: 'text' },
      { id: 'percentage', label: 'Percentage', type: 'number' }
    ]},
    { key: 'assets', label: 'Assets', itemFields: [
      { id: 'type', label: 'Type', type: 'select', options: ['real_property','bank_account','investment','insurance','vehicle','personal_property','business'] },
      { id: 'description', label: 'Description', type: 'text' },
      { id: 'approximate_value', label: 'Value', type: 'text' },
      { id: 'location', label: 'Location', type: 'text' }
    ]},
    { key: 'specific_bequests', label: 'Specific Bequests', itemFields: [
      { id: 'item', label: 'Item', type: 'text' },
      { id: 'beneficiary', label: 'Beneficiary', type: 'text' },
      { id: 'conditions', label: 'Conditions', type: 'text' }
    ]}
  ];

  function getNestedValue(obj, path) {
    return path.split('.').reduce(function(o, k) { return (o && o[k] !== undefined) ? o[k] : ''; }, obj);
  }

  function setNestedValue(obj, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function(o, k) {
      if (!o[k] || typeof o[k] !== 'object') o[k] = {};
      return o[k];
    }, obj);
    target[last] = value;
  }

  function renderDocuments(container) {
    // Filter out transcription summaries — those are shown on the Recordings tab
    var docs = (state.documents || []).filter(function(d) {
      var ct = (d.creator_type || d.Creator_Type || '').toLowerCase();
      return ct.indexOf('meeting_summary') < 0;
    });
    var html = '';

    // Header
    html += '<div class="cc-section">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h3 class="cc-section-title" style="margin:0;">Finished Documents</h3>';
    if (state.documentCreators.length > 0) {
      html += '<button id="cc-generate-doc-btn" class="cc-btn cc-btn-primary" style="font-size:13px;padding:6px 14px;">+ Generate Finished Documents</button>';
    }
    html += '</div>';

    if (docs.length === 0) {
      html += '<div style="text-align:center;padding:32px 16px;color:#888;">';
      html += '<p style="font-size:14px;">No finished documents generated yet.</p>';
      if (state.documentCreators.length > 0) {
        html += '<p style="font-size:13px;">Click "Generate Finished Documents" to create a will or other legal document.</p>';
      }
      html += '</div>';
    } else {
      // Group documents by transcription_id
      var groups = {};
      var ungrouped = [];
      docs.forEach(function(doc) {
        var transcriptionId = null;
        try {
          var sourceJson = doc.source_data_json || doc.Source_Data_JSON || '';
          if (sourceJson && typeof sourceJson === 'string') {
            var parsed = JSON.parse(sourceJson);
            transcriptionId = parsed.transcription_id || null;
          } else if (sourceJson && typeof sourceJson === 'object') {
            transcriptionId = sourceJson.transcription_id || null;
          }
        } catch (e) { /* ignore parse errors */ }

        if (transcriptionId) {
          if (!groups[transcriptionId]) {
            groups[transcriptionId] = { docs: [], transcriptionId: transcriptionId };
          }
          groups[transcriptionId].docs.push(doc);
        } else {
          ungrouped.push(doc);
        }
      });

      // Render grouped documents
      var groupKeys = Object.keys(groups);
      groupKeys.forEach(function(key) {
        var group = groups[key];
        var groupDocs = group.docs;
        // Derive meeting name from document names (strip "Internal Summary — " or "Client Summary — " prefix)
        var meetingName = '';
        for (var gi = 0; gi < groupDocs.length; gi++) {
          var dn = groupDocs[gi].document_name || groupDocs[gi].Document_Name || '';
          var stripped = dn.replace(/^(Internal Summary|Client Summary)\s*[-—]\s*/i, '').trim();
          if (stripped) { meetingName = stripped; break; }
        }
        if (!meetingName) meetingName = 'Recording';
        var groupDate = '';
        for (var gj = 0; gj < groupDocs.length; gj++) {
          var gd = groupDocs[gj].generated_at || groupDocs[gj].Generated_At;
          if (gd) { groupDate = API.util.formatDate(gd); break; }
        }

        html += '<div class="cc-card" style="padding:16px;margin-bottom:12px;">';
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += '<span style="font-size:16px;">&#128249;</span>';
        html += '<div style="flex:1;">';
        html += '<div style="font-weight:700;font-size:15px;color:#1F2937;">' + escapeHtml(meetingName) + '</div>';
        if (groupDate) html += '<div style="font-size:12px;color:#6B7280;margin-top:2px;">Generated: ' + escapeHtml(groupDate) + '</div>';
        html += '</div>';
        html += '<span class="cc-badge cc-badge-blue" style="font-size:10px;">Transcription</span>';
        html += '</div>';
        html += '</div>';
        groupDocs.forEach(function(doc) {
          var creatorType = doc.creator_type || doc.Creator_Type || doc.document_type || '';
          var creatorLabel = contactDocCreatorLabel(creatorType);
          var docId = doc.id || doc.record_id || '';
          var docName = doc.document_name || doc.Document_Name || 'Untitled Document';
          var hasHtml = !!(doc.document_html || doc.Document_HTML);
          var statusVal = (doc.status || doc.Status || 'draft').toLowerCase();
          var statusBadge = statusVal === 'final'
            ? '<span class="cc-badge cc-badge-green" style="font-size:11px;">Final</span>'
            : '<span class="cc-badge cc-badge-yellow" style="font-size:11px;">Draft</span>';

          html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid #F3F4F6;">';
          html += '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">';
          html += '<span style="font-size:13px;">&#128196; ' + escapeHtml(creatorLabel) + '</span> ' + statusBadge;
          html += '</div>';
          html += '<div style="display:flex;gap:8px;flex-shrink:0;">';
          if (hasHtml) {
            html += '<button class="cc-btn cc-btn-sm cc-doc-view-btn" data-doc-id="' + escapeAttr(docId) + '" style="font-size:12px;">View</button>';
            html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-doc-download-btn" data-doc-id="' + escapeAttr(docId) + '" data-doc-name="' + escapeAttr(docName) + '" style="font-size:12px;">Download</button>';
          }
          if (doc.file_data && doc.file_data.length > 0) {
            html += '<a href="' + escapeAttr(doc.file_data[0].url) + '" target="_blank" class="cc-btn cc-btn-sm" style="font-size:12px;">Download File</a>';
          }
          if (doc.clio_document_id) {
            html += '<button class="cc-btn cc-btn-sm cc-btn-outline" style="font-size:12px;" disabled>In Clio</button>';
          }
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';
      });

      // Render ungrouped documents individually
      ungrouped.forEach(function(doc) {
        var creatorType = doc.creator_type || doc.Creator_Type || doc.document_type || '';
        var creatorLabel = contactDocCreatorLabel(creatorType);
        var creatorColor = contactDocCreatorColor(creatorType);
        var typeBadge = '<span class="cc-badge cc-badge-' + creatorColor + '" style="font-size:11px;">' + escapeHtml(creatorLabel) + '</span>';
        var statusVal = (doc.status || doc.Status || 'draft').toLowerCase();
        var statusBadge = statusVal === 'final'
          ? '<span class="cc-badge cc-badge-green" style="font-size:11px;">Final</span>'
          : '<span class="cc-badge cc-badge-yellow" style="font-size:11px;">Draft</span>';
        var date = (doc.generated_at || doc.Generated_At) ? API.util.formatDate(doc.generated_at || doc.Generated_At) : '';
        var docName = doc.document_name || doc.Document_Name || 'Untitled Document';
        var docId = doc.id || doc.record_id || '';
        var hasHtml = !!(doc.document_html || doc.Document_HTML);

        html += '<div class="cc-card" style="padding:12px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:600;font-size:14px;">' + escapeHtml(docName) + '</div>';
        html += '<div style="margin-top:4px;">' + typeBadge + ' ' + statusBadge + ' <span style="color:#888;font-size:12px;margin-left:8px;">' + escapeHtml(date) + '</span></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;flex-shrink:0;">';
        if (hasHtml) {
          html += '<button class="cc-btn cc-btn-sm cc-doc-view-btn" data-doc-id="' + escapeAttr(docId) + '" style="font-size:12px;">View</button>';
          html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-doc-download-btn" data-doc-id="' + escapeAttr(docId) + '" data-doc-name="' + escapeAttr(docName) + '" style="font-size:12px;">Download</button>';
        }
        if (doc.file_data && doc.file_data.length > 0) {
          html += '<a href="' + escapeAttr(doc.file_data[0].url) + '" target="_blank" class="cc-btn cc-btn-sm" style="font-size:12px;">Download File</a>';
        }
        if (doc.clio_document_id) {
          html += '<button class="cc-btn cc-btn-sm cc-btn-outline" style="font-size:12px;" disabled>In Clio</button>';
        }
        html += '</div>';
        html += '</div>';
      });
    }
    html += '</div>';

    container.innerHTML = html;

    // Bind generate button
    var genBtn = document.getElementById('cc-generate-doc-btn');
    if (genBtn) {
      genBtn.addEventListener('click', function() {
        openDocumentCreatorModal();
      });
    }

    // Bind view buttons
    document.querySelectorAll('.cc-doc-view-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = btn.dataset.docId;
        btn.disabled = true;
        btn.textContent = 'Loading...';
        try {
          var res = await API.documents.get(docId);
          var docHtml = '';
          if (res.data) {
            docHtml = res.data.document_html || res.data.Document_HTML || '';
          } else if (res.document_html || res.Document_HTML) {
            docHtml = res.document_html || res.Document_HTML;
          }
          if (docHtml) {
            openDocViewerModal(docHtml);
          } else {
            ccToast('No document content available.', 'info');
          }
        } catch (err) {
          ccToast('Failed to load document: ' + (err.error || err.message || 'Network error'), 'error');
        }
        btn.disabled = false;
        btn.textContent = 'View';
      });
    });

    // Bind download buttons
    document.querySelectorAll('.cc-doc-download-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var docId = btn.dataset.docId;
        var docName = btn.dataset.docName || 'document';
        btn.disabled = true;
        btn.textContent = 'Loading...';
        try {
          var res = await API.documents.get(docId);
          var docHtml = '';
          if (res.data) {
            docHtml = res.data.document_html || res.data.Document_HTML || '';
          } else if (res.document_html || res.Document_HTML) {
            docHtml = res.document_html || res.Document_HTML;
          }
          if (docHtml) {
            contactDownloadHtmlFile(docHtml, docName.replace(/[^a-zA-Z0-9_\- ]/g, '') + '.html');
          } else {
            ccToast('No document content available for download.', 'info');
          }
        } catch (err) {
          ccToast('Failed to load document: ' + (err.error || err.message || 'Network error'), 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Download';
      });
    });
  }

  function contactDocCreatorLabel(type) {
    var map = {
      'meeting_summary_internal': 'Internal Summary',
      'meeting_summary_client': 'Client Copy of Summary',
      'will': 'Will',
      'poa_property': 'POA Property',
      'poa_care': 'POA Personal Care'
    };
    return map[(type || '').toLowerCase()] || type || 'Document';
  }

  function contactDocCreatorColor(type) {
    var map = {
      'meeting_summary_internal': 'purple',
      'meeting_summary_client': 'green',
      'will': 'blue',
      'poa_property': 'blue',
      'poa_care': 'blue'
    };
    return map[(type || '').toLowerCase()] || 'gray';
  }

  function openDocViewerModal(htmlContent) {
    var existing = document.getElementById('cc-doc-viewer-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'cc-doc-viewer-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:12px;width:90%;max-width:900px;height:85vh;display:flex;flex-direction:column;position:relative;';

    var header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #E5E7EB;flex-shrink:0;';
    header.innerHTML = '<span style="font-weight:600;font-size:14px;">Document Viewer</span>' +
      '<button id="cc-doc-viewer-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6B7280;padding:4px 8px;">&times;</button>';

    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'flex:1;border:none;border-radius:0 0 12px 12px;';
    iframe.sandbox = 'allow-same-origin';

    modal.appendChild(header);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    iframe.contentDocument.open();
    iframe.contentDocument.write(htmlContent);
    iframe.contentDocument.close();

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });
    document.getElementById('cc-doc-viewer-close').addEventListener('click', function() {
      overlay.remove();
    });
  }

  function contactDownloadHtmlFile(htmlContent, fileName) {
    var blob = new Blob([htmlContent], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Document Creator Modal (3-Step Wizard) ─────────────────

  function openDocumentCreatorModal() {
    state.docCreatorStep = 0;
    state.docCreatorSources = { lead_profile: true, _selectedIntake: {}, _selectedRecordings: {}, _selectedActivities: true, _intakeData: [], _recordingData: [] };
    state.docCreatorFieldData = null;
    state.docCreatorSelectedType = null;

    var overlay = document.createElement('div');
    overlay.id = 'cc-doc-creator-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;';

    var modal = document.createElement('div');
    modal.id = 'cc-doc-creator-modal';
    modal.style.cssText = 'background:#fff;border-radius:12px;width:90%;max-width:800px;max-height:90vh;overflow-y:auto;padding:24px;position:relative;';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDocCreatorModal();
    });

    renderDocCreatorStep();
  }

  function closeDocCreatorModal() {
    var overlay = document.getElementById('cc-doc-creator-overlay');
    if (overlay) overlay.remove();
  }

  function renderDocCreatorStep() {
    var modal = document.getElementById('cc-doc-creator-modal');
    if (!modal) return;

    switch (state.docCreatorStep) {
      case 0: renderDocCreatorStep0(modal); break; // Document type selection
      case 1: renderDocCreatorStep1(modal); break; // Source selection
      case 2: renderDocCreatorStep2(modal); break; // Form review & edit
      case 3: renderDocCreatorStep3(modal); break; // Generation
    }
  }

  // Step 0: Document Type Selector
  function renderDocCreatorStep0(modal) {
    var creators = state.documentCreators || [];
    var html = '<h3 style="margin:0 0 4px;">Generate Finished Documents</h3>';
    html += '<p style="color:#666;font-size:13px;margin-bottom:16px;">Select the type of document to generate.</p>';

    if (creators.length === 0) {
      html += '<div style="text-align:center;padding:24px;color:#888;">';
      html += '<p>No document creators configured.</p>';
      html += '<p style="font-size:12px;">Set up document creators in Admin &rarr; Documents.</p>';
      html += '</div>';
    } else {
      // Group by practice area
      var groups = {};
      creators.forEach(function(cr) {
        var pa = cr.practice_area || cr.Practice_Area || 'Other';
        if (!groups[pa]) groups[pa] = [];
        groups[pa].push(cr);
      });

      Object.keys(groups).forEach(function(pa) {
        html += '<div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;">' + escapeHtml(pa) + '</div>';
        groups[pa].forEach(function(cr) {
          var crId = cr.id || cr.record_id || cr.creator_name || '';
          var isSelected = state.docCreatorSelectedType === crId;
          var borderColor = isSelected ? '#3B82F6' : '#E5E7EB';
          var bgColor = isSelected ? '#EFF6FF' : '#fff';

          html += '<div class="cc-dc-type-card" data-creator-id="' + escapeAttr(crId) + '" ';
          html += 'style="padding:12px 14px;border:2px solid ' + borderColor + ';border-radius:8px;margin-bottom:6px;background:' + bgColor + ';cursor:pointer;transition:all 0.15s;">';
          html += '<div style="display:flex;align-items:center;gap:10px;">';
          html += '<span style="font-size:16px;width:20px;text-align:center;color:' + (isSelected ? '#3B82F6' : '#CBD5E1') + ';">' + (isSelected ? '&#9673;' : '&#9675;') + '</span>';
          html += '<div style="flex:1;">';
          html += '<div style="font-weight:600;font-size:14px;">' + escapeHtml(cr.creator_name || cr.Creator_Name || 'Document') + '</div>';
          if (cr.description) {
            html += '<div style="font-size:12px;color:#888;margin-top:2px;">' + escapeHtml(cr.description) + '</div>';
          }
          // Show required sources as pills
          if (cr.required_sources && cr.required_sources.length) {
            html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">';
            cr.required_sources.forEach(function(src) {
              var colors = { 'Lead Profile': 'background:#dbeafe;color:#1d4ed8', 'Intake Form': 'background:#fef3c7;color:#92400e', 'Transcription': 'background:#ede9fe;color:#5b21b6' };
              html += '<span class="cc-badge" style="' + (colors[src] || 'background:#f3f4f6;color:#374151') + ';font-size:10px;">' + escapeHtml(src) + '</span>';
            });
            html += '</div>';
          }
          html += '</div></div></div>';
        });
      });
    }

    html += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #E5E7EB;">';
    html += '<button id="cc-dc-cancel" class="cc-btn cc-btn-outline" style="font-size:13px;">Cancel</button>';
    html += '<button id="cc-dc-next" class="cc-btn cc-btn-primary" style="font-size:13px;" ' + (!state.docCreatorSelectedType ? 'disabled' : '') + '>Next &rarr;</button>';
    html += '</div>';

    modal.innerHTML = html;

    // Bind type card clicks
    modal.querySelectorAll('.cc-dc-type-card').forEach(function(card) {
      card.addEventListener('click', function() {
        state.docCreatorSelectedType = card.dataset.creatorId;
        renderDocCreatorStep0(modal);
      });
    });

    document.getElementById('cc-dc-cancel').addEventListener('click', closeDocCreatorModal);
    var nextBtn = document.getElementById('cc-dc-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        if (!state.docCreatorSelectedType) return;
        state.docCreatorStep = 1;
        renderDocCreatorStep();
      });
    }
  }

  // Step 1: Source Selector — granular individual item selection
  function renderDocCreatorStep1(modal) {
    var c = state.contact;
    modal.innerHTML = '<div style="text-align:center;padding:40px;"><p>Loading available sources...</p></div>';

    // Fetch all available sources in parallel
    Promise.all([
      API.forms.listSubmissions({ lead_id: contactId }).catch(function() { return { success: false, data: [] }; }),
      API.recordings.list({ lead_id: contactId }).catch(function() { return { success: false, recordings: [] }; })
    ]).then(function(results) {
      var intakeForms = (results[0].success && results[0].data) ? results[0].data : [];
      var recordings = (results[1].success && results[1].recordings) ? results[1].recordings : [];
      // Only show completed recordings with analysis
      var analyzedRecordings = recordings.filter(function(r) {
        return r.Status === 'completed' || r.AI_Summary || r.Extracted_Data_JSON;
      });

      // Initialize selected sources if not already set
      if (!state.docCreatorSources._selectedIntake) state.docCreatorSources._selectedIntake = {};
      if (!state.docCreatorSources._selectedRecordings) state.docCreatorSources._selectedRecordings = {};
      state.docCreatorSources._intakeData = intakeForms;
      state.docCreatorSources._recordingData = analyzedRecordings;

      var html = '<h3 style="margin:0 0 4px;">Generate Finished Documents &mdash; Select Sources</h3>';
      html += '<p style="color:#666;font-size:13px;margin-bottom:16px;">Select the specific sources to include. Click a card to toggle selection.</p>';
      html += '<div style="max-height:55vh;overflow-y:auto;padding-right:4px;">';

      // ── Lead Profile (always included) ──
      html += '<div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Lead Profile</div>';
      html += '<div style="padding:10px 12px;border:2px solid #22c55e;border-radius:8px;margin-bottom:12px;background:#f0fdf4;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span style="color:#22c55e;font-size:16px;">&#10003;</span>';
      html += '<div style="flex:1;">';
      html += '<div style="font-weight:600;font-size:14px;">' + escapeHtml(c.Client_Name || 'Contact') + '</div>';
      html += '<div style="font-size:12px;color:#888;">' + escapeHtml(c.Practice_Area || '') + (c.Client_Email ? ' &middot; ' + escapeHtml(c.Client_Email) : '') + '</div>';
      html += '</div>';
      html += '<span style="font-size:11px;color:#888;">Always included</span>';
      html += '</div></div>';

      // ── Intake Forms ──
      html += '<div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Intake Forms (' + intakeForms.length + ' available)</div>';
      if (intakeForms.length === 0) {
        html += '<div style="padding:8px 12px;color:#888;font-size:13px;margin-bottom:12px;border:1px dashed #E5E7EB;border-radius:8px;">No intake forms submitted yet.</div>';
      } else {
        intakeForms.forEach(function(form, idx) {
          var formId = form.id || form.record_id || 'intake_' + idx;
          var isSelected = !!state.docCreatorSources._selectedIntake[formId];
          var formName = form.form_name || form.Form_Name || 'Intake Form';
          var submittedAt = form.submitted_at || form.Submitted_At || form.created_at || form.Created_At || '';
          var dateStr = submittedAt ? API.util.formatDate(submittedAt) : '';
          var fieldCount = 0;
          try {
            var fd = form.form_data_json || form.Form_Data_JSON;
            if (fd) { var parsed = typeof fd === 'string' ? JSON.parse(fd) : fd; fieldCount = Object.keys(parsed).length; }
          } catch (e) {}

          var borderColor = isSelected ? '#3B82F6' : '#E5E7EB';
          var bgColor = isSelected ? '#EFF6FF' : '#fff';
          html += '<div class="cc-dc-source-card" data-source-type="intake" data-source-id="' + escapeAttr(formId) + '" ';
          html += 'style="padding:10px 12px;border:2px solid ' + borderColor + ';border-radius:8px;margin-bottom:6px;background:' + bgColor + ';cursor:pointer;transition:all 0.15s;">';
          html += '<div style="display:flex;align-items:center;gap:10px;">';
          html += '<span style="font-size:16px;width:20px;text-align:center;color:' + (isSelected ? '#3B82F6' : '#CBD5E1') + ';">' + (isSelected ? '&#9745;' : '&#9744;') + '</span>';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div style="font-weight:600;font-size:13px;">' + escapeHtml(formName) + '</div>';
          html += '<div style="font-size:12px;color:#888;">';
          if (dateStr) html += escapeHtml(dateStr);
          if (fieldCount) html += ' &middot; ' + fieldCount + ' fields';
          html += '</div></div></div></div>';
        });
      }

      // ── Meeting Transcriptions ──
      html += '<div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;">Meeting Transcriptions (' + analyzedRecordings.length + ' available)</div>';
      if (analyzedRecordings.length === 0) {
        html += '<div style="padding:8px 12px;color:#888;font-size:13px;margin-bottom:12px;border:1px dashed #E5E7EB;border-radius:8px;">No analyzed transcriptions available. Upload and analyze a recording first.</div>';
      } else {
        analyzedRecordings.forEach(function(rec) {
          var recId = rec.id || rec.record_id || '';
          var isSelected = !!state.docCreatorSources._selectedRecordings[recId];
          var subject = rec.Meeting_Subject || rec.File_Name || 'Recording';
          var createdAt = rec.Created_At || '';
          var dateStr = createdAt ? API.util.formatDate(createdAt) : '';
          var duration = rec.Duration_Seconds ? Math.round(rec.Duration_Seconds / 60) + ' min' : '';
          var source = (rec.Source || '').replace('_', ' ');
          var intent = rec.AI_Client_Intent || '';
          var summary = rec.AI_Summary || '';
          // First sentence of summary
          var summaryPreview = summary.split(/\.\s+/)[0];
          if (summaryPreview && summaryPreview.length > 120) summaryPreview = summaryPreview.substring(0, 117) + '...';
          if (summaryPreview && !summaryPreview.endsWith('.')) summaryPreview += '.';

          var borderColor = isSelected ? '#3B82F6' : '#E5E7EB';
          var bgColor = isSelected ? '#EFF6FF' : '#fff';
          html += '<div class="cc-dc-source-card" data-source-type="recording" data-source-id="' + escapeAttr(recId) + '" ';
          html += 'style="padding:10px 12px;border:2px solid ' + borderColor + ';border-radius:8px;margin-bottom:6px;background:' + bgColor + ';cursor:pointer;transition:all 0.15s;">';
          html += '<div style="display:flex;align-items:flex-start;gap:10px;">';
          html += '<span style="font-size:16px;width:20px;text-align:center;margin-top:1px;color:' + (isSelected ? '#3B82F6' : '#CBD5E1') + ';">' + (isSelected ? '&#9745;' : '&#9744;') + '</span>';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div style="font-weight:600;font-size:13px;">' + escapeHtml(subject) + '</div>';
          html += '<div style="font-size:12px;color:#888;margin-top:2px;">';
          var metaParts = [];
          if (dateStr) metaParts.push(dateStr);
          if (duration) metaParts.push(duration);
          if (source) metaParts.push(source);
          if (intent) metaParts.push('Intent: ' + intent);
          html += escapeHtml(metaParts.join(' \u00B7 '));
          html += '</div>';
          if (summaryPreview) {
            html += '<div style="font-size:12px;color:#6B7280;margin-top:4px;font-style:italic;">' + escapeHtml(summaryPreview) + '</div>';
          }
          html += '</div></div></div>';
        });
      }

      // ── File from computer ──
      // ── Activity & Task Notes ──
      var relevantNotes = (state.activities || []).filter(function(a) {
        return (a.type === 'NOTE' || a.type === 'MEETING' || a.type === 'CALL') && a.body;
      });
      html += '<div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;">Activity Notes (' + relevantNotes.length + ' available)</div>';
      if (relevantNotes.length === 0) {
        html += '<div style="padding:8px 12px;color:#888;font-size:13px;margin-bottom:12px;border:1px dashed #E5E7EB;border-radius:8px;">No activity notes recorded.</div>';
      } else {
        var isActSelected = !!state.docCreatorSources._selectedActivities;
        var actBorder = isActSelected ? '#3B82F6' : '#E5E7EB';
        var actBg = isActSelected ? '#EFF6FF' : '#fff';
        html += '<div class="cc-dc-source-card" data-source-type="activities" data-source-id="all" ';
        html += 'style="padding:10px 12px;border:2px solid ' + actBorder + ';border-radius:8px;margin-bottom:6px;background:' + actBg + ';cursor:pointer;transition:all 0.15s;">';
        html += '<div style="display:flex;align-items:center;gap:10px;">';
        html += '<span style="font-size:16px;width:20px;text-align:center;color:' + (isActSelected ? '#3B82F6' : '#CBD5E1') + ';">' + (isActSelected ? '&#9745;' : '&#9744;') + '</span>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:600;font-size:13px;">Include all activity notes (' + relevantNotes.length + ' notes)</div>';
        html += '<div style="font-size:12px;color:#888;">Notes, meeting logs, and call records from Activity &amp; Tasks tab</div>';
        html += '</div></div></div>';
      }

      // ── File from computer ──
      html += '<div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;">Upload File</div>';
      html += '<div style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;">';
      html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">';
      html += '<input type="checkbox" id="cc-dc-src-file" ' + (state.docCreatorSources.file ? 'checked' : '') + ' /> ';
      html += '<span style="font-weight:600;font-size:13px;">File from my computer</span>';
      html += '</label>';
      html += '<div id="cc-dc-file-upload-area" style="display:' + (state.docCreatorSources.file ? '' : 'none') + ';margin-top:8px;">';
      html += '<input type="file" id="cc-dc-file-input" accept=".pdf,.doc,.docx,.txt,.rtf" style="font-size:12px;" />';
      if (state.docCreatorSources._fileName) {
        html += '<p style="margin:4px 0 0;font-size:12px;color:#16a34a;">Selected: ' + escapeHtml(state.docCreatorSources._fileName) + '</p>';
      }
      html += '</div></div>';

      html += '</div>'; // end scrollable area

      html += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #E5E7EB;">';
      html += '<button id="cc-dc-cancel" class="cc-btn cc-btn-outline" style="font-size:13px;">Cancel</button>';
      html += '<button id="cc-dc-next" class="cc-btn cc-btn-primary" style="font-size:13px;">Next &rarr;</button>';
      html += '</div>';

      modal.innerHTML = html;

      // Bind card click toggles
      modal.querySelectorAll('.cc-dc-source-card').forEach(function(card) {
        card.addEventListener('click', function() {
          var type = card.dataset.sourceType;
          var id = card.dataset.sourceId;
          if (type === 'intake') {
            state.docCreatorSources._selectedIntake[id] = !state.docCreatorSources._selectedIntake[id];
          } else if (type === 'recording') {
            state.docCreatorSources._selectedRecordings[id] = !state.docCreatorSources._selectedRecordings[id];
          } else if (type === 'activities') {
            state.docCreatorSources._selectedActivities = !state.docCreatorSources._selectedActivities;
          }
          // Re-render to update visual state
          renderDocCreatorStep1(modal);
        });
      });

      // Toggle file upload area
      var fileChk = document.getElementById('cc-dc-src-file');
      var fileArea = document.getElementById('cc-dc-file-upload-area');
      if (fileChk && fileArea) {
        fileChk.addEventListener('change', function() {
          fileArea.style.display = fileChk.checked ? '' : 'none';
        });
      }

      document.getElementById('cc-dc-cancel').addEventListener('click', closeDocCreatorModal);
      document.getElementById('cc-dc-next').addEventListener('click', function() {
        // Collect selected source IDs
        var selectedIntakeIds = Object.keys(state.docCreatorSources._selectedIntake).filter(function(k) { return state.docCreatorSources._selectedIntake[k]; });
        var selectedRecordingIds = Object.keys(state.docCreatorSources._selectedRecordings).filter(function(k) { return state.docCreatorSources._selectedRecordings[k]; });
        state.docCreatorSources.intake = selectedIntakeIds.length > 0;
        state.docCreatorSources.transcription = selectedRecordingIds.length > 0;
        state.docCreatorSources._selectedIntakeIds = selectedIntakeIds;
        state.docCreatorSources._selectedRecordingIds = selectedRecordingIds;

        var fileChkEl = document.getElementById('cc-dc-src-file');
        var fileInput = document.getElementById('cc-dc-file-input');
        state.docCreatorSources.file = fileChkEl ? fileChkEl.checked : false;
        if (state.docCreatorSources.file && fileInput && fileInput.files && fileInput.files.length > 0) {
          state.docCreatorSources._file = fileInput.files[0];
          state.docCreatorSources._fileName = fileInput.files[0].name;
        } else {
          state.docCreatorSources._file = null;
          state.docCreatorSources._fileName = null;
        }
        mergeSourcesAndAdvance();
      });
    });
  }

  async function mergeSourcesAndAdvance() {
    var modal = document.getElementById('cc-doc-creator-modal');
    if (!modal) return;
    modal.innerHTML = '<div style="text-align:center;padding:40px;"><p>Merging data sources...</p></div>';

    var c = state.contact;
    var merged = {
      testator: {
        full_legal_name: c.Client_Name || '',
        date_of_birth: '',
        address: {
          street: c.Client_Address || '',
          city: '',
          province: 'Ontario',
          postal_code: ''
        },
        marital_status: '',
        occupation: ''
      },
      spouse: { name: '', relationship: '' },
      children: [],
      executor: { name: '', relationship: '', address: '', alternate_executor: { name: '', relationship: '' } },
      guardian: { name: '', relationship: '', alternate_guardian: { name: '', relationship: '' } },
      beneficiaries: [],
      assets: [],
      specific_bequests: [],
      residual_estate: { distribution: '' },
      trusts: [],
      poa_property: { attorney: '', alternate_attorney: '', conditions: '' },
      poa_personal_care: { attorney: '', alternate_attorney: '', conditions: '' },
      funeral_wishes: { preference: '', details: '' },
      special_instructions: ''
    };

    // Merge from selected intake form submissions
    if (state.docCreatorSources.intake && state.docCreatorSources._selectedIntakeIds) {
      try {
        var allForms = state.docCreatorSources._intakeData || [];
        var selectedIds = state.docCreatorSources._selectedIntakeIds || [];
        for (var si = 0; si < allForms.length; si++) {
          var sub = allForms[si];
          var subId = sub.id || sub.record_id || '';
          if (selectedIds.indexOf(subId) < 0) continue; // Skip unselected
          var rawFormData = sub.form_data_json || sub.Form_Data_JSON;
          if (rawFormData) {
            var formData = typeof rawFormData === 'string' ? JSON.parse(rawFormData) : rawFormData;
            // Map common intake form fields to will schema
            if (formData.client_name && !merged.testator.full_legal_name) merged.testator.full_legal_name = formData.client_name;
            if (formData.date_of_birth) merged.testator.date_of_birth = formData.date_of_birth;
            if (formData.client_address) merged.testator.address.street = formData.client_address;
            if (formData.city) merged.testator.address.city = formData.city;
            if (formData.postal_code) merged.testator.address.postal_code = formData.postal_code;
            if (formData.marital_status) merged.testator.marital_status = formData.marital_status;
            if (formData.occupation) merged.testator.occupation = formData.occupation;
            if (formData.spouse_name) merged.spouse.name = formData.spouse_name;
            if (formData.uepp || formData.will_data) {
              deepMergeWillData(merged, formData.uepp || formData.will_data);
            }
          }
        }
      } catch (e) { /* continue without intake data */ }
    }

    // Merge from uploaded file if selected
    if (state.docCreatorSources.file && state.docCreatorSources._file) {
      try {
        if (modal) modal.innerHTML = '<div style="text-align:center;padding:40px;"><p>Reading uploaded file...</p></div>';
        var fileText = await new Promise(function(resolve, reject) {
          var reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.onerror = function() { reject(new Error('Failed to read file')); };
          reader.readAsText(state.docCreatorSources._file);
        });
        // Try to parse any structured data from the file content
        if (fileText) {
          try {
            var parsed = JSON.parse(fileText);
            deepMergeWillData(merged, parsed);
          } catch (e) {
            // Not JSON — store raw text as special_instructions for context
            if (fileText.length > 0 && !merged.special_instructions) {
              merged.special_instructions = 'Content from uploaded file (' + escapeHtml(state.docCreatorSources._fileName || 'file') + '):\n' + fileText.substring(0, 5000);
            }
          }
        }
      } catch (e) { /* continue without file data */ }
    }

    // Merge from selected transcription recordings
    if (state.docCreatorSources.transcription && state.docCreatorSources._selectedRecordingIds) {
      try {
        var allRecordings = state.docCreatorSources._recordingData || [];
        var selectedRecIds = state.docCreatorSources._selectedRecordingIds || [];
        for (var i = 0; i < allRecordings.length; i++) {
          var rec = allRecordings[i];
          var recId = rec.id || rec.record_id || '';
          if (selectedRecIds.indexOf(recId) < 0) continue; // Skip unselected
          if (rec.Extracted_Data_JSON) {
            var extracted = typeof rec.Extracted_Data_JSON === 'string' ? JSON.parse(rec.Extracted_Data_JSON) : rec.Extracted_Data_JSON;
            deepMergeWillData(merged, extracted);
          }
        }
      } catch (e) { /* continue without transcription data */ }
    }

    // Merge from activity notes if selected
    if (state.docCreatorSources._selectedActivities) {
      var relevantNotes = (state.activities || []).filter(function(a) {
        return (a.type === 'NOTE' || a.type === 'MEETING' || a.type === 'CALL') && a.body;
      });
      if (relevantNotes.length > 0) {
        var noteTexts = relevantNotes.map(function(n) {
          return '[' + (n.type || 'NOTE') + ' - ' + (n.subject || 'Note') + ' - ' + API.util.formatDate(n.created_at || '') + ']\n' + n.body;
        });
        var existingInstructions = merged.special_instructions || '';
        merged.special_instructions = (existingInstructions ? existingInstructions + '\n\n' : '') +
          'Activity Notes:\n' + noteTexts.join('\n\n');
      }
    }

    state.docCreatorFieldData = merged;
    state.docCreatorStep = 2;
    renderDocCreatorStep();
  }

  function deepMergeWillData(target, source) {
    if (!source || typeof source !== 'object') return;
    for (var key in source) {
      if (!source.hasOwnProperty(key)) continue;
      var sv = source[key];
      var tv = target[key];
      if (Array.isArray(sv) && sv.length > 0) {
        target[key] = sv;
      } else if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        if (!tv || typeof tv !== 'object') target[key] = {};
        deepMergeWillData(target[key], sv);
      } else if (sv !== '' && sv !== null && sv !== undefined) {
        target[key] = sv;
      }
    }
  }

  // Step 2: Pre-populated Form
  function renderDocCreatorStep2(modal) {
    var data = state.docCreatorFieldData;
    var html = '<h3 style="margin:0 0 4px;">Generate Finished Documents &mdash; Review &amp; Edit</h3>';
    html += '<p style="color:#666;font-size:13px;margin-bottom:16px;">Review the pre-populated fields. Edit any values before generating.</p>';

    // Render fixed sections
    WILL_SCHEMA_SECTIONS.forEach(function(section) {
      html += '<div class="cc-doc-form-section" style="margin-bottom:16px;">';
      html += '<h4 style="margin:0 0 8px;padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:14px;cursor:pointer;" data-section="' + section.key + '">' + escapeHtml(section.label) + '</h4>';
      html += '<div class="cc-doc-form-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;">';
      section.fields.forEach(function(field) {
        var val = getNestedValue(data, field.id);
        html += renderDocFormField(field, val);
      });
      html += '</div></div>';
    });

    // Render array sections
    WILL_ARRAY_SECTIONS.forEach(function(section) {
      var items = data[section.key] || [];
      html += '<div class="cc-doc-form-section" style="margin-bottom:16px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding:6px 0;margin-bottom:8px;">';
      html += '<h4 style="margin:0;font-size:14px;">' + escapeHtml(section.label) + ' (' + items.length + ')</h4>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-dc-add-item" data-array="' + section.key + '" style="font-size:11px;">+ Add</button>';
      html += '</div>';
      items.forEach(function(item, idx) {
        html += '<div class="cc-doc-array-item" style="padding:8px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;position:relative;">';
        html += '<button class="cc-dc-remove-item" data-array="' + section.key + '" data-idx="' + idx + '" style="position:absolute;top:4px;right:4px;background:none;border:none;cursor:pointer;color:#ef4444;font-size:14px;" title="Remove">&times;</button>';
        section.itemFields.forEach(function(field) {
          var fid = section.key + '[' + idx + '].' + field.id;
          var val = item[field.id] || '';
          html += renderDocFormField(Object.assign({}, field, { id: fid }), val);
        });
        html += '</div>';
      });
      html += '</div>';
    });

    html += '<div style="display:flex;justify-content:space-between;margin-top:20px;">';
    html += '<button id="cc-dc-back" class="cc-btn cc-btn-outline" style="font-size:13px;">&larr; Back</button>';
    html += '<button id="cc-dc-generate" class="cc-btn cc-btn-primary" style="font-size:13px;">Generate Will</button>';
    html += '</div>';

    modal.innerHTML = html;

    // Bind events
    document.getElementById('cc-dc-back').addEventListener('click', function() {
      collectDocFormData();
      state.docCreatorStep = 0;
      renderDocCreatorStep();
    });
    document.getElementById('cc-dc-generate').addEventListener('click', function() {
      collectDocFormData();
      state.docCreatorStep = 2;
      renderDocCreatorStep();
      submitDocGeneration();
    });

    // Add item buttons
    modal.querySelectorAll('.cc-dc-add-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        collectDocFormData();
        var arrKey = btn.dataset.array;
        if (!state.docCreatorFieldData[arrKey]) state.docCreatorFieldData[arrKey] = [];
        var emptyItem = {};
        var sec = WILL_ARRAY_SECTIONS.find(function(s) { return s.key === arrKey; });
        if (sec) sec.itemFields.forEach(function(f) { emptyItem[f.id] = f.type === 'checkbox' ? false : ''; });
        state.docCreatorFieldData[arrKey].push(emptyItem);
        renderDocCreatorStep();
      });
    });

    // Remove item buttons
    modal.querySelectorAll('.cc-dc-remove-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        collectDocFormData();
        var arrKey = btn.dataset.array;
        var idx = parseInt(btn.dataset.idx);
        if (state.docCreatorFieldData[arrKey]) state.docCreatorFieldData[arrKey].splice(idx, 1);
        renderDocCreatorStep();
      });
    });
  }

  function renderDocFormField(field, value) {
    var html = '<div style="margin-bottom:4px;">';
    html += '<label style="font-size:11px;color:#555;display:block;margin-bottom:2px;">' + escapeHtml(field.label) + (field.required ? ' *' : '') + '</label>';
    var fid = 'cc-dc-field-' + field.id.replace(/[\[\].]/g, '-');

    if (field.type === 'select') {
      html += '<select id="' + fid + '" data-field="' + escapeAttr(field.id) + '" class="cc-input cc-dc-input" style="font-size:13px;padding:4px 8px;width:100%;">';
      html += '<option value="">-- Select --</option>';
      (field.options || []).forEach(function(opt) {
        html += '<option value="' + escapeAttr(opt) + '"' + (value === opt ? ' selected' : '') + '>' + escapeHtml(opt) + '</option>';
      });
      html += '</select>';
    } else if (field.type === 'textarea') {
      html += '<textarea id="' + fid + '" data-field="' + escapeAttr(field.id) + '" class="cc-input cc-dc-input" rows="2" style="font-size:13px;padding:4px 8px;width:100%;resize:vertical;">' + escapeHtml(value || '') + '</textarea>';
    } else if (field.type === 'checkbox') {
      html += '<input type="checkbox" id="' + fid + '" data-field="' + escapeAttr(field.id) + '" class="cc-dc-input" ' + (value ? 'checked' : '') + ' />';
    } else {
      html += '<input type="' + (field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text') + '" id="' + fid + '" data-field="' + escapeAttr(field.id) + '" class="cc-input cc-dc-input" value="' + escapeAttr(value || '') + '" style="font-size:13px;padding:4px 8px;width:100%;" />';
    }
    html += '</div>';
    return html;
  }

  function collectDocFormData() {
    var data = state.docCreatorFieldData;
    if (!data) return;

    document.querySelectorAll('.cc-dc-input').forEach(function(el) {
      var fieldPath = el.dataset.field;
      if (!fieldPath) return;

      var val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.tagName === 'TEXTAREA') val = el.value;
      else val = el.value;

      // Handle array field paths like children[0].name
      var arrayMatch = fieldPath.match(/^(\w+)\[(\d+)\]\.(.+)$/);
      if (arrayMatch) {
        var arrKey = arrayMatch[1];
        var idx = parseInt(arrayMatch[2]);
        var itemField = arrayMatch[3];
        if (!data[arrKey]) data[arrKey] = [];
        if (!data[arrKey][idx]) data[arrKey][idx] = {};
        data[arrKey][idx][itemField] = val;
      } else {
        setNestedValue(data, fieldPath, val);
      }
    });
  }

  // Step 3: Generate
  async function submitDocGeneration() {
    var modal = document.getElementById('cc-doc-creator-modal');
    if (!modal) return;
    modal.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div style="font-size:24px;margin-bottom:12px;">Generating Will...</div><p style="color:#666;">This may take a moment.</p></div>';

    try {
      var result = await API.documents.generate({
        creator_type: 'will_creator',
        lead_id: contactId,
        field_data: state.docCreatorFieldData,
        source_ids: state.docCreatorSources
      });

      if (result.success) {
        // Auto-download the file if base64 is returned
        if (result.file_base64) {
          try {
            var byteChars = atob(result.file_base64);
            var byteNums = new Array(byteChars.length);
            for (var bi = 0; bi < byteChars.length; bi++) byteNums[bi] = byteChars.charCodeAt(bi);
            var byteArr = new Uint8Array(byteNums);
            var blob = new Blob([byteArr], { type: 'application/msword' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = result.file_name || 'Will.doc';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
          } catch (dlErr) { /* download error handled below in UI */ }
        }

        var html = '<div style="text-align:center;padding:40px 20px;">';
        html += '<div style="font-size:20px;font-weight:600;color:#16a34a;margin-bottom:12px;">Document Generated</div>';
        html += '<p style="color:#666;margin-bottom:8px;">' + escapeHtml(result.document_name || 'Will') + '</p>';
        html += '<p style="color:#888;font-size:13px;margin-bottom:20px;">The .doc file has been downloaded. Open it in Word to review and edit, then upload the final version to Clio.</p>';
        if (result.file_base64) {
          html += '<button id="cc-dc-redownload" class="cc-btn cc-btn-outline" style="font-size:13px;margin-bottom:12px;">Download Again</button><br>';
        }
        html += '<div style="display:flex;gap:8px;justify-content:center;margin-top:8px;">';
        html += '<button id="cc-dc-close-success" class="cc-btn cc-btn-primary" style="font-size:13px;">Done</button>';
        html += '</div></div>';
        modal.innerHTML = html;

        // Re-download button
        var redownloadBtn = document.getElementById('cc-dc-redownload');
        if (redownloadBtn && result.file_base64) {
          redownloadBtn.addEventListener('click', function() {
            var byteChars = atob(result.file_base64);
            var byteNums = new Array(byteChars.length);
            for (var bi = 0; bi < byteChars.length; bi++) byteNums[bi] = byteChars.charCodeAt(bi);
            var blob = new Blob([new Uint8Array(byteNums)], { type: 'application/msword' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = result.file_name || 'Will.doc';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          });
        }

        document.getElementById('cc-dc-close-success').addEventListener('click', function() {
          closeDocCreatorModal();
          // Refresh documents list
          API.documents.list(contactId).then(function(r) {
            state.documents = (r.data || []).filter(function(d) { return d.status !== 'archived'; });
            renderDocuments($el('cc-contact-tab-content'));
          });
        });
      } else {
        throw new Error(result.error || 'Generation failed');
      }
    } catch (err) {
      var html = '<div style="text-align:center;padding:40px 20px;">';
      html += '<div style="font-size:20px;font-weight:600;color:#ef4444;margin-bottom:12px;">Generation Failed</div>';
      html += '<p style="color:#666;margin-bottom:20px;">' + escapeHtml(err.message || String(err)) + '</p>';
      html += '<div style="display:flex;gap:8px;justify-content:center;">';
      html += '<button id="cc-dc-retry" class="cc-btn cc-btn-outline" style="font-size:13px;">Try Again</button>';
      html += '<button id="cc-dc-close-err" class="cc-btn cc-btn-primary" style="font-size:13px;">Close</button>';
      html += '</div></div>';
      modal.innerHTML = html;
      document.getElementById('cc-dc-retry').addEventListener('click', function() {
        state.docCreatorStep = 1;
        renderDocCreatorStep();
      });
      document.getElementById('cc-dc-close-err').addEventListener('click', closeDocCreatorModal);
    }
  }

  function renderDocCreatorStep3(modal) {
    // This is handled by submitDocGeneration() above
    submitDocGeneration();
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
          Service_Package: (function() { var w = document.querySelector('[data-ms-id="cc-ms-sp"]'); return w && w._getValues ? w._getValues() : []; })(),
          Practice_Area: (function() { var w = document.querySelector('[data-ms-id="cc-ms-pa"]'); return w && w._getValues ? w._getValues() : []; })(),
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

    // Bind activity document view buttons
    document.querySelectorAll('.cc-activity-doc-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var docId = btn.dataset.docId;
        var origText = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Loading...';
        try {
          var res = await API.documents.get(docId);
          var docHtml = '';
          if (res.data) {
            docHtml = res.data.document_html || res.data.Document_HTML || '';
          } else if (res.document_html || res.Document_HTML) {
            docHtml = res.document_html || res.Document_HTML;
          }
          if (docHtml) {
            openDocViewerModal(docHtml);
          } else {
            ccToast('No document content available.', 'info');
          }
        } catch (err) {
          ccToast('Failed to load document: ' + (err.error || err.message || 'Network error'), 'error');
        }
        btn.disabled = false;
        btn.innerHTML = origText;
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

  // ── Send Intake Form Modal ──────────────────────────────
  var SEND_FORM_PA_MAP = {
    'ESTATE_PLANNING_WILL_POA': 'Estate Planning', 'ESTATE_PLANNING_TRUST': 'Estate Planning',
    'ESTATE_PLANNING_FULL': 'Estate Planning', 'PROBATE': 'Probate',
    'ESTATE_ADMINISTRATION': 'Probate', 'REAL_ESTATE': 'Real Estate',
    'CORPORATE': 'Business Law', 'OTHER': 'Other',
    'Estate Planning': 'Estate Planning', 'Real Estate': 'Real Estate',
    'Probate': 'Probate', 'Business Law': 'Business Law',
    'Family Law': 'Family Law', 'Immigration': 'Immigration',
    'Litigation': 'Litigation', 'Other': 'Other'
  };
  function sendFormPALabel(pa) { return SEND_FORM_PA_MAP[pa] || pa || 'Other'; }

  async function showSendFormModal(record) {
    var formsList = [];
    try {
      var result = await API.forms.list({ form_type: 'intake', is_active: true });
      formsList = (result && result.data) || [];
    } catch (e) {
      ccToast('Could not load forms list.', 'error');
      return;
    }
    if (formsList.length === 0) {
      ccToast('No active intake forms available. Create intake forms in Admin > Forms first.', 'error');
      return;
    }

    // Group forms by practice area
    var groups = {};
    formsList.forEach(function(f) {
      var pa = sendFormPALabel(f.Practice_Area || f.practice_area || '');
      if (!groups[pa]) groups[pa] = [];
      groups[pa].push(f);
    });
    var paKeys = Object.keys(groups).sort(function(a, b) {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });

    // Determine contact's practice area for default-open
    var contactPA = sendFormPALabel(record.Practice_Area || '');

    // Build accordion HTML
    var accordionHtml = '';
    paKeys.forEach(function(pa) {
      var items = groups[pa];
      var isOpen = (pa === contactPA);
      var accId = 'cc-sfm-acc-' + pa.replace(/\s+/g, '-').toLowerCase();
      accordionHtml += '<div style="border:1px solid #E5E7EB;border-radius:6px;margin-bottom:6px;overflow:hidden;">';
      accordionHtml += '<button class="cc-sfm-acc-toggle" data-target="' + accId + '" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:8px 12px;background:#F9FAFB;border:none;cursor:pointer;font-size:0.85rem;font-weight:600;color:#374151;">';
      accordionHtml += '<span>' + escapeHtml(pa) + ' (' + items.length + ')</span>';
      accordionHtml += '<span class="cc-sfm-arrow" style="transition:transform 0.2s;' + (isOpen ? '' : 'transform:rotate(-90deg);') + '">&#9660;</span>';
      accordionHtml += '</button>';
      accordionHtml += '<div id="' + accId + '" style="display:' + (isOpen ? 'block' : 'none') + ';padding:6px;">';
      items.forEach(function(f) {
        var fid = f.Form_ID || f.form_id || '';
        var fname = f.Name || f.name || '';
        var fdesc = f.Description || f.description || '';
        accordionHtml += '<div class="cc-sfm-form-card" data-form-id="' + escapeAttr(fid) + '" style="padding:8px 10px;border:2px solid #E5E7EB;border-radius:6px;margin-bottom:4px;cursor:pointer;transition:border-color 0.15s,background 0.15s;" onmouseover="this.style.background=\'#F0F9FF\'" onmouseout="if(!this.classList.contains(\'cc-sfm-selected\'))this.style.background=\'white\'">';
        accordionHtml += '<div style="font-weight:500;font-size:0.85rem;color:#1e293b;">' + escapeHtml(fname) + '</div>';
        if (fdesc) accordionHtml += '<div style="font-size:0.78rem;color:#6B7280;margin-top:2px;">' + escapeHtml(fdesc) + '</div>';
        accordionHtml += '</div>';
      });
      accordionHtml += '</div></div>';
    });

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'cc-modal';
    modal.innerHTML =
      '<div class="cc-modal-header">' +
        '<h3>Send Intake Form to ' + escapeHtml(record.Client_Name || 'Client') + '</h3>' +
        '<button class="cc-modal-close">&times;</button>' +
      '</div>' +
      '<div class="cc-modal-body">' +
        '<div class="cc-form-group" style="margin-bottom:1rem;">' +
          '<label class="cc-label">Select an Intake Form</label>' +
          '<div id="cc-sfm-accordion" style="max-height:280px;overflow-y:auto;border:1px solid #E5E7EB;border-radius:6px;padding:6px;">' + accordionHtml + '</div>' +
        '</div>' +
        '<div class="cc-form-group" style="margin-bottom:1rem;">' +
          '<label class="cc-label">Custom Message (optional)</label>' +
          '<textarea id="cc-send-form-message" class="cc-textarea" rows="3" placeholder="Add a personal message to include in the email..."></textarea>' +
        '</div>' +
        '<div class="cc-form-group" style="margin-bottom:1rem;">' +
          '<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.9rem;">' +
            '<input type="checkbox" id="cc-send-form-followup" class="cc-checkbox">' +
            ' Create follow-up task' +
          '</label>' +
        '</div>' +
        '<div id="cc-send-form-followup-config" style="display:none;margin-bottom:1rem;padding-left:1.5rem;">' +
          '<label class="cc-label">Follow up in (days)</label>' +
          '<input type="number" id="cc-send-form-followup-days" class="cc-input" value="3" min="1" max="30" style="width:80px;">' +
        '</div>' +
        '<div id="cc-send-form-preview" style="display:none;margin-bottom:0.5rem;font-size:0.8rem;color:#6B7280;">' +
          'Form URL: <span id="cc-send-form-url" style="color:#2563EB;word-break:break-all;"></span>' +
        '</div>' +
      '</div>' +
      '<div class="cc-modal-footer">' +
        '<button class="cc-btn cc-btn-outline cc-modal-cancel-btn">Cancel</button>' +
        '<button class="cc-btn cc-btn-primary" id="cc-send-form-btn" disabled>Send Form</button>' +
      '</div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.querySelector('.cc-modal-close').addEventListener('click', function() { overlay.remove(); });
    overlay.querySelector('.cc-modal-cancel-btn').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Bind accordion toggles
    modal.querySelectorAll('.cc-sfm-acc-toggle').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var target = document.getElementById(btn.dataset.target);
        if (target) {
          var isOpen = target.style.display !== 'none';
          target.style.display = isOpen ? 'none' : 'block';
          var arrow = btn.querySelector('.cc-sfm-arrow');
          if (arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : '';
        }
      });
    });

    // Track selected form
    var selectedFormId = '';
    var sendBtn = document.getElementById('cc-send-form-btn');
    var previewDiv = document.getElementById('cc-send-form-preview');
    var urlSpan = document.getElementById('cc-send-form-url');

    // Bind form card selection
    modal.querySelectorAll('.cc-sfm-form-card').forEach(function(card) {
      card.addEventListener('click', function() {
        modal.querySelectorAll('.cc-sfm-form-card').forEach(function(c) {
          c.classList.remove('cc-sfm-selected');
          c.style.borderColor = '#E5E7EB';
          c.style.background = 'white';
        });
        card.classList.add('cc-sfm-selected');
        card.style.borderColor = '#2563EB';
        card.style.background = '#EFF6FF';
        selectedFormId = card.dataset.formId;
        var url = 'https://clientcare.tabuchilaw.com/intake?form=' + encodeURIComponent(selectedFormId) + '&lead=' + encodeURIComponent(record.id);
        urlSpan.textContent = url;
        previewDiv.style.display = '';
        sendBtn.disabled = false;
      });
    });

    var followupCheck = document.getElementById('cc-send-form-followup');
    var followupConfig = document.getElementById('cc-send-form-followup-config');
    followupCheck.addEventListener('change', function() {
      followupConfig.style.display = followupCheck.checked ? '' : 'none';
    });
    sendBtn.addEventListener('click', async function() {
      if (sendBtn.disabled || !selectedFormId) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
      try {
        var payload = {
          lead_id: record.id,
          form_id: selectedFormId,
          custom_message: document.getElementById('cc-send-form-message').value.trim(),
          create_followup_task: followupCheck.checked,
          followup_days: followupCheck.checked ? parseInt(document.getElementById('cc-send-form-followup-days').value, 10) || 3 : undefined
        };
        var result = await API.forms.sendLink(payload);
        if (result && result.success) {
          ccToast('Form link sent to ' + escapeHtml(record.Client_Name || record.Client_Email) + '.', 'success');
          overlay.remove();
        } else {
          ccToast('Failed to send form: ' + (result && result.error || 'Unknown error'), 'error');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send Form';
        }
      } catch (err) {
        ccToast('Failed to send form: ' + (err.error || err.message || 'Unknown error'), 'error');
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Form';
      }
    });
  }

  // ── RingCentral Embeddable Integration ────────────────────
  function showCallDialog(record) {
    if (!record.Client_Phone) { ccToast('No phone number available.', 'error'); return; }

    // Normalize phone number for dialing
    var phone = record.Client_Phone.replace(/[\s\-\(\)\.]/g, '');
    if (/^\d{10}$/.test(phone)) phone = '+1' + phone;
    else if (/^1\d{10}$/.test(phone)) phone = '+' + phone;

    // Launch call via RC URI scheme (opens RC desktop app) with tel: fallback
    var rcUri = 'rcmobile://call?number=' + encodeURIComponent(phone);
    var telUri = 'tel:' + encodeURIComponent(phone);

    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = rcUri;
    document.body.appendChild(iframe);
    setTimeout(function() {
      document.body.removeChild(iframe);
      var a = document.createElement('a');
      a.href = telUri;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, 500);

    ccToast('Opening RingCentral for ' + escapeHtml(record.Client_Phone) + '...', 'info');

    // Notify backend that a call was initiated — triggers recording poll
    try {
      fetch('https://tabuchilaw.app.n8n.cloud/webhook/cc/call-started', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: contactId,
          phone: phone,
          lead_name: record.Client_Name || '',
          started_at: new Date().toISOString(),
          user_id: (API.auth.getUser() || {}).id || ''
        })
      }).catch(function() { /* fire and forget */ });
    } catch (e) { /* ignore */ }

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
        // Filter out drip-only templates for manual email sending
        var nonDripTemplates = templates.filter(function(t) { return !t.is_drip; });

        // Determine contact's practice area for default open
        var contactPA = (record.Practice_Area || []);
        if (typeof contactPA === 'string') contactPA = [contactPA];
        var defaultOpen = contactPA.length ? contactPA[0] : '';

        var accordionHtml = API.util.buildTemplateAccordion(nonDripTemplates, {
          defaultOpenPA: defaultOpen,
          cardClass: 'cc-email-template-card'
        });
        listEl.innerHTML = accordionHtml;
        API.util.bindAccordionToggles(listEl);

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

    var refreshInterval = null;
    var close = function() { if (refreshInterval) clearInterval(refreshInterval); overlay.remove(); };
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
    refreshInterval = setInterval(loadThread, 3000);

    // Immediately reload when tab becomes visible (handles background throttle)
    var visHandler = function() { if (!document.hidden) loadThread(); };
    document.addEventListener('visibilitychange', visHandler);
    var origClose = close;
    close = function() { document.removeEventListener('visibilitychange', visHandler); origClose(); };

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
