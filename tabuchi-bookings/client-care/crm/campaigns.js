/**
 * Tabuchi Law Client Care CRM - Campaign Management (v2)
 * Handles: /crm/campaigns
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Campaign list with search, status/type filters, sorting
 * - Campaign detail with tabbed view (Overview, Editor, Audience, Validation, Recipients, Reporting)
 * - Block-based email content editor with JSON storage
 * - Audience definition builder with preview
 * - Campaign validation with error/warning display
 * - Test send modal
 * - Schedule / send now / cancel
 * - Recipient snapshot (read-only, searchable)
 * - Duplicate campaign, resend to non-openers
 * - Template selection on create
 * - Role restricted: ADMIN, MARKETING, MANAGER
 *
 * Page element IDs:
 * - #cc-campaigns-container   (main container)
 * - #cc-campaigns-list        (campaign list area)
 * - #cc-campaign-detail       (detail area, hidden by default)
 * - #cc-campaign-filters      (filter bar)
 */

(function Campaigns() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

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

  // ─── Constants ─────────────────────────────────────────────
  var STATUS_OPTIONS = ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed'];
  var LEGACY_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];
  var TYPE_OPTIONS = ['email', 'automation_email', 'test'];
  var LEGACY_TYPES = ['DRIP', 'NEWSLETTER'];

  var STATUS_COLORS = {
    draft: 'gray', DRAFT: 'gray',
    scheduled: 'blue', SCHEDULED: 'blue',
    sending: 'cyan', SENDING: 'cyan',
    sent: 'green', SENT: 'green',
    paused: 'yellow', PAUSED: 'yellow',
    cancelled: 'red', CANCELLED: 'red',
    failed: 'red', FAILED: 'red',
    ACTIVE: 'green', ENDED: 'red'
  };

  var TYPE_LABELS = {
    email: 'Email', automation_email: 'Automation', test: 'Test',
    DRIP: 'Drip', NEWSLETTER: 'Newsletter'
  };

  var DETAIL_TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'editor', label: 'Editor' },
    { key: 'audience', label: 'Audience' },
    { key: 'validation', label: 'Validation' },
    { key: 'recipients', label: 'Recipients' },
    { key: 'reporting', label: 'Reporting' }
  ];

  var BLOCK_TYPES = [
    { type: 'heading', label: 'Heading', icon: 'H' },
    { type: 'text', label: 'Text', icon: 'T' },
    { type: 'image', label: 'Image', icon: '🖼' },
    { type: 'button', label: 'Button', icon: '▣' },
    { type: 'divider', label: 'Divider', icon: '—' },
    { type: 'spacer', label: 'Spacer', icon: '↕' },
    { type: 'social', label: 'Social Links', icon: '@' },
    { type: 'header', label: 'Logo/Header', icon: '⊞' },
    { type: 'footer', label: 'Footer/Compliance', icon: '⊟' }
  ];

  // ─── State ─────────────────────────────────────────────────
  var state = {
    view: 'list',       // 'list' or 'detail'
    campaigns: [],
    filterStatus: '',
    filterType: '',
    searchQuery: '',
    sortKey: 'Updated_At',
    sortDir: 'desc',
    loading: false,
    // Detail view
    activeCampaign: null,
    activeTab: 'overview',
    steps: [],
    recipients: [],
    recipientFilter: '',
    detailLoading: false,
    // Editor
    contentBlocks: [],
    editorDirty: false,
    // Audience
    audiencePreview: null,
    // Validation
    validationResult: null,
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

  // ─── Helpers ───────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function uid() {
    return 'b_' + Math.random().toString(36).substr(2, 9);
  }

  function statusLabel(s) {
    return (s || '').charAt(0).toUpperCase() + (s || '').slice(1).toLowerCase();
  }

  function isEmailCampaign(c) {
    if (!c) return false;
    var t = (c.type || c.Type || '').toLowerCase();
    return t === 'email' || t === 'automation_email' || t === 'test' || t === 'newsletter';
  }

  function isDrip(c) {
    if (!c) return false;
    var t = (c.type || c.Type || '').toUpperCase();
    return t === 'DRIP';
  }

  function campaignField(c, key) {
    // Normalize Airtable field names (may come as Title_Case or camelCase)
    return c[key] || c[key.toLowerCase()] || '';
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
        // Parse content JSON
        try {
          var cj = result.campaign.content_json || result.campaign.Content_JSON || '';
          state.contentBlocks = cj ? JSON.parse(cj).blocks || [] : [];
        } catch (e) { state.contentBlocks = []; }
        state.editorDirty = false;
        state.validationResult = null;
        state.recipients = [];
        renderDetail();
      } else {
        showDetailError(result.error || 'Failed to load campaign.');
      }
    } catch (err) {
      showDetailError(err.error || 'Error loading campaign.');
    }

    state.detailLoading = false;
  }

  // ═══════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════

  function renderList() {
    var el = $el('cc-campaigns-list');
    if (!el) return;

    var filtered = state.campaigns;

    // Search
    if (state.searchQuery) {
      var q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(function(c) {
        return (c.name || '').toLowerCase().includes(q) ||
               (c.subject || '').toLowerCase().includes(q);
      });
    }

    // Status filter
    if (state.filterStatus) {
      filtered = filtered.filter(function(c) {
        return (c.status || '').toUpperCase() === state.filterStatus.toUpperCase();
      });
    }

    // Type filter
    if (state.filterType) {
      filtered = filtered.filter(function(c) {
        return (c.type || '').toUpperCase() === state.filterType.toUpperCase();
      });
    }

    // Sort
    filtered = filtered.slice().sort(function(a, b) {
      var av = a[state.sortKey] || a[state.sortKey.toLowerCase()] || '';
      var bv = b[state.sortKey] || b[state.sortKey.toLowerCase()] || '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return state.sortDir === 'asc' ? av - bv : bv - av;
      }
      av = String(av); bv = String(bv);
      return state.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    if (filtered.length === 0) {
      el.innerHTML = '<div class="cc-empty">' +
        '<p>No campaigns found.' + (state.campaigns.length ? ' Try adjusting filters.' : ' Create your first campaign.') + '</p>' +
        '</div>';
      return;
    }

    var columns = [
      { key: 'name', label: 'Campaign' },
      { key: 'subject', label: 'Subject' },
      { key: 'status', label: 'Status' },
      { key: 'type', label: 'Type' },
      { key: 'estimated_recipients', label: 'Est. Recipients' },
      { key: 'scheduled_at', label: 'Scheduled' },
      { key: 'sent_at', label: 'Sent' },
      { key: 'Updated_At', label: 'Updated' }
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
    html += '<th class="cc-th" style="width:120px">Actions</th>';
    html += '</tr></thead><tbody>';

    filtered.forEach(function(c) {
      var st = (c.status || 'draft').toLowerCase();
      var statusCls = STATUS_COLORS[st] || 'gray';
      var typeLabel = TYPE_LABELS[c.type] || TYPE_LABELS[(c.type || '').toUpperCase()] || c.type || '';

      html += '<tr class="cc-campaign-row" data-id="' + c.id + '">';
      html += '<td class="cc-campaign-name-cell">' + escapeHtml(c.name || 'Untitled') + '</td>';
      html += '<td class="cc-campaign-subject-cell">' + escapeHtml(c.subject || '—') + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + statusCls + '">' + statusLabel(st) + '</span></td>';
      html += '<td>' + escapeHtml(typeLabel) + '</td>';
      html += '<td style="text-align:center">' + (c.estimated_recipients != null ? c.estimated_recipients : '—') + '</td>';
      html += '<td>' + (c.scheduled_at ? API.util.formatDateTime(c.scheduled_at) : '—') + '</td>';
      html += '<td>' + (c.sent_at ? API.util.formatDateTime(c.sent_at) : '—') + '</td>';
      html += '<td>' + API.util.formatRelativeTime(c.updated_at || c.Updated_At) + '</td>';

      html += '<td class="cc-list-actions">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-campaign-view-btn" data-id="' + c.id + '">Open</button>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-campaign-dup-btn" data-id="' + c.id + '" data-name="' + escapeAttr(c.name) + '" title="Duplicate">⧉</button>';
      if (st === 'scheduled') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-red cc-campaign-cancel-btn" data-id="' + c.id + '" title="Cancel">✕</button>';
      }
      if (st === 'sent') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-campaign-resend-btn" data-id="' + c.id + '" title="Resend to non-openers">↻</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
    bindListClicks();
  }

  function renderFilters() {
    var el = $el('cc-campaign-filters');
    if (!el) return;

    var allStatuses = STATUS_OPTIONS.concat(LEGACY_STATUSES);
    var allTypes = TYPE_OPTIONS.concat(LEGACY_TYPES);

    var html = '<div class="cc-campaigns-filter-row">';

    // Search
    html += '<input type="text" id="cc-campaign-search" class="cc-input cc-input-sm" placeholder="Search campaigns..." value="' + escapeAttr(state.searchQuery) + '" style="max-width:220px" />';

    // Status filter
    html += '<select id="cc-filter-campaign-status" class="cc-input cc-input-sm" style="max-width:150px">';
    html += '<option value="">All Statuses</option>';
    allStatuses.forEach(function(s) {
      html += '<option value="' + s + '"' + (state.filterStatus === s ? ' selected' : '') + '>' + statusLabel(s) + '</option>';
    });
    html += '</select>';

    // Type filter
    html += '<select id="cc-filter-campaign-type" class="cc-input cc-input-sm" style="max-width:150px">';
    html += '<option value="">All Types</option>';
    allTypes.forEach(function(t) {
      html += '<option value="' + t + '"' + (state.filterType === t ? ' selected' : '') + '>' + (TYPE_LABELS[t] || t) + '</option>';
    });
    html += '</select>';

    // Spacer
    html += '<div style="flex:1"></div>';

    // Create button
    html += '<button id="cc-create-campaign-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ New Campaign</button>';

    html += '</div>';
    el.innerHTML = html;

    // Bind
    var searchEl = $el('cc-campaign-search');
    if (searchEl) {
      var debounce;
      searchEl.addEventListener('input', function() {
        clearTimeout(debounce);
        debounce = setTimeout(function() {
          state.searchQuery = searchEl.value;
          renderList();
        }, 250);
      });
    }

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

    // View/Open
    listEl.querySelectorAll('.cc-campaign-view-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        openDetail(btn.dataset.id);
      });
    });

    // Row click
    listEl.querySelectorAll('.cc-campaign-row').forEach(function(row) {
      row.addEventListener('click', function() { openDetail(row.dataset.id); });
    });

    // Duplicate
    listEl.querySelectorAll('.cc-campaign-dup-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handleDuplicate(btn.dataset.id, btn.dataset.name);
      });
    });

    // Cancel
    listEl.querySelectorAll('.cc-campaign-cancel-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handleCancel(btn.dataset.id);
      });
    });

    // Resend
    listEl.querySelectorAll('.cc-campaign-resend-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handleResendNonOpeners(btn.dataset.id);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════

  function openDetail(campaignId) {
    state.view = 'detail';
    state.activeTab = 'overview';
    toggleViews();
    fetchDetail(campaignId);
  }

  function closeDetail() {
    if (state.editorDirty) {
      if (!confirm('You have unsaved editor changes. Discard?')) return;
    }
    state.view = 'list';
    state.activeCampaign = null;
    state.steps = [];
    state.contentBlocks = [];
    state.editorDirty = false;
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

  function renderDetail() {
    var el = $el('cc-campaign-detail');
    if (!el || !state.activeCampaign) return;

    var c = state.activeCampaign;
    var st = (c.status || 'draft').toLowerCase();
    var statusCls = STATUS_COLORS[st] || 'gray';
    var typeLabel = TYPE_LABELS[c.type] || TYPE_LABELS[(c.type || '').toUpperCase()] || c.type || '';

    var html = '';

    // Header
    html += '<div class="cc-detail-header">';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-detail-back-btn">&larr; Back to Campaigns</button>';
    html += '<h2 class="cc-detail-title">' + escapeHtml(c.name || 'Untitled') + '</h2>';
    html += '<div class="cc-detail-meta">';
    html += '<span class="cc-badge cc-badge-' + statusCls + '">' + statusLabel(st) + '</span>';
    html += '<span class="cc-detail-meta-item">' + escapeHtml(typeLabel) + '</span>';
    if (c.channel) html += '<span class="cc-detail-meta-item">' + escapeHtml(c.channel) + '</span>';
    if (c.created_at || c.Created_At) html += '<span class="cc-detail-meta-item">Created ' + API.util.formatDate(c.created_at || c.Created_At) + '</span>';
    html += '</div>';
    html += '</div>';

    // Action bar
    html += '<div class="cc-detail-actions">';
    html += renderDetailActions(c, st);
    html += '</div>';

    // Tabs
    html += '<div class="cc-detail-tabs">';
    DETAIL_TABS.forEach(function(tab) {
      // Hide steps-related tabs for email campaigns, show editor/audience for email
      if (isDrip(c) && (tab.key === 'editor' || tab.key === 'audience' || tab.key === 'validation' || tab.key === 'reporting')) return;
      var cls = 'cc-tab' + (state.activeTab === tab.key ? ' cc-tab-active' : '');
      html += '<button class="' + cls + '" data-tab="' + tab.key + '">' + tab.label + '</button>';
    });
    html += '</div>';

    // Tab content
    html += '<div class="cc-detail-tab-content">';
    html += renderTabContent(c, st);
    html += '</div>';

    el.innerHTML = html;
    bindDetailEvents();
  }

  function renderDetailActions(c, st) {
    var html = '';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-edit-campaign-btn">Edit Details</button>';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-dup-detail-btn">Duplicate</button>';

    if (isEmailCampaign(c)) {
      if (st === 'draft') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-test-send-btn">Test Send</button>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-validate-btn">Validate</button>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-green cc-schedule-btn">Schedule</button>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-green cc-send-now-btn">Send Now</button>';
      }
      if (st === 'scheduled') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-red cc-cancel-btn">Cancel Scheduled</button>';
      }
      if (st === 'sent') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-resend-btn">Resend to Non-Openers</button>';
      }
    } else if (isDrip(c)) {
      // Legacy drip actions
      if (c.status === 'DRAFT') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-green cc-status-btn" data-status="ACTIVE">Activate</button>';
      } else if (c.status === 'ACTIVE') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-yellow cc-status-btn" data-status="PAUSED">Pause</button>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-red cc-status-btn" data-status="ENDED">End</button>';
      } else if (c.status === 'PAUSED') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-green cc-status-btn" data-status="ACTIVE">Resume</button>';
        html += '<button class="cc-btn cc-btn-sm cc-btn-red cc-status-btn" data-status="ENDED">End</button>';
      } else if (c.status === 'ENDED') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-status-btn" data-status="DRAFT">Reset to Draft</button>';
      }
    }

    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // TAB CONTENT
  // ═══════════════════════════════════════════════════════════

  function renderTabContent(c, st) {
    switch (state.activeTab) {
      case 'overview': return renderOverviewTab(c, st);
      case 'editor': return renderEditorTab(c, st);
      case 'audience': return renderAudienceTab(c, st);
      case 'validation': return renderValidationTab(c, st);
      case 'recipients': return renderRecipientsTab(c, st);
      case 'reporting': return renderReportingTab(c, st);
      default: return renderOverviewTab(c, st);
    }
  }

  // ─── Overview Tab ──────────────────────────────────────────
  function renderOverviewTab(c, st) {
    var html = '<div class="cc-overview-grid">';

    // Campaign details card
    html += '<div class="cc-card">';
    html += '<h4>Campaign Details</h4>';
    html += '<div class="cc-detail-fields">';
    html += fieldRow('Subject', c.subject || '—');
    html += fieldRow('Preheader', c.preheader || '—');
    html += fieldRow('From', (c.from_name || '—') + ' &lt;' + (c.from_email || '—') + '&gt;');
    html += fieldRow('Reply-To', c.reply_to_email || '—');
    html += fieldRow('Timezone', c.timezone || 'America/Toronto');
    if (c.template_name) html += fieldRow('Template', c.template_name);
    if (c.original_campaign_name) {
      html += fieldRow('Resend Of', c.original_campaign_name);
      html += fieldRow('Resend Type', c.resend_type || '—');
    }
    html += '</div>';
    html += '</div>';

    // Audience card
    html += '<div class="cc-card">';
    html += '<h4>Audience</h4>';
    html += '<div class="cc-detail-fields">';
    html += fieldRow('Estimated Recipients', c.estimated_recipients != null ? String(c.estimated_recipients) : '—');
    html += fieldRow('Resolved Recipients', c.resolved_recipients != null ? String(c.resolved_recipients) : '—');
    var audienceSummary = '—';
    try {
      var aud = JSON.parse(c.audience_rules_json || c.Audience_Rules_JSON || '{}');
      if (aud.include_tags && aud.include_tags.length) audienceSummary = 'Tags: ' + aud.include_tags.join(', ');
      else if (aud.include_all) audienceSummary = 'All subscribed contacts';
    } catch (e) {}
    html += fieldRow('Audience Definition', audienceSummary);
    html += '</div>';
    html += '</div>';

    // Validation card
    html += '<div class="cc-card">';
    html += '<h4>Validation</h4>';
    var vs = c.validation_status || c.Validation_Status || 'pending';
    var vsColor = vs === 'valid' ? 'green' : vs === 'invalid' ? 'red' : 'gray';
    html += '<p>Status: <span class="cc-badge cc-badge-' + vsColor + '">' + statusLabel(vs) + '</span></p>';
    try {
      var vsj = JSON.parse(c.validation_summary_json || c.Validation_Summary_JSON || '{}');
      if (vsj.errors && vsj.errors.length) {
        html += '<ul class="cc-validation-errors">';
        vsj.errors.forEach(function(e) { html += '<li class="cc-text-red">' + escapeHtml(e) + '</li>'; });
        html += '</ul>';
      }
      if (vsj.warnings && vsj.warnings.length) {
        html += '<ul class="cc-validation-warnings">';
        vsj.warnings.forEach(function(w) { html += '<li style="color:#92400E">' + escapeHtml(w) + '</li>'; });
        html += '</ul>';
      }
    } catch (e) {}
    html += '</div>';

    // Timeline card
    html += '<div class="cc-card">';
    html += '<h4>Timeline</h4>';
    html += '<div class="cc-detail-fields">';
    html += fieldRow('Created', API.util.formatDateTime(c.created_at || c.Created_At));
    html += fieldRow('Updated', API.util.formatDateTime(c.updated_at || c.Updated_At));
    if (c.scheduled_at) html += fieldRow('Scheduled', API.util.formatDateTime(c.scheduled_at));
    if (c.sent_at) html += fieldRow('Sent', API.util.formatDateTime(c.sent_at));
    html += '</div>';
    html += '</div>';

    // If drip campaign, show steps
    if (isDrip(c)) {
      html += '<div class="cc-card" style="grid-column:1/-1">';
      html += '<div class="cc-detail-section-header"><h4>Campaign Steps</h4>';
      if (c.status === 'DRAFT') {
        html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-add-step-btn">+ Add Step</button>';
      }
      html += '</div>';
      html += renderStepsTable();
      html += '</div>';

      // Enrollment section
      html += '<div class="cc-card" style="grid-column:1/-1">';
      html += '<h4>Enroll Leads</h4>';
      html += '<div class="cc-enroll-form">';
      html += '<input type="text" id="cc-enroll-lead-ids" class="cc-input cc-input-sm" placeholder="Lead record IDs (comma-separated)" />';
      html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-enroll-btn">Enroll</button>';
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function fieldRow(label, value) {
    return '<div class="cc-field-row"><span class="cc-field-label">' + escapeHtml(label) + '</span><span class="cc-field-value">' + (value || '') + '</span></div>';
  }

  function renderStepsTable() {
    if (!state.steps || state.steps.length === 0) {
      return '<p class="cc-empty">No steps defined. Add steps to build your campaign sequence.</p>';
    }

    var sorted = state.steps.slice().sort(function(a, b) {
      return (a.step_number || 0) - (b.step_number || 0);
    });

    var isDraftCampaign = state.activeCampaign && state.activeCampaign.status === 'DRAFT';

    var html = '<table class="cc-table cc-steps-table">';
    html += '<thead><tr><th class="cc-th">Step #</th><th class="cc-th">Delay (Days)</th>';
    html += '<th class="cc-th">Template</th><th class="cc-th">Condition</th>';
    if (isDraftCampaign) html += '<th class="cc-th">Actions</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function(step) {
      var templateDisplay = step.template && step.template.length ? step.template[0] : 'None';
      html += '<tr><td>' + (step.step_number || '') + '</td>';
      html += '<td>' + (step.delay_days !== undefined ? step.delay_days : '') + '</td>';
      html += '<td class="cc-step-template-cell">' + escapeHtml(String(templateDisplay)) + '</td>';
      html += '<td>' + escapeHtml(step.condition || 'NONE') + '</td>';
      if (isDraftCampaign) {
        html += '<td><button class="cc-btn cc-btn-sm cc-btn-danger cc-delete-step-btn" data-step-id="' + step.id + '">Delete</button></td>';
      }
      html += '</tr>';
    });

    html += '</tbody></table>';

    var totalDays = sorted.reduce(function(sum, s) { return sum + (s.delay_days || 0); }, 0);
    html += '<div class="cc-steps-summary">Total: ' + sorted.length + ' step' + (sorted.length !== 1 ? 's' : '') +
      ' over ' + totalDays + ' day' + (totalDays !== 1 ? 's' : '') + '</div>';

    return html;
  }

  // ─── Editor Tab ────────────────────────────────────────────
  function renderEditorTab(c, st) {
    var editable = st === 'draft';

    var html = '<div class="cc-editor-container">';

    // Toolbar
    if (editable) {
      html += '<div class="cc-editor-toolbar">';
      html += '<span class="cc-editor-toolbar-label">Add Block:</span>';
      BLOCK_TYPES.forEach(function(bt) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-add-block-btn" data-type="' + bt.type + '" title="' + bt.label + '">' + bt.icon + ' ' + bt.label + '</button>';
      });
      html += '<div style="flex:1"></div>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-save-content-btn"' + (!state.editorDirty ? ' disabled' : '') + '>Save Content</button>';
      html += '</div>';
    }

    // Blocks
    html += '<div class="cc-editor-blocks">';
    if (state.contentBlocks.length === 0) {
      html += '<div class="cc-empty" style="padding:3rem">No content blocks yet. ' + (editable ? 'Add blocks using the toolbar above.' : '') + '</div>';
    } else {
      state.contentBlocks.forEach(function(block, idx) {
        html += renderBlock(block, idx, editable);
      });
    }
    html += '</div>';

    // Preview
    html += '<div class="cc-editor-preview-section">';
    html += '<h4>Preview</h4>';
    html += '<div class="cc-editor-preview">' + compilePreviewHtml() + '</div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderBlock(block, idx, editable) {
    var html = '<div class="cc-block" data-idx="' + idx + '">';
    html += '<div class="cc-block-header">';
    html += '<span class="cc-block-type-badge">' + block.type + '</span>';
    if (editable) {
      html += '<div class="cc-block-actions">';
      if (idx > 0) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-block-move-btn" data-dir="up" data-idx="' + idx + '" title="Move up">&#9650;</button>';
      if (idx < state.contentBlocks.length - 1) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-block-move-btn" data-dir="down" data-idx="' + idx + '" title="Move down">&#9660;</button>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-danger cc-block-delete-btn" data-idx="' + idx + '" title="Remove">✕</button>';
      html += '</div>';
    }
    html += '</div>';

    // Block content editing
    html += '<div class="cc-block-body">';
    switch (block.type) {
      case 'heading':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="text" value="' + escapeAttr(block.data.text || '') + '" placeholder="Heading text..."' + (!editable ? ' disabled' : '') + ' />';
        html += '<select class="cc-input cc-input-sm cc-block-input" data-idx="' + idx + '" data-field="level" style="width:80px;margin-top:4px"' + (!editable ? ' disabled' : '') + '>';
        [1,2,3,4].forEach(function(l) {
          html += '<option value="' + l + '"' + ((block.data.level || 2) === l ? ' selected' : '') + '>H' + l + '</option>';
        });
        html += '</select>';
        break;

      case 'text':
        html += '<textarea class="cc-input cc-textarea cc-block-input" data-idx="' + idx + '" data-field="text" placeholder="Paragraph text... (supports {{merge_tags}})"' + (!editable ? ' disabled' : '') + '>' + escapeHtml(block.data.text || '') + '</textarea>';
        break;

      case 'image':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="src" value="' + escapeAttr(block.data.src || '') + '" placeholder="Image URL..."' + (!editable ? ' disabled' : '') + ' />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="alt" value="' + escapeAttr(block.data.alt || '') + '" placeholder="Alt text..." style="margin-top:4px"' + (!editable ? ' disabled' : '') + ' />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="link" value="' + escapeAttr(block.data.link || '') + '" placeholder="Link URL (optional)" style="margin-top:4px"' + (!editable ? ' disabled' : '') + ' />';
        break;

      case 'button':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="text" value="' + escapeAttr(block.data.text || '') + '" placeholder="Button text..."' + (!editable ? ' disabled' : '') + ' />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="url" value="' + escapeAttr(block.data.url || '') + '" placeholder="Button URL..." style="margin-top:4px"' + (!editable ? ' disabled' : '') + ' />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="color" value="' + escapeAttr(block.data.color || '#2563EB') + '" placeholder="Button color (#hex)" style="margin-top:4px;width:120px"' + (!editable ? ' disabled' : '') + ' />';
        break;

      case 'divider':
        html += '<div style="border-top:1px solid #E5E7EB;margin:0.5rem 0;"></div>';
        break;

      case 'spacer':
        html += '<input type="number" class="cc-input cc-input-sm cc-block-input" data-idx="' + idx + '" data-field="height" value="' + (block.data.height || 20) + '" min="4" max="100" style="width:80px"' + (!editable ? ' disabled' : '') + ' />';
        html += '<span style="font-size:0.8rem;color:#6B7280;margin-left:4px">px height</span>';
        break;

      case 'social':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="links" value="' + escapeAttr(block.data.links || '') + '" placeholder="JSON array of {icon, url} or comma-separated URLs"' + (!editable ? ' disabled' : '') + ' />';
        break;

      case 'header':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="logoUrl" value="' + escapeAttr(block.data.logoUrl || '') + '" placeholder="Logo image URL..."' + (!editable ? ' disabled' : '') + ' />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="text" value="' + escapeAttr(block.data.text || '') + '" placeholder="Header text (optional)" style="margin-top:4px"' + (!editable ? ' disabled' : '') + ' />';
        break;

      case 'footer':
        html += '<textarea class="cc-input cc-textarea cc-block-input" data-idx="' + idx + '" data-field="text" placeholder="Footer text with compliance info, unsubscribe link: {{unsubscribe_url}}"' + (!editable ? ' disabled' : '') + '>' + escapeHtml(block.data.text || '') + '</textarea>';
        break;
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  function compilePreviewHtml() {
    if (state.contentBlocks.length === 0) return '<p style="color:#9CA3AF;text-align:center;padding:2rem">No content to preview</p>';

    var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#1F2937;line-height:1.6">';
    state.contentBlocks.forEach(function(block) {
      switch (block.type) {
        case 'heading':
          var lvl = block.data.level || 2;
          var fs = lvl === 1 ? '24px' : lvl === 2 ? '20px' : lvl === 3 ? '16px' : '14px';
          html += '<h' + lvl + ' style="font-size:' + fs + ';margin:16px 0 8px;font-weight:700">' + escapeHtml(block.data.text || '') + '</h' + lvl + '>';
          break;
        case 'text':
          html += '<p style="margin:8px 0;font-size:14px">' + escapeHtml(block.data.text || '').replace(/\n/g, '<br>') + '</p>';
          break;
        case 'image':
          var imgTag = '<img src="' + escapeAttr(block.data.src || '') + '" alt="' + escapeAttr(block.data.alt || '') + '" style="max-width:100%;height:auto;display:block;margin:12px 0;border-radius:4px">';
          if (block.data.link) html += '<a href="' + escapeAttr(block.data.link) + '">' + imgTag + '</a>';
          else html += imgTag;
          break;
        case 'button':
          html += '<div style="text-align:center;margin:16px 0"><a href="' + escapeAttr(block.data.url || '#') + '" style="display:inline-block;padding:12px 24px;background:' + (block.data.color || '#2563EB') + ';color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' + escapeHtml(block.data.text || 'Click Here') + '</a></div>';
          break;
        case 'divider':
          html += '<hr style="border:0;border-top:1px solid #E5E7EB;margin:16px 0">';
          break;
        case 'spacer':
          html += '<div style="height:' + (block.data.height || 20) + 'px"></div>';
          break;
        case 'header':
          html += '<div style="text-align:center;padding:16px 0;border-bottom:1px solid #E5E7EB;margin-bottom:16px">';
          if (block.data.logoUrl) html += '<img src="' + escapeAttr(block.data.logoUrl) + '" alt="Logo" style="max-height:48px;margin-bottom:8px">';
          if (block.data.text) html += '<div style="font-size:18px;font-weight:700">' + escapeHtml(block.data.text) + '</div>';
          html += '</div>';
          break;
        case 'footer':
          html += '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280;text-align:center">' + escapeHtml(block.data.text || '').replace(/\n/g, '<br>') + '</div>';
          break;
        case 'social':
          html += '<div style="text-align:center;margin:12px 0;font-size:12px;color:#6B7280">[Social Links]</div>';
          break;
      }
    });
    html += '</div>';
    return html;
  }

  function getContentJSON() {
    return JSON.stringify({
      version: 1,
      blocks: state.contentBlocks,
      theme: {}
    });
  }

  // ─── Audience Tab ──────────────────────────────────────────
  function renderAudienceTab(c, st) {
    var editable = st === 'draft';
    var aud = {};
    try { aud = JSON.parse(c.audience_rules_json || c.Audience_Rules_JSON || '{}'); } catch (e) {}

    var html = '<div class="cc-audience-container">';

    html += '<div class="cc-card">';
    html += '<h4>Audience Definition</h4>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Include</label>';
    html += '<select class="cc-input cc-audience-input" data-field="include_type"' + (!editable ? ' disabled' : '') + '>';
    html += '<option value="all"' + ((aud.include_type || 'all') === 'all' ? ' selected' : '') + '>All Subscribed Contacts</option>';
    html += '<option value="tags"' + (aud.include_type === 'tags' ? ' selected' : '') + '>By Tags</option>';
    html += '<option value="stages"' + (aud.include_type === 'stages' ? ' selected' : '') + '>By Lead Stage</option>';
    html += '<option value="practice_area"' + (aud.include_type === 'practice_area' ? ' selected' : '') + '>By Practice Area</option>';
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Include Values (comma-separated)</label>';
    html += '<input type="text" class="cc-input cc-audience-input" data-field="include_values" value="' + escapeAttr((aud.include_values || []).join(', ')) + '" placeholder="e.g. estate-planning, probate"' + (!editable ? ' disabled' : '') + ' />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Exclude Tags (comma-separated, optional)</label>';
    html += '<input type="text" class="cc-input cc-audience-input" data-field="exclude_tags" value="' + escapeAttr((aud.exclude_tags || []).join(', ')) + '" placeholder="e.g. do-not-email"' + (!editable ? ' disabled' : '') + ' />';
    html += '</div>';

    if (editable) {
      html += '<div style="display:flex;gap:0.5rem;margin-top:1rem">';
      html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-save-audience-btn">Save Audience</button>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-preview-audience-btn">Preview Recipients</button>';
      html += '</div>';
    }

    html += '</div>';

    // Summary card
    html += '<div class="cc-card">';
    html += '<h4>Audience Summary</h4>';
    html += '<div class="cc-detail-fields">';
    html += fieldRow('Estimated Recipients', c.estimated_recipients != null ? String(c.estimated_recipients) : '—');
    html += fieldRow('Last Validated', c.resolved_recipients != null ? String(c.resolved_recipients) + ' resolved' : 'Not yet validated');
    html += '</div>';

    if (state.audiencePreview) {
      html += '<div style="margin-top:1rem">';
      html += '<h5>Preview (' + (state.audiencePreview.count || 0) + ' recipients)</h5>';
      if (state.audiencePreview.sample && state.audiencePreview.sample.length) {
        html += '<table class="cc-table" style="font-size:0.8rem"><thead><tr><th class="cc-th">Name</th><th class="cc-th">Email</th></tr></thead><tbody>';
        state.audiencePreview.sample.forEach(function(r) {
          html += '<tr><td>' + escapeHtml(r.name || '') + '</td><td>' + escapeHtml(r.email || '') + '</td></tr>';
        });
        html += '</tbody></table>';
        if (state.audiencePreview.count > state.audiencePreview.sample.length) {
          html += '<p style="font-size:0.8rem;color:#6B7280;margin-top:4px">Showing ' + state.audiencePreview.sample.length + ' of ' + state.audiencePreview.count + '</p>';
        }
      }
      html += '</div>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ─── Validation Tab ────────────────────────────────────────
  function renderValidationTab(c, st) {
    var html = '<div class="cc-validation-container">';

    if (st === 'draft') {
      html += '<button class="cc-btn cc-btn-primary cc-validate-btn" style="margin-bottom:1rem">Run Validation</button>';
    }

    var vr = state.validationResult;
    if (!vr) {
      // Try to load from campaign field
      try {
        var vsj = c.validation_summary_json || c.Validation_Summary_JSON;
        if (vsj) vr = JSON.parse(vsj);
      } catch (e) {}
    }

    if (vr) {
      var vs = vr.status || (vr.errors && vr.errors.length ? 'invalid' : 'valid');
      var vsColor = vs === 'valid' ? 'green' : vs === 'invalid' ? 'red' : 'gray';

      html += '<div class="cc-card">';
      html += '<h4>Validation Result: <span class="cc-badge cc-badge-' + vsColor + '">' + statusLabel(vs) + '</span></h4>';

      html += '<p>Recipient Estimate: <strong>' + (vr.recipient_count || c.estimated_recipients || '—') + '</strong></p>';

      if (vr.errors && vr.errors.length) {
        html += '<h5 class="cc-text-red" style="margin-top:1rem">Errors (' + vr.errors.length + ')</h5>';
        html += '<ul class="cc-validation-list">';
        vr.errors.forEach(function(e) {
          html += '<li class="cc-validation-error">' + escapeHtml(e) + '</li>';
        });
        html += '</ul>';
      }

      if (vr.warnings && vr.warnings.length) {
        html += '<h5 style="margin-top:1rem;color:#92400E">Warnings (' + vr.warnings.length + ')</h5>';
        html += '<ul class="cc-validation-list">';
        vr.warnings.forEach(function(w) {
          html += '<li class="cc-validation-warning">' + escapeHtml(w) + '</li>';
        });
        html += '</ul>';
      }

      if ((!vr.errors || !vr.errors.length) && (!vr.warnings || !vr.warnings.length)) {
        html += '<p class="cc-text-green" style="margin-top:1rem">All checks passed. Campaign is ready to send.</p>';
      }

      html += '</div>';
    } else {
      html += '<div class="cc-card"><p class="cc-empty">No validation results yet. Click "Run Validation" to check this campaign.</p></div>';
    }

    html += '</div>';
    return html;
  }

  // ─── Recipients Tab ────────────────────────────────────────
  function renderRecipientsTab(c, st) {
    var html = '<div class="cc-recipients-container">';

    html += '<div style="display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center">';
    html += '<input type="text" id="cc-recipient-search" class="cc-input cc-input-sm" placeholder="Search recipients..." value="' + escapeAttr(state.recipientFilter) + '" style="max-width:250px" />';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-load-recipients-btn">Load Recipients</button>';
    html += '</div>';

    if (state.recipients.length > 0) {
      var filtered = state.recipients;
      if (state.recipientFilter) {
        var q = state.recipientFilter.toLowerCase();
        filtered = filtered.filter(function(r) {
          return (r.contact_email || '').toLowerCase().includes(q) ||
                 (r.contact_name || '').toLowerCase().includes(q) ||
                 (r.recipient_status || '').toLowerCase().includes(q);
        });
      }

      html += '<p style="font-size:0.8rem;color:#6B7280;margin-bottom:0.5rem">Showing ' + filtered.length + ' of ' + state.recipients.length + ' recipients</p>';

      html += '<table class="cc-table">';
      html += '<thead><tr>';
      html += '<th class="cc-th">Contact</th><th class="cc-th">Email</th><th class="cc-th">Status</th>';
      html += '<th class="cc-th">Subject</th><th class="cc-th">Sent At</th><th class="cc-th">Delivered At</th>';
      html += '<th class="cc-th">Skip Reason</th>';
      html += '</tr></thead><tbody>';

      filtered.slice(0, 100).forEach(function(r) {
        var rsCls = STATUS_COLORS[r.recipient_status] || 'gray';
        html += '<tr>';
        html += '<td>' + escapeHtml(r.contact_name || '—') + '</td>';
        html += '<td>' + escapeHtml(r.contact_email || '') + '</td>';
        html += '<td><span class="cc-badge cc-badge-' + rsCls + '">' + statusLabel(r.recipient_status || '') + '</span></td>';
        html += '<td class="cc-step-template-cell">' + escapeHtml(r.rendered_subject || '—') + '</td>';
        html += '<td>' + (r.sent_at ? API.util.formatDateTime(r.sent_at) : '—') + '</td>';
        html += '<td>' + (r.delivered_at ? API.util.formatDateTime(r.delivered_at) : '—') + '</td>';
        html += '<td>' + escapeHtml(r.skip_reason || '') + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
      if (filtered.length > 100) {
        html += '<p style="font-size:0.8rem;color:#6B7280;margin-top:0.5rem">Showing first 100 of ' + filtered.length + '</p>';
      }
    } else {
      html += '<div class="cc-empty">No recipients loaded. Click "Load Recipients" to view.</div>';
    }

    html += '</div>';
    return html;
  }

  // ─── Reporting Tab ─────────────────────────────────────────
  function renderReportingTab(c, st) {
    var html = '<div class="cc-reporting-container">';

    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-load-report-btn" style="margin-bottom:1rem">Load Report</button>';

    if (state.reportData) {
      var r = state.reportData;

      html += '<div class="cc-overview-grid">';

      // Metrics cards
      var metrics = [
        { label: 'Sent', value: r.sent || 0, color: '#2563EB' },
        { label: 'Delivered', value: r.delivered || 0, color: '#059669' },
        { label: 'Opened', value: r.opened || 0, color: '#7C3AED' },
        { label: 'Clicked', value: r.clicked || 0, color: '#0891B2' },
        { label: 'Bounced', value: r.bounced || 0, color: '#DC2626' },
        { label: 'Unsubscribed', value: r.unsubscribed || 0, color: '#92400E' }
      ];

      metrics.forEach(function(m) {
        var pct = r.sent > 0 ? Math.round((m.value / r.sent) * 100) : 0;
        html += '<div class="cc-card cc-metric-card">';
        html += '<div class="cc-metric-value" style="color:' + m.color + '">' + m.value + '</div>';
        html += '<div class="cc-metric-label">' + m.label + '</div>';
        if (m.label !== 'Sent') html += '<div class="cc-metric-pct">' + pct + '%</div>';
        html += '</div>';
      });

      html += '</div>';

      // Link metrics
      if (r.links && r.links.length) {
        html += '<div class="cc-card" style="margin-top:1rem">';
        html += '<h4>Link Performance</h4>';
        html += '<table class="cc-table"><thead><tr><th class="cc-th">URL</th><th class="cc-th">Clicks</th><th class="cc-th">Unique Clicks</th></tr></thead><tbody>';
        r.links.forEach(function(l) {
          html += '<tr><td class="cc-step-template-cell">' + escapeHtml(l.url || '') + '</td><td>' + (l.clicks || 0) + '</td><td>' + (l.unique_clicks || 0) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
    } else {
      html += '<div class="cc-empty">Click "Load Report" to view campaign metrics.</div>';
    }

    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // EVENT BINDINGS
  // ═══════════════════════════════════════════════════════════

  function bindDetailEvents() {
    var el = $el('cc-campaign-detail');
    if (!el) return;

    // Back
    el.querySelectorAll('.cc-detail-back-btn').forEach(function(btn) {
      btn.addEventListener('click', closeDetail);
    });

    // Tabs
    el.querySelectorAll('.cc-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        state.activeTab = tab.dataset.tab;
        renderDetail();
      });
    });

    // Edit details
    var editBtn = el.querySelector('.cc-edit-campaign-btn');
    if (editBtn) editBtn.addEventListener('click', showEditModal);

    // Duplicate
    var dupBtn = el.querySelector('.cc-dup-detail-btn');
    if (dupBtn) dupBtn.addEventListener('click', function() {
      var c = state.activeCampaign;
      handleDuplicate(c.id, c.name);
    });

    // Status buttons (drip)
    el.querySelectorAll('.cc-status-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { handleStatusChange(btn.dataset.status); });
    });

    // Validate
    el.querySelectorAll('.cc-validate-btn').forEach(function(btn) {
      btn.addEventListener('click', handleValidate);
    });

    // Test send
    var testBtn = el.querySelector('.cc-test-send-btn');
    if (testBtn) testBtn.addEventListener('click', showTestSendModal);

    // Schedule
    var schedBtn = el.querySelector('.cc-schedule-btn');
    if (schedBtn) schedBtn.addEventListener('click', showScheduleModal);

    // Send now
    var sendNowBtn = el.querySelector('.cc-send-now-btn');
    if (sendNowBtn) sendNowBtn.addEventListener('click', handleSendNow);

    // Cancel scheduled
    var cancelBtn = el.querySelector('.cc-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', function() { handleCancel(state.activeCampaign.id); });

    // Resend
    var resendBtn = el.querySelector('.cc-resend-btn');
    if (resendBtn) resendBtn.addEventListener('click', function() { handleResendNonOpeners(state.activeCampaign.id); });

    // Editor: add block
    el.querySelectorAll('.cc-add-block-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var type = btn.dataset.type;
        state.contentBlocks.push({ id: uid(), type: type, data: getDefaultBlockData(type) });
        state.editorDirty = true;
        renderDetail();
      });
    });

    // Editor: block inputs
    el.querySelectorAll('.cc-block-input').forEach(function(input) {
      input.addEventListener('input', function() {
        var idx = parseInt(input.dataset.idx, 10);
        var field = input.dataset.field;
        if (state.contentBlocks[idx]) {
          var val = input.tagName === 'SELECT' ? input.value : input.value;
          if (field === 'level' || field === 'height') val = parseInt(val, 10);
          state.contentBlocks[idx].data[field] = val;
          state.editorDirty = true;
          // Update preview
          var previewEl = el.querySelector('.cc-editor-preview');
          if (previewEl) previewEl.innerHTML = compilePreviewHtml();
          // Enable save button
          var saveBtn = el.querySelector('.cc-save-content-btn');
          if (saveBtn) saveBtn.disabled = false;
        }
      });
    });

    // Editor: move/delete blocks
    el.querySelectorAll('.cc-block-move-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx, 10);
        var dir = btn.dataset.dir;
        if (dir === 'up' && idx > 0) {
          var tmp = state.contentBlocks[idx];
          state.contentBlocks[idx] = state.contentBlocks[idx - 1];
          state.contentBlocks[idx - 1] = tmp;
        } else if (dir === 'down' && idx < state.contentBlocks.length - 1) {
          var tmp2 = state.contentBlocks[idx];
          state.contentBlocks[idx] = state.contentBlocks[idx + 1];
          state.contentBlocks[idx + 1] = tmp2;
        }
        state.editorDirty = true;
        renderDetail();
      });
    });

    el.querySelectorAll('.cc-block-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx, 10);
        state.contentBlocks.splice(idx, 1);
        state.editorDirty = true;
        renderDetail();
      });
    });

    // Editor: save content
    var saveContentBtn = el.querySelector('.cc-save-content-btn');
    if (saveContentBtn) saveContentBtn.addEventListener('click', handleSaveContent);

    // Audience: save
    var saveAudBtn = el.querySelector('.cc-save-audience-btn');
    if (saveAudBtn) saveAudBtn.addEventListener('click', handleSaveAudience);

    // Audience: preview
    var prevAudBtn = el.querySelector('.cc-preview-audience-btn');
    if (prevAudBtn) prevAudBtn.addEventListener('click', handlePreviewAudience);

    // Recipients: load
    var loadRecBtn = el.querySelector('.cc-load-recipients-btn');
    if (loadRecBtn) loadRecBtn.addEventListener('click', handleLoadRecipients);

    // Recipients: search
    var recSearch = el.querySelector('#cc-recipient-search');
    if (recSearch) {
      recSearch.addEventListener('input', function() {
        state.recipientFilter = recSearch.value;
        // Just re-render recipients tab content
        var tabContent = el.querySelector('.cc-detail-tab-content');
        if (tabContent && state.activeTab === 'recipients') {
          tabContent.innerHTML = renderRecipientsTab(state.activeCampaign, (state.activeCampaign.status || 'draft').toLowerCase());
          // Rebind search
          var newSearch = el.querySelector('#cc-recipient-search');
          if (newSearch) {
            newSearch.addEventListener('input', function() {
              state.recipientFilter = newSearch.value;
              renderDetail();
            });
          }
        }
      });
    }

    // Reporting: load
    var loadRepBtn = el.querySelector('.cc-load-report-btn');
    if (loadRepBtn) loadRepBtn.addEventListener('click', handleLoadReport);

    // Steps (drip)
    var addStepBtn = el.querySelector('.cc-add-step-btn');
    if (addStepBtn) addStepBtn.addEventListener('click', showAddStepModal);

    el.querySelectorAll('.cc-delete-step-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { handleDeleteStep(btn.dataset.stepId); });
    });

    var enrollBtn = el.querySelector('.cc-enroll-btn');
    if (enrollBtn) enrollBtn.addEventListener('click', handleEnroll);
  }

  function getDefaultBlockData(type) {
    switch (type) {
      case 'heading': return { text: '', level: 2 };
      case 'text': return { text: '' };
      case 'image': return { src: '', alt: '', link: '' };
      case 'button': return { text: 'Learn More', url: '', color: '#2563EB' };
      case 'divider': return {};
      case 'spacer': return { height: 20 };
      case 'social': return { links: '' };
      case 'header': return { logoUrl: '', text: '' };
      case 'footer': return { text: 'Tabuchi Law Professional Corporation\n5025 Orbitor Dr, Building 2, Suite 200, Mississauga, ON\n\nYou received this email because you subscribed to our mailing list.\n{{unsubscribe_url}}' };
      default: return {};
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════

  async function handleSaveContent() {
    if (!state.activeCampaign) return;
    try {
      var result = await API.campaigns.update(state.activeCampaign.id, {
        content_json: getContentJSON(),
        compiled_html: compilePreviewHtml()
      });
      if (result.success) {
        state.editorDirty = false;
        showToast('Content saved.', 'success');
        // Update local campaign object
        state.activeCampaign.content_json = getContentJSON();
        state.activeCampaign.Content_JSON = getContentJSON();
        renderDetail();
      } else {
        showToast(result.error || 'Failed to save content.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error saving content.', 'error');
    }
  }

  async function handleSaveAudience() {
    if (!state.activeCampaign) return;
    var el = $el('cc-campaign-detail');
    if (!el) return;

    var includeType = el.querySelector('[data-field="include_type"]');
    var includeValues = el.querySelector('[data-field="include_values"]');
    var excludeTags = el.querySelector('[data-field="exclude_tags"]');

    var aud = {
      include_type: includeType ? includeType.value : 'all',
      include_values: includeValues ? includeValues.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      exclude_tags: excludeTags ? excludeTags.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : []
    };

    try {
      var result = await API.campaigns.update(state.activeCampaign.id, {
        audience_rules_json: JSON.stringify(aud)
      });
      if (result.success) {
        showToast('Audience definition saved.', 'success');
        state.activeCampaign.audience_rules_json = JSON.stringify(aud);
        state.activeCampaign.Audience_Rules_JSON = JSON.stringify(aud);
      } else {
        showToast(result.error || 'Failed to save audience.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error saving audience.', 'error');
    }
  }

  async function handlePreviewAudience() {
    if (!state.activeCampaign) return;
    var el = $el('cc-campaign-detail');
    if (!el) return;

    var includeType = el.querySelector('[data-field="include_type"]');
    var includeValues = el.querySelector('[data-field="include_values"]');
    var excludeTags = el.querySelector('[data-field="exclude_tags"]');

    var aud = {
      include_type: includeType ? includeType.value : 'all',
      include_values: includeValues ? includeValues.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      exclude_tags: excludeTags ? excludeTags.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : []
    };

    try {
      showToast('Previewing audience...', 'info');
      var result = await API.campaigns.previewAudience(aud);
      if (result.success) {
        state.audiencePreview = result;
        renderDetail();
      } else {
        showToast(result.error || 'Failed to preview audience.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error previewing audience.', 'error');
    }
  }

  async function handleValidate() {
    if (!state.activeCampaign) return;
    try {
      showToast('Validating campaign...', 'info');
      var result = await API.campaigns.validate(state.activeCampaign.id);
      if (result.success) {
        state.validationResult = result.validation || result;
        // Update local campaign
        state.activeCampaign.validation_status = result.validation ? result.validation.status : (result.errors && result.errors.length ? 'invalid' : 'valid');
        state.activeCampaign.Validation_Status = state.activeCampaign.validation_status;
        state.activeTab = 'validation';
        renderDetail();
        showToast('Validation complete.', result.validation && result.validation.status === 'valid' ? 'success' : 'info');
      } else {
        showToast(result.error || 'Validation failed.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error validating campaign.', 'error');
    }
  }

  async function handleLoadRecipients() {
    if (!state.activeCampaign) return;
    try {
      showToast('Loading recipients...', 'info');
      var result = await API.campaigns.listRecipients(state.activeCampaign.id);
      if (result.success) {
        state.recipients = result.recipients || [];
        renderDetail();
      } else {
        showToast(result.error || 'Failed to load recipients.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error loading recipients.', 'error');
    }
  }

  async function handleLoadReport() {
    if (!state.activeCampaign) return;
    try {
      showToast('Loading report...', 'info');
      var result = await API.campaigns.report(state.activeCampaign.id, 'overview');
      if (result.success) {
        state.reportData = result.report || result;
        renderDetail();
      } else {
        showToast(result.error || 'Failed to load report.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error loading report.', 'error');
    }
  }

  async function handleSendNow() {
    if (!state.activeCampaign) return;
    if (!confirm('Send this campaign now? This will begin sending to all recipients immediately.')) return;

    try {
      var result = await API.campaigns.sendNow(state.activeCampaign.id);
      if (result.success) {
        showToast('Campaign is being sent.', 'success');
        fetchDetail(state.activeCampaign.id);
      } else {
        showToast(result.error || 'Failed to send campaign.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error sending campaign.', 'error');
    }
  }

  async function handleCancel(campaignId) {
    if (!confirm('Cancel this scheduled campaign?')) return;
    try {
      var result = await API.campaigns.cancel(campaignId);
      if (result.success) {
        showToast('Campaign cancelled.', 'success');
        if (state.view === 'detail') fetchDetail(campaignId);
        else fetchCampaigns();
      } else {
        showToast(result.error || 'Failed to cancel.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error cancelling campaign.', 'error');
    }
  }

  async function handleDuplicate(campaignId, campaignName) {
    var newName = prompt('New campaign name:', 'Copy of ' + (campaignName || ''));
    if (!newName) return;

    try {
      var result = await API.campaigns.duplicate(campaignId, newName);
      if (result.success) {
        showToast('Campaign duplicated.', 'success');
        fetchCampaigns();
        if (result.campaign_id) openDetail(result.campaign_id);
      } else {
        showToast(result.error || 'Failed to duplicate.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error duplicating campaign.', 'error');
    }
  }

  async function handleResendNonOpeners(campaignId) {
    var newSubject = prompt('Subject line for resend (leave blank to keep original):');
    if (newSubject === null) return; // cancelled

    try {
      var result = await API.campaigns.resendNonOpeners(campaignId, {
        subject: newSubject || undefined,
        resend_type: 'non_openers'
      });
      if (result.success) {
        showToast('Resend campaign created.', 'success');
        fetchCampaigns();
        if (result.campaign_id) openDetail(result.campaign_id);
      } else {
        showToast(result.error || 'Failed to create resend.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error creating resend.', 'error');
    }
  }

  async function handleStatusChange(newStatus) {
    if (!state.activeCampaign) return;
    var msg = 'Change campaign status to ' + newStatus + '?';
    if (newStatus === 'ENDED') msg = 'End this campaign? This will stop all scheduled sends.';
    if (!confirm(msg)) return;

    try {
      var result = await API.campaigns.update(state.activeCampaign.id, { status: newStatus });
      if (result.success) {
        showToast('Status updated to ' + newStatus, 'success');
        fetchDetail(state.activeCampaign.id);
      } else {
        showToast(result.error || 'Failed to update status.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error updating status.', 'error');
    }
  }

  async function handleDeleteStep(stepId) {
    if (!confirm('Delete this step?')) return;
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

  async function handleEnroll() {
    if (!state.activeCampaign) return;
    var input = $el('cc-enroll-lead-ids');
    if (!input || !input.value.trim()) { showToast('Enter at least one lead ID.', 'error'); return; }

    var leadIds = input.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    try {
      var result = await API.campaigns.enroll(state.activeCampaign.id, leadIds);
      if (result.success) {
        showToast('Enrolled ' + (result.enrolled_count || leadIds.length) + ' lead(s).', 'success');
        input.value = '';
      } else {
        showToast(result.error || 'Failed to enroll.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error enrolling leads.', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MODALS
  // ═══════════════════════════════════════════════════════════

  var activeModal = null;

  function showModal(title, bodyHtml, onSubmit, opts) {
    closeModal();
    opts = opts || {};

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'cc-modal';
    if (opts.wide) modal.style.maxWidth = '700px';

    modal.innerHTML =
      '<div class="cc-modal-header">' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        '<button class="cc-modal-close">&times;</button>' +
      '</div>' +
      '<div class="cc-modal-body">' + bodyHtml + '</div>' +
      '<div class="cc-modal-footer">' +
        '<button class="cc-btn cc-btn-outline cc-modal-cancel-btn">Cancel</button>' +
        '<button class="cc-btn cc-btn-primary cc-modal-save-btn">' + (opts.submitLabel || 'Save') + '</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    activeModal = overlay;

    var firstInput = modal.querySelector('input, select, textarea');
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);

    overlay.querySelector('.cc-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('.cc-modal-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    overlay.querySelector('.cc-modal-save-btn').addEventListener('click', function() {
      onSubmit(modal.querySelector('.cc-modal-body'));
    });
  }

  function closeModal() {
    if (activeModal) { activeModal.remove(); activeModal = null; }
  }

  // ─── Create Campaign Modal ─────────────────────────────────
  function showCreateModal() {
    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Campaign Name *</label>';
    html += '<input type="text" id="cc-modal-name" class="cc-input" placeholder="e.g. March Newsletter" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Campaign Type *</label>';
    html += '<select id="cc-modal-type" class="cc-input">';
    html += '<option value="NEWSLETTER">Newsletter / Broadcast</option>';
    html += '<option value="DRIP">Drip (Automation)</option>';
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Subject</label>';
    html += '<input type="text" id="cc-modal-subject" class="cc-input" placeholder="Email subject line" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Preheader</label>';
    html += '<input type="text" id="cc-modal-preheader" class="cc-input" placeholder="Preview text shown in inbox" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">From Name</label>';
    html += '<input type="text" id="cc-modal-from-name" class="cc-input" value="Tabuchi Law" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">From Email</label>';
    html += '<input type="email" id="cc-modal-from-email" class="cc-input" value="info@tabuchilaw.com" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Reply-To Email</label>';
    html += '<input type="email" id="cc-modal-reply-to" class="cc-input" value="info@tabuchilaw.com" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Channel</label>';
    html += '<select id="cc-modal-channel" class="cc-input">';
    html += '<option value="EMAIL">Email</option>';
    html += '<option value="SMS">SMS</option>';
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Timezone</label>';
    html += '<select id="cc-modal-timezone" class="cc-input">';
    html += '<option value="America/Toronto" selected>America/Toronto (EST)</option>';
    html += '<option value="America/Vancouver">America/Vancouver (PST)</option>';
    html += '<option value="UTC">UTC</option>';
    html += '</select>';
    html += '</div>';

    html += '</div>';

    showModal('New Campaign', html, handleCreateCampaign);
  }

  async function handleCreateCampaign(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    var type = form.querySelector('#cc-modal-type').value;

    if (!name) { showToast('Campaign name is required.', 'error'); return; }
    if (!type) { showToast('Campaign type is required.', 'error'); return; }

    var data = {
      name: name,
      type: type,
      channel: form.querySelector('#cc-modal-channel').value,
      subject: form.querySelector('#cc-modal-subject').value.trim(),
      preheader: form.querySelector('#cc-modal-preheader').value.trim(),
      from_name: form.querySelector('#cc-modal-from-name').value.trim(),
      from_email: form.querySelector('#cc-modal-from-email').value.trim(),
      reply_to: form.querySelector('#cc-modal-reply-to').value.trim(),
      timezone: form.querySelector('#cc-modal-timezone').value
    };

    try {
      var result = await API.campaigns.create(data);
      if (result.success) {
        showToast('Campaign created.', 'success');
        closeModal();
        fetchCampaigns();
        if (result.campaign_id) openDetail(result.campaign_id);
      } else {
        showToast(result.error || 'Failed to create campaign.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error creating campaign.', 'error');
    }
  }

  // ─── Edit Campaign Modal ───────────────────────────────────
  function showEditModal() {
    if (!state.activeCampaign) return;
    var c = state.activeCampaign;

    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Campaign Name *</label>';
    html += '<input type="text" id="cc-modal-name" class="cc-input" value="' + escapeAttr(c.name) + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Subject</label>';
    html += '<input type="text" id="cc-modal-subject" class="cc-input" value="' + escapeAttr(c.subject || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Preheader</label>';
    html += '<input type="text" id="cc-modal-preheader" class="cc-input" value="' + escapeAttr(c.preheader || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">From Name</label>';
    html += '<input type="text" id="cc-modal-from-name" class="cc-input" value="' + escapeAttr(c.from_name || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">From Email</label>';
    html += '<input type="email" id="cc-modal-from-email" class="cc-input" value="' + escapeAttr(c.from_email || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Reply-To Email</label>';
    html += '<input type="email" id="cc-modal-reply-to" class="cc-input" value="' + escapeAttr(c.reply_to_email || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Channel</label>';
    html += '<select id="cc-modal-channel" class="cc-input">';
    ['EMAIL', 'SMS'].forEach(function(ch) {
      html += '<option value="' + ch + '"' + ((c.channel || '') === ch ? ' selected' : '') + '>' + ch + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '</div>';

    showModal('Edit Campaign', html, handleEditCampaign);
  }

  async function handleEditCampaign(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    if (!name) { showToast('Campaign name is required.', 'error'); return; }

    var updates = {
      name: name,
      subject: form.querySelector('#cc-modal-subject').value.trim(),
      preheader: form.querySelector('#cc-modal-preheader').value.trim(),
      from_name: form.querySelector('#cc-modal-from-name').value.trim(),
      from_email: form.querySelector('#cc-modal-from-email').value.trim(),
      reply_to: form.querySelector('#cc-modal-reply-to').value.trim(),
      channel: form.querySelector('#cc-modal-channel').value
    };

    try {
      var result = await API.campaigns.update(state.activeCampaign.id, updates);
      if (result.success) {
        showToast('Campaign updated.', 'success');
        closeModal();
        fetchDetail(state.activeCampaign.id);
      } else {
        showToast(result.error || 'Failed to update.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error updating campaign.', 'error');
    }
  }

  // ─── Test Send Modal ───────────────────────────────────────
  function showTestSendModal() {
    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Test Recipient Emails (comma-separated) *</label>';
    html += '<input type="text" id="cc-modal-test-emails" class="cc-input" placeholder="test@example.com, admin@example.com" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Note (optional)</label>';
    html += '<input type="text" id="cc-modal-test-note" class="cc-input" placeholder="Internal note for test recipients" />';
    html += '</div>';

    html += '</div>';

    showModal('Send Test Email', html, handleTestSend, { submitLabel: 'Send Test' });
  }

  async function handleTestSend(form) {
    var emails = form.querySelector('#cc-modal-test-emails').value.trim();
    if (!emails) { showToast('Enter at least one email.', 'error'); return; }

    var emailList = emails.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    var note = form.querySelector('#cc-modal-test-note').value.trim();

    try {
      var result = await API.campaigns.testSend(state.activeCampaign.id, {
        emails: emailList,
        note: note
      });
      if (result.success) {
        showToast('Test email sent to ' + emailList.length + ' recipient(s).', 'success');
        closeModal();
      } else {
        showToast(result.error || 'Failed to send test.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error sending test.', 'error');
    }
  }

  // ─── Schedule Modal ────────────────────────────────────────
  function showScheduleModal() {
    var tz = (state.activeCampaign && state.activeCampaign.timezone) || 'America/Toronto';

    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Schedule Date & Time *</label>';
    html += '<input type="datetime-local" id="cc-modal-schedule-at" class="cc-input" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Timezone</label>';
    html += '<select id="cc-modal-schedule-tz" class="cc-input">';
    html += '<option value="America/Toronto"' + (tz === 'America/Toronto' ? ' selected' : '') + '>America/Toronto (EST)</option>';
    html += '<option value="America/Vancouver"' + (tz === 'America/Vancouver' ? ' selected' : '') + '>America/Vancouver (PST)</option>';
    html += '<option value="UTC"' + (tz === 'UTC' ? ' selected' : '') + '>UTC</option>';
    html += '</select>';
    html += '</div>';

    html += '</div>';

    showModal('Schedule Campaign', html, handleSchedule, { submitLabel: 'Schedule' });
  }

  async function handleSchedule(form) {
    var scheduledAt = form.querySelector('#cc-modal-schedule-at').value;
    var timezone = form.querySelector('#cc-modal-schedule-tz').value;

    if (!scheduledAt) { showToast('Select a date and time.', 'error'); return; }

    try {
      var result = await API.campaigns.schedule(state.activeCampaign.id, scheduledAt, timezone);
      if (result.success) {
        showToast('Campaign scheduled.', 'success');
        closeModal();
        fetchDetail(state.activeCampaign.id);
      } else {
        showToast(result.error || 'Failed to schedule.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error scheduling campaign.', 'error');
    }
  }

  // ─── Add Step Modal (Drip) ─────────────────────────────────
  function showAddStepModal() {
    if (!state.activeCampaign) return;
    var nextNum = 1;
    if (state.steps && state.steps.length > 0) {
      var maxNum = Math.max.apply(null, state.steps.map(function(s) { return s.step_number || 0; }));
      nextNum = maxNum + 1;
    }

    var html = '<div class="cc-modal-form">';
    html += '<div class="cc-form-group"><label class="cc-label">Step Number</label><input type="number" id="cc-modal-step-num" class="cc-input" value="' + nextNum + '" min="1" /></div>';
    html += '<div class="cc-form-group"><label class="cc-label">Delay (Days)</label><input type="number" id="cc-modal-delay" class="cc-input" value="0" min="0" /></div>';
    html += '<div class="cc-form-group"><label class="cc-label">Template ID</label><input type="text" id="cc-modal-template" class="cc-input" placeholder="Airtable record ID (optional)" /></div>';
    html += '<div class="cc-form-group"><label class="cc-label">Condition</label><select id="cc-modal-condition" class="cc-input">';
    ['NONE', 'OPENED', 'CLICKED', 'NO_RESPONSE'].forEach(function(cond) {
      html += '<option value="' + cond + '">' + cond + '</option>';
    });
    html += '</select></div>';
    html += '</div>';

    showModal('Add Step', html, handleAddStep);
  }

  async function handleAddStep(form) {
    var stepNumber = parseInt(form.querySelector('#cc-modal-step-num').value, 10);
    var delayDays = parseInt(form.querySelector('#cc-modal-delay').value, 10);
    var templateId = form.querySelector('#cc-modal-template').value.trim();
    var condition = form.querySelector('#cc-modal-condition').value;

    if (isNaN(stepNumber) || stepNumber < 1) { showToast('Valid step number required.', 'error'); return; }
    if (isNaN(delayDays) || delayDays < 0) { showToast('Valid delay required.', 'error'); return; }

    var data = { campaign_id: state.activeCampaign.id, step_number: stepNumber, delay_days: delayDays, condition: condition };
    if (templateId) data.template_id = templateId;

    try {
      var result = await API.campaigns.createStep(data);
      if (result.success) {
        showToast('Step added.', 'success');
        closeModal();
        fetchDetail(state.activeCampaign.id);
      } else {
        showToast(result.error || 'Failed to add step.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error adding step.', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TOAST / LOADING / ERROR
  // ═══════════════════════════════════════════════════════════

  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'cc-toast cc-toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('cc-toast-visible'); });
    setTimeout(function() {
      toast.classList.remove('cc-toast-visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

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

  // ═══════════════════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════════════════

  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) userNameEl.textContent = user.name || user.email;

    if (!checkRole()) return;

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
