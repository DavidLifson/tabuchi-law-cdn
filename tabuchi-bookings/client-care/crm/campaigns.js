/**
 * Tabuchi Law Client Care CRM - Campaign Management
 * Handles: /crm/campaigns
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Campaign list with status filters and sorting
 * - Create new drip / newsletter campaigns
 * - Campaign detail view with step sequence editor
 * - Add/remove steps with delay, template, condition
 * - Campaign status management (DRAFT -> ACTIVE -> PAUSED -> ENDED)
 * - Enroll leads into campaigns
 * - Role restricted: ADMIN, MARKETING, MANAGER
 *
 * Page element IDs:
 * - #cc-campaigns-container   (main container)
 * - #cc-campaigns-list        (campaign list area)
 * - #cc-campaign-detail       (detail/step editor area, hidden by default)
 * - #cc-campaign-filters      (filter bar)
 * - #cc-user-name             (nav user display)
 */

(function Campaigns() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

  var API = ClientCareAPI;
  var $el = function(id) { return document.getElementById(id); };

  // ─── Constants ─────────────────────────────────────────────
  var STATUS_OPTIONS = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];
  var TYPE_OPTIONS = ['DRIP', 'NEWSLETTER'];
  var CHANNEL_OPTIONS = ['EMAIL', 'SMS'];
  var CONDITION_OPTIONS = ['NONE', 'OPENED', 'CLICKED', 'NO_RESPONSE'];

  var STATUS_COLORS = {
    DRAFT: 'gray', ACTIVE: 'green', PAUSED: 'yellow', ENDED: 'red'
  };

  // ─── State ─────────────────────────────────────────────────
  var state = {
    view: 'list',       // 'list' or 'detail'
    campaigns: [],
    filterStatus: '',
    filterType: '',
    sortKey: 'created_at',
    sortDir: 'desc',
    loading: false,
    // Detail view
    activeCampaign: null,
    steps: [],
    detailLoading: false,
    user: API.auth.getUser()
  };

  // ─── Role Gate ─────────────────────────────────────────────
  function checkRole() {
    var role = state.user ? state.user.role : '';
    if (!['ADMIN', 'MARKETING', 'MANAGER'].includes(role)) {
      var container = $el('cc-campaigns-container');
      if (container) container.innerHTML =
        '<div class="cc-error"><p>Access denied. Campaign management requires ADMIN, MARKETING, or MANAGER role.</p></div>';
      return false;
    }
    return true;
  }

  // ─── Fetch Campaign List ───────────────────────────────────
  async function fetchCampaigns() {
    if (state.loading) return;
    state.loading = true;

    showListLoading();

    try {
      var result = await API.campaigns.list();
      if (result.success) {
        state.campaigns = result.campaigns || [];
        renderList();
      } else {
        showListError(result.error || 'Failed to load campaigns.');
      }
    } catch (err) {
      showListError(err.error || 'Error loading campaigns.');
    }

    state.loading = false;
  }

  // ─── Fetch Campaign Detail ─────────────────────────────────
  async function fetchDetail(campaignId) {
    state.detailLoading = true;
    showDetailLoading();

    try {
      var result = await API.campaigns.get(campaignId);
      if (result.success) {
        state.activeCampaign = result.campaign;
        state.steps = result.steps || [];
        renderDetail();
      } else {
        showDetailError(result.error || 'Failed to load campaign.');
      }
    } catch (err) {
      showDetailError(err.error || 'Error loading campaign.');
    }

    state.detailLoading = false;
  }

  // ─── Render List View ──────────────────────────────────────
  function renderList() {
    var el = $el('cc-campaigns-list');
    if (!el) return;

    // Apply filters
    var filtered = state.campaigns;
    if (state.filterStatus) {
      filtered = filtered.filter(function(c) { return c.status === state.filterStatus; });
    }
    if (state.filterType) {
      filtered = filtered.filter(function(c) { return c.type === state.filterType; });
    }

    // Apply sort
    filtered = filtered.slice().sort(function(a, b) {
      var av = a[state.sortKey];
      var bv = b[state.sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return state.sortDir === 'asc' ? av - bv : bv - av;
      }
      av = String(av || '');
      bv = String(bv || '');
      return state.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    if (filtered.length === 0) {
      el.innerHTML = '<div class="cc-empty">' +
        '<p>No campaigns found.' + (state.campaigns.length ? ' Try adjusting filters.' : '') + '</p>' +
        '</div>';
      return;
    }

    var columns = [
      { key: 'name', label: 'Campaign Name' },
      { key: 'type', label: 'Type' },
      { key: 'channel', label: 'Channel' },
      { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Created' }
    ];

    var html = '<table class="cc-table cc-campaigns-table">';
    html += '<thead><tr>';
    columns.forEach(function(col) {
      var arrow = '';
      var cls = 'cc-th cc-th-sortable';
      if (state.sortKey === col.key) {
        cls += ' cc-th-sorted';
        arrow = state.sortDir === 'asc' ? ' &#9650;' : ' &#9660;';
      }
      html += '<th class="' + cls + '" data-col="' + col.key + '">' + col.label + arrow + '</th>';
    });
    html += '<th class="cc-th">Actions</th>';
    html += '</tr></thead><tbody>';

    filtered.forEach(function(c) {
      var statusCls = STATUS_COLORS[c.status] || 'gray';
      html += '<tr class="cc-campaign-row" data-id="' + c.id + '">';
      html += '<td class="cc-campaign-name-cell">' + escapeHtml(c.name || 'Untitled') + '</td>';
      html += '<td>' + escapeHtml(c.type || '') + '</td>';
      html += '<td>' + escapeHtml(c.channel || '') + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + statusCls + '">' + escapeHtml(c.status || '') + '</span></td>';
      html += '<td>' + API.util.formatDate(c.created_at) + '</td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-campaign-view-btn" data-id="' + c.id + '">View</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;

    bindListClicks();
  }

  // ─── Render Filters ────────────────────────────────────────
  function renderFilters() {
    var el = $el('cc-campaign-filters');
    if (!el) return;

    var html = '<div class="cc-campaigns-filter-row">';

    // Status filter
    html += '<select id="cc-filter-campaign-status" class="cc-input cc-input-sm">';
    html += '<option value="">All Statuses</option>';
    STATUS_OPTIONS.forEach(function(s) {
      html += '<option value="' + s + '"' + (state.filterStatus === s ? ' selected' : '') + '>' + s + '</option>';
    });
    html += '</select>';

    // Type filter
    html += '<select id="cc-filter-campaign-type" class="cc-input cc-input-sm">';
    html += '<option value="">All Types</option>';
    TYPE_OPTIONS.forEach(function(t) {
      html += '<option value="' + t + '"' + (state.filterType === t ? ' selected' : '') + '>' + t + '</option>';
    });
    html += '</select>';

    // Create button
    html += '<button id="cc-create-campaign-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ New Campaign</button>';

    html += '</div>';
    el.innerHTML = html;

    // Bind filter changes
    var statusEl = $el('cc-filter-campaign-status');
    if (statusEl) statusEl.addEventListener('change', function() {
      state.filterStatus = statusEl.value;
      renderList();
    });

    var typeEl = $el('cc-filter-campaign-type');
    if (typeEl) typeEl.addEventListener('change', function() {
      state.filterType = typeEl.value;
      renderList();
    });

    var createBtn = $el('cc-create-campaign-btn');
    if (createBtn) createBtn.addEventListener('click', showCreateModal);
  }

  // ─── List Event Bindings ───────────────────────────────────
  function bindListClicks() {
    var listEl = $el('cc-campaigns-list');
    if (!listEl) return;

    // Sort headers
    listEl.querySelectorAll('.cc-th-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var col = th.dataset.col;
        if (state.sortKey === col) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = col;
          state.sortDir = 'asc';
        }
        renderList();
      });
    });

    // View buttons
    listEl.querySelectorAll('.cc-campaign-view-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        openDetail(btn.dataset.id);
      });
    });

    // Row click
    listEl.querySelectorAll('.cc-campaign-row').forEach(function(row) {
      row.addEventListener('click', function() {
        openDetail(row.dataset.id);
      });
    });
  }

  // ─── Open Detail View ──────────────────────────────────────
  function openDetail(campaignId) {
    state.view = 'detail';
    toggleViews();
    fetchDetail(campaignId);
  }

  function closeDetail() {
    state.view = 'list';
    state.activeCampaign = null;
    state.steps = [];
    toggleViews();
    fetchCampaigns();
  }

  function toggleViews() {
    var listSection = $el('cc-campaigns-list');
    var filterSection = $el('cc-campaign-filters');
    var detailSection = $el('cc-campaign-detail');

    if (state.view === 'detail') {
      if (listSection) listSection.style.display = 'none';
      if (filterSection) filterSection.style.display = 'none';
      if (detailSection) detailSection.style.display = 'block';
    } else {
      if (listSection) listSection.style.display = 'block';
      if (filterSection) filterSection.style.display = 'block';
      if (detailSection) detailSection.style.display = 'none';
    }
  }

  // ─── Render Detail View ────────────────────────────────────
  function renderDetail() {
    var el = $el('cc-campaign-detail');
    if (!el || !state.activeCampaign) return;

    var c = state.activeCampaign;
    var statusCls = STATUS_COLORS[c.status] || 'gray';

    var html = '<div class="cc-detail-header">';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-detail-back-btn">&larr; Back to Campaigns</button>';
    html += '<h2 class="cc-detail-title">' + escapeHtml(c.name) + '</h2>';
    html += '<div class="cc-detail-meta">';
    html += '<span class="cc-badge cc-badge-' + statusCls + '">' + escapeHtml(c.status) + '</span>';
    html += '<span class="cc-detail-meta-item">' + escapeHtml(c.type) + '</span>';
    html += '<span class="cc-detail-meta-item">' + escapeHtml(c.channel) + '</span>';
    html += '<span class="cc-detail-meta-item">Created ' + API.util.formatDate(c.created_at) + '</span>';
    html += '</div>';
    html += '</div>';

    // Status actions
    html += '<div class="cc-detail-actions">';
    html += renderStatusActions(c);
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-edit-campaign-btn">Edit Campaign</button>';
    html += '</div>';

    // Steps section
    html += '<div class="cc-detail-section">';
    html += '<div class="cc-detail-section-header">';
    html += '<h3>Campaign Steps</h3>';
    if (c.status === 'DRAFT') {
      html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-add-step-btn">+ Add Step</button>';
    }
    html += '</div>';
    html += renderStepsTable();
    html += '</div>';

    // Enrollment section
    html += '<div class="cc-detail-section">';
    html += '<h3>Enroll Leads</h3>';
    html += '<div class="cc-enroll-form">';
    html += '<input type="text" id="cc-enroll-lead-ids" class="cc-input cc-input-sm" placeholder="Lead record IDs (comma-separated)" />';
    html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-enroll-btn">Enroll</button>';
    html += '</div>';
    html += '</div>';

    el.innerHTML = html;
    bindDetailEvents();
  }

  function renderStatusActions(c) {
    var html = '';
    switch (c.status) {
      case 'DRAFT':
        html += '<button class="cc-btn cc-btn-sm cc-btn-green cc-status-btn" data-status="ACTIVE">Activate</button>';
        break;
      case 'ACTIVE':
        html += '<button class="cc-btn cc-btn-sm cc-btn-yellow cc-status-btn" data-status="PAUSED">Pause</button>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-red cc-status-btn" data-status="ENDED">End</button>';
        break;
      case 'PAUSED':
        html += '<button class="cc-btn cc-btn-sm cc-btn-green cc-status-btn" data-status="ACTIVE">Resume</button>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-red cc-status-btn" data-status="ENDED">End</button>';
        break;
      case 'ENDED':
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-status-btn" data-status="DRAFT">Reset to Draft</button>';
        break;
    }
    return html;
  }

  function renderStepsTable() {
    if (!state.steps || state.steps.length === 0) {
      return '<p class="cc-empty">No steps defined. Add steps to build your campaign sequence.</p>';
    }

    var sorted = state.steps.slice().sort(function(a, b) {
      return (a.step_number || 0) - (b.step_number || 0);
    });

    var isDraft = state.activeCampaign && state.activeCampaign.status === 'DRAFT';

    var html = '<table class="cc-table cc-steps-table">';
    html += '<thead><tr>';
    html += '<th class="cc-th">Step #</th>';
    html += '<th class="cc-th">Delay (Days)</th>';
    html += '<th class="cc-th">Template</th>';
    html += '<th class="cc-th">Condition</th>';
    if (isDraft) html += '<th class="cc-th">Actions</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function(step) {
      var templateDisplay = step.template && step.template.length ? step.template[0] : 'None';
      html += '<tr data-step-id="' + step.id + '">';
      html += '<td>' + (step.step_number || '') + '</td>';
      html += '<td>' + (step.delay_days !== undefined ? step.delay_days : '') + '</td>';
      html += '<td class="cc-step-template-cell">' + escapeHtml(String(templateDisplay)) + '</td>';
      html += '<td>' + escapeHtml(step.condition || 'NONE') + '</td>';
      if (isDraft) {
        html += '<td>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-danger cc-delete-step-btn" data-step-id="' + step.id + '">Delete</button>';
        html += '</td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table>';

    // Cumulative delay summary
    var totalDays = sorted.reduce(function(sum, s) { return sum + (s.delay_days || 0); }, 0);
    html += '<div class="cc-steps-summary">Total sequence: ' + sorted.length + ' step' + (sorted.length !== 1 ? 's' : '') +
      ' over ' + totalDays + ' day' + (totalDays !== 1 ? 's' : '') + '</div>';

    return html;
  }

  // ─── Detail Event Bindings ─────────────────────────────────
  function bindDetailEvents() {
    var el = $el('cc-campaign-detail');
    if (!el) return;

    // Back button
    var backBtn = el.querySelector('.cc-detail-back-btn');
    if (backBtn) backBtn.addEventListener('click', closeDetail);

    // Status change buttons
    el.querySelectorAll('.cc-status-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        handleStatusChange(btn.dataset.status);
      });
    });

    // Edit button
    var editBtn = el.querySelector('.cc-edit-campaign-btn');
    if (editBtn) editBtn.addEventListener('click', showEditModal);

    // Add step button
    var addStepBtn = el.querySelector('.cc-add-step-btn');
    if (addStepBtn) addStepBtn.addEventListener('click', showAddStepModal);

    // Delete step buttons
    el.querySelectorAll('.cc-delete-step-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        handleDeleteStep(btn.dataset.stepId);
      });
    });

    // Enroll button
    var enrollBtn = el.querySelector('.cc-enroll-btn');
    if (enrollBtn) enrollBtn.addEventListener('click', handleEnroll);
  }

  // ─── Status Change ─────────────────────────────────────────
  async function handleStatusChange(newStatus) {
    if (!state.activeCampaign) return;

    var confirmMsg = 'Change campaign status to ' + newStatus + '?';
    if (newStatus === 'ENDED') {
      confirmMsg = 'End this campaign? This will stop all scheduled sends.';
    }
    if (!confirm(confirmMsg)) return;

    try {
      var result = await API.campaigns.update(state.activeCampaign.id, { status: newStatus });
      if (result.success) {
        showToast('Campaign status updated to ' + newStatus, 'success');
        fetchDetail(state.activeCampaign.id);
      } else {
        showToast(result.error || 'Failed to update status.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error updating status.', 'error');
    }
  }

  // ─── Delete Step ───────────────────────────────────────────
  async function handleDeleteStep(stepId) {
    if (!confirm('Delete this step? This cannot be undone.')) return;

    try {
      var result = await API.campaigns.deleteStep(stepId);
      if (result.success) {
        showToast('Step deleted.', 'success');
        fetchDetail(state.activeCampaign.id);
      } else {
        showToast(result.error || 'Failed to delete step.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error deleting step.', 'error');
    }
  }

  // ─── Enroll Leads ──────────────────────────────────────────
  async function handleEnroll() {
    if (!state.activeCampaign) return;

    var input = $el('cc-enroll-lead-ids');
    if (!input || !input.value.trim()) {
      showToast('Enter at least one lead ID.', 'error');
      return;
    }

    var leadIds = input.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (leadIds.length === 0) {
      showToast('Enter at least one lead ID.', 'error');
      return;
    }

    try {
      var result = await API.campaigns.enroll(state.activeCampaign.id, leadIds);
      if (result.success) {
        showToast('Enrolled ' + (result.enrolled_count || leadIds.length) + ' lead(s).', 'success');
        input.value = '';
      } else {
        showToast(result.error || 'Failed to enroll leads.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error enrolling leads.', 'error');
    }
  }

  // ─── Create Campaign Modal ─────────────────────────────────
  function showCreateModal() {
    showModal('New Campaign', buildCampaignForm({}), function(form) {
      return handleCreateCampaign(form);
    });
  }

  async function handleCreateCampaign(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    var type = form.querySelector('#cc-modal-type').value;
    var channel = form.querySelector('#cc-modal-channel').value;

    if (!name) { showToast('Campaign name is required.', 'error'); return false; }
    if (!type) { showToast('Campaign type is required.', 'error'); return false; }
    if (!channel) { showToast('Channel is required.', 'error'); return false; }

    try {
      var result = await API.campaigns.create({ name: name, type: type, channel: channel });
      if (result.success) {
        showToast('Campaign created.', 'success');
        closeModal();
        fetchCampaigns();
        return true;
      } else {
        showToast(result.error || 'Failed to create campaign.', 'error');
        return false;
      }
    } catch (err) {
      showToast(err.error || 'Error creating campaign.', 'error');
      return false;
    }
  }

  // ─── Edit Campaign Modal ───────────────────────────────────
  function showEditModal() {
    if (!state.activeCampaign) return;
    var c = state.activeCampaign;
    showModal('Edit Campaign', buildCampaignForm(c), function(form) {
      return handleEditCampaign(form);
    });
  }

  async function handleEditCampaign(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    var channel = form.querySelector('#cc-modal-channel').value;

    if (!name) { showToast('Campaign name is required.', 'error'); return false; }

    var updates = { name: name };
    if (channel) updates.channel = channel;

    try {
      var result = await API.campaigns.update(state.activeCampaign.id, updates);
      if (result.success) {
        showToast('Campaign updated.', 'success');
        closeModal();
        fetchDetail(state.activeCampaign.id);
        return true;
      } else {
        showToast(result.error || 'Failed to update campaign.', 'error');
        return false;
      }
    } catch (err) {
      showToast(err.error || 'Error updating campaign.', 'error');
      return false;
    }
  }

  function buildCampaignForm(existing) {
    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Campaign Name</label>';
    html += '<input type="text" id="cc-modal-name" class="cc-input" value="' + escapeAttr(existing.name || '') + '" placeholder="e.g. Estate Planning Welcome Series" />';
    html += '</div>';

    if (!existing.id) {
      // Only show type on create (immutable after creation)
      html += '<div class="cc-form-group">';
      html += '<label class="cc-label">Type</label>';
      html += '<select id="cc-modal-type" class="cc-input">';
      html += '<option value="">Select type...</option>';
      TYPE_OPTIONS.forEach(function(t) {
        html += '<option value="' + t + '">' + t + '</option>';
      });
      html += '</select>';
      html += '</div>';
    }

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Channel</label>';
    html += '<select id="cc-modal-channel" class="cc-input">';
    CHANNEL_OPTIONS.forEach(function(ch) {
      html += '<option value="' + ch + '"' + (existing.channel === ch ? ' selected' : '') + '>' + ch + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ─── Add Step Modal ────────────────────────────────────────
  function showAddStepModal() {
    if (!state.activeCampaign) return;

    // Auto-calculate next step number
    var nextNum = 1;
    if (state.steps && state.steps.length > 0) {
      var maxNum = Math.max.apply(null, state.steps.map(function(s) { return s.step_number || 0; }));
      nextNum = maxNum + 1;
    }

    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Step Number</label>';
    html += '<input type="number" id="cc-modal-step-num" class="cc-input" value="' + nextNum + '" min="1" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Delay (Days after enrollment / previous step)</label>';
    html += '<input type="number" id="cc-modal-delay" class="cc-input" value="0" min="0" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Template ID (from CC_Templates table)</label>';
    html += '<input type="text" id="cc-modal-template" class="cc-input" placeholder="Airtable record ID (optional)" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Condition</label>';
    html += '<select id="cc-modal-condition" class="cc-input">';
    CONDITION_OPTIONS.forEach(function(cond) {
      html += '<option value="' + cond + '">' + cond + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '</div>';

    showModal('Add Step', html, function(form) {
      return handleAddStep(form);
    });
  }

  async function handleAddStep(form) {
    var stepNumber = parseInt(form.querySelector('#cc-modal-step-num').value, 10);
    var delayDays = parseInt(form.querySelector('#cc-modal-delay').value, 10);
    var templateId = form.querySelector('#cc-modal-template').value.trim();
    var condition = form.querySelector('#cc-modal-condition').value;

    if (isNaN(stepNumber) || stepNumber < 1) {
      showToast('Valid step number is required.', 'error');
      return false;
    }
    if (isNaN(delayDays) || delayDays < 0) {
      showToast('Valid delay (0+) is required.', 'error');
      return false;
    }

    var data = {
      campaign_id: state.activeCampaign.id,
      step_number: stepNumber,
      delay_days: delayDays,
      condition: condition
    };
    if (templateId) data.template_id = templateId;

    try {
      var result = await API.campaigns.createStep(data);
      if (result.success) {
        showToast('Step ' + stepNumber + ' added.', 'success');
        closeModal();
        fetchDetail(state.activeCampaign.id);
        return true;
      } else {
        showToast(result.error || 'Failed to add step.', 'error');
        return false;
      }
    } catch (err) {
      showToast(err.error || 'Error adding step.', 'error');
      return false;
    }
  }

  // ─── Generic Modal ─────────────────────────────────────────
  var activeModal = null;

  function showModal(title, bodyHtml, onSubmit) {
    closeModal();

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'cc-modal';

    modal.innerHTML =
      '<div class="cc-modal-header">' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        '<button class="cc-modal-close">&times;</button>' +
      '</div>' +
      '<div class="cc-modal-body">' + bodyHtml + '</div>' +
      '<div class="cc-modal-footer">' +
        '<button class="cc-btn cc-btn-outline cc-modal-cancel-btn">Cancel</button>' +
        '<button class="cc-btn cc-btn-primary cc-modal-save-btn">Save</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeModal = overlay;

    // Focus first input
    var firstInput = modal.querySelector('input, select');
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);

    // Bind close
    overlay.querySelector('.cc-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('.cc-modal-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal();
    });

    // Bind save
    overlay.querySelector('.cc-modal-save-btn').addEventListener('click', function() {
      var formEl = modal.querySelector('.cc-modal-body');
      onSubmit(formEl);
    });
  }

  function closeModal() {
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
  }

  // ─── Toast Notifications ───────────────────────────────────
  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'cc-toast cc-toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function() {
      toast.classList.add('cc-toast-visible');
    });

    setTimeout(function() {
      toast.classList.remove('cc-toast-visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  // ─── Loading / Error States ────────────────────────────────
  function showListLoading() {
    var el = $el('cc-campaigns-list');
    if (el) el.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading campaigns...</p></div>';
  }

  function showListError(msg) {
    var el = $el('cc-campaigns-list');
    if (el) el.innerHTML = '<div class="cc-error"><p>' + escapeHtml(msg) + '</p></div>';
  }

  function showDetailLoading() {
    var el = $el('cc-campaign-detail');
    if (el) el.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading campaign...</p></div>';
  }

  function showDetailError(msg) {
    var el = $el('cc-campaign-detail');
    if (el) el.innerHTML =
      '<div class="cc-error"><p>' + escapeHtml(msg) + '</p></div>' +
      '<button class="cc-btn cc-btn-sm cc-btn-outline cc-detail-back-btn" style="margin-top:12px">&larr; Back</button>';
    var backBtn = el ? el.querySelector('.cc-detail-back-btn') : null;
    if (backBtn) backBtn.addEventListener('click', closeDetail);
  }

  // ─── Helpers ───────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Initialize ────────────────────────────────────────────
  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    if (!checkRole()) return;

    // Hide detail by default
    var detailEl = $el('cc-campaign-detail');
    if (detailEl) detailEl.style.display = 'none';

    renderFilters();
    fetchCampaigns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
