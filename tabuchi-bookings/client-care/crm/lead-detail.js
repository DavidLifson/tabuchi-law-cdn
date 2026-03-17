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

  // Extract lead ID from URL: /crm/lead?id=xxx
  var params = API.util.getUrlParams();
  var leadId = params.id || '';

  var isNewLead = (!leadId || leadId === 'new');

  // ─── State ───────────────────────────────────────────────────
  var state = {
    lead: null,
    activities: [],
    tasks: [],
    recordings: [],
    recordingsLoaded: false,
    willTemplates: null,
    activeTab: params.tab || 'activity',
    loading: true,
    infoDirty: false,
    user: API.auth.getUser(),
    crmUsers: []
  };

  var LEAD_TABS = [
    { key: 'activity', label: 'Activity & Tasks' },
    { key: 'recordings', label: 'Recordings' }
  ];

  var _recRefreshTimer = null;

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
      var [leadResult, actResult, taskResult, usersResult] = await Promise.all([
        API.leads.get(leadId),
        API.activities.list(leadId),
        API.tasks.list({ lead_id: leadId }),
        API.admin.listUsers().catch(function() { return { users: [] }; })
      ]);

      if (leadResult.success && leadResult.lead) {
        state.lead = leadResult.lead;
      } else {
        showError('Lead not found or access denied.');
        return;
      }

      state.activities = (actResult.success && actResult.activities) || [];
      state.tasks = (taskResult.success && taskResult.tasks) || [];
      state.crmUsers = (usersResult.users || []).filter(function(u) { return u.is_active; });

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
    renderTabs();
    renderActivities();
    renderTasks();
    bindForms();
    switchTab(state.activeTab);
  }

  // ─── Tab System ───────────────────────────────────────────────
  function renderTabs() {
    var el = $el('cc-lead-tabs');
    if (!el || isNewLead) return;

    var html = '';
    LEAD_TABS.forEach(function(tab) {
      var cls = 'cc-lead-tab' + (state.activeTab === tab.key ? ' cc-tab-active' : '');
      var badge = '';
      if (tab.key === 'recordings' && state.recordings.length > 0) {
        badge = ' <span class="cc-tab-badge">' + state.recordings.length + '</span>';
      }
      html += '<button class="' + cls + '" data-tab="' + tab.key + '">' + tab.label + badge + '</button>';
    });
    el.innerHTML = html;

    el.querySelectorAll('.cc-lead-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTab(btn.dataset.tab);
      });
    });
  }

  function switchTab(tabKey) {
    state.activeTab = tabKey;

    // Update tab buttons
    var tabEl = $el('cc-lead-tabs');
    if (tabEl) {
      tabEl.querySelectorAll('.cc-lead-tab').forEach(function(btn) {
        btn.classList.toggle('cc-tab-active', btn.dataset.tab === tabKey);
      });
    }

    // Show/hide panels
    var actPanel = $el('cc-tab-activity-tasks');
    var recPanel = $el('cc-tab-recordings');

    if (actPanel) actPanel.style.display = tabKey === 'activity' ? '' : 'none';
    if (recPanel) recPanel.style.display = tabKey === 'recordings' ? '' : 'none';

    // Lazy-load recordings on first tab switch
    if (tabKey === 'recordings' && !state.recordingsLoaded) {
      loadRecordings();
    }

    // Manage auto-refresh for recordings
    if (tabKey === 'recordings') {
      startRecordingsRefresh();
    } else {
      stopRecordingsRefresh();
    }
  }

  // ─── Recordings Data ──────────────────────────────────────────
  async function loadRecordings() {
    var el = $el('cc-tab-recordings');
    if (!el) return;

    el.innerHTML = '<div style="text-align:center;padding:2rem;color:#6B7280;">Loading recordings...</div>';

    try {
      var result = await API.recordings.list({ lead_id: leadId });
      if (result.success) {
        state.recordings = result.recordings || [];
        state.recordingsLoaded = true;
        renderRecordings();
        renderTabs(); // Update badge count
      } else {
        el.innerHTML = '<div class="cc-error">' + escapeHtml(result.error || 'Failed to load recordings') + '</div>';
      }
    } catch (err) {
      el.innerHTML = '<div class="cc-error">' + escapeHtml(err.error || 'Failed to load recordings') + '</div>';
    }
  }

  async function reloadRecordings() {
    try {
      var result = await API.recordings.list({ lead_id: leadId });
      if (result.success) {
        state.recordings = result.recordings || [];
        renderRecordings();
        renderTabs();
      }
    } catch (err) { /* silently fail */ }
  }

  function startRecordingsRefresh() {
    stopRecordingsRefresh();
    var hasPending = state.recordings.some(function(r) {
      return ['pending', 'downloading', 'transcribing', 'analyzing'].indexOf((r.Status || '').toLowerCase()) >= 0;
    });
    if (hasPending) {
      _recRefreshTimer = setInterval(reloadRecordings, 15000);
    }
  }

  function stopRecordingsRefresh() {
    if (_recRefreshTimer) {
      clearInterval(_recRefreshTimer);
      _recRefreshTimer = null;
    }
  }

  // ─── Render Recordings Tab ────────────────────────────────────
  function renderRecordings() {
    var el = $el('cc-tab-recordings');
    if (!el) return;

    if (state.recordings.length === 0) {
      el.innerHTML = '<div class="cc-empty" style="padding:2rem;text-align:center;">' +
        '<p style="margin:0 0 .5rem;font-size:1.1rem;color:#6B7280;">No recordings linked to this lead.</p>' +
        '<p style="margin:0;font-size:.85rem;color:#9CA3AF;">Recordings from Teams/Zoom meetings will appear here automatically.</p>' +
        '</div>';
      return;
    }

    var html = '';

    state.recordings.forEach(function(rec, idx) {
      var statusCls = recStatusColor(rec.Status);
      var intentCls = recIntentColor(rec.AI_Client_Intent);
      var willCls = recWillColor(rec.Will_Status);
      var duration = formatDuration(rec.Duration_Seconds);
      var date = API.util.formatDateTime(rec.Meeting_Date || rec.Created_At);
      var source = (rec.Source || 'teams').toUpperCase();

      html += '<div class="cc-rec-card" data-rec-id="' + escapeAttr(rec.id) + '">';
      html += '<div class="cc-rec-card-header">';
      html += '<span class="cc-badge cc-badge-' + (source === 'ZOOM' ? 'blue' : 'purple') + '" style="font-size:.7rem;">' + escapeHtml(source) + '</span>';
      html += '<span class="cc-badge cc-badge-' + statusCls + '">' + escapeHtml(rec.Status || 'pending') + '</span>';
      if (rec.AI_Client_Intent) {
        html += '<span class="cc-badge cc-badge-' + intentCls + '">' + escapeHtml(rec.AI_Client_Intent) + '</span>';
      }
      if (rec.Will_Status && rec.Will_Status !== 'NOT_APPLICABLE') {
        html += '<span class="cc-badge cc-badge-' + willCls + '">Will: ' + escapeHtml(rec.Will_Status) + '</span>';
      }
      html += '<span class="cc-rec-card-meta" style="margin-left:auto;">' + escapeHtml(date) + (duration ? ' &middot; ' + duration : '') + '</span>';
      html += '</div>';

      // AI Summary
      if (rec.AI_Summary) {
        html += '<div class="cc-rec-summary">' + escapeHtml(rec.AI_Summary) + '</div>';
      }

      // Action Items (expandable)
      var actionItems = parseJson(rec.AI_Action_Items);
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
      }
      if (rec.Status === 'error') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-warning cc-rec-retry-btn" data-rec-id="' + escapeAttr(rec.id) + '">Retry Processing</button>';
      }
      if (rec.Reviewed_By) {
        html += '<span class="cc-rec-card-meta">Reviewed by ' + escapeHtml(rec.Reviewed_By_Name || rec.Reviewed_By) + '</span>';
      } else if (rec.Status === 'completed') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-success cc-rec-approve-btn" data-rec-id="' + escapeAttr(rec.id) + '">Mark Reviewed</button>';
      }
      html += '</div>';

      html += '</div>'; // end card
    });

    // Will Generation Panel (show if any recording is completed + estate practice area)
    var lead = state.lead || {};
    var hasCompleted = state.recordings.some(function(r) { return r.Status === 'completed'; });
    var isEstate = ['ESTATE_PLANNING', 'Estate Planning'].indexOf(lead.Practice_Area) >= 0;
    var hasIntake = !!lead.Intake_Received_At;

    if (hasCompleted && isEstate) {
      html += renderWillPanel(lead, hasIntake);
    }

    // Clio section
    var hasWill = state.recordings.some(function(r) { return r.Will_Status === 'GENERATED' || r.Will_Status === 'UPLOADED_TO_CLIO'; });
    if (hasWill) {
      html += renderClioSection();
    }

    el.innerHTML = html;
    bindRecordingActions();
  }

  function renderWillPanel(lead, hasIntake) {
    var html = '<div class="cc-will-panel">';
    html += '<h3>Will Draft Generation</h3>';

    if (!hasIntake) {
      html += '<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:.75rem;font-size:.85rem;color:#92400E;margin-bottom:.75rem;">';
      html += 'Intake form not yet received. Will generation requires intake data. You can still generate a draft using AI meeting notes only.';
      html += '</div>';
    }

    html += '<div class="cc-will-grid">';
    html += '<div class="cc-will-field"><label>Template</label>';
    html += '<select id="cc-will-template">';
    html += '<option value="">Select template...</option>';
    html += '<option value="SIMPLE_WILL_V1">Simple Will</option>';
    html += '<option value="COUPLES_WILL_V1">Couples Will (Mirror)</option>';
    html += '<option value="BLENDED_FAMILY_WILL_V1">Blended Family Will</option>';
    html += '</select></div>';

    // Key override fields
    html += '<div class="cc-will-field"><label>Client Name</label>';
    html += '<input id="cc-will-client-name" value="' + escapeAttr(lead.Client_Name) + '"></div>';
    html += '<div class="cc-will-field"><label>Executor</label>';
    html += '<input id="cc-will-executor" placeholder="Primary executor"></div>';
    html += '<div class="cc-will-field"><label>Guardian</label>';
    html += '<input id="cc-will-guardian" placeholder="Primary guardian (if minors)"></div>';
    html += '</div>';

    html += '<div class="cc-will-actions">';
    html += '<button class="cc-btn cc-btn-primary" id="cc-will-generate-btn">Generate Will Draft</button>';

    // Show download if any recording has a generated will
    var genRec = state.recordings.find(function(r) { return r.Will_Status === 'GENERATED' || r.Will_Status === 'UPLOADED_TO_CLIO'; });
    if (genRec && genRec.Will_Blob_URL) {
      html += ' <a class="cc-btn cc-btn-success" href="' + escapeAttr(genRec.Will_Blob_URL) + '" target="_blank" rel="noopener">Download Will Draft</a>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderClioSection() {
    var html = '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:1rem;margin-top:1rem;">';
    html += '<h3 style="font-size:1rem;font-weight:600;margin:0 0 .5rem;">Clio Integration</h3>';

    var lead = state.lead || {};
    if (lead.Clio_Matter_ID) {
      html += '<p style="font-size:.85rem;color:#374151;margin:0 0 .5rem;">Matter ID: <strong>' + escapeHtml(lead.Clio_Matter_ID) + '</strong></p>';
    }

    var uploadableRec = state.recordings.find(function(r) { return r.Will_Status === 'GENERATED'; });
    if (uploadableRec) {
      html += '<button class="cc-btn cc-btn-primary cc-clio-upload-btn" data-rec-id="' + escapeAttr(uploadableRec.id) + '">Upload Will to Clio</button>';
    }

    var uploadedRec = state.recordings.find(function(r) { return r.Will_Status === 'UPLOADED_TO_CLIO'; });
    if (uploadedRec) {
      html += '<span class="cc-badge cc-badge-green" style="margin-left:.5rem;">Uploaded to Clio</span>';
      if (uploadedRec.Will_Clio_Document_ID) {
        html += ' <span style="font-size:.8rem;color:#6B7280;">Doc ID: ' + escapeHtml(uploadedRec.Will_Clio_Document_ID) + '</span>';
      }
    }

    html += '</div>';
    return html;
  }

  function bindRecordingActions() {
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
          arrow.style.transform = 'rotate(90deg)';
          if (!body.dataset.loaded) {
            body.innerHTML = '<div style="color:#6B7280;padding:.5rem;">Loading transcript...</div>';
            loadTranscript(recId, body);
          }
        } else {
          body.style.display = 'none';
          arrow.style.transform = '';
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
          if (res.success) reloadRecordings();
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
          if (res.success) reloadRecordings();
          else ccToast('Failed: ' + (res.error || 'Unknown error'), 'error');
        } catch (err) {
          ccToast('Failed: ' + (err.error || 'Network error'), 'error');
        }
        btn.disabled = false;
      });
    });

    // Will generate button
    var genBtn = document.getElementById('cc-will-generate-btn');
    if (genBtn) {
      genBtn.addEventListener('click', async function() {
        var templateId = (document.getElementById('cc-will-template') || {}).value;
        if (!templateId) { ccToast('Please select a template.', 'info'); return; }

        var overrides = {};
        var clientName = (document.getElementById('cc-will-client-name') || {}).value;
        var executor = (document.getElementById('cc-will-executor') || {}).value;
        var guardian = (document.getElementById('cc-will-guardian') || {}).value;
        if (clientName) overrides.client_name = clientName;
        if (executor) overrides.executor_primary = executor;
        if (guardian) overrides.guardian_primary = guardian;

        // Find best recording (most recent completed)
        var targetRec = state.recordings.find(function(r) { return r.Status === 'completed'; });
        if (!targetRec) { ccToast('No completed recording available.', 'info'); return; }

        genBtn.disabled = true;
        genBtn.textContent = 'Generating...';
        try {
          var res = await API.recordings.generateWill(targetRec.id, templateId, overrides);
          if (res.success) {
            ccToast('Will draft generated successfully!', 'success');
            reloadRecordings();
          } else {
            ccToast('Generation failed: ' + (res.error || 'Unknown error'), 'error');
          }
        } catch (err) {
          ccToast('Generation failed: ' + (err.error || 'Network error'), 'error');
        }
        genBtn.disabled = false;
        genBtn.textContent = 'Generate Will Draft';
      });
    }

    // Clio upload button
    document.querySelectorAll('.cc-clio-upload-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        btn.disabled = true;
        btn.textContent = 'Uploading...';
        try {
          var res = await API.recordings.uploadToClio(btn.dataset.recId);
          if (res.success) {
            ccToast('Will uploaded to Clio successfully!', 'success');
            reloadRecordings();
            reloadLead(); // Refresh Clio IDs
          } else {
            ccToast('Upload failed: ' + (res.error || 'Unknown error'), 'error');
          }
        } catch (err) {
          ccToast('Upload failed: ' + (err.error || 'Network error'), 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Upload Will to Clio';
      });
    });
  }

  async function loadTranscript(recId, bodyEl) {
    try {
      var res = await API.recordings.get(recId);
      if (res.success && res.recording) {
        var transcript = res.recording.Transcript_Text || '';
        if (!transcript && res.recording.Blob_Transcript_URL) {
          bodyEl.innerHTML = '<div style="color:#6B7280;">Transcript available for download. <a href="' +
            escapeAttr(res.recording.Blob_Transcript_URL) + '" target="_blank">Open transcript file</a></div>';
        } else if (transcript) {
          bodyEl.innerHTML = formatTranscript(transcript);
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

  function formatTranscript(text) {
    // Format speaker labels: "Speaker 1:" → styled span
    return escapeHtml(text).replace(/^(Speaker \d+):/gm, '<span class="cc-speaker">$1:</span>');
  }

  // ─── Recording Helpers ──────────────────────────────────────
  function recStatusColor(status) {
    var map = { completed: 'green', pending: 'gray', downloading: 'blue', transcribing: 'blue', analyzing: 'blue', error: 'red' };
    return map[(status || '').toLowerCase()] || 'gray';
  }
  function recIntentColor(intent) {
    var map = { PROCEED: 'green', UNDECIDED: 'yellow', DECLINED: 'red', NEEDS_FOLLOWUP: 'blue' };
    return map[intent] || 'gray';
  }
  function recWillColor(status) {
    var map = { PENDING_REVIEW: 'yellow', GENERATING: 'blue', GENERATED: 'green', UPLOADED_TO_CLIO: 'green', NOT_APPLICABLE: 'gray' };
    return map[status] || 'gray';
  }
  function formatDuration(seconds) {
    if (!seconds) return '';
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function parseJson(str) {
    if (!str) return null;
    if (Array.isArray(str)) return str;
    try { return JSON.parse(str); } catch (e) { return null; }
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

    var canDelete = _u && ((_u.role || '').toUpperCase() === 'ADMIN' || (_u.role || '').toUpperCase() === 'MANAGER' || _u.is_admin);

    el.innerHTML =
      '<div class="cc-lead-header-main">' +
        '<h1 class="cc-lead-title">' + escapeHtml(l.Client_Name || l.Client_Email || l.Client_Phone || 'Unnamed Lead') + '</h1>' +
        '<span class="cc-badge cc-badge-' + API.util.stageColor(l.Lead_Stage) + '">' + escapeHtml(API.util.stageLabel(l.Lead_Stage)) + '</span>' +
        (l.Priority ? ' <span class="cc-badge cc-badge-' + API.util.priorityColor(l.Priority) + '">' + escapeHtml(l.Priority) + '</span>' : '') +
        (l.Disposition === 'WON' ? ' <span class="cc-badge cc-badge-green">WON</span>' : '') +
        (l.Disposition === 'LOST' ? ' <span class="cc-badge cc-badge-red">LOST</span>' : '') +
        (canDelete ? ' <button class="cc-btn cc-btn-sm cc-btn-danger" id="cc-delete-lead" style="margin-left:12px;">Delete Lead</button>' : '') +
      '</div>' +
      '<div class="cc-lead-contact">' +
        (l.Client_Email ? '<a href="mailto:' + escapeHtml(l.Client_Email) + '">' + escapeHtml(l.Client_Email) + '</a>' : '') +
        (l.Client_Phone ? ' &middot; <a href="tel:' + escapeHtml(l.Client_Phone) + '">' + escapeHtml(l.Client_Phone) + '</a>' : '') +
      '</div>';

    // Bind delete button
    var delBtn = document.getElementById('cc-delete-lead');
    if (delBtn) {
      delBtn.addEventListener('click', async function() {
        if (!confirm('Are you sure you want to delete this lead? This will also remove all associated activities and tasks.')) return;
        if (!confirm('This action cannot be undone. Delete "' + (l.Client_Name || 'this lead') + '" permanently?')) return;
        try {
          delBtn.disabled = true;
          delBtn.textContent = 'Deleting…';
          var result = await API.leads.delete(state.lead.id);
          if (result.success) {
            ccToast('Lead deleted successfully.', 'success');
            window.location.href = '/crm';
          } else {
            ccToast('Delete failed: ' + (result.error || 'Unknown error'), 'error');
            delBtn.disabled = false;
            delBtn.textContent = 'Delete Lead';
          }
        } catch (err) {
          ccToast('Delete failed: ' + (err.error || err.message || 'Unknown error'), 'error');
          delBtn.disabled = false;
          delBtn.textContent = 'Delete Lead';
        }
      });
    }
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
        ccToast('Stage update failed: ' + (result.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      ccToast('Stage update failed: ' + (err.error || (err.errors ? err.errors.join('; ') : 'Network error')), 'error');
    }
  }

  // ─── Lead Info Grid ─────────────────────────────────────────
  function editableInput(field, value, type, placeholder) {
    var val = value || '';
    return '<input type="' + type + '" class="cc-info-input" data-field="' + escapeAttr(field) + '" ' +
      'data-original="' + escapeAttr(val) + '" value="' + escapeAttr(val) + '" ' +
      'placeholder="' + escapeAttr(placeholder) + '">';
  }

  function renderSelectField(field, value, options) {
    var html = '<select class="cc-info-input cc-select" data-field="' + escapeAttr(field) + '" data-original="' + escapeAttr(value || '') + '">';
    options.forEach(function(opt) {
      var label = opt || '— Select —';
      html += '<option value="' + escapeAttr(opt) + '"' + (opt === (value || '') ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    });
    html += '</select>';
    return html;
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
      { label: 'Address 2', html: editableInput('Address_2', l.Address_2, 'text', 'Unit, suite, etc.') },
      { label: 'City', html: editableInput('City', l.City, 'text', 'Enter city') },
      { label: 'Province', html: editableInput('Province', l.Province, 'text', 'Enter province') },
      { label: 'Postal Code', html: editableInput('Postal_Code', l.Postal_Code, 'text', 'Enter postal code') },
      { label: 'Country', html: editableInput('Country', l.Country || 'Canada', 'text', 'Enter country') },
      { label: 'Company', html: editableInput('Company', l.Company, 'text', 'Enter company') },
      { label: 'Occupation', html: editableInput('Occupation', l.Occupation, 'text', 'Enter occupation') },
      { label: 'Date of Birth', html: editableInput('Date_of_Birth', l.Date_of_Birth, 'date', '') },
      { label: 'Spouse Name', html: editableInput('Spouse_Name', l.Spouse_Name, 'text', 'Enter spouse name') },
      { label: 'Marital Status', html: renderSelectField('Marital_Status', l.Marital_Status, ['', 'Single', 'Married', 'Common-Law', 'Divorced', 'Widowed', 'Separated']) },
      { label: 'Preferred Language', html: renderSelectField('Preferred_Language', l.Preferred_Language, ['', 'English', 'French', 'Mandarin', 'Cantonese', 'Other']) },
      { label: 'Referral Source', html: editableInput('Referral_Source', l.Referral_Source, 'text', 'Who referred them?') }
    ];

    var html = '<div class="cc-info-section-label">Contact Information</div>';
    html += '<div class="cc-info-grid">';
    contactFields.forEach(function(f) {
      html += '<div class="cc-info-item"><div class="cc-info-label">' + f.label + '</div>' + f.html + '</div>';
    });
    html += '</div>';

    // Save bar for existing leads (hidden until fields are edited)
    if (!isNewLead) {
      html += '<div id="cc-info-save-bar" class="cc-info-save-bar" style="display:none">' +
        '<span class="cc-info-save-hint">You have unsaved changes</span>' +
        '<button id="cc-info-discard-btn" class="cc-btn cc-btn-secondary cc-btn-sm">Discard</button>' +
        '<button id="cc-info-save-btn" class="cc-btn cc-btn-primary cc-btn-sm">Save Changes</button>' +
        '</div>';
    }

    // For new leads, show contact fields + lead details + Create button
    if (isNewLead) {
      html += '<div class="cc-info-divider"></div>';
      html += '<div class="cc-info-section-label">Lead Details</div>';
      html += '<div class="cc-info-grid">';
      // Practice Area multi-checkbox
      html += '<div class="cc-info-item cc-info-item-full"><div class="cc-info-label">Practice Area</div>';
      html += '<div class="cc-checkbox-group" data-field="Practice_Area">';
      [
        { key: 'ESTATE_PLANNING_WILL_POA', label: 'Estate Planning (Will & POA)' },
        { key: 'TRUSTS_HENSON_SPOUSAL', label: 'Trusts (Henson/Spousal)' },
        { key: 'GUARDIANSHIP_MINORS', label: 'Guardianship (Minors)' },
        { key: 'PROBATE_ESTATE_ADMIN', label: 'Probate & Estate Admin' },
        { key: 'BUSINESS_SUCCESSION', label: 'Business Succession' },
        { key: 'REAL_ESTATE', label: 'Real Estate' },
        { key: 'CORPORATE', label: 'Corporate' },
        { key: 'FAMILY_LAW', label: 'Family Law' }
      ].forEach(function(pa) {
        html += '<label class="cc-checkbox-label"><input type="checkbox" class="cc-pa-check" value="' + pa.key + '"> ' + escapeHtml(pa.label) + '</label>';
      });
      html += '</div></div>';
      // Service Package multi-checkbox
      html += '<div class="cc-info-item cc-info-item-full"><div class="cc-info-label">Service Package</div>';
      html += '<div class="cc-checkbox-group" data-field="Service_Package">';
      [
        { key: 'SIMPLE_WILL_POA', label: 'Simple Will & POA' },
        { key: 'COUPLES_WILLS_POA', label: 'Couples Wills & POA' },
        { key: 'BLENDED_FAMILY_PLAN', label: 'Blended Family Plan' },
        { key: 'MINORS_GUARDIANSHIP_PLAN', label: 'Minors Guardianship Plan' },
        { key: 'HENSON_TRUST_PLAN', label: 'Henson Trust Plan' },
        { key: 'SPOUSAL_TRUST_PLAN', label: 'Spousal Trust Plan' },
        { key: 'PROBATE_APPLICATION', label: 'Probate Application' },
        { key: 'PROBATE_FULL_ADMIN', label: 'Probate Full Admin' }
      ].forEach(function(sp) {
        html += '<label class="cc-checkbox-label"><input type="checkbox" class="cc-sp-check" value="' + sp.key + '"> ' + escapeHtml(sp.label) + '</label>';
      });
      html += '</div></div>';
      // Lead Source dropdown
      html += '<div class="cc-info-item"><div class="cc-info-label">Lead Source</div>';
      html += renderSelectField('Source', '', ['WEBFORM', 'REFERRAL', 'COLD_CALL', 'WEBSITE', 'SOCIAL_MEDIA', 'ADVERTISING', 'EVENT', 'OTHER']);
      html += '</div>';
      // Est. Closing Date
      html += '<div class="cc-info-item"><div class="cc-info-label">Est. Closing Date</div>';
      html += editableInput('Estimated_Closing_Date', '', 'date', '');
      html += '</div>';
      // Services Required (click to open modal, same as lead detail)
      html += '<div class="cc-info-item"><div class="cc-info-label">Services Required</div>';
      html += '<div class="cc-info-value cc-field-btn" id="cc-new-lead-svc-btn" title="Click to select services">' +
        '<span class="cc-field-btn-text"><span style="color:#9ca3af">Select</span></span>' +
        '<span class="cc-field-btn-icon">&#9662;</span></div>';
      html += '</div>';
      html += '</div>';
      html += '<div style="margin-top:1rem;text-align:right">' +
        '<button id="cc-create-lead-btn" class="cc-btn cc-btn-primary">Create Lead</button></div>';
      el.innerHTML = html;
      bindInfoEdits();
      // Bind services selector button
      var svcBtn = document.getElementById('cc-new-lead-svc-btn');
      if (svcBtn) svcBtn.addEventListener('click', function() { showNewLeadServicesModal(); });
      return;
    }

    // ── Lead details (read-only) ──
    var detailFields = [
      { label: 'Practice Area', value: formatPracticeArea(l.Practice_Area) },
      { label: 'Service Package', value: formatPracticeArea(l.Service_Package) },
      { label: 'Lead Source', value: l.Source || '—' },
      { label: 'Owner', value: l.Lead_Owner_Name || '—' },
      { label: 'Responsible Lawyer', value: l.Responsible_Lawyer_Name || '—' },
      { label: 'Created', value: API.util.formatDateTime(l.Created_At) },
      { label: 'Last Contact', value: API.util.formatRelativeTime(l.Last_Contacted_At) || '—' },
      { label: 'Next Action', value: API.util.formatDateTime(l.Next_Action_At) || '—' },
      { label: 'Est. Closing Date', html: renderClosingDateField(l) },
      { label: 'Services Required', html: renderServicesField(l) },
      { label: 'Subscribed', value: l.Consent_Status || 'UNKNOWN' }
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
      if (t.Owner_Name) html += ' &middot; <span style="color:#6B7280;">Assigned: ' + escapeHtml(t.Owner_Name) + '</span>';
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
          ccToast('Failed to complete task: ' + (err.error || 'Unknown error'), 'error');
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
      if (!subject) { ccToast('Subject is required.', 'info'); return; }

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
        ccToast('Failed: ' + (err.error || 'Unknown error'), 'error');
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
    $el('cc-task-assign-type').addEventListener('change', function() {
      var isRole = this.value === 'role';
      $el('cc-task-assign-user').style.display = isRole ? 'none' : '';
      $el('cc-task-assign-role').style.display = isRole ? '' : 'none';
    });

    $el('cc-task-submit').addEventListener('click', async function() {
      var btn = $el('cc-task-submit');
      if (btn.disabled) return;
      var title = $el('cc-task-title').value.trim();
      if (!title) { ccToast('Task title is required.', 'info'); return; }

      // Resolve assignment
      var assignType = $el('cc-task-assign-type').value;
      var ownerId = '';
      if (assignType === 'user') {
        ownerId = $el('cc-task-assign-user').value;
      } else if (assignType === 'role') {
        var role = $el('cc-task-assign-role').value;
        var roleUser = (state.crmUsers || []).find(function(u) { return u.role === role; });
        ownerId = roleUser ? roleUser.id : '';
      }

      btn.disabled = true;
      try {
        var taskData = {
          lead_id: leadId,
          title: title,
          due_at: $el('cc-task-due').value || '',
          task_type: $el('cc-task-type').value
        };
        if (ownerId) taskData.owner = ownerId;
        var result = await API.tasks.create(taskData);
        if (result.success) {
          $el('cc-task-title').value = '';
          $el('cc-task-due').value = '';
          reloadTasks();
        }
      } catch (err) {
        ccToast('Failed: ' + (err.error || 'Unknown error'), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindBackButton() {
    var btn = $el('cc-back-btn');
    if (btn) {
      btn.addEventListener('click', function() {
        if (state.infoDirty) {
          if (!confirm('You have unsaved changes. Discard and go back?')) return;
        }
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
    var items = Array.isArray(pa) ? pa : [pa];
    return items.map(function(item) {
      return item.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
    }).join(', ');
  }

  // ─── Inline Edit: Closing Date ───────────────────────────────
  function renderClosingDateField(l) {
    var val = l.Estimated_Closing_Date ? API.util.formatDate(l.Estimated_Closing_Date) : '';
    var placeholder = val ? escapeHtml(val) : '<span style="color:#9ca3af">Select date</span>';
    return '<div class="cc-info-value cc-field-btn" id="cc-closing-date-val" title="Click to edit">' +
      '<span class="cc-field-btn-text">' + placeholder + '</span>' +
      '<span class="cc-field-btn-icon">&#128197;</span></div>' +
      '<input type="date" id="cc-closing-date-input" class="cc-info-input" style="display:none" ' +
      'value="' + escapeAttr(l.Estimated_Closing_Date || '') + '">';
  }

  function renderServicesField(l) {
    var display = formatServicesRequired(l);
    var hasValue = display && display !== '---';
    var placeholder = hasValue ? escapeHtml(display) : '<span style="color:#9ca3af">Select</span>';
    return '<div class="cc-info-value cc-field-btn" id="cc-services-val" title="Click to edit">' +
      '<span class="cc-field-btn-text">' + placeholder + '</span>' +
      '<span class="cc-field-btn-icon">&#9662;</span></div>';
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
      dateInput.addEventListener('change', function() {
        // Show the date value inline, mark dirty (actual save via Save button)
        dateInput.style.display = 'none';
        dateVal.style.display = '';
        var newDate = dateInput.value || null;
        dateVal.textContent = newDate ? API.util.formatDate(newDate) : 'Set date';
        if (newDate !== (state.lead.Estimated_Closing_Date || '')) {
          dateInput.classList.add('cc-field-dirty');
        } else {
          dateInput.classList.remove('cc-field-dirty');
        }
        // Trigger dirty check for save bar
        var saveBar = document.getElementById('cc-info-save-bar');
        if (saveBar) {
          var dirty = false;
          document.querySelectorAll('.cc-info-input').forEach(function(inp) {
            if (inp.value.trim() !== (inp.getAttribute('data-original') || '')) dirty = true;
          });
          saveBar.style.display = dirty ? 'flex' : 'none';
          state.infoDirty = dirty;
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

    // Editable contact inputs: track changes + explicit Save button (skip for new leads)
    if (!isNewLead) {
      var saveBar = document.getElementById('cc-info-save-bar');
      var saveBtn = document.getElementById('cc-info-save-btn');
      var discardBtn = document.getElementById('cc-info-discard-btn');

      function checkDirty() {
        var dirty = false;
        document.querySelectorAll('.cc-info-input').forEach(function(inp) {
          var original = inp.getAttribute('data-original');
          var current = inp.value.trim();
          if (current !== (original || '')) {
            dirty = true;
            inp.classList.add('cc-field-dirty');
          } else {
            inp.classList.remove('cc-field-dirty');
          }
        });
        if (saveBar) saveBar.style.display = dirty ? 'flex' : 'none';
        state.infoDirty = dirty;
        return dirty;
      }

      document.querySelectorAll('.cc-info-input').forEach(function(inp) {
        inp.addEventListener('input', checkDirty);
        inp.addEventListener('change', checkDirty);
      });

      if (saveBtn) {
        saveBtn.addEventListener('click', async function() {
          if (saveBtn.disabled) return;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          var updates = {};
          document.querySelectorAll('.cc-info-input').forEach(function(inp) {
            var field = inp.getAttribute('data-field');
            var original = inp.getAttribute('data-original');
            var current = inp.value.trim();
            if (current !== (original || '')) {
              updates[field] = current;
            }
          });
          if (Object.keys(updates).length === 0) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
            return;
          }
          try {
            var res = await API.leads.update(leadId, updates);
            if (res.success) {
              // Update originals so dirty check resets
              document.querySelectorAll('.cc-info-input').forEach(function(inp) {
                inp.setAttribute('data-original', inp.value.trim());
                inp.classList.remove('cc-field-dirty');
              });
              Object.keys(updates).forEach(function(k) { state.lead[k] = updates[k]; });
              if (saveBar) saveBar.style.display = 'none';
              state.infoDirty = false;
              ccToast('Changes saved', 'success');
            } else {
              ccToast('Save failed: ' + (res.error || 'Unknown error'), 'error');
            }
          } catch (err) {
            ccToast('Save failed: ' + (err.error || 'Network error'), 'error');
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
          }
        });
      }

      if (discardBtn) {
        discardBtn.addEventListener('click', function() {
          document.querySelectorAll('.cc-info-input').forEach(function(inp) {
            inp.value = inp.getAttribute('data-original') || '';
            inp.classList.remove('cc-field-dirty');
          });
          if (saveBar) saveBar.style.display = 'none';
          state.infoDirty = false;
        });
      }
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
          ccToast('Please enter at least a name or email.', 'info');
          return;
        }
        // Build Client_Name from first + last
        var parts = [data.First_Name, data.Last_Name].filter(Boolean);
        if (parts.length) data.Client_Name = parts.join(' ');

        // Collect Practice Area checkboxes
        var paChecks = document.querySelectorAll('.cc-pa-check:checked');
        if (paChecks.length) {
          data.Practice_Area = Array.from(paChecks).map(function(cb) { return cb.value; });
        }

        // Collect Service Package checkboxes
        var spChecks = document.querySelectorAll('.cc-sp-check:checked');
        if (spChecks.length) {
          data.Service_Package = Array.from(spChecks).map(function(cb) { return cb.value; });
        }

        // Services Required: use selections from modal
        if (_newLeadServiceIds.length) {
          data.Services_Required = _newLeadServiceIds;
        }

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        try {
          var res = await API.leads.create(data);
          var newId = res.id || (res.lead && res.lead.id);
          if (res.success && newId) {
            window.location.href = '/crm/lead?id=' + newId;
          } else {
            ccToast('Create failed: ' + (res.error || res.message || res.details || JSON.stringify(res)), 'error');
            createBtn.disabled = false;
            createBtn.textContent = 'Create Lead';
          }
        } catch (err) {
          ccToast('Create failed: ' + (err.error || err.message || 'Network error'), 'error');
          createBtn.disabled = false;
          createBtn.textContent = 'Create Lead';
        }
      });
    }
  }

  // ─── New Lead: Services Modal ───────────────────────────────
  var _newLeadServiceIds = [];

  async function showNewLeadServicesModal() {
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML = '<div class="cc-modal" style="max-width:520px"><div class="cc-modal-header"><h3>Select Services</h3>' +
      '<button class="cc-modal-close" id="cc-nlsvc-close">&times;</button></div>' +
      '<div class="cc-modal-body" id="cc-nlsvc-body"><p>Loading services...</p></div>' +
      '<div class="cc-modal-footer">' +
      '<span id="cc-nlsvc-count" style="font-size:13px;color:#666;margin-right:auto;"></span>' +
      '<button class="cc-btn cc-btn-primary" id="cc-nlsvc-done">Done</button> ' +
      '<button class="cc-btn" id="cc-nlsvc-cancel">Cancel</button></div></div>';
    document.body.appendChild(overlay);

    var closeModal = function() { overlay.remove(); };
    document.getElementById('cc-nlsvc-close').addEventListener('click', closeModal);
    document.getElementById('cc-nlsvc-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    try {
      if (!_priceBookCache) {
        var res = await API.priceBook.list();
        _priceBookCache = (res.items || []).filter(function(i) { return i.Is_Active; });
      }
      var items = _priceBookCache;
      var body = document.getElementById('cc-nlsvc-body');
      if (!items.length) {
        body.innerHTML = '<p>No active services in price book. <a href="/crm/admin">Add services</a> first.</p>';
        return;
      }

      var grouped = {};
      PRACTICE_AREAS.forEach(function(pa) { grouped[pa.key] = []; });
      items.forEach(function(item) {
        var key = PA_LABEL_TO_KEY[item.Practice_Area || ''] || 'OTHER';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
      });

      var activePAs = PRACTICE_AREAS.filter(function(pa) { return grouped[pa.key] && grouped[pa.key].length > 0; });
      var html = '<div style="max-height:400px;overflow-y:auto;">';
      activePAs.forEach(function(pa) {
        var paItems = grouped[pa.key];
        var selectedInPa = paItems.filter(function(i) { return _newLeadServiceIds.indexOf(i.id) !== -1; }).length;
        var badge = selectedInPa > 0
          ? ' <span class="cc-nlsvc-badge" data-pa="' + escapeAttr(pa.key) + '" style="background:#2563eb;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:6px;">' + selectedInPa + '</span>'
          : '<span class="cc-nlsvc-badge" data-pa="' + escapeAttr(pa.key) + '"></span>';
        html += '<div class="cc-nlsvc-header" data-pa="' + escapeAttr(pa.key) + '" ' +
          'style="display:flex;align-items:center;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:4px;cursor:pointer;user-select:none;">' +
          '<span class="cc-nlsvc-arrow" data-pa="' + escapeAttr(pa.key) + '" style="margin-right:8px;font-size:12px;color:#64748b;transition:transform 0.15s;">&#9654;</span>' +
          '<strong style="flex:1;font-size:14px;color:#334155;">' + escapeHtml(pa.label) + '</strong>' +
          '<span style="color:#94a3b8;font-size:13px;margin-right:4px;">' + paItems.length + ' service' + (paItems.length > 1 ? 's' : '') + '</span>' +
          badge + '</div>';
        html += '<div class="cc-nlsvc-body" data-pa="' + escapeAttr(pa.key) + '" style="display:none;margin:0 0 8px 0;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;padding:4px 0;">';
        paItems.forEach(function(item) {
          var checked = _newLeadServiceIds.indexOf(item.id) !== -1 ? ' checked' : '';
          html += '<label style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;gap:8px;">' +
            '<input type="checkbox" class="cc-nlsvc-cb" data-pa="' + escapeAttr(pa.key) + '" value="' + escapeAttr(item.id) + '"' + checked + '> ' +
            '<span style="flex:1;">' + escapeHtml(item.Service_Name) + '</span>' +
            (item.List_Price ? '<span style="color:#2563eb;font-size:13px;white-space:nowrap;">$' + Number(item.List_Price).toLocaleString() + '</span>' : '') +
            '</label>';
        });
        html += '</div>';
      });
      html += '</div>';
      body.innerHTML = html;

      function updateCount() {
        var total = overlay.querySelectorAll('.cc-nlsvc-cb:checked').length;
        var countEl = document.getElementById('cc-nlsvc-count');
        if (countEl) countEl.textContent = total > 0 ? total + ' service' + (total > 1 ? 's' : '') + ' selected' : '';
        activePAs.forEach(function(pa) {
          var c = overlay.querySelectorAll('.cc-nlsvc-cb[data-pa="' + pa.key + '"]:checked').length;
          var b = overlay.querySelector('.cc-nlsvc-badge[data-pa="' + pa.key + '"]');
          if (b) b.innerHTML = c > 0 ? c : '';
          if (b) b.style.background = c > 0 ? '#2563eb' : 'transparent';
          if (b) b.style.color = c > 0 ? '#fff' : 'transparent';
        });
      }
      updateCount();

      // Accordion toggle
      overlay.querySelectorAll('.cc-nlsvc-header').forEach(function(hdr) {
        hdr.addEventListener('click', function() {
          var pa = hdr.getAttribute('data-pa');
          var bdy = overlay.querySelector('.cc-nlsvc-body[data-pa="' + pa + '"]');
          var arrow = overlay.querySelector('.cc-nlsvc-arrow[data-pa="' + pa + '"]');
          if (bdy) {
            var open = bdy.style.display !== 'none';
            bdy.style.display = open ? 'none' : 'block';
            if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
          }
        });
      });

      overlay.querySelectorAll('.cc-nlsvc-cb').forEach(function(cb) {
        cb.addEventListener('change', updateCount);
      });

      // Done: store selected IDs and update button label
      document.getElementById('cc-nlsvc-done').addEventListener('click', function() {
        _newLeadServiceIds = [];
        overlay.querySelectorAll('.cc-nlsvc-cb:checked').forEach(function(cb) {
          _newLeadServiceIds.push(cb.value);
        });
        // Update button text
        var btn = document.getElementById('cc-new-lead-svc-btn');
        if (btn) {
          var textEl = btn.querySelector('.cc-field-btn-text');
          if (_newLeadServiceIds.length) {
            var names = items.filter(function(i) { return _newLeadServiceIds.indexOf(i.id) !== -1; })
              .map(function(i) { return i.Service_Name; });
            textEl.innerHTML = escapeHtml(names.join(', '));
          } else {
            textEl.innerHTML = '<span style="color:#9ca3af">Select</span>';
          }
        }
        closeModal();
      });
    } catch (err) {
      var body = document.getElementById('cc-nlsvc-body');
      if (body) body.innerHTML = '<p style="color:red;">Failed to load services.</p>';
    }
  }

  // ─── Services Selector Modal ────────────────────────────────
  var _priceBookCache = null;

  var PRACTICE_AREAS = [
    { key: 'ESTATE_PLANNING', label: 'Estate Planning' },
    { key: 'PROBATE', label: 'Probate' },
    { key: 'REAL_ESTATE', label: 'Real Estate' },
    { key: 'CORPORATE', label: 'Corporate Law' },
    { key: 'FAMILY_LAW', label: 'Family Law' },
    { key: 'COMMISSION_NOTARY', label: 'Commission & Notary' },
    { key: 'OTHER', label: 'Other' }
  ];

  // Build label→key lookup for mapping Airtable Practice_Area values to PA keys
  var PA_LABEL_TO_KEY = {};
  PRACTICE_AREAS.forEach(function(pa) { PA_LABEL_TO_KEY[pa.label] = pa.key; });
  PA_LABEL_TO_KEY['Corporate'] = 'CORPORATE';
  PA_LABEL_TO_KEY['Probat & Estate Admin'] = 'PROBATE';
  PA_LABEL_TO_KEY['Miscellaneous'] = 'OTHER';

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

      // Group items by Practice_Area (map Airtable labels to PA keys)
      var grouped = {};
      PRACTICE_AREAS.forEach(function(pa) { grouped[pa.key] = []; });
      items.forEach(function(item) {
        var raw = item.Practice_Area || '';
        var key = PA_LABEL_TO_KEY[raw] || 'OTHER';
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
            ccToast('Save failed: ' + (saveRes.error || 'Unknown error'), 'error');
          }
        } catch (err) {
          ccToast('Save failed: ' + (err.error || 'Network error'), 'error');
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
      '.cc-field-btn{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;transition:border-color .15s,box-shadow .15s;font-size:0.9rem;color:#1F2937}' +
      '.cc-field-btn:hover{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}' +
      '.cc-field-btn-text{flex:1;white-space:normal;word-wrap:break-word;overflow-wrap:break-word}' +
      '.cc-field-btn-icon{flex-shrink:0;margin-left:8px;font-size:14px;color:#6B7280}' +
      '.cc-info-input{width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:0.9rem;color:#1F2937;background:#fff;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}' +
      '.cc-info-input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}' +
      '.cc-info-input::placeholder{color:#9ca3af}' +
      '.cc-info-input.cc-save-ok{border-color:#22c55e;background:#f0fdf4}' +
      '.cc-info-input.cc-save-err{border-color:#ef4444;background:#fef2f2}' +
      '.cc-info-input.cc-field-dirty{border-color:#f59e0b;background:#fffbeb}' +
      '.cc-info-save-bar{display:flex;align-items:center;gap:10px;padding:10px 16px;margin:12px 0;background:#fef3c7;border:1px solid #fbbf24;border-radius:8px}' +
      '.cc-info-save-hint{flex:1;font-size:0.85rem;color:#92400e;font-weight:500}' +
      '.cc-btn-sm{padding:5px 14px;font-size:0.8rem}' +
      '.cc-btn-secondary{background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:6px;cursor:pointer}' +
      '.cc-btn-secondary:hover{background:#f9fafb}' +
      '.cc-info-section-label{font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:8px;padding-bottom:4px}' +
      '.cc-info-divider{border:none;border-top:1px solid #e2e8f0;margin:16px 0}';
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    // Cleanup refresh timer on page unload
    window.addEventListener('beforeunload', stopRecordingsRefresh);

    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
