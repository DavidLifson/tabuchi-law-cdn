/**
 * Tabuchi Law Client Care CRM - Lead Detail (360 View)
 * Handles: /crm/lead/:id
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Lead header with key info + stage badge
 * - Stage progression bar with advance/close controls
 * - Activity timeline (sortable by date)
 * - Task list with complete/create
 * - Log activity form (call, email, meeting, note)
 * - Edit lead fields inline
 *
 * Page element IDs:
 * - #cc-lead-detail       (main container)
 * - #cc-lead-header       (name, email, phone, stage, priority)
 * - #cc-stage-bar         (pipeline stage progression)
 * - #cc-lead-info         (detail fields grid)
 * - #cc-activity-timeline (activity list)
 * - #cc-task-list         (tasks for this lead)
 * - #cc-log-activity-form (log activity form)
 * - #cc-add-task-form     (add task form)
 * - #cc-back-btn          (back to list)
 */

(function LeadDetail() {
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

  // Extract lead ID from URL: /crm/lead?id=xxx
  var params = API.util.getUrlParams();
  var leadId = params.id || '';

  var isNewLead = (!leadId || leadId === 'new');

  // ─── State ───────────────────────────────────────────────────
  var state = {
    lead: null,
    activities: [],
    tasks: [],
    loading: true,
    user: API.auth.getUser()
  };

  var STAGES = [
    { key: 'NEW_LEAD', label: 'New Lead' },
    { key: 'CONTACTED', label: 'Contacted' },
    { key: 'INTAKE_RECEIVED', label: 'Intake Received' },
    { key: 'DISCOVERY_MEETING_BOOKED', label: 'Discovery Meeting Booked' },
    { key: 'MEETING_DONE', label: 'Meeting Done' },
    { key: 'READY_TO_DRAFT', label: 'Ready to Draft' }
  ];

  // ─── Load All Data ──────────────────────────────────────────
  async function loadData() {
    // New lead: show empty form immediately
    if (isNewLead) {
      state.lead = {};
      state.loading = false;
      render();
      return;
    }

    state.loading = true;
    var container = $el('cc-lead-detail');
    if (container) container.classList.add('cc-loading-state');

    try {
      var [leadResult, actResult, taskResult] = await Promise.all([
        API.leads.get(leadId),
        API.activities.list(leadId),
        API.tasks.list({ lead_id: leadId })
      ]);

      if (leadResult.success && leadResult.lead) {
        state.lead = leadResult.lead;
      } else {
        showError('Lead not found or access denied.');
        return;
      }

      state.activities = (actResult.success && actResult.activities) || [];
      state.tasks = (taskResult.success && taskResult.tasks) || [];

      render();
    } catch (err) {
      showError(err.error || 'Failed to load lead details.');
    }

    state.loading = false;
    if (container) container.classList.remove('cc-loading-state');
  }

  // ─── Selective Re-fetch Helpers ────────────────────────────
  async function reloadLead() {
    try {
      if (API.cache) API.cache.invalidate('/cc/leads');
      var result = await API.leads.get(leadId);
      if (result.success && result.lead) {
        state.lead = result.lead;
        renderHeader();
        renderStageBar();
        renderInfo();
      }
    } catch (err) { /* silently fail, data will be stale */ }
  }

  async function reloadActivities() {
    try {
      if (API.cache) API.cache.invalidate('/cc/activities');
      var result = await API.activities.list(leadId);
      state.activities = (result.success && result.activities) || [];
      renderActivities();
    } catch (err) { /* silently fail */ }
  }

  async function reloadTasks() {
    try {
      if (API.cache) API.cache.invalidate('/cc/tasks');
      var result = await API.tasks.list({ lead_id: leadId });
      state.tasks = (result.success && result.tasks) || [];
      renderTasks();
    } catch (err) { /* silently fail */ }
  }

  // ─── Render All Sections ────────────────────────────────────
  function render() {
    renderHeader();
    renderStageBar();
    renderInfo();
    renderActivities();
    renderTasks();
    bindForms();
  }

  // ─── Header ─────────────────────────────────────────────────
  function renderHeader() {
    var el = $el('cc-lead-header');
    if (!el || !state.lead) return;
    var l = state.lead;

    if (isNewLead) {
      el.innerHTML =
        '<div class="cc-lead-header-main">' +
          '<h1 class="cc-lead-title">New Lead</h1>' +
        '</div>';
      return;
    }

    el.innerHTML =
      '<div class="cc-lead-header-main">' +
        '<h1 class="cc-lead-title">' + escapeHtml(l.Client_Name || 'Unnamed Lead') + '</h1>' +
        '<span class="cc-badge cc-badge-' + API.util.stageColor(l.Lead_Stage) + '">' + escapeHtml(API.util.stageLabel(l.Lead_Stage)) + '</span>' +
        (l.Priority ? ' <span class="cc-badge cc-badge-' + API.util.priorityColor(l.Priority) + '">' + escapeHtml(l.Priority) + '</span>' : '') +
        (l.Disposition === 'WON' ? ' <span class="cc-badge cc-badge-green">WON</span>' : '') +
        (l.Disposition === 'LOST' ? ' <span class="cc-badge cc-badge-red">LOST</span>' : '') +
      '</div>' +
      '<div class="cc-lead-contact">' +
        (l.Client_Email ? '<a href="mailto:' + escapeHtml(l.Client_Email) + '">' + escapeHtml(l.Client_Email) + '</a>' : '') +
        (l.Client_Phone ? ' &middot; <a href="tel:' + escapeHtml(l.Client_Phone) + '">' + escapeHtml(l.Client_Phone) + '</a>' : '') +
      '</div>';
  }

  // ─── Stage Progression Bar ──────────────────────────────────
  function renderStageBar() {
    var el = $el('cc-stage-bar');
    if (!el || !state.lead) return;
    var currentStage = state.lead.Lead_Stage || 'NEW_LEAD';
    var currentIdx = STAGES.findIndex(function(s) { return s.key === currentStage; });
    if (currentIdx === -1) currentIdx = 0; // unknown stage defaults to first

    var html = '<div class="cc-stage-progress">';
    STAGES.forEach(function(s, i) {
      var cls = 'cc-stage-step';
      if (i < currentIdx) cls += ' cc-stage-done';
      if (i === currentIdx) cls += ' cc-stage-current';
      if (i > currentIdx) cls += ' cc-stage-future';
      html += '<div class="' + cls + '" data-stage="' + s.key + '">';
      html += '<div class="cc-stage-dot"></div>';
      html += '<div class="cc-stage-label">' + s.label + '</div>';
      html += '</div>';
    });
    html += '</div>';

    // Advance button (if not closed)
    if (state.lead.Disposition === 'OPEN' && currentIdx < STAGES.length - 1) {
      var nextStage = STAGES[currentIdx + 1];
      html += '<div class="cc-stage-actions">';
      html += '<button class="cc-btn cc-btn-primary" id="cc-advance-stage-btn">Advance to ' + nextStage.label + '</button>';
      if (currentIdx >= 3) { // After MEETING_DONE, allow close
        html += ' <button class="cc-btn cc-btn-success" id="cc-close-won-btn">Close — Won</button>';
        html += ' <button class="cc-btn cc-btn-danger" id="cc-close-lost-btn">Close — Lost</button>';
      }
      html += '</div>';
    }
    el.innerHTML = html;

    // Bind advance
    var advBtn = $el('cc-advance-stage-btn');
    if (advBtn) {
      advBtn.addEventListener('click', function() {
        var nextStage = STAGES[currentIdx + 1];
        advanceStage(nextStage.key);
      });
    }

    // Bind close won
    var wonBtn = $el('cc-close-won-btn');
    if (wonBtn) {
      wonBtn.addEventListener('click', function() {
        advanceStage('READY_TO_DRAFT', { disposition: 'WON' });
      });
    }

    // Bind close lost
    var lostBtn = $el('cc-close-lost-btn');
    if (lostBtn) {
      lostBtn.addEventListener('click', function() {
        var reason = prompt('Close reason (PRICE, NOT_QUALIFIED, NO_RESPONSE, TIMING, COMPETITOR, DUPLICATE, OTHER):');
        if (!reason) return;
        advanceStage('READY_TO_DRAFT', { disposition: 'LOST', close_reason: reason.toUpperCase() });
      });
    }
  }

  async function advanceStage(newStage, opts) {
    try {
      var result = await API.leads.updateStage(leadId, newStage, opts || {});
      if (result.success) {
        reloadLead(); // Only reload lead (stage changed)
      } else {
        alert('Stage update failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Stage update failed: ' + (err.error || (err.errors ? err.errors.join('; ') : 'Network error')));
    }
  }

  // ─── Lead Info Grid ─────────────────────────────────────────
  function editableInput(field, value, type, placeholder) {
    var val = value || '';
    return '<input type="' + type + '" class="cc-info-input" data-field="' + escapeAttr(field) + '" ' +
      'data-original="' + escapeAttr(val) + '" value="' + escapeAttr(val) + '" ' +
      'placeholder="' + escapeAttr(placeholder) + '">';
  }

  function renderInfo() {
    var el = $el('cc-lead-info');
    if (!el || !state.lead) return;
    var l = state.lead;

    // ── Contact fields (editable) ──
    var contactFields = [
      { label: 'First Name', html: editableInput('First_Name', l.First_Name, 'text', 'Enter first name') },
      { label: 'Last Name', html: editableInput('Last_Name', l.Last_Name, 'text', 'Enter last name') },
      { label: 'Email', html: editableInput('Client_Email', l.Client_Email, 'email', 'Enter email') },
      { label: 'Phone', html: editableInput('Client_Phone', l.Client_Phone, 'tel', 'Enter phone') },
      { label: 'Address', html: editableInput('Client_Address', l.Client_Address, 'text', 'Enter address') },
      { label: 'Company', html: editableInput('Company', l.Company, 'text', 'Enter company') }
    ];

    var html = '<div class="cc-info-section-label">Contact Information</div>';
    html += '<div class="cc-info-grid">';
    contactFields.forEach(function(f) {
      html += '<div class="cc-info-item"><div class="cc-info-label">' + f.label + '</div>' + f.html + '</div>';
    });
    html += '</div>';

    // For new leads, show only contact fields + Create button
    if (isNewLead) {
      html += '<div style="margin-top:1rem;text-align:right">' +
        '<button id="cc-create-lead-btn" class="cc-btn cc-btn-primary">Create Lead</button></div>';
      el.innerHTML = html;
      bindInfoEdits();
      return;
    }

    // ── Lead details (read-only) ──
    var detailFields = [
      { label: 'Practice Area', value: formatPracticeArea(l.Practice_Area) },
      { label: 'Service Package', value: formatPracticeArea(l.Service_Package) },
      { label: 'Source', value: l.Source || '—' },
      { label: 'Owner', value: l.Lead_Owner_Name || '—' },
      { label: 'Responsible Lawyer', value: l.Responsible_Lawyer_Name || '—' },
      { label: 'Created', value: API.util.formatDateTime(l.Created_At) },
      { label: 'Last Contact', value: API.util.formatRelativeTime(l.Last_Contacted_At) || '—' },
      { label: 'Next Action', value: API.util.formatDateTime(l.Next_Action_At) || '—' },
      { label: 'Est. Closing Date', html: renderClosingDateField(l) },
      { label: 'Services Required', html: renderServicesField(l) },
      { label: 'Consent', value: l.Consent_Status || 'UNKNOWN' }
    ];

    if (l.Disposition !== 'OPEN') {
      detailFields.push({ label: 'Disposition', value: l.Disposition });
      if (l.Close_Reason) detailFields.push({ label: 'Close Reason', value: l.Close_Reason });
      if (l.Intake_Received_At) detailFields.push({ label: 'Closed At', value: API.util.formatDateTime(l.Intake_Received_At) });
    }

    if (l.Clio_Contact_ID) detailFields.push({ label: 'Clio Contact', value: l.Clio_Contact_ID });
    if (l.Clio_Matter_ID) detailFields.push({ label: 'Clio Matter', value: l.Clio_Matter_ID });

    html += '<div class="cc-info-divider"></div>';
    html += '<div class="cc-info-section-label">Lead Details</div>';
    html += '<div class="cc-info-grid">';
    detailFields.forEach(function(f) {
      var valHtml = f.html ? f.html : '<div class="cc-info-value">' + escapeHtml(f.value || '') + '</div>';
      html += '<div class="cc-info-item"><div class="cc-info-label">' + f.label + '</div>' + valHtml + '</div>';
    });
    html += '</div>';

    el.innerHTML = html;
    bindInfoEdits();
  }

  // ─── Activity Timeline ──────────────────────────────────────
  function renderActivities() {
    var el = $el('cc-activity-timeline');
    if (!el) return;

    if (state.activities.length === 0) {
      el.innerHTML = '<div class="cc-empty">No activities logged yet.</div>';
      return;
    }

    var html = '<div class="cc-timeline">';
    state.activities.forEach(function(a) {
      var icon = getActivityIcon(a.Type);
      html += '<div class="cc-timeline-item">';
      html += '<div class="cc-timeline-icon">' + icon + '</div>';
      html += '<div class="cc-timeline-content">';
      html += '<div class="cc-timeline-header">';
      html += '<span class="cc-timeline-type">' + escapeHtml(a.Type || '') + '</span>';
      html += '<span class="cc-timeline-time">' + escapeHtml(API.util.formatRelativeTime(a.Occurred_At)) + '</span>';
      html += '</div>';
      html += '<div class="cc-timeline-subject">' + escapeHtml(a.Subject || '') + '</div>';
      if (a.Body) html += '<div class="cc-timeline-body">' + escapeHtml(a.Body) + '</div>';
      if (a.Duration_Minutes) html += '<div class="cc-timeline-meta">' + escapeHtml(String(a.Duration_Minutes)) + ' min</div>';
      if (a.Outcome) html += '<div class="cc-timeline-meta">Outcome: ' + escapeHtml(a.Outcome) + '</div>';
      html += '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function getActivityIcon(type) {
    var icons = {
      CALL: '&#128222;', MEETING: '&#128197;', EMAIL: '&#9993;',
      SMS: '&#128172;', NOTE: '&#128221;', TASK_COMPLETED: '&#9989;',
      STATUS_CHANGE: '&#128260;', FORM_SUBMISSION: '&#128203;'
    };
    return icons[type] || '&#128196;';
  }

  // ─── Task List ──────────────────────────────────────────────
  function renderTasks() {
    var el = $el('cc-task-list');
    if (!el) return;

    // Filter out ghost tasks (empty items from n8n alwaysOutputData)
    var validTasks = state.tasks.filter(function(t) { return t.id; });

    if (validTasks.length === 0) {
      el.innerHTML = '<div class="cc-empty">No tasks for this lead.</div>';
      return;
    }

    var html = '<div class="cc-task-list">';
    validTasks.forEach(function(t) {
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
    el.innerHTML = html;

    // Bind complete buttons
    el.querySelectorAll('.cc-task-complete-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var taskId = btn.dataset.taskId;
        try {
          var result = await API.tasks.update(taskId, { status: 'DONE' });
          if (result.success) reloadTasks(); // Only reload tasks
        } catch (err) {
          alert('Failed to complete task: ' + (err.error || 'Unknown error'));
        }
      });
    });
  }

  // ─── Bind Forms ─────────────────────────────────────────────
  function bindForms() {
    bindLogActivityForm();
    bindAddTaskForm();
    bindBackButton();
  }

  function bindLogActivityForm() {
    var form = $el('cc-log-activity-form');
    if (!form) return;

    // Only render form if not already rendered
    if (form.dataset.bound) return;
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

    $el('cc-act-submit').addEventListener('click', async function() {
      var btn = $el('cc-act-submit');
      if (btn.disabled) return;
      var type = $el('cc-act-type').value;
      var subject = $el('cc-act-subject').value.trim();
      if (!subject) { alert('Subject is required.'); return; }

      btn.disabled = true;
      try {
        var result = await API.activities.create({
          lead_id: leadId,
          type: type,
          subject: subject,
          body: $el('cc-act-body').value.trim(),
          duration_minutes: parseInt($el('cc-act-duration').value) || 0,
          outcome: $el('cc-act-outcome').value.trim()
        });
        if (result.success) {
          $el('cc-act-subject').value = '';
          $el('cc-act-body').value = '';
          $el('cc-act-duration').value = '';
          $el('cc-act-outcome').value = '';
          reloadActivities(); // Only reload activities
        }
      } catch (err) {
        alert('Failed: ' + (err.error || 'Unknown error'));
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindAddTaskForm() {
    var form = $el('cc-add-task-form');
    if (!form) return;

    if (form.dataset.bound) return;
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

    $el('cc-task-submit').addEventListener('click', async function() {
      var btn = $el('cc-task-submit');
      if (btn.disabled) return;
      var title = $el('cc-task-title').value.trim();
      if (!title) { alert('Task title is required.'); return; }

      btn.disabled = true;
      try {
        var result = await API.tasks.create({
          lead_id: leadId,
          title: title,
          due_at: $el('cc-task-due').value || '',
          task_type: $el('cc-task-type').value
        });
        if (result.success) {
          $el('cc-task-title').value = '';
          $el('cc-task-due').value = '';
          reloadTasks(); // Only reload tasks
        }
      } catch (err) {
        alert('Failed: ' + (err.error || 'Unknown error'));
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindBackButton() {
    var btn = $el('cc-back-btn');
    if (btn) {
      btn.addEventListener('click', function() {
        window.location.href = '/crm';
      });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────
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

  // ─── Inline Edit: Closing Date ───────────────────────────────
  function renderClosingDateField(l) {
    var val = l.Estimated_Closing_Date ? API.util.formatDate(l.Estimated_Closing_Date) : '---';
    return '<div class="cc-info-value cc-editable" id="cc-closing-date-val" title="Click to edit">' +
      escapeHtml(val) + ' <span class="cc-edit-icon">&#9998;</span></div>' +
      '<input type="date" id="cc-closing-date-input" class="cc-inline-date" style="display:none" ' +
      'value="' + escapeAttr(l.Estimated_Closing_Date || '') + '">';
  }

  function renderServicesField(l) {
    var display = formatServicesRequired(l);
    return '<div class="cc-info-value cc-editable" id="cc-services-val" title="Click to edit">' +
      escapeHtml(display) + ' <span class="cc-edit-icon">&#9998;</span></div>';
  }

  function bindInfoEdits() {
    // Closing Date: click to show date input
    var dateVal = document.getElementById('cc-closing-date-val');
    var dateInput = document.getElementById('cc-closing-date-input');
    if (dateVal && dateInput) {
      dateVal.addEventListener('click', function() {
        dateVal.style.display = 'none';
        dateInput.style.display = 'inline-block';
        dateInput.focus();
      });
      dateInput.addEventListener('change', async function() {
        var newDate = dateInput.value || null;
        try {
          var res = await API.leads.update(leadId, { Estimated_Closing_Date: newDate });
          if (res.success) {
            state.lead.Estimated_Closing_Date = newDate;
            renderInfo();
          } else {
            alert('Save failed: ' + (res.error || 'Unknown error'));
            dateInput.style.display = 'none';
            dateVal.style.display = '';
          }
        } catch (err) {
          alert('Save failed: ' + (err.error || 'Network error'));
          dateInput.style.display = 'none';
          dateVal.style.display = '';
        }
      });
      dateInput.addEventListener('blur', function() {
        // Re-show label if no change
        setTimeout(function() {
          if (dateInput.style.display !== 'none') {
            dateInput.style.display = 'none';
            dateVal.style.display = '';
          }
        }, 200);
      });
    }

    // Services: click to open modal
    var svcVal = document.getElementById('cc-services-val');
    if (svcVal) {
      svcVal.addEventListener('click', function() {
        showServicesModal();
      });
    }

    // Editable contact inputs: save on blur (skip for new leads — no record yet)
    if (!isNewLead) {
      document.querySelectorAll('.cc-info-input').forEach(function(inp) {
        inp.addEventListener('blur', async function() {
          var field = inp.getAttribute('data-field');
          var original = inp.getAttribute('data-original');
          var newVal = inp.value.trim();
          if (newVal === original) return;
          try {
            var update = {};
            update[field] = newVal;
            var res = await API.leads.update(leadId, update);
            if (res.success) {
              inp.setAttribute('data-original', newVal);
              state.lead[field] = newVal;
              inp.classList.add('cc-save-ok');
              setTimeout(function() { inp.classList.remove('cc-save-ok'); }, 1200);
            } else {
              inp.value = original;
              inp.classList.add('cc-save-err');
              setTimeout(function() { inp.classList.remove('cc-save-err'); }, 1500);
            }
          } catch (err) {
            inp.value = original;
            inp.classList.add('cc-save-err');
            setTimeout(function() { inp.classList.remove('cc-save-err'); }, 1500);
          }
        });
      });
    }

    // Create Lead button (new lead mode)
    var createBtn = document.getElementById('cc-create-lead-btn');
    if (createBtn) {
      createBtn.addEventListener('click', async function() {
        var data = {};
        document.querySelectorAll('.cc-info-input').forEach(function(inp) {
          var v = inp.value.trim();
          if (v) data[inp.getAttribute('data-field')] = v;
        });
        if (!data.First_Name && !data.Last_Name && !data.Client_Email) {
          alert('Please enter at least a name or email.');
          return;
        }
        // Build Client_Name from first + last
        var parts = [data.First_Name, data.Last_Name].filter(Boolean);
        if (parts.length) data.Client_Name = parts.join(' ');

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        try {
          var res = await API.leads.create(data);
          if (res.success && res.id) {
            window.location.href = '/crm/lead?id=' + res.id;
          } else {
            alert('Create failed: ' + (res.error || 'Unknown error'));
            createBtn.disabled = false;
            createBtn.textContent = 'Create Lead';
          }
        } catch (err) {
          alert('Create failed: ' + (err.error || 'Network error'));
          createBtn.disabled = false;
          createBtn.textContent = 'Create Lead';
        }
      });
    }
  }

  // ─── Services Selector Modal ────────────────────────────────
  var _priceBookCache = null;

  var PRACTICE_AREAS = [
    { key: 'ESTATE_PLANNING', label: 'Estate Planning' },
    { key: 'PROBATE', label: 'Probate' },
    { key: 'REAL_ESTATE', label: 'Real Estate' },
    { key: 'CORPORATE', label: 'Corporate' },
    { key: 'FAMILY_LAW', label: 'Family Law' },
    { key: 'OTHER', label: 'Other' }
  ];

  async function showServicesModal() {
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.id = 'cc-services-modal-overlay';
    overlay.innerHTML = '<div class="cc-modal" style="max-width:520px"><div class="cc-modal-header"><h3>Select Services</h3>' +
      '<button class="cc-modal-close" id="cc-svc-modal-close">&times;</button></div>' +
      '<div class="cc-modal-body" id="cc-svc-modal-body"><p>Loading services...</p></div>' +
      '<div class="cc-modal-footer">' +
      '<span id="cc-svc-selected-count" style="font-size:13px;color:#666;margin-right:auto;"></span>' +
      '<button class="cc-btn cc-btn-primary" id="cc-svc-modal-save">Save</button> ' +
      '<button class="cc-btn" id="cc-svc-modal-cancel">Cancel</button></div></div>';
    document.body.appendChild(overlay);

    var closeModal = function() { overlay.remove(); };
    document.getElementById('cc-svc-modal-close').addEventListener('click', closeModal);
    document.getElementById('cc-svc-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    try {
      if (!_priceBookCache) {
        var res = await API.priceBook.list();
        _priceBookCache = (res.items || []).filter(function(i) { return i.Is_Active; });
      }
      var items = _priceBookCache;
      var currentIds = (state.lead.Services_Required || []).filter(function(s) {
        return typeof s === 'string' && s.startsWith('rec');
      });

      var body = document.getElementById('cc-svc-modal-body');
      if (!items.length) {
        body.innerHTML = '<p>No active services in price book. <a href="/crm/admin">Add services</a> first.</p>';
        return;
      }

      // Group items by Practice_Area
      var grouped = {};
      PRACTICE_AREAS.forEach(function(pa) { grouped[pa.key] = []; });
      items.forEach(function(item) {
        var key = item.Practice_Area || 'OTHER';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
      });

      // Only show practice areas that have services
      var activePAs = PRACTICE_AREAS.filter(function(pa) {
        return grouped[pa.key] && grouped[pa.key].length > 0;
      });

      // Render accordion — all practice areas collapsed by default
      var html = '<div style="max-height:400px;overflow-y:auto;">';

      activePAs.forEach(function(pa) {
        var paItems = grouped[pa.key];
        var selectedInPa = paItems.filter(function(i) { return currentIds.indexOf(i.id) !== -1; }).length;
        var badge = selectedInPa > 0 ? ' <span class="cc-svc-pa-badge" data-pa="' + escapeAttr(pa.key) + '" style="background:#2563eb;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:6px;">' + selectedInPa + '</span>' : '<span class="cc-svc-pa-badge" data-pa="' + escapeAttr(pa.key) + '"></span>';

        // Accordion header
        html += '<div class="cc-svc-pa-header" data-pa="' + escapeAttr(pa.key) + '" ' +
          'style="display:flex;align-items:center;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:4px;cursor:pointer;user-select:none;">' +
          '<span class="cc-svc-pa-arrow" data-pa="' + escapeAttr(pa.key) + '" style="margin-right:8px;font-size:12px;color:#64748b;transition:transform 0.15s;">&#9654;</span>' +
          '<strong style="flex:1;font-size:14px;color:#334155;">' + escapeHtml(pa.label) + '</strong>' +
          '<span style="color:#94a3b8;font-size:13px;margin-right:4px;">' + paItems.length + ' service' + (paItems.length > 1 ? 's' : '') + '</span>' +
          badge +
          '</div>';

        // Accordion body (hidden by default)
        html += '<div class="cc-svc-pa-body" data-pa="' + escapeAttr(pa.key) + '" style="display:none;margin:0 0 8px 0;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;padding:4px 0;">';
        paItems.forEach(function(item) {
          var checked = currentIds.indexOf(item.id) !== -1 ? ' checked' : '';
          html += '<label style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;gap:8px;">' +
            '<input type="checkbox" class="cc-svc-checkbox" data-pa="' + escapeAttr(pa.key) + '" value="' + escapeAttr(item.id) + '"' + checked + '> ' +
            '<span style="flex:1;">' + escapeHtml(item.Service_Name) + '</span>' +
            (item.List_Price ? '<span style="color:#2563eb;font-size:13px;white-space:nowrap;">$' + Number(item.List_Price).toLocaleString() + '</span>' : '') +
            '</label>';
        });
        html += '</div>';
      });

      html += '</div>';
      body.innerHTML = html;

      // Update selected count + per-area badges
      function updateSelectedCount() {
        var total = overlay.querySelectorAll('.cc-svc-checkbox:checked').length;
        var countEl = document.getElementById('cc-svc-selected-count');
        if (countEl) countEl.textContent = total > 0 ? total + ' service' + (total > 1 ? 's' : '') + ' selected' : '';
        // Update per-area badges
        activePAs.forEach(function(pa) {
          var count = overlay.querySelectorAll('.cc-svc-checkbox[data-pa="' + pa.key + '"]:checked').length;
          var badgeEl = overlay.querySelector('.cc-svc-pa-badge[data-pa="' + pa.key + '"]');
          if (badgeEl) {
            if (count > 0) {
              badgeEl.textContent = count;
              badgeEl.style.cssText = 'background:#2563eb;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:6px;';
            } else {
              badgeEl.textContent = '';
              badgeEl.style.cssText = '';
            }
          }
        });
      }
      updateSelectedCount();

      // Bind checkbox changes
      overlay.querySelectorAll('.cc-svc-checkbox').forEach(function(cb) {
        cb.addEventListener('change', updateSelectedCount);
      });

      // Bind accordion toggle
      overlay.querySelectorAll('.cc-svc-pa-header').forEach(function(header) {
        header.addEventListener('click', function() {
          var pa = header.dataset.pa;
          var bodyEl = overlay.querySelector('.cc-svc-pa-body[data-pa="' + pa + '"]');
          var arrow = overlay.querySelector('.cc-svc-pa-arrow[data-pa="' + pa + '"]');
          if (bodyEl.style.display === 'none') {
            bodyEl.style.display = '';
            arrow.style.transform = 'rotate(90deg)';
          } else {
            bodyEl.style.display = 'none';
            arrow.style.transform = '';
          }
        });
      });

      // Bind save — collect ALL checked checkboxes across all panels
      document.getElementById('cc-svc-modal-save').addEventListener('click', async function() {
        var checkboxes = overlay.querySelectorAll('.cc-svc-checkbox');
        var selectedIds = [];
        checkboxes.forEach(function(cb) { if (cb.checked) selectedIds.push(cb.value); });

        try {
          var saveRes = await API.leads.update(leadId, { Services_Required: selectedIds });
          if (saveRes.success) {
            state.lead.Services_Required = selectedIds;
            state.lead._serviceNames = items.filter(function(i) { return selectedIds.indexOf(i.id) !== -1; })
              .map(function(i) { return i.Service_Name; });
            renderInfo();
            closeModal();
          } else {
            alert('Save failed: ' + (saveRes.error || 'Unknown error'));
          }
        } catch (err) {
          alert('Save failed: ' + (err.error || 'Network error'));
        }
      });
    } catch (err) {
      var body = document.getElementById('cc-svc-modal-body');
      if (body) body.innerHTML = '<p class="cc-error">Failed to load services: ' + escapeHtml(err.error || 'Network error') + '</p>';
    }
  }

  function formatServicesRequired(lead) {
    // Use cached names if available
    if (lead._serviceNames && lead._serviceNames.length) return lead._serviceNames.join(', ');
    var services = lead.Services_Required || [];
    if (!services.length) return '---';
    // If Airtable returns lookup names, use them; otherwise show count
    if (typeof services[0] === 'string' && services[0].startsWith('rec')) {
      return services.length + ' service' + (services.length > 1 ? 's' : '') + ' linked';
    }
    return services.join(', ');
  }

  function showError(msg) {
    var el = $el('cc-lead-detail');
    if (el) el.innerHTML = '<div class="cc-error"><p>' + escapeHtml(msg) + '</p><button class="cc-btn" onclick="window.location.href=\'/crm\'">Back to Leads</button></div>';
  }

  // ─── Initialize ──────────────────────────────────────────────
  function injectStyles() {
    var s = document.createElement('style');
    s.textContent =
      '.cc-editable{cursor:pointer;border-bottom:1px dashed #cbd5e1;transition:background .15s}' +
      '.cc-editable:hover{background:#f0f7ff}' +
      '.cc-edit-icon{font-size:11px;opacity:.4;margin-left:2px}' +
      '.cc-editable:hover .cc-edit-icon{opacity:.8}' +
      '.cc-info-label{display:block;margin-bottom:4px}' +
      '.cc-inline-date{padding:2px 6px;border:1px solid #94a3b8;border-radius:4px;font-size:13px}' +
      '.cc-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center}' +
      '.cc-modal{background:#fff;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:90%;max-width:480px}' +
      '.cc-modal-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #e2e8f0}' +
      '.cc-modal-header h3{margin:0;font-size:16px}' +
      '.cc-modal-close{background:none;border:none;font-size:22px;cursor:pointer;color:#64748b}' +
      '.cc-modal-body{padding:16px 20px}' +
      '.cc-modal-footer{padding:12px 20px;border-top:1px solid #e2e8f0;text-align:right}' +
      '.cc-info-input{width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:0.9rem;color:#1F2937;background:#fff;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}' +
      '.cc-info-input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}' +
      '.cc-info-input::placeholder{color:#9ca3af}' +
      '.cc-info-input.cc-save-ok{border-color:#22c55e;background:#f0fdf4}' +
      '.cc-info-input.cc-save-err{border-color:#ef4444;background:#fef2f2}' +
      '.cc-info-section-label{font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:8px;padding-bottom:4px}' +
      '.cc-info-divider{border:none;border-top:1px solid #e2e8f0;margin:16px 0}';
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
