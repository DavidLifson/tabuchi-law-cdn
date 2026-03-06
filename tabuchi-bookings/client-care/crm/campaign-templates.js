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
  var CATEGORIES = ['General', 'Welcome', 'Follow-Up', 'Newsletter', 'Announcement', 'Reminder', 'Legal Update', 'Holiday'];
  var CHANNELS = ['EMAIL', 'SMS'];

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
    editorDirty: false,
    detailLoading: false,
    user: API.auth.getUser()
  };

  // ─── Role Gate ─────────────────────────────────────────────
  function checkRole() {
    var role = state.user ? state.user.role : '';
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
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        try {
          var cj = result.template.content_json || result.template.Content_JSON || '';
          state.contentBlocks = cj ? JSON.parse(cj).blocks || [] : [];
        } catch (e) { state.contentBlocks = []; }
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
    fetchTemplates();
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
    html += '<button class="cc-btn cc-btn-sm cc-btn-outline cc-tpl-dup-detail-btn">Duplicate</button>';
    html += '<button class="cc-btn cc-btn-sm cc-btn-danger cc-tpl-del-detail-btn">Delete</button>';
    html += '</div>';

    // Template fields
    html += '<div class="cc-overview-grid" style="margin-bottom:1.5rem">';
    html += '<div class="cc-card">';
    html += '<h4>Template Details</h4>';
    html += '<div class="cc-detail-fields">';
    html += fieldRow('Subject', t.subject || '—');
    html += fieldRow('Category', t.category || 'General');
    html += fieldRow('Channel', t.channel || 'EMAIL');
    html += fieldRow('Brand Theme', t.brand_theme || '—');
    html += fieldRow('Active', isActive ? 'Yes' : 'No');
    html += '</div></div></div>';

    // Editor
    html += '<div class="cc-editor-container">';

    // Toolbar
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
          html += '<div style="text-align:center;margin:16px 0"><a href="' + escapeAttr(d.url || '#') + '" style="display:inline-block;padding:12px 24px;background:' + (d.color || '#2563EB') + ';color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' + escapeHtml(d.text || 'Click Here') + '</a></div>';
          break;
        case 'divider':
          html += '<hr style="border:0;border-top:1px solid #E5E7EB;margin:16px 0">';
          break;
        case 'spacer':
          html += '<div style="height:' + (d.height || 20) + 'px"></div>';
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
    return JSON.stringify({ version: 1, blocks: state.contentBlocks, theme: {} });
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

    var dupBtn = el.querySelector('.cc-tpl-dup-detail-btn');
    if (dupBtn) dupBtn.addEventListener('click', function() {
      handleDuplicate(state.activeTemplate.id, state.activeTemplate.name);
    });

    var delBtn = el.querySelector('.cc-tpl-del-detail-btn');
    if (delBtn) delBtn.addEventListener('click', function() {
      handleDelete(state.activeTemplate.id, state.activeTemplate.name);
    });

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

    // Save
    var saveBtn = el.querySelector('.cc-save-content-btn');
    if (saveBtn) saveBtn.addEventListener('click', handleSaveContent);
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

  async function handleDuplicate(templateId, templateName) {
    var newName = prompt('New template name:', 'Copy of ' + (templateName || ''));
    if (!newName) return;

    try {
      var result = await API.campaignTemplates.duplicate(templateId, newName);
      if (result.success) {
        showToast('Template duplicated.', 'success');
        fetchTemplates();
        if (result.template_id) openDetail(result.template_id);
      } else {
        showToast(result.error || 'Failed to duplicate.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error duplicating template.', 'error');
    }
  }

  async function handleDelete(templateId, templateName) {
    if (!confirm('Delete template "' + (templateName || '') + '"? This cannot be undone.')) return;

    try {
      var result = await API.campaignTemplates.delete(templateId);
      if (result.success) {
        showToast('Template deleted.', 'success');
        if (state.view === 'detail') closeDetail();
        else fetchTemplates();
      } else {
        showToast(result.error || 'Failed to delete.', 'error');
      }
    } catch (err) {
      showToast(err.error || 'Error deleting template.', 'error');
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
    html += '<label class="cc-label">Default Subject</label>';
    html += '<input type="text" id="cc-modal-subject" class="cc-input" placeholder="Email subject line" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Category</label>';
    html += '<select id="cc-modal-category" class="cc-input">';
    CATEGORIES.forEach(function(c) {
      html += '<option value="' + c + '">' + c + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Channel</label>';
    html += '<select id="cc-modal-channel" class="cc-input">';
    CHANNELS.forEach(function(ch) {
      html += '<option value="' + ch + '">' + ch + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Brand Theme (optional)</label>';
    html += '<input type="text" id="cc-modal-brand-theme" class="cc-input" placeholder="e.g. default, dark, minimal" />';
    html += '</div>';

    html += '</div>';

    showModal('New Template', html, handleCreate);
  }

  async function handleCreate(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    if (!name) { showToast('Template name is required.', 'error'); return; }

    var data = {
      name: name,
      subject: form.querySelector('#cc-modal-subject').value.trim(),
      category: form.querySelector('#cc-modal-category').value,
      channel: form.querySelector('#cc-modal-channel').value,
      brand_theme: form.querySelector('#cc-modal-brand-theme').value.trim()
    };

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

    var html = '<div class="cc-modal-form">';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Template Name *</label>';
    html += '<input type="text" id="cc-modal-name" class="cc-input" value="' + escapeAttr(t.name) + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Default Subject</label>';
    html += '<input type="text" id="cc-modal-subject" class="cc-input" value="' + escapeAttr(t.subject || '') + '" />';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Category</label>';
    html += '<select id="cc-modal-category" class="cc-input">';
    CATEGORIES.forEach(function(c) {
      html += '<option value="' + c + '"' + ((t.category || '') === c ? ' selected' : '') + '>' + c + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Channel</label>';
    html += '<select id="cc-modal-channel" class="cc-input">';
    CHANNELS.forEach(function(ch) {
      html += '<option value="' + ch + '"' + ((t.channel || '') === ch ? ' selected' : '') + '>' + ch + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="cc-form-group">';
    html += '<label class="cc-label">Brand Theme</label>';
    html += '<input type="text" id="cc-modal-brand-theme" class="cc-input" value="' + escapeAttr(t.brand_theme || '') + '" />';
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
  }

  async function handleEdit(form) {
    var name = form.querySelector('#cc-modal-name').value.trim();
    if (!name) { showToast('Template name is required.', 'error'); return; }

    var updates = {
      name: name,
      subject: form.querySelector('#cc-modal-subject').value.trim(),
      category: form.querySelector('#cc-modal-category').value,
      channel: form.querySelector('#cc-modal-channel').value,
      brand_theme: form.querySelector('#cc-modal-brand-theme').value.trim(),
      is_active: form.querySelector('#cc-modal-active').value === 'true'
    };

    try {
      var result = await API.campaignTemplates.update(state.activeTemplate.id, updates);
      if (result.success) {
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
