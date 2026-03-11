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
    tasks: [],
    conversion: null,
    activeTab: 'overview',
    loading: true,
    user: API.auth.getUser(),
    editMode: false
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
        API.tasks.list({ lead_id: contactId })
      ]);

      var leadResult = results[0];
      var historyResult = results[1];
      var taskResult = results[2];

      if (leadResult.success && leadResult.lead) {
        state.contact = leadResult.lead;
      } else {
        showError('Contact not found or access denied.');
        return;
      }

      if (historyResult.success) {
        state.activities = historyResult.activities || [];
        state.campaignSends = historyResult.campaign_sends || [];
        state.conversion = historyResult.conversion || { converted: false };
      }

      state.tasks = (taskResult.success && taskResult.tasks) || [];

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

    // Edit form (when in edit mode)
    if (state.editMode) {
      html += buildEditForm(c);
    }

    // Info grid
    html += buildInfoGrid(c);

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
      { label: 'Address', value: c.Client_Address },
      { label: 'Practice Area', value: formatPracticeArea(c.Practice_Area) },
      { label: 'Service Package', value: formatPracticeArea(c.Service_Package) },
      { label: 'Source', value: c.Source },
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

  function buildEditForm(c) {
    var html = '<div class="cc-section cc-edit-section">';
    html += '<h3 class="cc-section-title">Edit Contact</h3>';
    html += '<div class="cc-edit-grid">';

    html += '<div class="cc-edit-field"><label>Company</label>' +
      '<input class="cc-input" id="cc-edit-company" value="' + escapeAttr(c.Company || '') + '" /></div>';

    html += '<div class="cc-edit-field"><label>Address</label>' +
      '<input class="cc-input" id="cc-edit-address" value="' + escapeAttr(c.Client_Address || '') + '" /></div>';

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

    html += '</div>'; // close edit-grid
    html += '<div class="cc-edit-actions">' +
      '<button class="cc-btn cc-btn-primary" id="cc-edit-save">Save Changes</button>' +
    '</div>';
    html += '</div>'; // close section
    return html;
  }

  function buildTagsSection(c) {
    var tags = c.Tags || [];
    var html = '<div class="cc-section"><h3 class="cc-section-title">Tags</h3>';
    html += '<div class="cc-tags-manage">';

    if (tags.length === 0) {
      html += '<span class="cc-text-muted">No tags assigned.</span>';
    } else {
      tags.forEach(function(tag) {
        html += '<span class="cc-tag-pill cc-tag-removable">' +
          escapeHtml(tag) +
          ' <button class="cc-tag-remove" data-tag="' + escapeAttr(tag) + '" title="Remove tag">&times;</button>' +
        '</span>';
      });
    }

    html += '</div>';
    html += '<div class="cc-tag-add-row">' +
      '<input class="cc-input cc-input-sm" id="cc-tag-input" placeholder="Add tags (comma-separated)" />' +
      '<button class="cc-btn cc-btn-sm cc-btn-primary" id="cc-tag-add-btn">Add</button>' +
    '</div></div>';
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

    // Sort by date descending
    items.sort(function(a, b) {
      return new Date(b.sortDate || 0) - new Date(a.sortDate || 0);
    });

    if (items.length === 0) {
      return '<div class="cc-empty">No activity recorded yet.</div>';
    }

    var html = '<div class="cc-timeline">';
    items.forEach(function(item) {
      html += '<div class="cc-timeline-item">';
      html += '<div class="cc-timeline-icon">' + item.icon + '</div>';
      html += '<div class="cc-timeline-content">';
      html += '<div class="cc-timeline-header">';
      html += '<span class="cc-timeline-type">' + escapeHtml(item.label) + '</span>';
      html += '<span class="cc-timeline-time">' + escapeHtml(API.util.formatRelativeTime(item.time)) + '</span>';
      html += '</div>';
      html += '<div class="cc-timeline-subject">' + escapeHtml(item.subject) + '</div>';
      if (item.body) html += '<div class="cc-timeline-body">' + escapeHtml(item.body) + '</div>';
      if (item.duration) html += '<div class="cc-timeline-meta">' + item.duration + ' min</div>';
      if (item.outcome) html += '<div class="cc-timeline-meta">Outcome: ' + escapeHtml(item.outcome) + '</div>';
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
      html += '<span class="cc-key-date-label">' + escapeHtml(d.label) + '</span>';
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

    saveBtn.addEventListener('click', async function() {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        var updates = {
          Company: document.getElementById('cc-edit-company').value.trim(),
          Client_Address: document.getElementById('cc-edit-address').value.trim(),
          Contact_Status: document.getElementById('cc-edit-status').value,
          Consent_Status: document.getElementById('cc-edit-consent').value
        };

        var result = await API.leads.update(contactId, updates);
        if (result.success) {
          state.editMode = false;
          reloadContact();
        } else {
          alert(result.error || 'Failed to save changes');
        }
      } catch (err) {
        alert(err.error || 'Error saving changes');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
  }

  // ─── Tag Controls ───────────────────────────────────────────
  function bindTagControls() {
    // Remove tag buttons
    document.querySelectorAll('.cc-tag-remove').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.preventDefault();
        var tagToRemove = btn.dataset.tag;
        var currentTags = (state.contact.Tags || []).filter(function(t) { return t !== tagToRemove; });

        try {
          var result = await API.leads.update(contactId, { Tags: currentTags });
          if (result.success) reloadContact();
        } catch (err) {
          alert('Failed to remove tag: ' + (err.error || 'Unknown error'));
        }
      });
    });

    // Add tags
    var addBtn = document.getElementById('cc-tag-add-btn');
    var input = document.getElementById('cc-tag-input');
    if (addBtn && input) {
      addBtn.addEventListener('click', function() { addTagsFromInput(input); });

      // Enter key to add
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addTagsFromInput(input);
        }
      });
    }
  }

  async function addTagsFromInput(input) {
    var newTags = input.value.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    if (!newTags.length) return;

    var currentTags = (state.contact.Tags || []).slice();
    // Merge without duplicates
    newTags.forEach(function(t) {
      if (currentTags.indexOf(t) === -1) currentTags.push(t);
    });

    try {
      var result = await API.leads.update(contactId, { Tags: currentTags });
      if (result.success) reloadContact();
    } catch (err) {
      alert('Failed to add tags: ' + (err.error || 'Unknown error'));
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
          alert(result.error || 'Failed to save notes');
          saveBtn.textContent = 'Save Notes';
        }
      } catch (err) {
        alert(err.error || 'Error saving notes');
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
          alert('Failed to complete task: ' + (err.error || 'Unknown error'));
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
      if (!subject) { alert('Subject is required.'); return; }

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
        alert('Failed: ' + (err.error || 'Unknown error'));
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
      if (!title) { alert('Task title is required.'); return; }

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
        alert('Failed: ' + (err.error || 'Unknown error'));
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
    return pa.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
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

  // ─── Initialize ──────────────────────────────────────────────
  function init() {
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
