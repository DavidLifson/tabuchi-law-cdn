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
      var [leadResult, actResult, taskResult, usersResult, paResult] = await Promise.all([
        API.leads.get(leadId),
        API.activities.list(leadId),
        API.tasks.list({ lead_id: leadId }),
        API.admin.listUsers().catch(function() { return { users: [] }; }),
        API.admin.config.list('practice_area').catch(function() { return { data: [] }; })
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
      // Populate practice area options from config
      PA_OPTIONS = (paResult.data || []).filter(function(i) { return i.Is_Active !== false; }).sort(function(a, b) { return (a.Sort_Order || 0) - (b.Sort_Order || 0); }).map(function(i) { return { key: i.Label, label: i.Label }; });

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
      // Self-heal: if Last_Contacted_At is empty but activities exist, backfill it
      if (!state.lead.Last_Contacted_At && state.activities.length > 0) {
        var latest = state.activities[0].Occurred_At || state.activities[0].Created_At;
        if (latest) {
          state.lead.Last_Contacted_At = latest;
          renderInfo(); // re-render info panel with updated value
          // Background patch — fire and forget
          API.leads.update(leadId, { Last_Contacted_At: latest }).catch(function() {});
        }
      }
    } catch (err) { /* silently fail */ }
  }

  async function reloadTasks() {
    try {
      if (API.cache) API.cache.invalidate('/cc/tasks');
      var result = await API.tasks.list({ lead_id: leadId });
      state.tasks = (result.success && result.tasks) || [];
      renderTasks();
      // Compute Next Action from earliest incomplete task due date
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
    // Only update Next Action if tasks provide a date; never clear a manually-set value
    if (!earliest) return;
    var newVal = earliest.toISOString();
    var current = state.lead.Next_Action_At || state.lead.Next_Action_Date || null;
    var currentDate = current ? new Date(current).toISOString().slice(0, 10) : null;
    var newDate = new Date(newVal).toISOString().slice(0, 10);
    if (currentDate !== newDate) {
      state.lead.Next_Action_At = newVal;
      renderInfo();
      API.leads.update(leadId, { Next_Action_At: newDate }).catch(function() {});
    }
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
    // Refresh button for recordings tab
    if (state.activeTab === 'recordings') {
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-recordings-refresh" title="Refresh recordings" style="margin-left:auto;padding:4px 10px;font-size:0.8rem;">&#8635; Refresh</button>';
    }
    el.innerHTML = html;

    el.querySelectorAll('.cc-lead-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTab(btn.dataset.tab);
      });
    });

    // Bind recordings refresh button
    var refreshBtn = document.getElementById('cc-recordings-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        await reloadRecordings();
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '&#8635; Refresh';
      });
    }
  }

  function switchTab(tabKey) {
    state.activeTab = tabKey;

    // Re-render tabs to update refresh button visibility
    renderTabs();

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

    // Collect RC call recordings from activities
    var rcRecordings = (state.activities || []).filter(function(a) { return a.Recording_URL; });

    if (state.recordings.length === 0 && rcRecordings.length === 0) {
      el.innerHTML = '<div class="cc-empty" style="padding:2rem;text-align:center;">' +
        '<p style="margin:0 0 .5rem;font-size:1.1rem;color:#6B7280;">No recordings linked to this lead.</p>' +
        '<p style="margin:0;font-size:.85rem;color:#9CA3AF;">Recordings from calls and meetings will appear here automatically.</p>' +
        '</div>';
      return;
    }

    var html = '';

    // RC Call Recordings (from Activities with Recording_URL)
    if (rcRecordings.length > 0) {
      html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.75rem;font-size:0.95rem;color:#374151;">Call Recordings</h4>';
      rcRecordings.forEach(function(a) {
        var date = API.util.formatDateTime(a.Occurred_At);
        var duration = a.Duration_Minutes ? a.Duration_Minutes + ' min' : '';
        var metadata = {};
        try { metadata = JSON.parse(a.Metadata_JSON || '{}'); } catch(e) {}

        html += '<div class="cc-rec-card" style="margin-bottom:0.5rem;">';
        html += '<div class="cc-rec-card-header">';
        html += '<span class="cc-badge cc-badge-green" style="font-size:.7rem;">RINGCENTRAL</span>';
        html += '<span class="cc-badge cc-badge-gray">' + escapeHtml(a.Outcome || 'Completed') + '</span>';
        html += '<span class="cc-rec-card-meta" style="margin-left:auto;">' + escapeHtml(date) + (duration ? ' &middot; ' + duration : '') + '</span>';
        html += '</div>';
        html += '<div style="padding:0.5rem 0;">';
        html += '<div style="font-size:0.9rem;font-weight:500;margin-bottom:0.25rem;">' + escapeHtml(a.Subject || 'Phone Call') + '</div>';
        if (a.Body) html += '<div style="font-size:0.85rem;color:#4B5563;margin-bottom:0.5rem;white-space:pre-wrap;">' + escapeHtml(a.Body).substring(0, 200) + '</div>';
        html += '<a href="' + escapeAttr(a.Recording_URL) + '" target="_blank" rel="noopener" ' +
          'style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:#4F46E5;color:white;border-radius:6px;font-size:0.8rem;text-decoration:none;font-weight:500;">' +
          '&#9654; Play Recording</a>';
        html += '</div></div>';
      });
      html += '</div>';
    }

    // Meeting Recordings (Teams/Zoom)
    if (state.recordings.length > 0) {
      html += '<div><h4 style="margin:0 0 0.75rem;font-size:0.95rem;color:#374151;">Meeting Recordings</h4>';
    }

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

    if (state.recordings.length > 0) {
      html += '</div>'; // close Meeting Recordings section
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
        '<span class="cc-action-btns">' +
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-call" title="Call Now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg> Call</button>' +
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-email" title="Email Now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Email</button>' +
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-sms" title="Send SMS"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> SMS</button>' +
          '<button class="cc-btn cc-btn-sm cc-btn-outline" id="cc-action-send-form" title="Send Intake Form"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Send Intake</button>' +
        '</span>' +
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

    // Bind action buttons
    var callBtn = document.getElementById('cc-action-call');
    if (callBtn) callBtn.addEventListener('click', function() {
      if (!state.lead.Client_Phone) { ccToast('No phone number on file. Add a phone number first.', 'error'); return; }
      showCallDialog(state.lead);
    });
    var emailBtn = document.getElementById('cc-action-email');
    if (emailBtn) emailBtn.addEventListener('click', function() {
      if (!state.lead.Client_Email) { ccToast('No email address on file. Add an email first.', 'error'); return; }
      showEmailModal(state.lead);
    });
    var smsBtn = document.getElementById('cc-action-sms');
    if (smsBtn) smsBtn.addEventListener('click', function() {
      if (!state.lead.Client_Phone) { ccToast('No phone number on file. Add a phone number first.', 'error'); return; }
      showSmsModal(state.lead);
    });
    var sendFormBtn = document.getElementById('cc-action-send-form');
    if (sendFormBtn) sendFormBtn.addEventListener('click', function() {
      if (!state.lead.Client_Email) { ccToast('No email address on file. Add an email first.', 'error'); return; }
      showSendFormModal(state.lead);
    });
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
      }
      html += ' <button class="cc-btn cc-btn-danger" id="cc-deal-lost-btn">Deal Lost</button>';
      html += '</div>';
    } else if (state.lead.Disposition === 'OPEN') {
      // At last stage but still open
      html += '<div class="cc-stage-actions">';
      html += ' <button class="cc-btn cc-btn-success" id="cc-close-won-btn">Close — Won</button>';
      html += ' <button class="cc-btn cc-btn-danger" id="cc-deal-lost-btn">Deal Lost</button>';
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

    // Bind Deal Lost
    var dealLostBtn = document.getElementById('cc-deal-lost-btn');
    if (dealLostBtn) {
      dealLostBtn.addEventListener('click', function() {
        showDealLostModal();
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

  // ─── Deal Lost Modal ──────────────────────────────────────────
  function showDealLostModal() {
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal" style="max-width:480px">' +
        '<div class="cc-modal-header"><h3>Deal Lost</h3>' +
          '<button class="cc-modal-close" id="cc-dl-close">&times;</button></div>' +
        '<div class="cc-modal-body">' +
          '<div style="margin-bottom:12px;">' +
            '<label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem;">Close Reason</label>' +
            '<select id="cc-dl-reason" class="cc-input" style="width:100%">' +
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
            '<textarea id="cc-dl-notes" class="cc-input cc-textarea" rows="4" placeholder="Please explain why this deal was lost (required)" style="width:100%;resize:vertical;"></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="cc-modal-footer">' +
          '<button class="cc-btn cc-btn-danger" id="cc-dl-confirm">Mark Deal Lost</button> ' +
          '<button class="cc-btn" id="cc-dl-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('cc-dl-close').addEventListener('click', function() { overlay.remove(); });
    document.getElementById('cc-dl-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    document.getElementById('cc-dl-confirm').addEventListener('click', async function() {
      var reason = document.getElementById('cc-dl-reason').value;
      var notes = document.getElementById('cc-dl-notes').value.trim();
      if (!reason) { ccToast('Please select a close reason.', 'info'); return; }
      if (!notes) { ccToast('Explanation is required. Please explain why this deal was lost.', 'info'); return; }

      var btn = document.getElementById('cc-dl-confirm');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        // Log the explanation as an activity
        await API.activities.create({
          lead_id: leadId,
          type: 'NOTE',
          subject: 'Deal Lost — ' + reason,
          body: notes,
          outcome: 'DEAL_LOST'
        });
        // Update stage to LOST
        await advanceStage('READY_TO_DRAFT', { disposition: 'LOST', close_reason: reason });
        overlay.remove();
        ccToast('Deal marked as lost.', 'success');
      } catch (err) {
        ccToast('Failed: ' + (err.error || 'Network error'), 'error');
        btn.disabled = false;
        btn.textContent = 'Mark Deal Lost';
      }
    });
  }

  // ─── Lead Info Grid ─────────────────────────────────────────
  function editableInput(field, value, type, placeholder) {
    var val = value || '';
    return '<input type="' + type + '" class="cc-info-input" data-field="' + escapeAttr(field) + '" ' +
      'data-original="' + escapeAttr(val) + '" value="' + escapeAttr(val) + '" ' +
      'placeholder="' + escapeAttr(placeholder) + '" autocomplete="off">';
  }

  function renderSelectField(field, value, options) {
    var html = '<select class="cc-info-input cc-select" data-field="' + escapeAttr(field) + '" data-original="' + escapeAttr(value || '') + '" autocomplete="off">';
    options.forEach(function(opt) {
      var label = opt || '— Select —';
      html += '<option value="' + escapeAttr(opt) + '"' + (opt === (value || '') ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    });
    html += '</select>';
    return html;
  }

  // ─── Country & Province/State Dropdowns ─────────────────────
  var COUNTRIES = ['Canada','United States','Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia','Cameroon','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway','Oman','Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom','Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe'];

  var CA_PROVINCES = [
    {v:'AB',l:'Alberta'},{v:'BC',l:'British Columbia'},{v:'MB',l:'Manitoba'},
    {v:'NB',l:'New Brunswick'},{v:'NL',l:'Newfoundland and Labrador'},{v:'NS',l:'Nova Scotia'},
    {v:'NT',l:'Northwest Territories'},{v:'NU',l:'Nunavut'},{v:'ON',l:'Ontario'},
    {v:'PE',l:'Prince Edward Island'},{v:'QC',l:'Quebec'},{v:'SK',l:'Saskatchewan'},{v:'YT',l:'Yukon'}
  ];
  var US_STATES = [
    {v:'AL',l:'Alabama'},{v:'AK',l:'Alaska'},{v:'AZ',l:'Arizona'},{v:'AR',l:'Arkansas'},
    {v:'CA',l:'California'},{v:'CO',l:'Colorado'},{v:'CT',l:'Connecticut'},{v:'DE',l:'Delaware'},
    {v:'FL',l:'Florida'},{v:'GA',l:'Georgia'},{v:'HI',l:'Hawaii'},{v:'ID',l:'Idaho'},
    {v:'IL',l:'Illinois'},{v:'IN',l:'Indiana'},{v:'IA',l:'Iowa'},{v:'KS',l:'Kansas'},
    {v:'KY',l:'Kentucky'},{v:'LA',l:'Louisiana'},{v:'ME',l:'Maine'},{v:'MD',l:'Maryland'},
    {v:'MA',l:'Massachusetts'},{v:'MI',l:'Michigan'},{v:'MN',l:'Minnesota'},{v:'MS',l:'Mississippi'},
    {v:'MO',l:'Missouri'},{v:'MT',l:'Montana'},{v:'NE',l:'Nebraska'},{v:'NV',l:'Nevada'},
    {v:'NH',l:'New Hampshire'},{v:'NJ',l:'New Jersey'},{v:'NM',l:'New Mexico'},{v:'NY',l:'New York'},
    {v:'NC',l:'North Carolina'},{v:'ND',l:'North Dakota'},{v:'OH',l:'Ohio'},{v:'OK',l:'Oklahoma'},
    {v:'OR',l:'Oregon'},{v:'PA',l:'Pennsylvania'},{v:'RI',l:'Rhode Island'},{v:'SC',l:'South Carolina'},
    {v:'SD',l:'South Dakota'},{v:'TN',l:'Tennessee'},{v:'TX',l:'Texas'},{v:'UT',l:'Utah'},
    {v:'VT',l:'Vermont'},{v:'VA',l:'Virginia'},{v:'WA',l:'Washington'},{v:'WV',l:'West Virginia'},
    {v:'WI',l:'Wisconsin'},{v:'WY',l:'Wyoming'},{v:'DC',l:'District of Columbia'}
  ];

  function renderCountryField(l) {
    var val = l.Country || 'Canada';
    var html = '<select class="cc-info-input cc-select" id="cc-country-select" data-field="Country" data-original="' + escapeAttr(val) + '" autocomplete="off">';
    COUNTRIES.forEach(function(c) {
      html += '<option value="' + escapeAttr(c) + '"' + (c === val ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
    });
    html += '</select>';
    return html;
  }

  function renderProvinceField(l) {
    var val = l.Province || 'ON';
    var allOpts = CA_PROVINCES.concat(US_STATES);
    var isOther = val && !allOpts.some(function(o) { return o.v === val || o.l === val; });
    var selectVal = isOther ? 'Other' : val;
    var html = '<div class="cc-province-wrap">';
    html += '<select class="cc-info-input cc-select" id="cc-province-select" data-field="Province" data-original="' + escapeAttr(val) + '" autocomplete="off">';
    html += '<option value="">— Select —</option>';
    html += '<optgroup label="Canada">';
    CA_PROVINCES.forEach(function(p) {
      html += '<option value="' + escapeAttr(p.v) + '"' + (p.v === selectVal || p.l === selectVal ? ' selected' : '') + '>' + escapeHtml(p.l) + '</option>';
    });
    html += '</optgroup>';
    html += '<optgroup label="United States">';
    US_STATES.forEach(function(s) {
      html += '<option value="' + escapeAttr(s.v) + '"' + (s.v === selectVal || s.l === selectVal ? ' selected' : '') + '>' + escapeHtml(s.l) + '</option>';
    });
    html += '</optgroup>';
    html += '<option value="Other"' + (isOther ? ' selected' : '') + '>Other</option>';
    html += '</select>';
    html += '<input type="text" class="cc-info-input" id="cc-province-other" data-field="Province" ' +
      'placeholder="Enter province/state" value="' + escapeAttr(isOther ? val : '') + '" ' +
      'autocomplete="off" style="margin-top:6px;display:' + (isOther ? 'block' : 'none') + '">';
    html += '</div>';
    return html;
  }

  function bindProvinceField() {
    var sel = document.getElementById('cc-province-select');
    var other = document.getElementById('cc-province-other');
    if (!sel || !other) return;
    sel.addEventListener('change', function() {
      if (sel.value === 'Other') {
        other.style.display = 'block';
        other.value = '';
        other.focus({ preventScroll: true });
      } else {
        other.style.display = 'none';
        other.value = '';
      }
      sel.classList.add('cc-field-dirty');
      var saveBar = document.getElementById('cc-info-save-bar');
      if (saveBar) saveBar.style.display = 'flex';
    });
    other.addEventListener('input', function() {
      other.classList.add('cc-field-dirty');
      var saveBar = document.getElementById('cc-info-save-bar');
      if (saveBar) saveBar.style.display = 'flex';
    });
  }

  var LANGUAGE_OPTIONS = ['', 'English', 'French', 'Mandarin', 'Cantonese', 'Hindi', 'Italian', 'Other'];

  // Lead Sources — loaded from config API (for Lead Source dropdown)
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

  function renderLeadSourceField(l) {
    var val = l.Source || '';
    var isOther = val && LEAD_SOURCE_OPTIONS.indexOf(val) === -1;
    var selectVal = isOther ? 'Other' : val;
    var html = '<div class="cc-leadsrc-wrap">';
    html += '<select class="cc-info-input cc-select" data-field="Source" data-original="' + escapeAttr(val) + '" id="cc-leadsrc-select" autocomplete="off">';
    LEAD_SOURCE_OPTIONS.forEach(function(opt) {
      var label = opt || '— Select —';
      html += '<option value="' + escapeAttr(opt) + '"' + (opt === selectVal ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    });
    html += '</select>';
    html += '<input type="text" class="cc-info-input" id="cc-leadsrc-other" data-field="Source" ' +
      'placeholder="Specify lead source" value="' + escapeAttr(isOther ? val : '') + '" ' +
      'autocomplete="off" style="margin-top:6px;display:' + (isOther ? 'block' : 'none') + '">';
    html += '</div>';
    return html;
  }

  function renderConsentField(l) {
    var val = (l.Consent_Status || 'UNKNOWN').toUpperCase();
    var opts = [
      { value: 'UNKNOWN', label: 'Unknown' },
      { value: 'SUBSCRIBED', label: 'Subscribed' },
      { value: 'UNSUBSCRIBED', label: 'Unsubscribed' }
    ];
    var html = '<select class="cc-info-input cc-select" id="cc-consent-select" data-field="Consent_Status" data-original="' + escapeAttr(val) + '" autocomplete="off">';
    opts.forEach(function(o) {
      html += '<option value="' + o.value + '"' + (o.value === val ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
    });
    html += '</select>';
    return html;
  }

  function renderResponsibleLawyerField(l) {
    var currentId = (l.Responsible_Lawyer && l.Responsible_Lawyer[0]) || '';
    var lawyers = (state.crmUsers || []).filter(function(u) { return (u.role || '').toUpperCase() === 'LAWYER'; });
    var html = '<select class="cc-info-input cc-select" id="cc-lawyer-select" data-field="Responsible_Lawyer" data-original="' + escapeAttr(currentId) + '" autocomplete="off">';
    html += '<option value="">— Select —</option>';
    lawyers.forEach(function(u) {
      html += '<option value="' + escapeAttr(u.id) + '"' + (u.id === currentId ? ' selected' : '') + '>' + escapeHtml(u.name) + '</option>';
    });
    html += '</select>';
    return html;
  }

  function bindResponsibleLawyerField() {
    var sel = document.getElementById('cc-lawyer-select');
    if (!sel) return;
    sel.addEventListener('change', function() {
      sel.classList.add('cc-field-dirty');
      var saveBar = document.getElementById('cc-info-save-bar');
      if (saveBar) saveBar.style.display = 'flex';
    });
  }

  function renderOwnerField(l) {
    var currentId = (l.Owner && l.Owner[0]) || '';
    var currentName = l.Lead_Owner_Name || '—';
    var users = state.crmUsers || [];
    var html = '<select class="cc-info-input cc-select" id="cc-owner-select" autocomplete="off">';
    html += '<option value="">— Unassigned —</option>';
    users.forEach(function(u) {
      var selected = (u.id === currentId || u.name === currentName) ? ' selected' : '';
      html += '<option value="' + escapeAttr(u.id) + '"' + selected + '>' + escapeHtml(u.name) + ' (' + escapeHtml(u.role || '') + ')</option>';
    });
    html += '</select>';
    return html;
  }

  function bindOwnerField() {
    var sel = document.getElementById('cc-owner-select');
    if (!sel) return;
    sel.addEventListener('change', async function() {
      var newOwnerId = sel.value;
      sel.disabled = true;
      try {
        var updatePayload = { Owner: newOwnerId ? [newOwnerId] : [] };
        var res = await API.leads.update(leadId, updatePayload);
        if (res.success) {
          state.lead.Owner = newOwnerId ? [newOwnerId] : [];
          var selectedUser = (state.crmUsers || []).find(function(u) { return u.id === newOwnerId; });
          state.lead.Lead_Owner_Name = selectedUser ? selectedUser.name : '';
          ccToast('Owner updated.', 'success');
        } else {
          ccToast('Failed to update owner: ' + (res.error || 'Unknown error'), 'error');
        }
      } catch (err) {
        ccToast('Failed to update owner: ' + (err.error || 'Network error'), 'error');
      }
      sel.disabled = false;
    });
  }

  function bindConsentField() {
    var sel = document.getElementById('cc-consent-select');
    if (!sel) return;
    sel.addEventListener('change', async function() {
      var newVal = sel.value;
      try {
        await API.leads.update(leadId, { Consent_Status: newVal });
        state.lead.Consent_Status = newVal;
        ccToast('Subscription status updated.', 'success');
      } catch (e) {
        ccToast('Failed to update subscription status.', 'error');
      }
    });
  }

  // Practice Areas — loaded dynamically from config API
  var PA_OPTIONS = [];

  async function loadPracticeAreas() {
    try {
      var result = await API.admin.config.list('practice_area');
      var items = (result.data || []).filter(function(i) { return i.Is_Active !== false; }).sort(function(a, b) { return (a.Sort_Order || 0) - (b.Sort_Order || 0); });
      PA_OPTIONS = items.map(function(i) { return { key: i.Label, label: i.Label }; });
    } catch (e) {
      PA_OPTIONS = [];
    }
  }

  function renderPracticeAreaField(l) {
    var vals = Array.isArray(l.Practice_Area) ? l.Practice_Area : (l.Practice_Area ? [l.Practice_Area] : []);
    var html = '<div class="cc-multiselect-wrap" id="cc-pa-inline">';
    html += '<div class="cc-ms-control cc-input" id="cc-pa-control">';
    html += '<div class="cc-ms-pills" id="cc-pa-pills">';
    if (vals.length) {
      vals.forEach(function(v) {
        var opt = PA_OPTIONS.find(function(o) { return o.key === v || o.label === v; });
        html += '<span class="cc-ms-pill">' + escapeHtml(opt ? opt.label : v) + '</span>';
      });
    } else {
      html += '<span class="cc-ms-placeholder" style="color:#9CA3AF;font-size:0.85rem;">Select practice areas...</span>';
    }
    html += '</div>';
    html += '<span class="cc-ms-arrow">&#9662;</span>';
    html += '</div>';
    html += '<div class="cc-ms-dropdown" id="cc-pa-dropdown">';
    PA_OPTIONS.forEach(function(o) {
      var checked = vals.indexOf(o.key) >= 0 || vals.indexOf(o.label) >= 0;
      html += '<label class="cc-ms-option' + (checked ? ' cc-ms-option-checked' : '') + '">';
      html += '<input type="checkbox" class="cc-pa-cb" value="' + escapeAttr(o.key) + '"' + (checked ? ' checked' : '') + '> ';
      html += escapeHtml(o.label) + '</label>';
    });
    html += '</div></div>';
    return html;
  }

  function bindPracticeAreaField() {
    var wrap = document.getElementById('cc-pa-inline');
    if (!wrap) return;
    var control = document.getElementById('cc-pa-control');
    var dropdown = document.getElementById('cc-pa-dropdown');
    var pills = document.getElementById('cc-pa-pills');
    var isOpen = false;

    function toggle(open) {
      isOpen = typeof open === 'boolean' ? open : !isOpen;
      dropdown.style.display = isOpen ? 'block' : 'none';
      if (isOpen) {
        control.style.borderRadius = '6px 6px 0 0';
        control.style.borderBottomColor = 'transparent';
      } else {
        control.style.borderRadius = '';
        control.style.borderBottomColor = '';
      }
    }

    function refreshPills() {
      var checked = [];
      dropdown.querySelectorAll('.cc-pa-cb:checked').forEach(function(cb) { checked.push(cb.value); });
      var html = '';
      if (checked.length) {
        checked.forEach(function(v) {
          var opt = PA_OPTIONS.find(function(o) { return o.key === v; });
          html += '<span class="cc-ms-pill">' + escapeHtml(opt ? opt.label : v) + '</span>';
        });
      } else {
        html += '<span class="cc-ms-placeholder" style="color:#9CA3AF;font-size:0.85rem;">Select practice areas...</span>';
      }
      pills.innerHTML = html;
    }

    // Update option highlight state
    function refreshOptions() {
      dropdown.querySelectorAll('.cc-ms-option').forEach(function(opt) {
        var cb = opt.querySelector('.cc-pa-cb');
        if (cb && cb.checked) {
          opt.classList.add('cc-ms-option-checked');
        } else {
          opt.classList.remove('cc-ms-option-checked');
        }
      });
    }

    control.addEventListener('click', function(e) {
      toggle();
    });

    dropdown.addEventListener('change', function(e) {
      if (e.target.classList.contains('cc-pa-cb')) {
        refreshPills();
        refreshOptions();
        var checked = [];
        dropdown.querySelectorAll('.cc-pa-cb:checked').forEach(function(cb) { checked.push(cb.value); });
        state.lead.Practice_Area = checked;
        API.leads.update(leadId, { Practice_Area: checked }).then(function() {
          ccToast('Practice area updated.', 'success');
        }).catch(function() {
          ccToast('Failed to update practice area.', 'error');
        });
      }
    });

    // Prevent clicks inside dropdown from closing it
    dropdown.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    document.addEventListener('click', function(e) {
      if (!wrap.contains(e.target)) toggle(false);
    });
  }

  function bindLeadSourceField() {
    var sel = document.getElementById('cc-leadsrc-select');
    var other = document.getElementById('cc-leadsrc-other');
    if (!sel || !other) return;
    sel.addEventListener('change', function() {
      if (sel.value === 'Other') {
        other.style.display = 'block';
        other.focus();
        other.value = '';
      } else {
        other.style.display = 'none';
        other.value = '';
      }
      sel.classList.add('cc-field-dirty');
      var saveBar = document.getElementById('cc-info-save-bar');
      if (saveBar) saveBar.style.display = '';
    });
    other.addEventListener('input', function() {
      other.classList.add('cc-field-dirty');
      var saveBar = document.getElementById('cc-info-save-bar');
      if (saveBar) saveBar.style.display = '';
    });
  }

  function renderLanguageField(l) {
    var val = l.Preferred_Language || (isNewLead ? 'English' : '');
    var isOther = val && LANGUAGE_OPTIONS.indexOf(val) === -1;
    var selectVal = isOther ? 'Other' : val;
    var html = '<div class="cc-lang-wrap">';
    html += '<select class="cc-info-input cc-select" data-field="Preferred_Language" data-original="' + escapeAttr(val) + '" id="cc-lang-select" autocomplete="off">';
    LANGUAGE_OPTIONS.forEach(function(opt) {
      var label = opt || '— Select —';
      html += '<option value="' + escapeAttr(opt) + '"' + (opt === selectVal ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    });
    html += '</select>';
    html += '<input type="text" class="cc-info-input" id="cc-lang-other" data-field="Preferred_Language" ' +
      'placeholder="Enter language" value="' + escapeAttr(isOther ? val : '') + '" ' +
      'autocomplete="off" style="margin-top:6px;display:' + (isOther ? 'block' : 'none') + '">';
    html += '</div>';
    return html;
  }

  function bindLanguageField() {
    var sel = document.getElementById('cc-lang-select');
    var other = document.getElementById('cc-lang-other');
    if (!sel || !other) return;
    sel.addEventListener('change', function() {
      if (sel.value === 'Other') {
        other.style.display = 'block';
        other.focus();
        other.value = '';
      } else {
        other.style.display = 'none';
        other.value = '';
      }
    });
    // When "Other" text changes, update the data-field value so save picks it up
    other.addEventListener('input', function() {
      // Mark dirty
      other.classList.add('cc-field-dirty');
      var saveBar = document.getElementById('cc-info-save-bar');
      if (saveBar) saveBar.style.display = '';
    });
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
      { label: 'City', html: (function() {
        var cityVal = l.City || (isNewLead ? 'Mississauga' : '');
        return '<input type="text" class="cc-info-input" data-field="City" value="' + escapeAttr(cityVal) + '" placeholder="Enter city" list="cc-city-list" autocomplete="off">' +
          '<datalist id="cc-city-list">' +
          ['Mississauga','Toronto','Brampton','Oakville','Burlington','Hamilton','Milton','Vaughan','Richmond Hill','Markham','Scarborough','Etobicoke','North York','Ajax','Pickering','Oshawa','Whitby','Newmarket','Aurora','Barrie','Guelph','Kitchener','Waterloo','Cambridge','London','Windsor','Ottawa','Kingston','St. Catharines','Niagara Falls','Thunder Bay','Sudbury','Peterborough','Brantford','Caledon','Halton Hills','Georgetown','Stouffville','Woodbridge','Bolton','Orangeville','Innisfil','Orillia'].map(function(c) {
            return '<option value="' + escapeAttr(c) + '">';
          }).join('') + '</datalist>';
      })() },
      { label: 'Province / State', html: renderProvinceField(l) },
      { label: 'Postal Code', html: editableInput('Postal_Code', l.Postal_Code, 'text', 'Enter postal code') },
      { label: 'Country', html: renderCountryField(l) },
      { label: 'Company', html: editableInput('Company', l.Company, 'text', 'Enter company') },
      { label: 'Occupation', html: editableInput('Occupation', l.Occupation, 'text', 'Enter occupation') },
      { label: 'Date of Birth', html: editableInput('Date_of_Birth', l.Date_of_Birth, 'date', '') },
      { label: 'Spouse Name', html: editableInput('Spouse_Name', l.Spouse_Name, 'text', 'Enter spouse name') },
      { label: 'Marital Status', html: renderSelectField('Marital_Status', l.Marital_Status, ['', 'Single', 'Married', 'Common-Law', 'Divorced', 'Widowed', 'Separated']) },
      { label: 'Preferred Language', html: renderLanguageField(l) },
      { label: 'Referred By', html: editableInput('Referral_Source', l.Referral_Source, 'text', 'Who referred them?') }
    ];

    var html = '<form autocomplete="off" onsubmit="return false" style="margin:0;padding:0;border:none">';
    html += '<div class="cc-info-section-label">Contact Information</div>';
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
      // Lead Source dropdown (from config)
      html += '<div class="cc-info-item"><div class="cc-info-label">Lead Source</div>';
      html += renderLeadSourceField({ Source: '' });
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
    bindLanguageField();
    bindLeadSourceField();
      // Bind services selector button
      var svcBtn = document.getElementById('cc-new-lead-svc-btn');
      if (svcBtn) svcBtn.addEventListener('click', function() { showNewLeadServicesModal(); });
      return;
    }

    // ── Compute Next Action from earliest pending task ──
    var nextActionDisplay = '—';
    var nextActionDate = l.Next_Action_At || l.Next_Action_Date || null;
    var earliestTaskDate = null;
    (state.tasks || []).forEach(function(t) {
      if (t.Status === 'DONE' || !t.Due_At) return;
      var d = new Date(t.Due_At);
      if (!earliestTaskDate || d < earliestTaskDate) earliestTaskDate = d;
    });
    if (earliestTaskDate) {
      nextActionDisplay = API.util.formatDateTime(earliestTaskDate.toISOString());
    } else if (nextActionDate) {
      nextActionDisplay = API.util.formatDateTime(nextActionDate);
    }

    // ── Lead details (read-only) ──
    var detailFields = [
      { label: 'Practice Area', html: renderPracticeAreaField(l) },
      { label: 'Lead Source', html: renderLeadSourceField(l) },
      { label: 'Owner', html: renderOwnerField(l) },
      { label: 'Created', value: API.util.formatDateTime(l.Created_At) },
      { label: 'Last Contact', value: API.util.formatRelativeTime(l.Last_Contacted_At) || '—' },
      { label: 'Next Action', value: nextActionDisplay },
      { label: 'Est. Closing Date', html: renderClosingDateField(l) },
      { label: 'Services Required', html: renderServicesField(l) },
      { label: 'Subscribed', html: renderConsentField(l) }
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
    html += '</form>';

    el.innerHTML = html;
    bindInfoEdits();
    bindLanguageField();
    bindLeadSourceField();
    bindConsentField();
    bindOwnerField();
    bindPracticeAreaField();
    bindProvinceField();
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
      var hasDetails = a.Body || a.Duration_Minutes || a.Outcome;

      html += '<div class="cc-timeline-item' + (hasDetails ? ' cc-timeline-clickable' : '') + '"' +
        (hasDetails ? ' style="cursor:pointer;" tabindex="0" role="button" aria-expanded="false"' : '') + '>';
      html += '<div class="cc-timeline-icon">' + icon + '</div>';
      html += '<div class="cc-timeline-content">';
      html += '<div class="cc-timeline-header">';
      html += '<span class="cc-timeline-type">' + escapeHtml(a.Type || '') + '</span>';
      html += '<span class="cc-timeline-time">' + escapeHtml(API.util.formatRelativeTime(a.Occurred_At)) + '</span>';
      if (hasDetails) html += '<span class="cc-timeline-chevron" style="margin-left:auto;font-size:0.7rem;color:#9CA3AF;transition:transform .2s;">&#9660;</span>';
      html += '</div>';
      html += '<div class="cc-timeline-subject">' + escapeHtml(a.Subject || '') + '</div>';
      // Recording badge (shown inline, always visible)
      if (a.Recording_URL) {
        html += '<a href="' + escapeAttr(a.Recording_URL) + '" target="_blank" rel="noopener" ' +
          'style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:3px 8px;background:#EEF2FF;color:#4F46E5;border-radius:4px;font-size:0.75rem;text-decoration:none;font-weight:500;" ' +
          'onclick="event.stopPropagation();">' +
          '&#9654; Play Recording</a>';
      }
      // Collapsible detail section
      html += '<div class="cc-timeline-details" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #E5E7EB;">';
      if (a.Type === 'EMAIL' || a.Type === 'SMS') {
        // Show full message body prominently for EMAIL/SMS
        if (a.Body) {
          html += '<div class="cc-timeline-body" style="white-space:pre-wrap;background:#F9FAFB;padding:10px;border-radius:6px;font-size:0.85rem;color:#1F2937;max-height:300px;overflow-y:auto;">' + escapeHtml(a.Body) + '</div>';
        }
        if (a.Type === 'EMAIL') {
          if (a.Campaign_ID) {
            html += '<div style="margin-top:6px;"><a href="/crm/campaigns?id=' + escapeAttr(a.Campaign_ID) + '" style="color:#2563EB;font-size:0.8rem;text-decoration:underline;">View Campaign</a></div>';
          }
          html += '<div style="margin-top:6px;"><button class="cc-btn cc-btn-sm cc-btn-outline cc-view-email-btn" ' +
            'data-recipient="' + escapeAttr(state.lead.Client_Email || '') + '" ' +
            'data-sent-at="' + escapeAttr(a.Occurred_At || '') + '" ' +
            'data-subject="' + escapeAttr(a.Subject || '') + '" ' +
            'style="font-size:0.78rem;">&#9993; View Email Content</button></div>';
        }
        if (a.Type === 'SMS') {
          html += '<div style="margin-top:6px;"><button class="cc-btn cc-btn-sm cc-btn-outline cc-sms-thread-btn" data-lead-id="' + escapeAttr(leadId) + '" style="font-size:0.78rem;">Open SMS Thread</button></div>';
        }
      } else {
        if (a.Body) html += '<div class="cc-timeline-body">' + escapeHtml(a.Body) + '</div>';
      }
      if (a.Duration_Minutes) html += '<div class="cc-timeline-meta">' + escapeHtml(String(a.Duration_Minutes)) + ' min</div>';
      if (a.Outcome) html += '<div class="cc-timeline-meta">Outcome: ' + escapeHtml(a.Outcome) + '</div>';
      html += '</div>'; // end cc-timeline-details
      html += '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;

    // Bind click-to-expand on timeline items
    el.querySelectorAll('.cc-timeline-clickable').forEach(function(item) {
      item.addEventListener('click', function(e) {
        // Don't toggle if clicking a link or button inside details
        if (e.target.closest('a') || e.target.closest('.cc-sms-thread-btn')) return;
        var details = item.querySelector('.cc-timeline-details');
        var chevron = item.querySelector('.cc-timeline-chevron');
        if (!details) return;
        var isOpen = details.style.display !== 'none';
        details.style.display = isOpen ? 'none' : 'block';
        item.setAttribute('aria-expanded', String(!isOpen));
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });

    // Bind SMS thread open buttons in activity timeline
    el.querySelectorAll('.cc-sms-thread-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (state.lead) showSmsModal(state.lead);
      });
    });

    // Bind View Email Content buttons
    el.querySelectorAll('.cc-view-email-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var recipient = btn.getAttribute('data-recipient');
        var sentAt = btn.getAttribute('data-sent-at');
        var subject = btn.getAttribute('data-subject');
        btn.textContent = 'Loading...';
        btn.disabled = true;
        API.admin.getEmailContent(recipient, sentAt, subject).then(function(result) {
          if (result.success && result.email) {
            showEmailContentModal(result.email);
          } else {
            ccToast(result.error || 'Could not fetch email content', 'error');
          }
          btn.innerHTML = '&#9993; View Email Content';
          btn.disabled = false;
        }).catch(function(err) {
          ccToast('Failed to fetch email: ' + (err.error || 'Network error'), 'error');
          btn.innerHTML = '&#9993; View Email Content';
          btn.disabled = false;
        });
      });
    });
  }

  function showEmailContentModal(email) {
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal" style="max-width:700px">' +
        '<div class="cc-modal-header"><h3>Email: ' + escapeHtml(email.subject || 'No Subject') + '</h3>' +
          '<button class="cc-modal-close" id="cc-email-modal-close">&times;</button></div>' +
        '<div class="cc-modal-body" style="padding:0;">' +
          '<div style="padding:0.75rem 1rem;background:#F9FAFB;border-bottom:1px solid #E5E7EB;font-size:0.8rem;color:#6B7280;">' +
            '<div><strong>To:</strong> ' + escapeHtml(email.to || '') + '</div>' +
            '<div><strong>From:</strong> ' + escapeHtml(email.from || '') + '</div>' +
            '<div><strong>Sent:</strong> ' + escapeHtml(email.sent_at ? API.util.formatDateTime(email.sent_at) : '') + '</div>' +
          '</div>' +
          '<div style="padding:1rem;max-height:500px;overflow-y:auto;">' +
            '<iframe id="cc-email-iframe" style="width:100%;border:none;min-height:300px;" sandbox="allow-same-origin"></iframe>' +
          '</div>' +
        '</div>' +
        '<div class="cc-modal-footer">' +
          '<button class="cc-btn cc-btn-secondary" id="cc-email-modal-done">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Write email HTML into sandboxed iframe
    var iframe = document.getElementById('cc-email-iframe');
    if (iframe && email.body_html) {
      var doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write('<html><head><style>body{font-family:Arial,sans-serif;font-size:14px;margin:0;padding:8px;color:#1F2937;}</style></head><body>' + email.body_html + '</body></html>');
      doc.close();
      // Auto-resize iframe to content height
      setTimeout(function() {
        try { iframe.style.height = Math.min(doc.body.scrollHeight + 20, 500) + 'px'; } catch(e) {}
      }, 200);
    }

    var close = function() { overlay.remove(); };
    document.getElementById('cc-email-modal-close').addEventListener('click', close);
    document.getElementById('cc-email-modal-done').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
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

    // Ensure card styling on the task list container
    el.style.background = '#F9FAFB';
    el.style.border = '1px solid #E5E7EB';
    el.style.borderRadius = '8px';
    el.style.padding = '1rem';

    // Filter out ghost tasks (empty items from n8n alwaysOutputData)
    var validTasks = state.tasks.filter(function(t) { return t.id; });

    // Sort most recent first (by Due_At descending, tasks without dates last)
    validTasks.sort(function(a, b) {
      if (!a.Due_At && !b.Due_At) return 0;
      if (!a.Due_At) return 1;
      if (!b.Due_At) return -1;
      return new Date(b.Due_At) - new Date(a.Due_At);
    });

    if (validTasks.length === 0) {
      el.innerHTML = '<div class="cc-empty">No tasks for this lead.</div>';
      return;
    }

    var html = '<div class="cc-task-list" style="max-height:600px;overflow-y:auto;display:flex;flex-direction:column;gap:0.75rem;">';
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

    // Move Log Activity form above Activity Timeline
    var logForm = $el('cc-log-activity-form');
    var timeline = $el('cc-activity-timeline');
    if (logForm && timeline) {
      var formContainer = logForm.closest('div[style*="background"]') || logForm.parentElement;
      var column = timeline.parentElement;
      if (formContainer && column && column.contains(formContainer)) {
        column.insertBefore(formContainer, column.firstChild);
      }
    }

    // Move Add Task form above Tasks list
    var addTaskForm = $el('cc-add-task-form');
    var taskList = $el('cc-task-list');
    if (addTaskForm && taskList) {
      var taskFormContainer = addTaskForm.closest('div[style*="background"]') || addTaskForm.parentElement;
      var taskColumn = taskList.parentElement;
      if (taskFormContainer && taskColumn && taskColumn.contains(taskFormContainer)) {
        taskColumn.insertBefore(taskFormContainer, taskColumn.firstChild);
      }
    }
  }

  function bindLogActivityForm() {
    var form = $el('cc-log-activity-form');
    if (!form) return;

    // Only render form if not already rendered
    if (form.dataset.bound) return;
    form.dataset.bound = 'true';

    form.innerHTML =
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
      '<textarea id="cc-act-body" class="cc-input cc-textarea" placeholder="Details (required)" required></textarea>' +
      '<div class="cc-form-row">' +
        '<input id="cc-act-duration" class="cc-input cc-input-sm" type="number" placeholder="Duration (min)" />' +
        '<input id="cc-act-outcome" class="cc-input" placeholder="Outcome (required)" required />' +
        '<button id="cc-act-submit" class="cc-btn cc-btn-primary">Log</button>' +
      '</div>';

    $el('cc-act-submit').addEventListener('click', async function() {
      var btn = $el('cc-act-submit');
      if (btn.disabled) return;
      var type = $el('cc-act-type').value;
      var subject = $el('cc-act-subject').value.trim();
      if (!subject) { ccToast('Subject is required.', 'info'); return; }
      var body = $el('cc-act-body').value.trim();
      if (!body) { ccToast('Details is required.', 'info'); return; }
      var outcome = $el('cc-act-outcome').value.trim();
      if (!outcome) { ccToast('Outcome is required.', 'info'); return; }

      btn.disabled = true;
      try {
        var result = await API.activities.create({
          lead_id: leadId,
          type: type,
          subject: subject,
          body: body,
          duration_minutes: parseInt($el('cc-act-duration').value) || 0,
          outcome: outcome
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
      '<input type="date" id="cc-closing-date-input" class="cc-info-input" data-field="Estimated_Closing_Date" data-original="' + escapeAttr(l.Estimated_Closing_Date || '') + '" style="display:none" ' +
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
          var langSelect = document.getElementById('cc-lang-select');
          var langOther = document.getElementById('cc-lang-other');
          var srcSelect = document.getElementById('cc-leadsrc-select');
          var srcOther = document.getElementById('cc-leadsrc-other');
          var provSelect = document.getElementById('cc-province-select');
          var provOther = document.getElementById('cc-province-other');
          document.querySelectorAll('.cc-info-input').forEach(function(inp) {
            // Skip hidden language "Other" text input when a standard language is selected
            if (inp.id === 'cc-lang-other' && langSelect && langSelect.value !== 'Other') return;
            // Skip language select when "Other" is chosen (use text input value instead)
            if (inp.id === 'cc-lang-select' && langSelect && langSelect.value === 'Other') return;
            // Skip hidden lead source "Other" text input when a standard option is selected
            if (inp.id === 'cc-leadsrc-other' && srcSelect && srcSelect.value !== 'Other') return;
            // Skip lead source select when "Other" is chosen (use text input value instead)
            if (inp.id === 'cc-leadsrc-select' && srcSelect && srcSelect.value === 'Other') return;
            // Skip hidden province "Other" text input when a standard option is selected
            if (inp.id === 'cc-province-other' && provSelect && provSelect.value !== 'Other') return;
            // Skip province select when "Other" is chosen (use text input value instead)
            if (inp.id === 'cc-province-select' && provSelect && provSelect.value === 'Other') return;
            var field = inp.getAttribute('data-field');
            var original = inp.getAttribute('data-original');
            var current = inp.value.trim();
            if (current !== (original || '')) {
              updates[field] = current;
            }
          });
          // Responsible_Lawyer must be sent as an array of record IDs
          if (updates.Responsible_Lawyer !== undefined) {
            updates.Responsible_Lawyer = updates.Responsible_Lawyer ? [updates.Responsible_Lawyer] : [];
          }
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
        var langSel = document.getElementById('cc-lang-select');
        var langOth = document.getElementById('cc-lang-other');
        var srcSel = document.getElementById('cc-leadsrc-select');
        var srcOth = document.getElementById('cc-leadsrc-other');
        document.querySelectorAll('.cc-info-input').forEach(function(inp) {
          if (inp.id === 'cc-lang-other' && langSel && langSel.value !== 'Other') return;
          if (inp.id === 'cc-lang-select' && langSel && langSel.value === 'Other') return;
          if (inp.id === 'cc-leadsrc-other' && srcSel && srcSel.value !== 'Other') return;
          if (inp.id === 'cc-leadsrc-select' && srcSel && srcSel.value === 'Other') return;
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

        // Collect Service Package checkboxes
        var spChecks = document.querySelectorAll('.cc-sp-check:checked');
        if (spChecks.length) {
          data.Service_Package = Array.from(spChecks).map(function(cb) { return cb.value; });
        }

        // Services Required: use selections from modal
        if (_newLeadServiceIds.length) {
          data.Services_Required = _newLeadServiceIds;
        }

        // Auto-tag new leads with "Lead"
        data.Tags = ['Lead'];

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

  // ─── Communication Modals ───────────────────────────────────

  // SVG icons for action buttons (reused in modals)
  var _icons = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
  };

  // ── Call via tel: link (opens RingCentral desktop app) ─────
  // ─── Send Form Modal ──────────────────────────────────────
  async function showSendFormModal(record) {
    // Fetch active forms
    var formsList = [];
    try {
      var result = await API.forms.list({ is_active: true });
      formsList = (result && result.data) || [];
    } catch (e) {
      ccToast('Could not load forms list.', 'error');
      return;
    }

    if (formsList.length === 0) {
      ccToast('No active forms available. Create forms in Admin > Forms first.', 'error');
      return;
    }

    // Build modal
    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'cc-modal';

    var optionsHtml = '<option value="">Select a form...</option>';
    formsList.forEach(function(f) {
      optionsHtml += '<option value="' + escapeAttr(f.Form_ID) + '">' + escapeHtml(f.Name) + '</option>';
    });

    modal.innerHTML =
      '<div class="cc-modal-header">' +
        '<h3>Send Form to ' + escapeHtml(record.Client_Name || 'Client') + '</h3>' +
        '<button class="cc-modal-close">&times;</button>' +
      '</div>' +
      '<div class="cc-modal-body">' +
        '<div class="cc-form-group" style="margin-bottom:1rem;">' +
          '<label class="cc-label">Form</label>' +
          '<select id="cc-send-form-select" class="cc-select" style="width:100%;">' + optionsHtml + '</select>' +
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

    // Bind close
    overlay.querySelector('.cc-modal-close').addEventListener('click', function() { overlay.remove(); });
    overlay.querySelector('.cc-modal-cancel-btn').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Bind form select → show preview URL + enable send
    var formSelect = document.getElementById('cc-send-form-select');
    var sendBtn = document.getElementById('cc-send-form-btn');
    var previewDiv = document.getElementById('cc-send-form-preview');
    var urlSpan = document.getElementById('cc-send-form-url');

    formSelect.addEventListener('change', function() {
      if (formSelect.value) {
        var url = 'https://clientcare.tabuchilaw.com/intake?form=' + encodeURIComponent(formSelect.value) + '&lead=' + encodeURIComponent(record.id);
        urlSpan.textContent = url;
        previewDiv.style.display = '';
        sendBtn.disabled = false;
      } else {
        previewDiv.style.display = 'none';
        sendBtn.disabled = true;
      }
    });

    // Bind follow-up checkbox toggle
    var followupCheck = document.getElementById('cc-send-form-followup');
    var followupConfig = document.getElementById('cc-send-form-followup-config');
    followupCheck.addEventListener('change', function() {
      followupConfig.style.display = followupCheck.checked ? '' : 'none';
    });

    // Bind send
    sendBtn.addEventListener('click', async function() {
      if (sendBtn.disabled) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';

      try {
        var payload = {
          lead_id: record.id,
          form_id: formSelect.value,
          custom_message: document.getElementById('cc-send-form-message').value.trim(),
          create_followup_task: followupCheck.checked,
          followup_days: followupCheck.checked ? parseInt(document.getElementById('cc-send-form-followup-days').value, 10) || 3 : undefined
        };

        var result = await API.forms.sendLink(payload);
        if (result && result.success) {
          ccToast('Form link sent to ' + escapeHtml(record.Client_Name || record.Client_Email) + '.', 'success');
          overlay.remove();
          // Refresh activity timeline if visible
          if (typeof fetchActivities === 'function') fetchActivities();
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

    // Try RC desktop app first, fall back to tel:
    var launched = false;
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = rcUri;
    document.body.appendChild(iframe);
    setTimeout(function() {
      document.body.removeChild(iframe);
      if (!launched) {
        // If RC app didn't handle it, use tel: link
        var a = document.createElement('a');
        a.href = telUri;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }, 500);

    ccToast('Opening RingCentral for ' + escapeHtml(record.Client_Phone) + '...', 'info');

    // Notify backend that a call was initiated — triggers recording poll
    try {
      fetch('https://tabuchilaw.app.n8n.cloud/webhook/cc/call-started', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: state.lead.id,
          phone: phone,
          lead_name: record.Client_Name || '',
          started_at: new Date().toISOString(),
          user_id: (API.auth.getUser() || {}).id || ''
        })
      }).catch(function() { /* fire and forget */ });
    } catch (e) { /* ignore */ }

    // Show the call log modal immediately so user can track the call
    showCallLogModal({ lead_id: state.lead.id });
  }

  function showCallLogModal(callData) {
    var _timerStart = Date.now();
    var _timerInterval = null;
    var isFromRC = !!callData.fromRC;

    // Build timer/summary section
    var timerHtml;
    if (isFromRC && callData.duration_minutes > 0) {
      // RC call ended — show static summary
      var rcMins = Math.floor((callData.duration_minutes * 60) / 60);
      var rcSecs = Math.round((callData.duration_minutes * 60) % 60);
      timerHtml =
        '<div class="cc-call-timer" style="text-align:center;margin-bottom:16px;padding:12px;background:#ECFDF5;border-radius:8px;">' +
          '<div style="font-size:0.75rem;color:#059669;margin-bottom:4px;">Call Completed</div>' +
          '<div style="font-size:1.8rem;font-weight:700;color:#059669;font-variant-numeric:tabular-nums;">' + String(rcMins).padStart(2, '0') + ':' + String(rcSecs).padStart(2, '0') + '</div>' +
          '<div style="font-size:0.7rem;color:#6B7280;margin-top:2px;">Duration captured from RingCentral' + (callData.recording_url ? ' &middot; Recording captured' : '') + '</div>' +
        '</div>';
    } else {
      // Fallback — live timer
      timerHtml =
        '<div class="cc-call-timer" style="text-align:center;margin-bottom:16px;padding:12px;background:#F0F9FF;border-radius:8px;">' +
          '<div style="font-size:0.75rem;color:#6B7280;margin-bottom:4px;">Call Duration</div>' +
          '<div id="cc-cl-timer-display" style="font-size:1.8rem;font-weight:700;color:#2563EB;font-variant-numeric:tabular-nums;">00:00</div>' +
          '<div style="font-size:0.7rem;color:#9CA3AF;margin-top:2px;">Timer started when call was placed</div>' +
        '</div>';
    }

    // Recording row: auto-filled if from RC, manual input if fallback
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

    // Live timer (only for fallback mode)
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
        reloadActivities();
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

    // Custom email — open Outlook then show log form
    document.getElementById('cc-em-custom-btn').addEventListener('click', function() {
      var mailto = 'mailto:' + encodeURIComponent(record.Client_Email) +
        '?subject=' + encodeURIComponent('Tabuchi Law — ');
      window.location.href = mailto;

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
            lead_id: state.lead.id,
            type: 'EMAIL',
            subject: subject,
            body: notes || 'Sent via Outlook',
            outcome: 'SENT'
          });
          close();
          ccToast('Email activity logged.', 'success');
          reloadActivities();
        } catch (err) {
          ccToast('Failed to log: ' + (err.error || 'Network error'), 'error');
          btn.disabled = false;
          btn.textContent = 'Log Email Activity';
        }
      });
    });

    // Template email
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

        // Bind template selection
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

    // Back button
    document.getElementById('cc-em-back').addEventListener('click', function() {
      document.getElementById('cc-em-template-area').style.display = 'none';
      document.getElementById('cc-em-preview').style.display = 'none';
      document.getElementById('cc-em-footer').style.display = 'none';
      var choiceBtns = overlay.querySelectorAll('.cc-email-choice-btn');
      for (var i = 0; i < choiceBtns.length; i++) choiceBtns[i].style.display = '';
      selectedTemplateId = null;
    });

    // Send button
    document.getElementById('cc-em-send').addEventListener('click', async function() {
      if (!selectedTemplateId) { ccToast('Please select a template.', 'info'); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        await API.comms.sendEmail({
          lead_id: record.id,
          template_id: selectedTemplateId,
          subject: document.getElementById('cc-em-subject').value,
          body_html: document.getElementById('cc-em-preview-body').innerHTML
        });
        ccToast('Email sent successfully.', 'success');
        close();
        reloadActivities();
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

    // Load SMS thread
    async function loadThread() {
      try {
        var result = await API.comms.getSmsThread(record.id);
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

    // Send SMS
    document.getElementById('cc-sms-send').addEventListener('click', async function() {
      var input = document.getElementById('cc-sms-input');
      var body = input.value.trim();
      if (!body) return;
      var btn = this;
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        await API.comms.sendSms({ lead_id: record.id, body: body });
        input.value = '';
        ccToast('SMS sent.', 'success');
        await loadThread();
        reloadActivities();
      } catch (err) {
        ccToast('Failed to send SMS: ' + (err.error || 'Network error'), 'error');
      }
      btn.disabled = false; btn.textContent = 'Send';
    });

    // Send on Enter (Shift+Enter for newline)
    document.getElementById('cc-sms-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('cc-sms-send').click();
      }
    });
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
      '.cc-info-divider{border:none;border-top:1px solid #e2e8f0;margin:16px 0}' +
      '.cc-ms-pill{display:inline-flex;align-items:center;gap:2px;padding:2px 8px;border-radius:4px;font-size:.78rem;font-weight:500;background:#EDE9FE;color:#5B21B6;white-space:nowrap;margin:1px 2px}' +
      '.cc-ms-arrow{font-size:12px;color:#6B7280;margin-left:4px}' +
      '.cc-pa-inline-wrap{position:relative;display:flex;align-items:center;flex-wrap:wrap;cursor:pointer;gap:2px}' +
      '.cc-pa-pills{display:flex;flex-wrap:wrap;gap:2px;flex:1}';
    document.head.appendChild(s);
  }

  function init() {
    injectStyles();
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    // Cleanup refresh timer on page unload
    window.addEventListener('beforeunload', stopRecordingsRefresh);

    loadLeadSources().then(function() { loadData(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
/* 1774050520 */
