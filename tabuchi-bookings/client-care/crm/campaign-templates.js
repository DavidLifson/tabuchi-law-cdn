/**
 * Tabuchi Law Client Care CRM - Campaign Template Management
 * Handles: /crm/campaign-templates
 *
 * Requires: cc-api-client.js loaded first
 *
 * Features:
 * - Template list with search and category filter
 * - Template create/edit with block-based content editor
 * - Template preview (compiled HTML)
 * - Duplicate and delete templates
 * - Template selection for campaign creation
 * - Role restricted: ADMIN, MARKETING, MANAGER
 *
 * Page element IDs:
 * - #cc-templates-container   (main container)
 * - #cc-templates-list        (template list area)
 * - #cc-template-detail       (detail/editor area, hidden by default)
 * - #cc-template-filters      (filter bar)
 */

(function CampaignTemplates() {
  'use strict';

  if (!ClientCareAPI.auth.requireAuth()) return;

  var _u = ClientCareAPI.auth.getUser();
  if (_u && _u.role === 'BOOKINGS') { window.location.href = '/dashboard'; return; }

  var API = ClientCareAPI;

  var $el = function(id) {
    var all = document.querySelectorAll('#' + id);
    if (!all.length) return null;
    for (var i = 0; i < all.length; i++) {
      if (!all[i].closest('.w-embed')) return all[i];
    }
    return all[all.length - 1];
  };

  // ─── Constants ─────────────────────────────────────────────
  var CATEGORIES = ['Welcome', 'Newsletter', 'Email Marketing', 'Confirmation - Email', 'Confirmation - SMS'];

  // Channel is derived from category — no separate selection needed
  function channelForCategory(cat) {
    return cat === 'Confirmation - SMS' ? 'SMS' : 'EMAIL';
  }

  // Editor type per category
  function editorTypeForCategory(cat) {
    if (cat === 'Confirmation - Email') return 'richtext';
    if (cat === 'Confirmation - SMS') return 'sms';
    return 'blocks'; // Newsletter, Email Marketing
  }

  function isConfirmationCategory(cat) {
    return cat === 'Confirmation - Email' || cat === 'Confirmation - SMS';
  }

  var BLOCK_TYPES = [
    { type: 'heading', label: 'Heading', icon: 'H' },
    { type: 'text', label: 'Text', icon: 'T' },
    { type: 'image', label: 'Image', icon: '&#128444;' },
    { type: 'button', label: 'Button', icon: '&#9635;' },
    { type: 'divider', label: 'Divider', icon: '&mdash;' },
    { type: 'spacer', label: 'Spacer', icon: '&#8597;' },
    { type: 'social', label: 'Social Links', icon: '@' },
    { type: 'header', label: 'Logo/Header', icon: '&#8862;' },
    { type: 'footer', label: 'Footer/Compliance', icon: '&#8863;' }
  ];

  // ─── State ─────────────────────────────────────────────────
  var state = {
    view: 'list',
    templates: [],
    filterCategory: '',
    searchQuery: '',
    sortKey: 'name',
    sortDir: 'asc',
    loading: false,
    // Detail
    activeTemplate: null,
    contentBlocks: [],
    richTextHtml: '',
    smsText: '',
    quillInstance: null,
    editorDirty: false,
    listStale: false,
    detailLoading: false,
    user: API.auth.getUser()
  };

  // ─── Role Gate ─────────────────────────────────────────────
  function checkRole() {
    var role = state.user ? (state.user.role || '').toUpperCase() : '';
    if (!['ADMIN', 'MARKETING', 'MANAGER'].includes(role)) {
      var container = $el('cc-templates-container');
      if (container) container.innerHTML =
        '<div class="cc-error"><p>Access denied. Template management requires ADMIN, MARKETING, or MANAGER role.</p></div>';
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
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function uid() { return 'b_' + Math.random().toString(36).substr(2, 9); }

  // ─── Fetch Templates ──────────────────────────────────────
  async function fetchTemplates() {
    if (state.loading) return;
    state.loading = true;
    showListLoading();

    try {
      var result = await API.campaignTemplates.list();
      if (result.success) {
        state.templates = result.templates || [];
        renderList();
      } else {
        showListError(result.error || 'Failed to load templates.');
      }
    } catch (err) {
      showListError(err.error || 'Error loading templates.');
    }

    state.loading = false;
  }

  // ─── Fetch Template Detail ─────────────────────────────────
  async function fetchDetail(templateId) {
    state.detailLoading = true;
    showDetailLoading();

    try {
      var result = await API.campaignTemplates.get(templateId);
      if (result.success) {
        state.activeTemplate = result.template;
        var cat = result.template.category || result.template.Category || '';
        var edType = editorTypeForCategory(cat);
        try {
          var cj = result.template.content_json || result.template.Content_JSON || '';
          var parsed = cj ? JSON.parse(cj) : {};
          if (edType === 'richtext') {
            state.richTextHtml = parsed.html || '';
            state.contentBlocks = [];
          } else if (edType === 'sms') {
            state.smsText = parsed.text || '';
            state.contentBlocks = [];
          } else {
            state.contentBlocks = parsed.blocks || [];
            state.richTextHtml = '';
            state.smsText = '';
          }
        } catch (e) { state.contentBlocks = []; state.richTextHtml = ''; state.smsText = ''; }
        state.quillInstance = null;
        state.editorDirty = false;
        renderDetail();
      } else {
        showDetailError(result.error || 'Failed to load template.');
      }
    } catch (err) {
      showDetailError(err.error || 'Error loading template.');
    }

    state.detailLoading = false;
  }

  // ═══════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════

  function renderList() {
    var el = $el('cc-templates-list');
    if (!el) return;

    var filtered = state.templates;

    if (state.searchQuery) {
      var q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(function(t) {
        return (t.name || '').toLowerCase().includes(q) ||
               (t.subject || '').toLowerCase().includes(q) ||
               (t.category || '').toLowerCase().includes(q);
      });
    }

    if (state.filterCategory) {
      filtered = filtered.filter(function(t) {
        return (t.category || '').toLowerCase() === state.filterCategory.toLowerCase();
      });
    }

    filtered = filtered.slice().sort(function(a, b) {
      var av = a[state.sortKey] || '';
      var bv = b[state.sortKey] || '';
      av = String(av); bv = String(bv);
      return state.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    if (filtered.length === 0) {
      el.innerHTML = '<div class="cc-empty">' +
        '<p>No templates found.' + (state.templates.length ? ' Try adjusting filters.' : ' Create your first template.') + '</p>' +
        '</div>';
      return;
    }

    var columns = [
      { key: 'name', label: 'Template Name' },
      { key: 'subject', label: 'Default Subject' },
      { key: 'category', label: 'Category' },
      { key: 'channel', label: 'Channel' },
      { key: 'is_active', label: 'Active' }
    ];

    var html = '<table class="cc-table">';
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
    html += '<th class="cc-th" style="width:150px">Actions</th>';
    html += '</tr></thead><tbody>';

    filtered.forEach(function(t) {
      var isActive = t.is_active !== false && t.Is_Active !== false;
      html += '<tr class="cc-template-row" data-id="' + t.id + '">';
      html += '<td style="font-weight:500">' + escapeHtml(t.name || 'Untitled') + '</td>';
      html += '<td>' + escapeHtml(t.subject || '—') + '</td>';
      html += '<td><span class="cc-badge cc-badge-blue">' + escapeHtml(t.category || 'General') + '</span></td>';
      html += '<td>' + escapeHtml(t.channel || 'EMAIL') + '</td>';
      html += '<td><span class="cc-badge cc-badge-' + (isActive ? 'green' : 'gray') + '">' + (isActive ? 'Active' : 'Inactive') + '</span></td>';
      html += '<td>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-tpl-open-btn" data-id="' + t.id + '">Edit</button> ';
      html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-tpl-dup-btn" data-id="' + t.id + '" data-name="' + escapeAttr(t.name) + '" title="Duplicate">&#10697;</button> ';
      html += '<button class="cc-btn cc-btn-sm cc-btn-danger cc-tpl-del-btn" data-id="' + t.id + '" data-name="' + escapeAttr(t.name) + '" title="Delete">&#10005;</button>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
    bindListClicks();
  }

  function renderFilters() {
    var el = $el('cc-template-filters');
    if (!el) return;

    var html = '<div class="cc-campaigns-filter-row">';
    html += '<input type="text" id="cc-tpl-search" class="cc-input cc-input-sm" placeholder="Search templates..." value="' + escapeAttr(state.searchQuery) + '" style="max-width:220px" />';

    html += '<select id="cc-tpl-filter-category" class="cc-input cc-input-sm" style="max-width:160px">';
    html += '<option value="">All Categories</option>';
    CATEGORIES.forEach(function(c) {
      html += '<option value="' + c + '"' + (state.filterCategory === c ? ' selected' : '') + '>' + c + '</option>';
    });
    html += '</select>';

    html += '<div style="flex:1"></div>';
    html += '<button id="cc-create-template-btn" class="cc-btn cc-btn-primary cc-btn-sm">+ New Template</button>';
    html += '</div>';
    el.innerHTML = html;

    var searchEl = $el('cc-tpl-search');
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

    var catEl = $el('cc-tpl-filter-category');
    if (catEl) catEl.addEventListener('change', function() {
      state.filterCategory = catEl.value;
      renderList();
    });

    var createBtn = $el('cc-create-template-btn');
    if (createBtn) createBtn.addEventListener('click', showCreateModal);
  }

  function bindListClicks() {
    var listEl = $el('cc-templates-list');
    if (!listEl) return;

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

    listEl.querySelectorAll('.cc-tpl-open-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        openDetail(btn.dataset.id);
      });
    });

    listEl.querySelectorAll('.cc-template-row').forEach(function(row) {
      row.addEventListener('click', function() { openDetail(row.dataset.id); });
    });

    listEl.querySelectorAll('.cc-tpl-dup-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handleDuplicate(btn.dataset.id, btn.dataset.name);
      });
    });

    listEl.querySelectorAll('.cc-tpl-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handleDelete(btn.dataset.id, btn.dataset.name);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // DETAIL / EDITOR VIEW
  // ═══════════════════════════════════════════════════════════

  function openDetail(templateId) {
    state.view = 'detail';
    toggleViews();
    fetchDetail(templateId);
  }

  function closeDetail() {
    if (state.editorDirty) {
      if (!confirm('You have unsaved changes. Discard?')) return;
    }
    state.view = 'list';
    state.activeTemplate = null;
    state.contentBlocks = [];
    state.editorDirty = false;
    toggleViews();
    if (state.listStale) {
      state.listStale = false;
      fetchTemplates();
    } else {
      renderTable();
    }
  }

  function toggleViews() {
    var listSection = $el('cc-templates-list');
    var filterSection = $el('cc-template-filters');
    var detailSection = $el('cc-template-detail');

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
    var el = $el('cc-template-detail');
    if (!el || !state.activeTemplate) return;
    var t = state.activeTemplate;

    var html = '';

    // Header
    html += '<div class="cc-detail-header">';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-detail-back-btn">&larr; Back to Templates</button>';
    html += '<h2 class="cc-detail-title">' + escapeHtml(t.name || 'Untitled') + '</h2>';
    html += '<div class="cc-detail-meta">';
    html += '<span class="cc-badge cc-badge-blue">' + escapeHtml(t.category || 'General') + '</span>';
    html += '<span class="cc-detail-meta-item">' + escapeHtml(t.channel || 'EMAIL') + '</span>';
    var isActive = t.is_active !== false && t.Is_Active !== false;
    html += '<span class="cc-badge cc-badge-' + (isActive ? 'green' : 'gray') + '">' + (isActive ? 'Active' : 'Inactive') + '</span>';
    html += '</div>';
    html += '</div>';

    // Action bar
    html += '<div class="cc-detail-actions">';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-tpl-edit-meta-btn">Edit Details</button>';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-tpl-preview-tab-btn">Preview in New Tab</button>';
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-tpl-dup-detail-btn">Duplicate</button>';
    html += '<button class="cc-btn cc-btn-sm cc-btn-danger cc-tpl-del-detail-btn">Delete</button>';
    html += '</div>';

    // Template fields
    var cat = t.category || '';
    var edType = editorTypeForCategory(cat);
    var derivedChannel = channelForCategory(cat);

    html += '<div class="cc-overview-grid" style="margin-bottom:1.5rem">';
    html += '<div class="cc-card">';
    html += '<h4>Template Details</h4>';
    html += '<div class="cc-detail-fields">';
    if (edType !== 'sms') html += fieldRow('Subject', t.subject || '—');
    html += fieldRow('Category', cat || '—');
    html += fieldRow('Channel', derivedChannel);
    if (edType === 'blocks') html += fieldRow('Brand Theme', t.brand_theme || '—');
    html += fieldRow('Active', isActive ? 'Yes' : 'No');
    if (isConfirmationCategory(cat)) {
      var timing = '';
      try { var cj = t.content_json || t.Content_JSON || ''; var p = cj ? JSON.parse(cj) : {}; timing = p.send_before || ''; } catch(e){}
      html += fieldRow('Send Before', timing ? timing + ' before appointment' : 'Not set');
    }
    html += '</div></div></div>';

    // Editor — conditional based on category
    html += '<div class="cc-editor-container">';

    if (edType === 'blocks') {
      // Block editor toolbar
      html += '<div class="cc-editor-toolbar">';
      html += '<span class="cc-editor-toolbar-label">Add Block:</span>';
      BLOCK_TYPES.forEach(function(bt) {
        html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-add-block-btn" data-type="' + bt.type + '" title="' + bt.label + '">' + bt.icon + ' ' + bt.label + '</button>';
      });
      html += '<div style="flex:1"></div>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-save-content-btn"' + (!state.editorDirty ? ' disabled' : '') + '>Save Template</button>';
      html += '</div>';

      // Blocks
      html += '<div class="cc-editor-blocks">';
      if (state.contentBlocks.length === 0) {
        html += '<div class="cc-empty" style="padding:3rem">No content blocks yet. Add blocks using the toolbar above.</div>';
      } else {
        state.contentBlocks.forEach(function(block, idx) {
          html += renderBlock(block, idx);
        });
      }
      html += '</div>';

      // Preview
      html += '<div class="cc-editor-preview-section">';
      html += '<h4>Preview</h4>';
      html += '<div class="cc-editor-preview">' + compilePreviewHtml() + '</div>';
      html += '</div>';

    } else if (edType === 'richtext') {
      // Quill rich text editor for Confirmation - Email
      html += '<div class="cc-editor-toolbar" style="justify-content:flex-end">';
      html += '<span class="cc-editor-toolbar-label" style="flex:1">Rich Text Editor</span>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-save-content-btn"' + (!state.editorDirty ? ' disabled' : '') + '>Save Template</button>';
      html += '</div>';
      html += '<div class="cc-tpl-merge-tags" style="margin-bottom:0.5rem;font-size:0.8rem;color:#6B7280;">';
      html += 'Merge tags: <code>{{clientName}}</code> <code>{{staffName}}</code> <code>{{date}}</code> <code>{{time}}</code> <code>{{joinUrl}}</code> <code>{{rescheduleUrl}}</code> <code>{{cancelUrl}}</code> <code>{{meetingTypeName}}</code>';
      html += '</div>';
      html += '<div id="cc-tpl-quill-editor" class="cc-tpl-quill-wrap"></div>';

      // Preview
      html += '<div class="cc-editor-preview-section">';
      html += '<h4>Preview</h4>';
      html += '<div class="cc-editor-preview" id="cc-tpl-richtext-preview">' + (state.richTextHtml || '<p style="color:#9CA3AF;text-align:center;padding:2rem">No content to preview</p>') + '</div>';
      html += '</div>';

    } else if (edType === 'sms') {
      // Plain textarea for Confirmation - SMS
      html += '<div class="cc-editor-toolbar" style="justify-content:flex-end">';
      html += '<span class="cc-editor-toolbar-label" style="flex:1">SMS Template</span>';
      html += '<span id="cc-tpl-sms-charcount" style="font-size:0.8rem;color:#6B7280;margin-right:1rem;">' + (state.smsText || '').length + '/160 chars</span>';
      html += '<button class="cc-btn cc-btn-sm cc-btn-primary cc-save-content-btn"' + (!state.editorDirty ? ' disabled' : '') + '>Save Template</button>';
      html += '</div>';
      html += '<div class="cc-tpl-merge-tags" style="margin-bottom:0.5rem;font-size:0.8rem;color:#6B7280;">';
      html += 'Merge tags: <code>{{clientName}}</code> <code>{{staffName}}</code> <code>{{date}}</code> <code>{{time}}</code> <code>{{rescheduleUrl}}</code> <code>{{cancelUrl}}</code> <code>{{meetingTypeName}}</code>';
      html += '</div>';
      html += '<textarea id="cc-tpl-sms-textarea" class="cc-input cc-textarea" style="min-height:120px;font-size:0.9rem;" placeholder="SMS message text...">' + escapeHtml(state.smsText || '') + '</textarea>';
    }

    html += '</div>';

    el.innerHTML = html;
    bindDetailEvents();
  }

  function fieldRow(label, value) {
    return '<div class="cc-field-row"><span class="cc-field-label">' + escapeHtml(label) + '</span><span class="cc-field-value">' + escapeHtml(value || '') + '</span></div>';
  }

  function renderBlock(block, idx) {
    var html = '<div class="cc-block" data-idx="' + idx + '">';
    html += '<div class="cc-block-header">';
    html += '<span class="cc-block-type-badge">' + block.type + '</span>';
    html += '<div class="cc-block-actions">';
    if (idx > 0) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-block-move-btn" data-dir="up" data-idx="' + idx + '" title="Move up">&#9650;</button>';
    if (idx < state.contentBlocks.length - 1) html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-block-move-btn" data-dir="down" data-idx="' + idx + '" title="Move down">&#9660;</button>';
    html += '<button class="cc-btn cc-btn-sm cc-btn-danger cc-block-delete-btn" data-idx="' + idx + '" title="Remove">&#10005;</button>';
    html += '</div>';
    html += '</div>';

    html += '<div class="cc-block-body">';
    var d = block.data || {};
    switch (block.type) {
      case 'heading':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="text" value="' + escapeAttr(d.text || '') + '" placeholder="Heading text..." />';
        html += '<select class="cc-input cc-input-sm cc-block-input" data-idx="' + idx + '" data-field="level" style="width:80px;margin-top:4px">';
        [1,2,3,4].forEach(function(l) {
          html += '<option value="' + l + '"' + ((d.level || 2) === l ? ' selected' : '') + '>H' + l + '</option>';
        });
        html += '</select>';
        break;
      case 'text':
        html += '<textarea class="cc-input cc-textarea cc-block-input" data-idx="' + idx + '" data-field="text" placeholder="Paragraph text... (supports {{merge_tags}})">' + escapeHtml(d.text || '') + '</textarea>';
        break;
      case 'image':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="src" value="' + escapeAttr(d.src || '') + '" placeholder="Image URL..." />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="alt" value="' + escapeAttr(d.alt || '') + '" placeholder="Alt text..." style="margin-top:4px" />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="link" value="' + escapeAttr(d.link || '') + '" placeholder="Link URL (optional)" style="margin-top:4px" />';
        break;
      case 'button':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="text" value="' + escapeAttr(d.text || '') + '" placeholder="Button text..." />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="url" value="' + escapeAttr(d.url || '') + '" placeholder="Button URL..." style="margin-top:4px" />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="color" value="' + escapeAttr(d.color || '#2563EB') + '" placeholder="Button color (#hex)" style="margin-top:4px;width:120px" />';
        break;
      case 'divider':
        html += '<div style="border-top:1px solid #E5E7EB;margin:0.5rem 0;"></div>';
        break;
      case 'spacer':
        html += '<input type="number" class="cc-input cc-input-sm cc-block-input" data-idx="' + idx + '" data-field="height" value="' + (d.height || 20) + '" min="4" max="100" style="width:80px" />';
        html += '<span style="font-size:0.8rem;color:#6B7280;margin-left:4px">px height</span>';
        break;
      case 'social':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="links" value="' + escapeAttr(d.links || '') + '" placeholder="JSON array of {icon, url} or comma-separated URLs" />';
        break;
      case 'header':
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="logoUrl" value="' + escapeAttr(d.logoUrl || '') + '" placeholder="Logo image URL..." />';
        html += '<input type="text" class="cc-input cc-block-input" data-idx="' + idx + '" data-field="text" value="' + escapeAttr(d.text || '') + '" placeholder="Header text (optional)" style="margin-top:4px" />';
        break;
      case 'footer':
        html += '<textarea class="cc-input cc-textarea cc-block-input" data-idx="' + idx + '" data-field="text" placeholder="Footer text with compliance info, unsubscribe link: {{unsubscribe_url}}">' + escapeHtml(d.text || '') + '</textarea>';
        break;
    }
    html += '</div></div>';
    return html;
  }

  function compilePreviewHtml() {
    // For richtext/sms, return appropriate preview
    var cat = state.activeTemplate ? (state.activeTemplate.category || '') : '';
    var edType = editorTypeForCategory(cat);
    if (edType === 'richtext') {
      return state.richTextHtml || '<p style="color:#9CA3AF;text-align:center;padding:2rem">No content to preview</p>';
    }
    if (edType === 'sms') {
      return state.smsText
        ? '<div style="max-width:320px;margin:0 auto;padding:12px;background:#E5F3FF;border-radius:12px;font-size:14px;line-height:1.5">' + escapeHtml(state.smsText) + '</div>'
        : '<p style="color:#9CA3AF;text-align:center;padding:2rem">No content to preview</p>';
    }
    if (state.contentBlocks.length === 0) return '<p style="color:#9CA3AF;text-align:center;padding:2rem">No content to preview</p>';

    var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#1F2937;line-height:1.6">';
    state.contentBlocks.forEach(function(block) {
      var d = block.data || {};
      switch (block.type) {
        case 'heading':
          var lvl = d.level || 2;
          var fs = lvl === 1 ? '24px' : lvl === 2 ? '20px' : lvl === 3 ? '16px' : '14px';
          html += '<h' + lvl + ' style="font-size:' + fs + ';margin:16px 0 8px;font-weight:700">' + escapeHtml(d.text || '') + '</h' + lvl + '>';
          break;
        case 'text':
          html += '<p style="margin:8px 0;font-size:14px">' + escapeHtml(d.text || '').replace(/\n/g, '<br>') + '</p>';
          break;
        case 'image':
          var imgTag = '<img src="' + escapeAttr(d.src || '') + '" alt="' + escapeAttr(d.alt || '') + '" style="max-width:100%;height:auto;display:block;margin:12px 0;border-radius:4px">';
          html += d.link ? '<a href="' + escapeAttr(d.link) + '">' + imgTag + '</a>' : imgTag;
          break;
        case 'button':
          var btnColor = /^#[0-9A-Fa-f]{3,8}$/.test(d.color) ? d.color : '#2563EB';
          html += '<div style="text-align:center;margin:16px 0"><a href="' + escapeAttr(d.url || '#') + '" style="display:inline-block;padding:12px 24px;background:' + btnColor + ';color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' + escapeHtml(d.text || 'Click Here') + '</a></div>';
          break;
        case 'divider':
          html += '<hr style="border:0;border-top:1px solid #E5E7EB;margin:16px 0">';
          break;
        case 'spacer':
          html += '<div style="height:' + (parseInt(d.height, 10) || 20) + 'px"></div>';
          break;
        case 'header':
          html += '<div style="text-align:center;padding:16px 0;border-bottom:1px solid #E5E7EB;margin-bottom:16px">';
          if (d.logoUrl) html += '<img src="' + escapeAttr(d.logoUrl) + '" alt="Logo" style="max-height:48px;margin-bottom:8px">';
          if (d.text) html += '<div style="font-size:18px;font-weight:700">' + escapeHtml(d.text) + '</div>';
          html += '</div>';
          break;
        case 'footer':
          html += '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280;text-align:center">' + escapeHtml(d.text || '').replace(/\n/g, '<br>') + '</div>';
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
    var cat = state.activeTemplate ? (state.activeTemplate.category || '') : '';
    var edType = editorTypeForCategory(cat);
    if (edType === 'richtext') {
      return JSON.stringify({ version: 1, type: 'richtext', html: state.richTextHtml, send_before: getSendBefore() });
    }
    if (edType === 'sms') {
      return JSON.stringify({ version: 1, type: 'sms', text: state.smsText, send_before: getSendBefore() });
    }
    return JSON.stringify({ version: 1, blocks: state.contentBlocks, theme: {} });
  }

  function getSendBefore() {
    if (!state.activeTemplate) return '';
    try {
      var cj = state.activeTemplate.content_json || state.activeTemplate.Content_JSON || '';
      var p = cj ? JSON.parse(cj) : {};
      return p.send_before || '';
    } catch(e) { return ''; }
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
  // PREVIEW IN NEW TAB
  // ═══════════════════════════════════════════════════════════

  function openPreviewTab() {
    var t = state.activeTemplate;
    if (!t) return;
    var cat = t.category || '';
    var edType = editorTypeForCategory(cat);
    var body = '';

    if (edType === 'sms') {
      body = '<div style="max-width:400px;margin:2rem auto;padding:1.5rem;background:#E5F3FF;border-radius:16px;font-family:-apple-system,system-ui,sans-serif;font-size:15px;line-height:1.5">'
        + escapeHtml(state.smsText || '(empty)')
        + '</div>';
    } else {
      body = compilePreviewHtml();
    }

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview: '
      + escapeHtml(t.name || 'Template')
      + '</title><style>body{margin:0;padding:2rem;background:#f3f4f6;font-family:-apple-system,system-ui,sans-serif}'
      + '.preview-wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);padding:2rem}'
      + '.preview-banner{text-align:center;padding:0.75rem;background:#1E40AF;color:#fff;font-size:0.8rem;border-radius:8px 8px 0 0;margin:-2rem -2rem 1.5rem}'
      + '</style></head><body>'
      + '<div class="preview-wrap">'
      + '<div class="preview-banner">Template Preview: ' + escapeHtml(t.name || '') + ' (' + escapeHtml(cat || 'Email') + ')</div>'
      + body
      + '</div></body></html>';

    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }

  // ═══════════════════════════════════════════════════════════
  // EVENT BINDINGS
  // ═══════════════════════════════════════════════════════════

  function bindDetailEvents() {
    var el = $el('cc-template-detail');
    if (!el) return;

    el.querySelectorAll('.cc-detail-back-btn').forEach(function(btn) {
      btn.addEventListener('click', closeDetail);
    });

    var editMetaBtn = el.querySelector('.cc-tpl-edit-meta-btn');
    if (editMetaBtn) editMetaBtn.addEventListener('click', showEditModal);

    var previewTabBtn = el.querySelector('.cc-tpl-preview-tab-btn');
    if (previewTabBtn) previewTabBtn.addEventListener('click', openPreviewTab);

    var dupBtn = el.querySelector('.cc-tpl-dup-detail-btn');
    if (dupBtn) dupBtn.addEventListener('click', function() {
      handleDuplicate(state.activeTemplate.id, state.activeTemplate.name);
    });

    var delBtn = el.querySelector('.cc-tpl-del-detail-btn');
    if (delBtn) delBtn.addEventListener('click', function() {
      handleDelete(state.activeTemplate.id, state.activeTemplate.name);
    });

    // Editor bindings — conditional on editor type
    var cat = state.activeTemplate ? (state.activeTemplate.category || '') : '';
    var edType = editorTypeForCategory(cat);

    if (edType === 'blocks') {
      // Add block
      el.querySelectorAll('.cc-add-block-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          state.contentBlocks.push({ id: uid(), type: btn.dataset.type, data: getDefaultBlockData(btn.dataset.type) });
          state.editorDirty = true;
          renderDetail();
        });
      });

      // Block inputs
      el.querySelectorAll('.cc-block-input').forEach(function(input) {
        input.addEventListener('input', function() {
          var idx = parseInt(input.dataset.idx, 10);
          var field = input.dataset.field;
          if (state.contentBlocks[idx]) {
            var val = input.value;
            if (field === 'level' || field === 'height') val = parseInt(val, 10);
            state.contentBlocks[idx].data[field] = val;
            state.editorDirty = true;
            var previewEl = el.querySelector('.cc-editor-preview');
            if (previewEl) previewEl.innerHTML = compilePreviewHtml();
            var saveBtn = el.querySelector('.cc-save-content-btn');
            if (saveBtn) saveBtn.disabled = false;
          }
        });
      });

      // Move/delete blocks
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

    } else if (edType === 'richtext') {
      // Initialize Quill for Confirmation - Email
      initQuillEditor();

    } else if (edType === 'sms') {
      // SMS textarea binding
      var smsArea = document.getElementById('cc-tpl-sms-textarea');
      if (smsArea) {
        smsArea.addEventListener('input', function() {
          state.smsText = smsArea.value;
          state.editorDirty = true;
          var saveBtn = el.querySelector('.cc-save-content-btn');
          if (saveBtn) saveBtn.disabled = false;
          var charCount = document.getElementById('cc-tpl-sms-charcount');
          if (charCount) charCount.textContent = smsArea.value.length + '/160 chars';
        });
      }
    }

    // Save
    var saveBtn = el.querySelector('.cc-save-content-btn');
    if (saveBtn) saveBtn.addEventListener('click', handleSaveContent);
  }

  // ─── Quill Editor Init ──────────────────────────────────
  function initQuillEditor() {
    if (typeof Quill === 'undefined') {
      console.warn('Quill.js not loaded — rich text editor unavailable');
      return;
    }
    var container = document.getElementById('cc-tpl-quill-editor');
    if (!container) return;

    state.quillInstance = new Quill(container, {
      theme: 'snow',
      placeholder: 'Compose confirmation email...',
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link'],
          ['clean']
        ]
      }
    });

    // Set initial content
    if (state.richTextHtml) {
      state.quillInstance.root.innerHTML = state.richTextHtml;
    }

    // Track changes
    state.quillInstance.on('text-change', function() {
      state.richTextHtml = state.quillInstance.root.innerHTML;
      state.editorDirty = true;
      var saveBtn = document.querySelector('.cc-save-content-btn');
      if (saveBtn) saveBtn.disabled = false;
      var preview = document.getElementById('cc-tpl-richtext-preview');
      if (preview) preview.innerHTML = state.richTextHtml || '<p style="color:#9CA3AF;text-align:center;padding:2rem">No content to preview</p>';
    });
  }

  // ═══════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════

  async function handleSaveContent() {
    if (!state.activeTemplate) return;
    try {
      var result = await API.campaignTemplates.update(state.activeTemplate.id, {
        content_json: getContentJSON(),
        preview_html: compilePreviewHtml()
      });
      if (result.success) {
        state.editorDirty = false;
        state.listStale = true;
        showToast('Template saved.', 'success');
        state.activeTemplate.content_json = getContentJSON();
        state.activeTemplate.Content_JSON = getContentJSON();
        renderDetail();
      } else {
        showToast(result.error || 'Failed to save template.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error saving template.', 'error');
    }
  }

  function handleDuplicate(templateId, templateName) {
    var html = '<div class="cc-modal-form">' +
      '<div class="cc-form-group">' +
        '<label class="cc-label">New Template Name *</label>' +
        '<input type="text" id="cc-modal-dup-name" class="cc-input" value="' + escapeAttr('Copy of ' + (templateName || '')) + '" />' +
      '</div>' +
    '</div>';

    showModal('Duplicate Template', html, async function(form) {
      var newName = form.querySelector('#cc-modal-dup-name').value.trim();
      if (!newName) { showToast('Template name is required.', 'error'); return; }

      try {
        var result = await API.campaignTemplates.duplicate(templateId, newName);
        if (result.success) {
          showToast('Template duplicated.', 'success');
          closeModal();
          fetchTemplates();
          if (result.template_id) openDetail(result.template_id);
        } else {
          showToast(result.error || 'Failed to duplicate.', 'error');
        }
      } catch (err) {
        showToast(err.error || 'Error duplicating template.', 'error');
      }
    }, { submitLabel: 'Duplicate' });
  }

  function handleDelete(templateId, templateName) {
    var html = '<div class="cc-modal-form">' +
      '<p style="margin:0 0 8px 0;">Are you sure you want to delete <strong>' + escapeHtml(templateName || '') + '</strong>?</p>' +
      '<p style="margin:0;color:#dc2626;font-size:13px;">This action cannot be undone.</p>' +
    '</div>';

    showModal('Delete Template', html, async function() {
      try {
        var result = await API.campaignTemplates.delete(templateId);
        if (result.success) {
          showToast('Template deleted.', 'success');
          closeModal();
          state.listStale = true;
          if (state.view === 'detail') closeDetail();
          else fetchTemplates();
        } else {
          showToast(result.error || 'Failed to delete.', 'error');
        }
      } catch (err) {
        showToast(err.error || 'Error deleting template.', 'error');
      }
    }, { submitLabel: 'Delete' });
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

  function showCreateModal() {
    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Template Name *</label>';
    html += '<input type="text" id="cc-modal-name" class="cc-input" placeholder="e.g. Welcome Email" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Category *</label>';
    html += '<select id="cc-modal-category" class="cc-input">';
    CATEGORIES.forEach(function(c) {
      html += '<option value="' + c + '">' + c + '</option>';
    });
    html += '</select>';
    html += '<span style="font-size:0.75rem;color:#6B7280;margin-top:2px;display:block" id="cc-modal-channel-hint">Channel: EMAIL</span>';
    html += '</div>';

    html += '<div class="cc-form-group cc-modal-subject-group">';
    html += '<label class="cc-label">Default Subject</label>';
    html += '<input type="text" id="cc-modal-subject" class="cc-input" placeholder="Email subject line" />';
    html += '</div>';

    html += '<div class="cc-form-group cc-modal-brand-group">';
    html += '<label class="cc-label">Brand Theme (optional)</label>';
    html += '<input type="text" id="cc-modal-brand-theme" class="cc-input" placeholder="e.g. default, dark, minimal" />';
    html += '</div>';

    html += '<div class="cc-form-group cc-modal-timing-group" style="display:none">';
    html += '<label class="cc-label">Send Before Appointment</label>';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    html += '<input type="number" id="cc-modal-send-before-val" class="cc-input" style="width:80px" min="1" value="24" />';
    html += '<select id="cc-modal-send-before-unit" class="cc-input" style="width:100px">';
    html += '<option value="hours">hours</option>';
    html += '<option value="days">days</option>';
    html += '</select>';
    html += '<span style="font-size:0.8rem;color:#6B7280">before appointment</span>';
    html += '</div>';
    html += '</div>';

    html += '</div>';

    showModal('New Template', html, handleCreate);
    bindCreateModalCategoryToggle();
  }

  function bindCreateModalCategoryToggle() {
    var catSelect = document.getElementById('cc-modal-category');
    if (!catSelect) return;
    catSelect.addEventListener('change', function() {
      var cat = catSelect.value;
      var isSms = cat === 'Confirmation - SMS';
      var isConfirm = isConfirmationCategory(cat);
      var isBlocks = editorTypeForCategory(cat) === 'blocks';
      var hint = document.getElementById('cc-modal-channel-hint');
      if (hint) hint.textContent = 'Channel: ' + channelForCategory(cat);
      var subjectGroup = activeModal ? activeModal.querySelector('.cc-modal-subject-group') : null;
      if (subjectGroup) subjectGroup.style.display = isSms ? 'none' : '';
      var brandGroup = activeModal ? activeModal.querySelector('.cc-modal-brand-group') : null;
      if (brandGroup) brandGroup.style.display = isBlocks ? '' : 'none';
      var timingGroup = activeModal ? activeModal.querySelector('.cc-modal-timing-group') : null;
      if (timingGroup) timingGroup.style.display = isConfirm ? '' : 'none';
    });
    // Fire once to set initial state
    catSelect.dispatchEvent(new Event('change'));
  }

  async function handleCreate(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    if (!name) { showToast('Template name is required.', 'error'); return; }

    var cat = form.querySelector('#cc-modal-category').value;
    var edType = editorTypeForCategory(cat);

    var data = {
      name: name,
      category: cat,
      channel: channelForCategory(cat)
    };

    // Subject only for email types
    if (edType !== 'sms') {
      data.subject = form.querySelector('#cc-modal-subject').value.trim();
    }

    // Brand theme only for block editor types
    if (edType === 'blocks') {
      data.brand_theme = form.querySelector('#cc-modal-brand-theme').value.trim();
    }

    // Timing for confirmation categories — seed into content_json
    if (isConfirmationCategory(cat)) {
      var val = parseInt(form.querySelector('#cc-modal-send-before-val').value, 10) || 24;
      var unit = form.querySelector('#cc-modal-send-before-unit').value || 'hours';
      var sendBefore = val + ' ' + unit;
      if (edType === 'richtext') {
        data.content_json = JSON.stringify({ version: 1, type: 'richtext', html: '', send_before: sendBefore });
      } else {
        data.content_json = JSON.stringify({ version: 1, type: 'sms', text: '', send_before: sendBefore });
      }
    }

    try {
      var result = await API.campaignTemplates.create(data);
      if (result.success) {
        showToast('Template created.', 'success');
        closeModal();
        fetchTemplates();
        if (result.template_id) openDetail(result.template_id);
      } else {
        showToast(result.error || 'Failed to create template.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error creating template.', 'error');
    }
  }

  function showEditModal() {
    if (!state.activeTemplate) return;
    var t = state.activeTemplate;
    var cat = t.category || '';
    var edType = editorTypeForCategory(cat);
    var isConfirm = isConfirmationCategory(cat);

    // Parse existing send_before
    var existingSendBefore = '';
    try { var p = JSON.parse(t.content_json || t.Content_JSON || '{}'); existingSendBefore = p.send_before || ''; } catch(e){}
    var sbParts = existingSendBefore.match(/^(\d+)\s+(hours|days)$/);
    var sbVal = sbParts ? sbParts[1] : '24';
    var sbUnit = sbParts ? sbParts[2] : 'hours';

    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Template Name *</label>';
    html += '<input type="text" id="cc-modal-name" class="cc-input" value="' + escapeAttr(t.name) + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Category</label>';
    html += '<select id="cc-modal-category" class="cc-input">';
    CATEGORIES.forEach(function(c) {
      html += '<option value="' + c + '"' + (cat === c ? ' selected' : '') + '>' + c + '</option>';
    });
    html += '</select>';
    html += '<span style="font-size:0.75rem;color:#6B7280;margin-top:2px;display:block" id="cc-modal-channel-hint">Channel: ' + channelForCategory(cat) + '</span>';
    html += '</div>';

    html += '<div class="cc-form-group cc-modal-subject-group"' + (edType === 'sms' ? ' style="display:none"' : '') + '>';
    html += '<label class="cc-label">Default Subject</label>';
    html += '<input type="text" id="cc-modal-subject" class="cc-input" value="' + escapeAttr(t.subject || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group cc-modal-brand-group"' + (edType !== 'blocks' ? ' style="display:none"' : '') + '>';
    html += '<label class="cc-label">Brand Theme</label>';
    html += '<input type="text" id="cc-modal-brand-theme" class="cc-input" value="' + escapeAttr(t.brand_theme || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group cc-modal-timing-group"' + (!isConfirm ? ' style="display:none"' : '') + '>';
    html += '<label class="cc-label">Send Before Appointment</label>';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    html += '<input type="number" id="cc-modal-send-before-val" class="cc-input" style="width:80px" min="1" value="' + escapeAttr(sbVal) + '" />';
    html += '<select id="cc-modal-send-before-unit" class="cc-input" style="width:100px">';
    html += '<option value="hours"' + (sbUnit === 'hours' ? ' selected' : '') + '>hours</option>';
    html += '<option value="days"' + (sbUnit === 'days' ? ' selected' : '') + '>days</option>';
    html += '</select>';
    html += '<span style="font-size:0.8rem;color:#6B7280">before appointment</span>';
    html += '</div>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Active</label>';
    html += '<select id="cc-modal-active" class="cc-input">';
    var isActive = t.is_active !== false && t.Is_Active !== false;
    html += '<option value="true"' + (isActive ? ' selected' : '') + '>Active</option>';
    html += '<option value="false"' + (!isActive ? ' selected' : '') + '>Inactive</option>';
    html += '</select>';
    html += '</div>';

    html += '</div>';

    showModal('Edit Template', html, handleEdit);
    bindCreateModalCategoryToggle();
  }

  async function handleEdit(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    if (!name) { showToast('Template name is required.', 'error'); return; }

    var cat = form.querySelector('#cc-modal-category').value;
    var edType = editorTypeForCategory(cat);

    var updates = {
      name: name,
      category: cat,
      channel: channelForCategory(cat),
      is_active: form.querySelector('#cc-modal-active').value === 'true'
    };

    if (edType !== 'sms') {
      updates.subject = form.querySelector('#cc-modal-subject').value.trim();
    }
    if (edType === 'blocks') {
      updates.brand_theme = form.querySelector('#cc-modal-brand-theme').value.trim();
    }

    // Update send_before in content_json for confirmation categories
    if (isConfirmationCategory(cat)) {
      var val = parseInt(form.querySelector('#cc-modal-send-before-val').value, 10) || 24;
      var unit = form.querySelector('#cc-modal-send-before-unit').value || 'hours';
      var sendBefore = val + ' ' + unit;
      // Merge into existing content_json
      try {
        var existing = JSON.parse(state.activeTemplate.content_json || state.activeTemplate.Content_JSON || '{}');
        existing.send_before = sendBefore;
        updates.content_json = JSON.stringify(existing);
      } catch(e) {
        updates.content_json = JSON.stringify({ version: 1, type: edType, send_before: sendBefore });
      }
    }

    try {
      var result = await API.campaignTemplates.update(state.activeTemplate.id, updates);
      if (result.success) {
        state.listStale = true;
        showToast('Template updated.', 'success');
        closeModal();
        fetchDetail(state.activeTemplate.id);
      } else {
        showToast(result.error || 'Failed to update.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error updating template.', 'error');
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
    var el = $el('cc-templates-list');
    if (el) el.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading templates...</p></div>';
  }

  function showListError(msg) {
    var el = $el('cc-templates-list');
    if (el) el.innerHTML = '<div class="cc-error"><p>' + escapeHtml(msg) + '</p></div>';
  }

  function showDetailLoading() {
    var el = $el('cc-template-detail');
    if (el) el.innerHTML = '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading template...</p></div>';
  }

  function showDetailError(msg) {
    var el = $el('cc-template-detail');
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
    if (!checkRole()) return;

    var detailEl = $el('cc-template-detail');
    if (detailEl) detailEl.style.display = 'none';

    renderFilters();
    fetchTemplates();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
