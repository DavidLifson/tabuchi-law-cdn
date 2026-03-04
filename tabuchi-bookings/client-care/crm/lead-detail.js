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
  // Use last element with ID to avoid Webflow dual-embed (hidden .w-embed copy)
  var $el = function(id) {
    var all = document.querySelectorAll('#' + id);
    return all.length ? all[all.length - 1] : null;
  };

  // Extract lead ID from URL: /crm/lead?id=xxx
  var params = API.util.getUrlParams();
  var leadId = params.id || '';

  if (!leadId || leadId === 'new') return; // 'new' is handled by a different script

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
    { key: 'MEETING1_BOOKED', label: 'Meeting Booked' },
    { key: 'MEETING1_COMPLETED', label: 'Meeting Done' },
    { key: 'INTAKE_COMPLETE_READY_TO_DRAFT', label: 'Ready to Draft' },
    { key: 'CLOSED_INTAKE_RECEIVED', label: 'Intake Received' }
  ];

  // ─── Load All Data ──────────────────────────────────────────
  async function loadData() {
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

    el.innerHTML =
      '<div class="cc-lead-header-main">' +
        '<h1 class="cc-lead-title">' + escapeHtml(l.Client_Name || 'Unnamed Lead') + '</h1>' +
        '<span class="cc-badge cc-badge-' + API.util.stageColor(l.Lead_Stage) + '">' + API.util.stageLabel(l.Lead_Stage) + '</span>' +
        (l.Priority ? ' <span class="cc-badge cc-badge-' + API.util.priorityColor(l.Priority) + '">' + l.Priority + '</span>' : '') +
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
      if (currentIdx >= 3) { // After MEETING1_COMPLETED, allow close
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
        advanceStage('CLOSED_INTAKE_RECEIVED', { disposition: 'WON' });
      });
    }

    // Bind close lost
    var lostBtn = $el('cc-close-lost-btn');
    if (lostBtn) {
      lostBtn.addEventListener('click', function() {
        var reason = prompt('Close reason (PRICE, NOT_QUALIFIED, NO_RESPONSE, TIMING, COMPETITOR, DUPLICATE, OTHER):');
        if (!reason) return;
        advanceStage('CLOSED_INTAKE_RECEIVED', { disposition: 'LOST', close_reason: reason.toUpperCase() });
      });
    }
  }

  async function advanceStage(newStage, opts) {
    try {
      var result = await API.leads.updateStage(leadId, newStage, opts || {});
      if (result.success) {
        loadData(); // Reload all
      } else {
        alert('Stage update failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Stage update failed: ' + (err.error || err.errors ? err.errors.join('; ') : 'Network error'));
    }
  }

  // ─── Lead Info Grid ─────────────────────────────────────────
  function renderInfo() {
    var el = $el('cc-lead-info');
    if (!el || !state.lead) return;
    var l = state.lead;

    var fields = [
      { label: 'Practice Area', value: formatPracticeArea(l.Practice_Area) },
      { label: 'Service Package', value: formatPracticeArea(l.Service_Package) },
      { label: 'Source', value: l.Source || '—' },
      { label: 'Owner', value: l.Lead_Owner_Name || '—' },
      { label: 'Responsible Lawyer', value: l.Responsible_Lawyer_Name || '—' },
      { label: 'Created', value: API.util.formatDateTime(l.Created_At) },
      { label: 'Last Contact', value: API.util.formatRelativeTime(l.Last_Contacted_At) || '—' },
      { label: 'Next Action', value: API.util.formatDateTime(l.Next_Action_At) || '—' },
      { label: 'Consent', value: l.Consent_Status || 'UNKNOWN' },
      { label: 'Lead ID', value: l.Lead_ID || l.id }
    ];

    if (l.Disposition !== 'OPEN') {
      fields.push({ label: 'Disposition', value: l.Disposition });
      if (l.Close_Reason) fields.push({ label: 'Close Reason', value: l.Close_Reason });
      if (l.Intake_Received_At) fields.push({ label: 'Closed At', value: API.util.formatDateTime(l.Intake_Received_At) });
    }

    if (l.Clio_Contact_ID) fields.push({ label: 'Clio Contact', value: l.Clio_Contact_ID });
    if (l.Clio_Matter_ID) fields.push({ label: 'Clio Matter', value: l.Clio_Matter_ID });

    var html = '<div class="cc-info-grid">';
    fields.forEach(function(f) {
      html += '<div class="cc-info-item"><span class="cc-info-label">' + f.label + '</span><span class="cc-info-value">' + escapeHtml(f.value || '') + '</span></div>';
    });
    html += '</div>';
    el.innerHTML = html;
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
      html += '<span class="cc-timeline-time">' + API.util.formatRelativeTime(a.Occurred_At) + '</span>';
      html += '</div>';
      html += '<div class="cc-timeline-subject">' + escapeHtml(a.Subject || '') + '</div>';
      if (a.Body) html += '<div class="cc-timeline-body">' + escapeHtml(a.Body) + '</div>';
      if (a.Duration_Minutes) html += '<div class="cc-timeline-meta">' + a.Duration_Minutes + ' min</div>';
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

    if (state.tasks.length === 0) {
      el.innerHTML = '<div class="cc-empty">No tasks for this lead.</div>';
      return;
    }

    var html = '<div class="cc-task-list">';
    state.tasks.forEach(function(t) {
      var isDone = t.Status === 'DONE';
      var isOverdue = !isDone && t.Due_At && new Date(t.Due_At) < new Date();
      var cls = 'cc-task-item' + (isDone ? ' cc-task-done' : '') + (isOverdue ? ' cc-task-overdue' : '');

      html += '<div class="' + cls + '" data-task-id="' + t.id + '">';
      html += '<div class="cc-task-check">';
      if (!isDone) {
        html += '<button class="cc-task-complete-btn" data-task-id="' + t.id + '" title="Mark complete">&#9744;</button>';
      } else {
        html += '<span class="cc-task-completed-icon">&#9745;</span>';
      }
      html += '</div>';
      html += '<div class="cc-task-info">';
      html += '<div class="cc-task-title">' + escapeHtml(t.Title || '') + '</div>';
      if (t.Description) html += '<div class="cc-task-desc">' + escapeHtml(t.Description) + '</div>';
      html += '<div class="cc-task-meta">';
      if (t.Due_At) html += '<span class="' + (isOverdue ? 'cc-text-red' : '') + '">Due: ' + API.util.formatDate(t.Due_At) + '</span>';
      if (t.Task_Type) html += ' &middot; ' + t.Task_Type;
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
          if (result.success) loadData();
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
      var type = $el('cc-act-type').value;
      var subject = $el('cc-act-subject').value.trim();
      if (!subject) { alert('Subject is required.'); return; }

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
          loadData();
        }
      } catch (err) {
        alert('Failed: ' + (err.error || 'Unknown error'));
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
          '<option value="SLA_CONTACT">SLA Contact</option>' +
          '<option value="MEETING2_SCHEDULE">Schedule Meeting #2</option>' +
          '<option value="DRAFTING">Drafting</option>' +
        '</select>' +
        '<button id="cc-task-submit" class="cc-btn cc-btn-primary">Add</button>' +
      '</div>';

    $el('cc-task-submit').addEventListener('click', async function() {
      var title = $el('cc-task-title').value.trim();
      if (!title) { alert('Task title is required.'); return; }

      try {
        var result = await API.tasks.create({
          lead_id: leadId,
          title: title,
          due_at: $el('cc-task-due').value ? new Date($el('cc-task-due').value).toISOString() : '',
          task_type: $el('cc-task-type').value
        });
        if (result.success) {
          $el('cc-task-title').value = '';
          $el('cc-task-due').value = '';
          loadData();
        }
      } catch (err) {
        alert('Failed: ' + (err.error || 'Unknown error'));
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
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPracticeArea(pa) {
    if (!pa) return '—';
    return pa.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
  }

  function showError(msg) {
    var el = $el('cc-lead-detail');
    if (el) el.innerHTML = '<div class="cc-error"><p>' + escapeHtml(msg) + '</p><button class="cc-btn" onclick="window.location.href=\'/crm\'">Back to Leads</button></div>';
  }

  // ─── Initialize ──────────────────────────────────────────────
  function init() {
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
