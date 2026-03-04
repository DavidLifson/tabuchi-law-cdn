/**
 * Tabuchi Law Client Care CRM - Pipeline Kanban Board
 * Handles: /crm/kanban (pipeline view)
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Drag-and-drop cards between stage columns
 * - Filters: disposition, practice area, owner, search
 * - Card shows: client name, practice area, priority, owner, age
 * - Click card to navigate to lead detail
 * - Column counts + total
 * - Close gate validation on final stage drop
 *
 * Page element IDs:
 * - #cc-kanban-board       (main board container)
 * - #cc-kanban-filters     (filter bar)
 * - #cc-filter-disposition  (disposition dropdown)
 * - #cc-filter-practice     (practice area dropdown)
 * - #cc-filter-owner        (owner dropdown)
 * - #cc-filter-search       (search input)
 * - #cc-kanban-count        (total lead count)
 * - #cc-user-name           (nav user display)
 */

(function Kanban() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

  // Block BOOKINGS-only users from CRM pages
  var _u = ClientCareAPI.auth.getUser();
  if (_u && _u.role === 'BOOKINGS') { window.location.href = '/dashboard'; return; }

  var API = ClientCareAPI;
  var $el = function(id) { return document.getElementById(id); };

  var STAGES = [
    { key: 'NEW_LEAD', label: 'New Lead', color: 'blue' },
    { key: 'CONTACTED', label: 'Contacted', color: 'cyan' },
    { key: 'MEETING1_BOOKED', label: 'Meeting Booked', color: 'teal' },
    { key: 'MEETING1_COMPLETED', label: 'Meeting Done', color: 'green' },
    { key: 'INTAKE_COMPLETE_READY_TO_DRAFT', label: 'Ready to Draft', color: 'yellow' },
    { key: 'CLOSED_INTAKE_RECEIVED', label: 'Intake Received', color: 'purple' }
  ];

  // ─── State ───────────────────────────────────────────────────
  var state = {
    leads: [],
    filters: {
      disposition: 'OPEN',
      practice_area: '',
      owner: '',
      search: ''
    },
    loading: false,
    draggedCard: null,
    draggedLeadId: null,
    user: API.auth.getUser()
  };

  // ─── Fetch Leads ─────────────────────────────────────────────
  async function fetchLeads() {
    if (state.loading) return;
    state.loading = true;

    var board = $el('cc-kanban-board');
    if (board) board.classList.add('cc-loading-state');

    try {
      var params = { limit: 500 };

      Object.entries(state.filters).forEach(function(entry) {
        if (entry[1]) params[entry[0]] = entry[1];
      });

      var result = await API.leads.list(params);

      if (result.success) {
        state.leads = result.leads || [];
        renderBoard();
      } else {
        showBoardError('Failed to load pipeline data.');
      }
    } catch (err) {
      showBoardError(err.error || 'Error loading pipeline.');
    }

    state.loading = false;
    if (board) board.classList.remove('cc-loading-state');

    var countEl = $el('cc-kanban-count');
    if (countEl) countEl.textContent = state.leads.length + ' lead' + (state.leads.length !== 1 ? 's' : '');
  }

  // ─── Render Board ────────────────────────────────────────────
  function renderBoard() {
    var board = $el('cc-kanban-board');
    if (!board) return;

    // Group leads by stage
    var grouped = {};
    STAGES.forEach(function(s) { grouped[s.key] = []; });
    state.leads.forEach(function(lead) {
      var stage = lead.Lead_Stage || 'NEW_LEAD';
      if (grouped[stage]) {
        grouped[stage].push(lead);
      } else {
        grouped['NEW_LEAD'].push(lead);
      }
    });

    var html = '<div class="cc-kanban-columns">';

    STAGES.forEach(function(stage) {
      var leads = grouped[stage.key];
      html += '<div class="cc-kanban-column" data-stage="' + stage.key + '">';
      html += '<div class="cc-kanban-column-header cc-kanban-header-' + stage.color + '">';
      html += '<span class="cc-kanban-column-title">' + stage.label + '</span>';
      html += '<span class="cc-kanban-column-count">' + leads.length + '</span>';
      html += '</div>';
      html += '<div class="cc-kanban-cards" data-stage="' + stage.key + '">';

      leads.forEach(function(lead) {
        html += renderCard(lead, stage);
      });

      // Drop zone placeholder
      html += '<div class="cc-kanban-drop-placeholder" style="display:none;"></div>';
      html += '</div>';
      html += '</div>';
    });

    html += '</div>';
    board.innerHTML = html;

    bindDragAndDrop();
    bindCardClicks();
  }

  // ─── Render Single Card ──────────────────────────────────────
  function renderCard(lead, stage) {
    var ageText = lead.Created_At ? API.util.formatRelativeTime(lead.Created_At) : '';
    var priorityCls = API.util.priorityColor(lead.Priority);
    var practiceArea = formatPracticeArea(lead.Practice_Area);

    var html = '<div class="cc-kanban-card" draggable="true" data-lead-id="' + lead.id + '">';

    // Priority indicator
    if (lead.Priority) {
      html += '<div class="cc-kanban-card-priority cc-priority-' + priorityCls + '"></div>';
    }

    // Client name
    html += '<div class="cc-kanban-card-name">' + escapeHtml(lead.Client_Name || 'Unnamed') + '</div>';

    // Practice area
    if (practiceArea && practiceArea !== '\u2014') {
      html += '<div class="cc-kanban-card-practice">' + escapeHtml(practiceArea) + '</div>';
    }

    // Footer: owner + age
    html += '<div class="cc-kanban-card-footer">';
    if (lead.Lead_Owner_Name) {
      html += '<span class="cc-kanban-card-owner">' + escapeHtml(lead.Lead_Owner_Name) + '</span>';
    }
    if (ageText) {
      html += '<span class="cc-kanban-card-age">' + ageText + '</span>';
    }
    html += '</div>';

    // Disposition badge for non-open
    if (lead.Disposition && lead.Disposition !== 'OPEN') {
      var dispClass = lead.Disposition === 'WON' ? 'green' : 'red';
      html += '<div class="cc-kanban-card-disposition cc-badge-' + dispClass + '">' + lead.Disposition + '</div>';
    }

    html += '</div>';
    return html;
  }

  // ─── Drag & Drop ─────────────────────────────────────────────
  function bindDragAndDrop() {
    var board = $el('cc-kanban-board');
    if (!board) return;

    // Card drag start
    board.querySelectorAll('.cc-kanban-card').forEach(function(card) {
      card.addEventListener('dragstart', function(e) {
        state.draggedCard = card;
        state.draggedLeadId = card.dataset.leadId;
        card.classList.add('cc-kanban-card-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.leadId);
      });

      card.addEventListener('dragend', function() {
        card.classList.remove('cc-kanban-card-dragging');
        state.draggedCard = null;
        state.draggedLeadId = null;

        // Hide all placeholders
        board.querySelectorAll('.cc-kanban-drop-placeholder').forEach(function(ph) {
          ph.style.display = 'none';
        });

        // Remove highlights
        board.querySelectorAll('.cc-kanban-column-drop-active').forEach(function(col) {
          col.classList.remove('cc-kanban-column-drop-active');
        });
      });
    });

    // Column drop zones
    board.querySelectorAll('.cc-kanban-cards').forEach(function(dropZone) {
      dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dropZone.parentElement.classList.add('cc-kanban-column-drop-active');

        var placeholder = dropZone.querySelector('.cc-kanban-drop-placeholder');
        if (placeholder) placeholder.style.display = 'block';
      });

      dropZone.addEventListener('dragleave', function(e) {
        // Only remove highlight if leaving the drop zone entirely
        if (!dropZone.contains(e.relatedTarget)) {
          dropZone.parentElement.classList.remove('cc-kanban-column-drop-active');
          var placeholder = dropZone.querySelector('.cc-kanban-drop-placeholder');
          if (placeholder) placeholder.style.display = 'none';
        }
      });

      dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.parentElement.classList.remove('cc-kanban-column-drop-active');
        var placeholder = dropZone.querySelector('.cc-kanban-drop-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        var leadId = e.dataTransfer.getData('text/plain');
        var newStage = dropZone.dataset.stage;
        if (!leadId || !newStage) return;

        // Find the lead's current stage
        var lead = state.leads.find(function(l) { return l.id === leadId; });
        if (!lead) return;

        var currentStage = lead.Lead_Stage;
        if (currentStage === newStage) return; // No change

        handleStageDrop(lead, newStage);
      });
    });
  }

  // ─── Handle Stage Drop ───────────────────────────────────────
  async function handleStageDrop(lead, newStage) {
    var stageIdx = STAGES.findIndex(function(s) { return s.key === newStage; });
    var currentIdx = STAGES.findIndex(function(s) { return s.key === lead.Lead_Stage; });

    // Check if backward move (only admins/managers)
    if (stageIdx < currentIdx) {
      var role = state.user ? state.user.role : '';
      if (role !== 'ADMIN' && role !== 'MANAGER') {
        showToast('Only admins and managers can move leads backward.', 'error');
        return;
      }
    }

    // Close gate — need extra fields
    var opts = {};
    if (newStage === 'CLOSED_INTAKE_RECEIVED') {
      var disposition = prompt('Set disposition:\n\nWON = Client retained\nLOST = Client not retained\n\nEnter WON or LOST:');
      if (!disposition || (disposition.toUpperCase() !== 'WON' && disposition.toUpperCase() !== 'LOST')) {
        showToast('Stage change cancelled — disposition required.', 'error');
        return;
      }
      opts.disposition = disposition.toUpperCase();

      if (opts.disposition === 'LOST') {
        var reason = prompt('Close reason:\n\nPRICE, NOT_QUALIFIED, NO_RESPONSE, TIMING, COMPETITOR, DUPLICATE, OTHER\n\nEnter reason:');
        if (!reason) {
          showToast('Stage change cancelled — close reason required.', 'error');
          return;
        }
        opts.close_reason = reason.toUpperCase();
      }
    }

    // Optimistic UI update
    var prevStage = lead.Lead_Stage;
    lead.Lead_Stage = newStage;
    renderBoard();

    try {
      var result = await API.leads.updateStage(lead.id, newStage, opts);
      if (!result.success) {
        // Revert
        lead.Lead_Stage = prevStage;
        renderBoard();
        showToast(result.error || 'Failed to update stage.', 'error');
      } else {
        showToast('Moved to ' + STAGES.find(function(s) { return s.key === newStage; }).label, 'success');
      }
    } catch (err) {
      // Revert
      lead.Lead_Stage = prevStage;
      renderBoard();
      showToast(err.error || 'Failed to update stage.', 'error');
    }
  }

  // ─── Card Clicks ─────────────────────────────────────────────
  function bindCardClicks() {
    var board = $el('cc-kanban-board');
    if (!board) return;

    board.querySelectorAll('.cc-kanban-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        // Don't navigate if we were dragging
        if (state.draggedCard) return;
        window.location.href = '/crm/lead/' + card.dataset.leadId;
      });
    });
  }

  // ─── Bind Filters ────────────────────────────────────────────
  function bindFilters() {
    var debounceTimer;

    // Dropdown filters
    var filterMap = {
      'cc-filter-disposition': 'disposition',
      'cc-filter-practice': 'practice_area',
      'cc-filter-owner': 'owner'
    };

    Object.entries(filterMap).forEach(function(entry) {
      var el = $el(entry[0]);
      if (!el) return;
      el.addEventListener('change', function() {
        state.filters[entry[1]] = el.value;
        fetchLeads();
      });
    });

    // Search input (debounced)
    var searchEl = $el('cc-filter-search');
    if (searchEl) {
      searchEl.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          state.filters.search = searchEl.value.trim();
          fetchLeads();
        }, 400);
      });
    }
  }

  // ─── Toast Notifications ─────────────────────────────────────
  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'cc-toast cc-toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(function() {
      toast.classList.add('cc-toast-visible');
    });

    setTimeout(function() {
      toast.classList.remove('cc-toast-visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  function showBoardError(message) {
    var board = $el('cc-kanban-board');
    if (board) board.innerHTML = '<div class="cc-error"><p>' + escapeHtml(message) + '</p></div>';
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPracticeArea(pa) {
    if (!pa) return '\u2014';
    return pa.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }).replace(/\bPoa\b/g, 'POA');
  }

  // ─── Initialize ──────────────────────────────────────────────
  function init() {
    var user = API.auth.getUser();
    var userNameEl = $el('cc-user-name');
    if (user && userNameEl) {
      userNameEl.textContent = user.name || user.email;
    }

    bindFilters();
    fetchLeads();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
