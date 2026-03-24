/* Meeting Types Manager - /dashboard-meeting-types */

(async function MeetingTypesPage() {
  'use strict';

  // Use last #tb-page-root to handle Webflow dual-embed (HTML Embed widget + Before </body> tag)
  const _roots = document.querySelectorAll('#tb-page-root');
  const _root = _roots[_roots.length - 1] || null;
  function $el(id) { return _root ? _root.querySelector('#' + id) : document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  const token = localStorage.getItem('app_token');
  if (!token) { window.location.href = '/login'; return; }

  // Show admin dropdown if user is an admin
  try {
    var staffInfo = JSON.parse(localStorage.getItem('app_user') || '{}');
    if (staffInfo.is_admin) {
      var logoutLink = _root.querySelector('a[href="/login?logout"]');
      if (logoutLink) {
        var adminWrap = document.createElement('div');
        adminWrap.style.cssText = 'position:relative;display:inline-block;';
        var adminBtn = document.createElement('button');
        adminBtn.style.cssText = 'color:#D1D5DB;background:none;border:1px solid #4B5563;cursor:pointer;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;font-family:inherit;';
        adminBtn.textContent = 'Admin \u25BE';
        var adminMenu = document.createElement('div');
        adminMenu.style.cssText = 'display:none;position:absolute;right:0;top:100%;margin-top:2px;background:#1F2937;border:1px solid #4B5563;border-radius:4px;min-width:130px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        adminMenu.innerHTML = '<a href="/dashboard-staff" style="display:block;color:#D1D5DB;text-decoration:none;padding:0.5rem 0.8rem;font-size:0.85rem;">Staff</a>'
          + '<a href="/dashboard-categories" style="display:block;color:#D1D5DB;text-decoration:none;padding:0.5rem 0.8rem;font-size:0.85rem;">Categories</a>';
        adminWrap.appendChild(adminBtn);
        adminWrap.appendChild(adminMenu);
        adminBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          adminMenu.style.display = adminMenu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', function() { adminMenu.style.display = 'none'; });
        logoutLink.parentNode.insertBefore(adminWrap, logoutLink);
        var currentPath = window.location.pathname;
        adminMenu.querySelectorAll('a').forEach(function(a) {
          if (a.getAttribute('href') === currentPath) {
            a.style.background = '#374151';
            a.style.color = 'white';
          }
        });
      }
    }
  } catch(e) { /* ignore parse errors */ }

  let staffData = null;
  let meetingTypes = [];
  let currentCategory = '';
  let currentSort = localStorage.getItem('tb-mt-sort') || 'category-asc';

  TabuchiAPI.util.showLoading('tb-loading');

  try {
    let staffCache = null;
    try { staffCache = JSON.parse(localStorage.getItem('app_user') || 'null'); } catch(e) {}

    // Use bare fetch (no Content-Type header) to avoid CORS preflight on GET
    async function _bareGet(url) {
      var r = await fetch(url);
      if (!r.ok) throw { status: r.status, error: 'Request failed' };
      return r.json();
    }
    var _wh = 'https://tabuchilaw.app.n8n.cloud/webhook';

    if (staffCache && staffCache.slug) {
      const result = await _bareGet(_wh + '/api/staff?slug=' + encodeURIComponent(staffCache.slug));
      staffData = result.staff;
      meetingTypes = result.meetingTypes || [];
    } else {
      const bookingsResult = await _bareGet(_wh + '/api/dashboard/bookings?scope=upcoming');
      if (bookingsResult.staff) {
        staffData = bookingsResult.staff;
        localStorage.setItem('app_user', JSON.stringify(staffData));
        const result = await _bareGet(_wh + '/api/staff?slug=' + encodeURIComponent(staffData.slug));
        meetingTypes = result.meetingTypes || [];
      }
    }

    // Tag each meeting type with original index for date-created sort
    meetingTypes.forEach(function(mt, i) { mt._origIdx = i; });

    hideEl('tb-loading');
    await populateCategoryDropdown();
    populateCategoryFilter();
    insertSortDropdown();
    renderMeetingTypeList();

    var catFilterEl = $el('tb-mt-category-filter');
    if (catFilterEl) catFilterEl.addEventListener('change', function() {
      currentCategory = this.value;
      renderMeetingTypeList();
    });

  } catch (err) {
    hideEl('tb-loading');
    console.error('[MeetingTypes] Init error:', err, err && err.stack ? err.stack : '');
    if (err.status === 401) { window.location.href = '/login'; return; }
    TabuchiAPI.util.showError('tb-error', (err.error || err.message || 'Unable to load meeting types.') + ' [Debug: ' + JSON.stringify(err).substring(0, 100) + ']');
  }

  var PA_OPTIONS = ['Estate Planning', 'Real Estate', 'Probate', 'Business Law', 'Family Law', 'Immigration', 'Litigation', 'Other'];

  function _injectFormDropdowns() {
    // Find insertion point — before the Buffer After grid (scope to _root for dual-embed safety)
    var searchRoot = _root || document;
    var bufferLabel = searchRoot.querySelector('label[for="tb-mt-buffer-after"]');
    if (!bufferLabel) return;
    var gridParent = bufferLabel.closest('div[style*="grid"]');
    if (!gridParent) return;

    // Inject Practice Area if missing
    if (!$el('tb-mt-practice-area')) {
      var paWrapper = document.createElement('div');
      paWrapper.style.cssText = 'margin-bottom:1rem;';
      paWrapper.innerHTML = '<label for="tb-mt-practice-area" style="display:block;font-size:0.9rem;font-weight:500;margin-bottom:0.3rem;">Practice Area</label>' +
        '<select id="tb-mt-practice-area" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #E5E7EB;border-radius:6px;font-size:0.95rem;box-sizing:border-box;">' +
        '<option value="">\u2014 None \u2014</option>' +
        PA_OPTIONS.map(function(p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('') +
        '</select>';
      gridParent.parentNode.insertBefore(paWrapper, gridParent);
    }

    // Inject Category if missing
    if (!$el('tb-mt-category')) {
      var catWrapper = document.createElement('div');
      catWrapper.style.cssText = 'margin-bottom:1rem;';
      catWrapper.innerHTML = '<label for="tb-mt-category" style="display:block;font-size:0.9rem;font-weight:500;margin-bottom:0.3rem;">Meeting Type Category</label>' +
        '<select id="tb-mt-category" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #E5E7EB;border-radius:6px;font-size:0.95rem;box-sizing:border-box;"><option value="">\u2014 None \u2014</option></select>';
      var paEl = $el('tb-mt-practice-area');
      var paWrap = paEl ? paEl.closest('div[style*="margin-bottom"]') : null;
      var insertBefore = (paWrap && paWrap.nextSibling) ? paWrap.nextSibling : gridParent;
      gridParent.parentNode.insertBefore(catWrapper, insertBefore);
    }
  }

  async function populateCategoryDropdown() {
    _injectFormDropdowns();
    var sel = $el('tb-mt-category');
    if (!sel) return;
    // Fetch categories from the admin API
    var t = localStorage.getItem('app_token') || '';
    var cats = [];
    try {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 5000);
      var resp = await fetch('https://tabuchilaw.app.n8n.cloud/webhook/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Dashboard_Token': t },
        body: JSON.stringify({ action: 'list' }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      var data = await resp.json();
      cats = (data.categories || []).map(function(c) { return typeof c === 'object' ? (c.name || '') : c; }).filter(Boolean);
    } catch (e) {
      // Fallback to localStorage cache
      try {
        var cached = JSON.parse(localStorage.getItem('app_user') || '{}');
        cats = cached.categories || [];
        if (typeof cats === 'string') { try { cats = JSON.parse(cats); } catch (e2) { cats = []; } }
        if (cats.length > 0 && typeof cats[0] === 'object') cats = cats.map(function(c) { return c.name || c; });
      } catch (e2) {}
    }
    sel.innerHTML = '<option value="">\u2014 None \u2014</option>'
      + cats.map(function(c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  }

  function populateCategoryFilter() {
    var filterEl = $el('tb-mt-category-filter');
    if (!filterEl) return;
    var cats = {};
    for (var i = 0; i < meetingTypes.length; i++) {
      var c = (meetingTypes[i].category || '').trim();
      if (c) cats[c] = true;
    }
    var sorted = Object.keys(cats).sort();
    var html = '<option value="">All</option>';
    for (var j = 0; j < sorted.length; j++) {
      html += '<option value="' + esc(sorted[j]) + '"' + (currentCategory === sorted[j] ? ' selected' : '') + '>' + esc(sorted[j]) + '</option>';
    }
    filterEl.innerHTML = html;
  }

  function insertSortDropdown() {
    var catFilter = $el('tb-mt-category-filter');
    if (!catFilter) return;
    var parent = catFilter.parentElement;
    if (!parent || parent.querySelector('#tb-mt-sort-select')) return;
    var sortLabel = document.createElement('label');
    sortLabel.style.cssText = 'font-size:0.85rem;color:#9CA3AF;margin-left:1rem;';
    sortLabel.textContent = 'Sort: ';
    var sortSel = document.createElement('select');
    sortSel.id = 'tb-mt-sort-select';
    sortSel.style.cssText = 'padding:0.4rem;border:1px solid #374151;border-radius:4px;background:#1F2937;color:#D1D5DB;font-size:0.85rem;';
    sortSel.innerHTML = '<option value="category-asc">Service Type</option>'
      + '<option value="name-asc">Name A\u2192Z</option>'
      + '<option value="name-desc">Name Z\u2192A</option>'
      + '<option value="newest">Newest First</option>'
      + '<option value="oldest">Oldest First</option>';
    sortSel.value = currentSort;
    sortSel.addEventListener('change', function() {
      currentSort = this.value;
      localStorage.setItem('tb-mt-sort', currentSort);
      renderMeetingTypeList();
    });
    sortLabel.appendChild(sortSel);
    parent.appendChild(sortLabel);
  }

  function sortMeetingTypes(arr) {
    var sorted = arr.slice();
    switch (currentSort) {
      case 'category-asc':
        sorted.sort(function(a, b) {
          var catA = (a.category || '').trim() || '\uffff';
          var catB = (b.category || '').trim() || '\uffff';
          var c = catA.localeCompare(catB);
          return c !== 0 ? c : (a.name || '').localeCompare(b.name || '');
        });
        break;
      case 'name-asc':
        sorted.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
        break;
      case 'name-desc':
        sorted.sort(function(a, b) { return (b.name || '').localeCompare(a.name || ''); });
        break;
      case 'newest':
        sorted.sort(function(a, b) { return (b._origIdx || 0) - (a._origIdx || 0); });
        break;
      case 'oldest':
        sorted.sort(function(a, b) { return (a._origIdx || 0) - (b._origIdx || 0); });
        break;
    }
    return sorted;
  }

  function renderMeetingTypeList() {
    const container = $el('tb-mt-list');
    if (!container) return;

    // Filter by category
    var filtered = meetingTypes;
    if (currentCategory) {
      filtered = [];
      for (var fi = 0; fi < meetingTypes.length; fi++) {
        if (meetingTypes[fi].category === currentCategory) filtered.push(meetingTypes[fi]);
      }
    }

    // Apply sort within each group
    filtered = sortMeetingTypes(filtered);

    if (filtered.length === 0) {
      container.innerHTML = currentCategory
        ? '<p class="tb-no-slots">No meeting types in the "' + esc(currentCategory) + '" category.</p>'
        : '<p class="tb-no-slots">No meeting types yet. Click "Add Meeting Type" to create one.</p>';
      return;
    }

    // Group by Service Type (category), sorted alphabetically; uncategorized last
    var groups = {};
    var groupOrder = [];
    for (var gi = 0; gi < filtered.length; gi++) {
      var cat = (filtered[gi].category || '').trim() || '__uncategorized__';
      if (!groups[cat]) { groups[cat] = []; groupOrder.push(cat); }
      groups[cat].push(filtered[gi]);
    }
    groupOrder.sort(function(a, b) {
      if (a === '__uncategorized__') return 1;
      if (b === '__uncategorized__') return -1;
      return a.localeCompare(b);
    });

    // SVG chevron templates (larger, more visible)
    var chevronDown = '<svg class="tb-mt-group-chevron" width="20" height="20" viewBox="0 0 20 20" fill="none" style="transition:transform 0.2s;flex-shrink:0;"><path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var chevronRight = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var chevronDownSm = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    // Expand / Collapse All toggle
    let html = '<div style="margin-bottom:0.75rem;text-align:right;">'
      + '<a href="#" id="tb-mt-toggle-all" style="font-size:0.85rem;color:var(--tb-accent);text-decoration:none;font-weight:500;">Expand All</a></div>';

    for (var gk = 0; gk < groupOrder.length; gk++) {
      var groupName = groupOrder[gk];
      var groupLabel = groupName === '__uncategorized__' ? 'Uncategorized' : groupName;
      var groupItems = groups[groupName];

      // Service Type section header (collapsible)
      html += '<div class="tb-mt-service-group" data-group="' + esc(groupName) + '">';
      html += '<div class="tb-mt-group-header" style="cursor:pointer;display:flex;align-items:center;gap:0.6rem;padding:0.75rem 1rem;background:var(--tb-bg-light, #F9FAFB);border:1px solid var(--tb-border, #E5E7EB);border-radius:var(--tb-radius, 8px);margin-bottom:0;margin-top:' + (gk > 0 ? '0.75rem' : '0') + ';transition:background 0.15s;">';
      html += '<span style="color:var(--tb-text-light, #6B7280);display:flex;">' + chevronDown + '</span>';
      html += '<span style="font-weight:600;font-size:1rem;color:var(--tb-text, #1F2937);flex:1;">' + esc(groupLabel) + '</span>';
      html += '<span style="font-size:0.8rem;color:var(--tb-text-light, #6B7280);background:white;padding:0.15rem 0.6rem;border-radius:12px;border:1px solid var(--tb-border, #E5E7EB);">' + groupItems.length + ' type' + (groupItems.length !== 1 ? 's' : '') + '</span>';
      html += '</div>';
      html += '<div class="tb-mt-group-body" style="border-left:2px solid var(--tb-border, #E5E7EB);margin-left:0.6rem;padding-left:0.9rem;margin-top:0.5rem;">';

      for (var mi = 0; mi < groupItems.length; mi++) {
        var mt = groupItems[mi];
        var colorDot = mt.color && /^#[0-9A-Fa-f]{3,8}$/.test(mt.color) ? '<span style="width:10px;height:10px;border-radius:50%;background:' + mt.color + ';flex-shrink:0;"></span>' : '';
        var statusBadge = mt.active !== false
          ? '<span class="tb-status-badge tb-status-confirmed">Active</span>'
          : '<span class="tb-status-badge tb-status-cancelled">Inactive</span>';
        var bookingUrl = staffData ? window.location.origin + '/book?staff=' + staffData.slug + '&type=' + mt.slug : '';

        html += '<div class="tb-dash-card" style="margin-bottom:0.5rem;padding:0;overflow:hidden;">'
          // ── Header row ──
          + '<div class="tb-meeting-card-header tb-mt-card-toggle" style="cursor:pointer;padding:1rem 1.25rem;" data-mt-id="' + esc(mt.id) + '">'
          + '<div style="display:flex;align-items:center;gap:0.5rem;flex:1;min-width:0;">'
          + '<span class="tb-mt-chevron" style="color:var(--tb-text-light, #6B7280);display:flex;">' + chevronRight + '</span>'
          + colorDot
          + '<h3 class="tb-meeting-card-name" style="margin:0;font-size:1rem;">' + esc(mt.name) + '</h3>'
          + '<span class="tb-meeting-card-duration">' + esc(String(mt.duration)) + ' min</span>'
          + statusBadge + '</div>'
          + '<div style="display:flex;gap:0.5rem;flex-shrink:0;" onclick="event.stopPropagation();">'
          + '<button class="tb-btn tb-btn-secondary tb-mt-edit-btn" data-id="' + esc(mt.id) + '" style="padding:0.35rem 0.75rem;font-size:0.8rem;font-weight:500;">Edit</button>'
          + '<button class="tb-btn tb-mt-delete-btn" data-id="' + esc(mt.id) + '" data-name="' + esc(mt.name) + '" style="padding:0.35rem 0.75rem;font-size:0.8rem;font-weight:500;background:none;color:var(--tb-error, #DC2626);border:1px solid var(--tb-border, #E5E7EB);">Delete</button>'
          + '</div></div>'
          // ── Body (collapsed by default) ──
          + '<div class="tb-mt-card-body" style="display:none;padding:0 1.25rem 1rem;border-top:1px solid var(--tb-border, #E5E7EB);">'
          + '<p class="tb-meeting-card-desc" style="margin:0.75rem 0 0.5rem;">' + esc(mt.description || 'No description') + '</p>'
          + '<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;color:var(--tb-text-light, #6B7280);">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'
          + '<span>' + esc(mt.location || 'Teams Video Call') + '</span>'
          + '</div>'
          + (bookingUrl ? '<div style="background:var(--tb-accent-light, #EFF6FF);border:1px solid #DBEAFE;border-radius:var(--tb-radius, 8px);padding:0.75rem 1rem;margin-top:0.75rem;">'
          + '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem;">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tb-accent, #2563EB)" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>'
          + '<span style="font-size:0.8rem;font-weight:600;color:var(--tb-accent, #2563EB);">Client Booking Link</span></div>'
          + '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">'
          + '<code style="font-size:0.75rem;color:var(--tb-text, #374151);word-break:break-all;flex:1;background:white;padding:0.3rem 0.5rem;border-radius:4px;border:1px solid var(--tb-border, #E5E7EB);">' + esc(bookingUrl) + '</code>'
          + '<button class="tb-btn tb-btn-secondary tb-copy-link-btn" data-url="' + esc(bookingUrl) + '" style="padding:0.3rem 0.7rem;font-size:0.75rem;white-space:nowrap;">Copy</button>'
          + '<button class="tb-btn tb-btn-secondary tb-preview-link-btn" data-url="' + esc(bookingUrl) + '" style="padding:0.3rem 0.7rem;font-size:0.75rem;white-space:nowrap;">Preview</button>'
          + '</div></div>' : '')
          + '</div>'
          + '</div>';
      }

      html += '</div></div>'; // close group body + group wrapper
    }

    container.innerHTML = html;

    // Wire edit buttons
    container.querySelectorAll('.tb-mt-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { openEditForm(btn.dataset.id); });
    });

    // Wire delete buttons
    container.querySelectorAll('.tb-mt-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { handleDeleteMeetingType(btn.dataset.id, btn.dataset.name); });
    });

    // Wire copy-link buttons
    container.querySelectorAll('.tb-copy-link-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var url = btn.dataset.url;
        var original = btn.textContent;
        function showCopied() {
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = original; }, 2000);
        }
        function fallbackCopy() {
          var ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showCopied();
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(showCopied).catch(fallbackCopy);
        } else {
          fallbackCopy();
        }
      });
    });

    // Wire preview buttons (open booking page in new tab)
    container.querySelectorAll('.tb-preview-link-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { window.open(btn.dataset.url, '_blank'); });
    });

    // Wire collapsible card toggles (individual meeting types)
    container.querySelectorAll('.tb-mt-card-toggle').forEach(function(hdr) {
      hdr.addEventListener('click', function() {
        var card = hdr.closest('.tb-dash-card');
        var body = card.querySelector('.tb-mt-card-body');
        var chevron = hdr.querySelector('.tb-mt-chevron');
        var open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (chevron) {
          var svg = chevron.querySelector('svg');
          if (svg) svg.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
        }
      });
    });

    // Wire collapsible Service Type group headers
    container.querySelectorAll('.tb-mt-group-header').forEach(function(hdr) {
      hdr.addEventListener('click', function() {
        var group = hdr.closest('.tb-mt-service-group');
        var body = group.querySelector('.tb-mt-group-body');
        var chevron = hdr.querySelector('.tb-mt-group-chevron');
        var open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (chevron) chevron.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    });

    // Wire Expand All / Collapse All
    var toggleAllLink = container.querySelector('#tb-mt-toggle-all');
    if (toggleAllLink) {
      toggleAllLink.addEventListener('click', function(e) {
        e.preventDefault();
        var expanding = toggleAllLink.textContent === 'Expand All';
        container.querySelectorAll('.tb-mt-group-body').forEach(function(body) {
          body.style.display = expanding ? '' : 'none';
        });
        container.querySelectorAll('.tb-mt-group-chevron').forEach(function(chev) {
          chev.style.transform = expanding ? 'rotate(0deg)' : 'rotate(-90deg)';
        });
        container.querySelectorAll('.tb-mt-card-body').forEach(function(body) {
          body.style.display = expanding ? '' : 'none';
        });
        container.querySelectorAll('.tb-mt-chevron svg').forEach(function(svg) {
          svg.style.transform = expanding ? 'rotate(90deg)' : 'rotate(0deg)';
        });
        toggleAllLink.textContent = expanding ? 'Collapse All' : 'Expand All';
      });
    }
  }

  // ─── Delete Meeting Type ──────────────────────────────────
  async function handleDeleteMeetingType(mtId, mtName) {
    if (!confirm('Delete "' + mtName + '"? This cannot be undone.')) return;
    try {
      await TabuchiAPI.dashboard.deleteMeetingType(mtId);
      // Close modal if open
      hideEl('tb-mt-form-modal');
      // Refresh list
      if (staffData) {
        var updated = await TabuchiAPI.getStaff(staffData.slug);
        meetingTypes = updated.meetingTypes || [];
        meetingTypes.forEach(function(mt, i) { mt._origIdx = i; });
        populateCategoryFilter();
        renderMeetingTypeList();
      }
    } catch (err) {
      alert('Failed to delete: ' + (err.error || 'Unknown error'));
    }
  }

  $el('tb-mt-add-btn')?.addEventListener('click', function() { openCreateForm(); });

  function openCreateForm() {
    setText('tb-mt-form-title', 'Create Meeting Type');
    var form = $el('tb-mt-form');
    if (form) form.reset();
    setVal('tb-mt-id', '');
    setVal('tb-mt-duration', '30');
    setVal('tb-mt-location', 'Teams Video Call');
    setVal('tb-mt-buffer-after', '0');
    setVal('tb-mt-max-per-day', '0');
    setVal('tb-mt-slot-interval', '30');
    setVal('tb-mt-category', '');
    setVal('tb-mt-practice-area', '');
    setVal('tb-mt-required-witnesses', '0');
    updateWitnessState('Teams Video Call');
    setVal('tb-mt-time-block', '0');
    var tbVal = $el('tb-mt-time-block-val');
    if (tbVal) tbVal.textContent = '0%';
    setChecked('tb-mt-avail-recurring', true);
    renderAvailGrid(null);
    setChecked('tb-mt-active', true);
    hideEl('tb-mt-form-error');
    var blWrap = $el('tb-mt-booking-link-wrap');
    if (blWrap) blWrap.style.display = 'none';
    // Hide modal delete button for create
    var modalDelBtn = $el('tb-mt-modal-delete-btn');
    if (modalDelBtn) modalDelBtn.style.display = 'none';
    loadReminderOptions().then(function() { renderReminderPicker({}); });
    showEl('tb-mt-form-modal');
  }

  function openEditForm(mtId) {
    var mt = meetingTypes.find(function(m) { return m.id === mtId; });
    if (!mt) return;

    setText('tb-mt-form-title', 'Edit Meeting Type');
    setVal('tb-mt-id', mt.id);
    setVal('tb-mt-name', mt.name);
    setVal('tb-mt-category', mt.category || '');
    setVal('tb-mt-practice-area', mt.practice_area || mt.practiceArea || '');
    setVal('tb-mt-duration', mt.duration || 30);
    setVal('tb-mt-description', mt.description || '');
    setVal('tb-mt-location', mt.location || 'Teams Video Call');
    setVal('tb-mt-color', mt.color || '#2563EB');
    setVal('tb-mt-buffer-after', mt.bufferAfter || 0);
    setVal('tb-mt-confirmation-message', mt.confirmationMessage || '');
    setVal('tb-mt-max-per-day', mt.maxPerDay || 0);
    setVal('tb-mt-slot-interval', mt.slotInterval || 30);
    setVal('tb-mt-required-witnesses', mt.requiredWitnesses || 0);
    updateWitnessState(mt.location || 'Teams Video Call');
    setVal('tb-mt-time-block', mt.timeBlockPercent || 0);
    var tbVal = $el('tb-mt-time-block-val');
    if (tbVal) tbVal.textContent = (mt.timeBlockPercent || 0) + '%';

    // Custom availability
    var cavData = null;
    try { cavData = mt.customAvailability ? (typeof mt.customAvailability === 'string' ? JSON.parse(mt.customAvailability) : mt.customAvailability) : null; } catch(e) {}
    setChecked('tb-mt-avail-recurring', cavData ? cavData.recurring !== false : true);
    if (cavData && cavData.enabled && cavData.schedule) renderAvailGrid(cavData.schedule);
    else renderAvailGrid(null);

    setChecked('tb-mt-active', mt.active !== false);

    // Load reminder picker with existing config
    var reminderCfg = migrateReminderConfig(mt);
    loadReminderOptions().then(function() { renderReminderPicker(reminderCfg); });

    hideEl('tb-mt-form-error');

    // Show modal delete button for edit mode
    var modalDelBtn = $el('tb-mt-modal-delete-btn');
    if (!modalDelBtn) {
      // Create the delete button once and inject into modal footer
      var saveBtn = $el('tb-mt-save-btn');
      if (saveBtn) {
        modalDelBtn = document.createElement('button');
        modalDelBtn.type = 'button';
        modalDelBtn.id = 'tb-mt-modal-delete-btn';
        modalDelBtn.className = 'tb-btn tb-btn-danger';
        modalDelBtn.style.cssText = 'margin-right:auto;padding:0.5rem 1rem;font-size:0.85rem;';
        modalDelBtn.textContent = 'Delete';
        saveBtn.parentElement.insertBefore(modalDelBtn, saveBtn.parentElement.firstChild);
      }
    }
    if (modalDelBtn) {
      modalDelBtn.style.display = '';
      modalDelBtn.onclick = function() { handleDeleteMeetingType(mt.id, mt.name); };
    }

    var bookingLink = $el('tb-mt-booking-link');
    var bookingLinkWrap = $el('tb-mt-booking-link-wrap');
    if (bookingLink && staffData) {
      var bUrl = window.location.origin + '/book?staff=' + staffData.slug + '&type=' + mt.slug;
      bookingLink.textContent = bUrl;
      bookingLink.href = '/book?staff=' + staffData.slug + '&type=' + mt.slug;
      if (bookingLinkWrap) bookingLinkWrap.style.display = 'flex';
    }

    showEl('tb-mt-form-modal');
  }

  $el('tb-mt-cancel-btn')?.addEventListener('click', function() { hideEl('tb-mt-form-modal'); });

  $el('tb-mt-copy-link-btn')?.addEventListener('click', function() {
    var link = $el('tb-mt-booking-link');
    if (!link) return;
    var url = link.textContent;
    var btn = $el('tb-mt-copy-link-btn');
    var orig = btn.innerHTML;
    function showCopied() {
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.innerHTML = orig; }, 2000);
    }
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopied();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(showCopied).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  });

  $el('tb-mt-preview-link-btn')?.addEventListener('click', function() {
    var link = $el('tb-mt-booking-link');
    if (link && link.textContent) window.open(link.textContent, '_blank');
  });

  $el('tb-mt-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();

    var btn = $el('tb-mt-save-btn');
    var errorEl = $el('tb-mt-form-error');
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
    if (errorEl) errorEl.style.display = 'none';

    var mtId = getVal('tb-mt-id');
    var data = {
      name: getVal('tb-mt-name'),
      category: getVal('tb-mt-category'),
      practice_area: getVal('tb-mt-practice-area'),
      duration: parseInt(getVal('tb-mt-duration')) || 30,
      description: getVal('tb-mt-description'),
      location: getVal('tb-mt-location'),
      color: getVal('tb-mt-color'),
      bufferAfter: parseInt(getVal('tb-mt-buffer-after')) || 0,
      confirmationMessage: getVal('tb-mt-confirmation-message'),
      reminderConfig: JSON.stringify(collectReminderConfig()),
      maxPerDay: parseInt(getVal('tb-mt-max-per-day')) || 0,
      requiredWitnesses: parseInt(getVal('tb-mt-required-witnesses')) || 0,
      slotInterval: parseInt(getVal('tb-mt-slot-interval')) || 30,
      timeBlockPercent: parseInt(getVal('tb-mt-time-block')) || 0,
      customAvailability: JSON.stringify(collectCustomAvailability()),
      active: isChecked('tb-mt-active')
    };

    if (mtId) data.id = mtId;

    try {
      await TabuchiAPI.dashboard.saveMeetingType(data);
      hideEl('tb-mt-form-modal');
      if (btn) { btn.textContent = 'Save'; btn.disabled = false; }

      if (staffData) {
        var updated = await TabuchiAPI.getStaff(staffData.slug);
        meetingTypes = updated.meetingTypes || [];
        meetingTypes.forEach(function(mt, i) { mt._origIdx = i; });
        populateCategoryFilter();
        renderMeetingTypeList();
      }
    } catch (err) {
      if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
      if (errorEl) { errorEl.textContent = err.error || 'Unable to save meeting type.'; errorEl.style.display = ''; }
    }
  });

  // ─── Witness Field State ─────────────────────────────────
  function updateWitnessState(location) {
    var witnessInput = $el('tb-mt-required-witnesses');
    var isInOffice = location === 'In-Office';
    if (witnessInput) {
      witnessInput.disabled = !isInOffice;
      witnessInput.style.opacity = isInOffice ? '1' : '0.5';
      witnessInput.style.cursor = isInOffice ? '' : 'not-allowed';
      if (!isInOffice) witnessInput.value = '0';
    }
  }

  $el('tb-mt-location')?.addEventListener('change', function() {
    updateWitnessState(this.value);
  });

  // ─── Time Block Slider ─────────────────────────────────
  $el('tb-mt-time-block')?.addEventListener('input', function() {
    var label = $el('tb-mt-time-block-val');
    if (label) label.textContent = this.value + '%';
    applyTimeBlockPreview();
  });

  // ─── Custom Availability Calendar ─────────────────────────────────
  var _availSchedule = {};
  var _availDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var _availSlots = [];

  function buildTimeSlots() {
    _availSlots = [];
    var startH = 8, endH = 18;
    if (staffData) {
      var sh = staffData.workingHoursStart || '09:00';
      var eh = staffData.workingHoursEnd || '17:00';
      startH = parseInt(sh.split(':')[0]) || 8;
      endH = parseInt(eh.split(':')[0]) || 18;
    }
    for (var h = startH; h < endH; h++) {
      _availSlots.push(('0'+h).slice(-2) + ':00');
      _availSlots.push(('0'+h).slice(-2) + ':30');
    }
  }

  function renderAvailGrid(schedule) {
    buildTimeSlots();
    // Always show all 7 days; mark non-working days as blocked by default
    _availDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    // Initialize schedule: working days available, weekends blocked
    _availSchedule = {};
    var workingDays = (staffData && staffData.workingDays) || ['Mon','Tue','Wed','Thu','Fri'];
    _availDays.forEach(function(d) {
      _availSchedule[d] = {};
      var isWorkDay = workingDays.indexOf(d) !== -1;
      _availSlots.forEach(function(s) { _availSchedule[d][s] = isWorkDay; });
    });
    // Apply saved schedule
    if (schedule) {
      _availDays.forEach(function(d) {
        if (!schedule[d]) { _availSlots.forEach(function(s) { _availSchedule[d][s] = false; }); return; }
        var ranges = schedule[d];
        _availSlots.forEach(function(s) {
          var inRange = ranges.some(function(r) { return s >= r.start && s < r.end; });
          _availSchedule[d][s] = inRange;
        });
      });
    }
    drawGrid();
  }

  function drawGrid() {
    var container = $el('tb-mt-avail-grid');
    if (!container) return;
    var html = '<table style="border-collapse:collapse;font-size:0.75rem;width:100%;"><thead><tr><th style="padding:4px 6px;text-align:left;border:1px solid #E5E7EB;background:#F9FAFB;"></th>';
    _availDays.forEach(function(d) {
      var isWeekend = d === 'Sat' || d === 'Sun';
      html += '<th style="padding:4px 8px;text-align:center;border:1px solid #E5E7EB;background:' + (isWeekend ? '#FEF3C7' : '#F9FAFB') + ';font-weight:600;' + (isWeekend ? 'font-style:italic;' : '') + '">' + d + '</th>';
    });
    html += '</tr></thead><tbody>';
    _availSlots.forEach(function(slot) {
      html += '<tr><td style="padding:2px 6px;border:1px solid #E5E7EB;font-size:0.7rem;color:#6B7280;white-space:nowrap;">' + slot + '</td>';
      _availDays.forEach(function(d) {
        var on = _availSchedule[d] && _availSchedule[d][slot];
        html += '<td data-day="' + d + '" data-slot="' + slot + '" style="padding:0;border:1px solid #E5E7EB;cursor:pointer;background:' + (on ? '#BBF7D0' : '#F3F4F6') + ';width:60px;height:22px;" title="' + d + ' ' + slot + '"></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
    container.querySelectorAll('td[data-day]').forEach(function(cell) {
      cell.addEventListener('click', function() {
        var d = cell.dataset.day, s = cell.dataset.slot;
        _availSchedule[d][s] = !_availSchedule[d][s];
        applyTimeBlockPreview();
      });
    });
    applyTimeBlockPreview();
  }

  function applyTimeBlockPreview() {
    var pct = parseInt(getVal('tb-mt-time-block')) || 0;
    var container = $el('tb-mt-avail-grid');
    if (!container) return;
    container.querySelectorAll('td[data-day]').forEach(function(cell) {
      var d = cell.dataset.day, s = cell.dataset.slot;
      var isAvailable = _availSchedule[d] && _availSchedule[d][s];
      if (!isAvailable) {
        cell.style.background = '#F3F4F6';
        cell.dataset.autoBlocked = '';
      } else if (pct > 0 && isAutoBlocked(d, s, pct)) {
        cell.style.background = '#FDE68A';
        cell.dataset.autoBlocked = '1';
      } else {
        cell.style.background = '#BBF7D0';
        cell.dataset.autoBlocked = '';
      }
    });
  }

  function isAutoBlocked(day, slot, pct) {
    var str = day + '-' + slot;
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    var normalized = Math.abs(hash) % 100;
    return normalized < pct;
  }

  function collectCustomAvailability() {
    var schedule = {};
    _availDays.forEach(function(d) {
      var ranges = [], inRange = false, start = '';
      _availSlots.forEach(function(s, i) {
        if (_availSchedule[d] && _availSchedule[d][s]) {
          if (!inRange) { start = s; inRange = true; }
        } else {
          if (inRange) { ranges.push({start: start, end: s}); inRange = false; }
        }
      });
      if (inRange) {
        var lastSlot = _availSlots[_availSlots.length - 1];
        var endH = parseInt(lastSlot.split(':')[0]); var endM = parseInt(lastSlot.split(':')[1]) + 30;
        if (endM >= 60) { endH++; endM = 0; }
        ranges.push({start: start, end: ('0'+endH).slice(-2) + ':' + ('0'+endM).slice(-2)});
      }
      schedule[d] = ranges;
    });
    return {enabled: true, recurring: isChecked('tb-mt-avail-recurring'), schedule: schedule};
  }

  // ─── Reminder Default Templates ─────────────────────────────────
  function defaultReminderTemplate(channel) {
    var staffName = (staffData && staffData.name) || '{{staffName}}';
    if (channel === 'sms') {
      return 'Reminder: Your {{meetingTypeName}} with ' + staffName + ' is on {{date}} at {{time}}. To reschedule: {{rescheduleUrl}} To cancel: {{cancelUrl}}';
    }
    return '<p>Hi {{clientName}},</p><p>This is a friendly reminder about your upcoming <b>{{meetingTypeName}}</b> with ' + staffName + ' on <b>{{date}}</b> at <b>{{time}}</b>.</p><p>If you need to make changes:</p><ul><li><a href="{{rescheduleUrl}}">Reschedule your appointment</a></li><li><a href="{{cancelUrl}}">Cancel your appointment</a></li></ul><p>We look forward to seeing you!</p>';
  }

  function stripHtml(html) {
    try {
      var doc = new DOMParser().parseFromString(html || '', 'text/html');
      return (doc.body.textContent || '').trim();
    } catch (e) {
      return String(html || '').replace(/<[^>]*>/g, '').trim();
    }
  }

  // ─── Reminder Picker (Template / Drip Campaign selection) ───
  var _reminderTemplatesCache = { email: [], sms: [] };
  var _reminderCampaignsCache = [];
  var _reminderPickerLoaded = false;

  async function loadReminderOptions() {
    if (_reminderPickerLoaded) return;
    _reminderPickerLoaded = true;
    var webhookBase = 'https://tabuchilaw.app.n8n.cloud/webhook';
    try {
      var [tplRes, campRes] = await Promise.all([
        fetch(webhookBase + '/cc/campaign-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Dashboard_Token': token },
          body: JSON.stringify({ action: 'list' })
        }).then(function(r) { return r.json(); }),
        fetch(webhookBase + '/cc/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Dashboard_Token': token },
          body: JSON.stringify({ action: 'list' })
        }).then(function(r) { return r.json(); })
      ]);
      var templates = (tplRes.success ? tplRes.templates : []) || [];
      _reminderTemplatesCache.email = templates.filter(function(t) { return t.category === 'Confirmation - Email'; });
      _reminderTemplatesCache.sms = templates.filter(function(t) { return t.category === 'Confirmation - SMS'; });
      // Only show drip-type campaigns
      _reminderCampaignsCache = ((campRes.success ? campRes.campaigns : []) || []).filter(function(c) { return c.type === 'drip'; });
    } catch (e) {
      console.warn('Failed to load reminder options:', e);
    }
  }

  function renderReminderPicker(config) {
    var container = $el('tb-mt-reminders-list');
    if (!container) return;

    // config format: { email: { type: 'template'|'drip', id: 'recXXX' }, sms: { type: 'template'|'drip', id: 'recXXX' } }
    config = config || {};
    var emailCfg = config.email || { type: 'none', id: '' };
    var smsCfg = config.sms || { type: 'none', id: '' };

    var html = '';

    // Email reminder picker
    html += '<div class="tb-reminder-channel-section" style="margin-bottom:1rem;padding:0.75rem;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;">';
    html += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">Email Reminders</div>';
    html += '<div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;">';
    html += '<label style="font-size:0.85rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem;">';
    html += '<input type="radio" name="tb-mt-email-reminder-type" value="none"' + (emailCfg.type === 'none' ? ' checked' : '') + '> None';
    html += '</label>';
    html += '<label style="font-size:0.85rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem;">';
    html += '<input type="radio" name="tb-mt-email-reminder-type" value="template"' + (emailCfg.type === 'template' ? ' checked' : '') + '> Template';
    html += '</label>';
    html += '<label style="font-size:0.85rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem;">';
    html += '<input type="radio" name="tb-mt-email-reminder-type" value="drip"' + (emailCfg.type === 'drip' ? ' checked' : '') + '> Drip Campaign';
    html += '</label>';
    html += '</div>';
    // Template dropdown
    html += '<div id="tb-mt-email-tpl-picker" style="' + (emailCfg.type === 'template' ? '' : 'display:none;') + '">';
    html += '<select id="tb-mt-email-tpl-select" style="width:100%;padding:0.4rem;border:1px solid #E5E7EB;border-radius:4px;font-size:0.85rem;">';
    html += '<option value="">— Select a template —</option>';
    _reminderTemplatesCache.email.forEach(function(t) {
      html += '<option value="' + esc(t.id) + '"' + (emailCfg.id === t.id ? ' selected' : '') + '>' + esc(t.name || 'Untitled') + '</option>';
    });
    html += '</select>';
    if (_reminderTemplatesCache.email.length === 0) html += '<div style="font-size:0.75rem;color:#9CA3AF;margin-top:4px;">No Confirmation - Email templates found. <a href="/crm/campaign-templates" target="_blank" style="color:#2563EB;">Create one</a></div>';
    html += '</div>';
    // Drip dropdown
    html += '<div id="tb-mt-email-drip-picker" style="' + (emailCfg.type === 'drip' ? '' : 'display:none;') + '">';
    html += '<select id="tb-mt-email-drip-select" style="width:100%;padding:0.4rem;border:1px solid #E5E7EB;border-radius:4px;font-size:0.85rem;">';
    html += '<option value="">— Select a drip campaign —</option>';
    _reminderCampaignsCache.forEach(function(c) {
      html += '<option value="' + esc(c.id) + '"' + (emailCfg.id === c.id ? ' selected' : '') + '>' + esc(c.name || 'Untitled') + '</option>';
    });
    html += '</select>';
    if (_reminderCampaignsCache.length === 0) html += '<div style="font-size:0.75rem;color:#9CA3AF;margin-top:4px;">No drip campaigns found. <a href="/crm/campaigns" target="_blank" style="color:#2563EB;">Create one</a></div>';
    html += '</div>';
    html += '</div>';

    // SMS reminder picker
    html += '<div class="tb-reminder-channel-section" style="padding:0.75rem;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;">';
    html += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">SMS Reminders</div>';
    html += '<div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;">';
    html += '<label style="font-size:0.85rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem;">';
    html += '<input type="radio" name="tb-mt-sms-reminder-type" value="none"' + (smsCfg.type === 'none' ? ' checked' : '') + '> None';
    html += '</label>';
    html += '<label style="font-size:0.85rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem;">';
    html += '<input type="radio" name="tb-mt-sms-reminder-type" value="template"' + (smsCfg.type === 'template' ? ' checked' : '') + '> Template';
    html += '</label>';
    html += '<label style="font-size:0.85rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem;">';
    html += '<input type="radio" name="tb-mt-sms-reminder-type" value="drip"' + (smsCfg.type === 'drip' ? ' checked' : '') + '> Drip Campaign';
    html += '</label>';
    html += '</div>';
    // Template dropdown
    html += '<div id="tb-mt-sms-tpl-picker" style="' + (smsCfg.type === 'template' ? '' : 'display:none;') + '">';
    html += '<select id="tb-mt-sms-tpl-select" style="width:100%;padding:0.4rem;border:1px solid #E5E7EB;border-radius:4px;font-size:0.85rem;">';
    html += '<option value="">— Select a template —</option>';
    _reminderTemplatesCache.sms.forEach(function(t) {
      html += '<option value="' + esc(t.id) + '"' + (smsCfg.id === t.id ? ' selected' : '') + '>' + esc(t.name || 'Untitled') + '</option>';
    });
    html += '</select>';
    if (_reminderTemplatesCache.sms.length === 0) html += '<div style="font-size:0.75rem;color:#9CA3AF;margin-top:4px;">No Confirmation - SMS templates found. <a href="/crm/campaign-templates" target="_blank" style="color:#2563EB;">Create one</a></div>';
    html += '</div>';
    // Drip dropdown
    html += '<div id="tb-mt-sms-drip-picker" style="' + (smsCfg.type === 'drip' ? '' : 'display:none;') + '">';
    html += '<select id="tb-mt-sms-drip-select" style="width:100%;padding:0.4rem;border:1px solid #E5E7EB;border-radius:4px;font-size:0.85rem;">';
    html += '<option value="">— Select a drip campaign —</option>';
    _reminderCampaignsCache.forEach(function(c) {
      html += '<option value="' + esc(c.id) + '"' + (smsCfg.id === c.id ? ' selected' : '') + '>' + esc(c.name || 'Untitled') + '</option>';
    });
    html += '</select>';
    if (_reminderCampaignsCache.length === 0) html += '<div style="font-size:0.75rem;color:#9CA3AF;margin-top:4px;">No drip campaigns found. <a href="/crm/campaigns" target="_blank" style="color:#2563EB;">Create one</a></div>';
    html += '</div>';
    html += '</div>';

    container.innerHTML = html;
    bindReminderPickerEvents();
  }

  function bindReminderPickerEvents() {
    // Email type toggle
    var emailRadios = _root.querySelectorAll('input[name="tb-mt-email-reminder-type"]');
    emailRadios.forEach(function(r) {
      r.addEventListener('change', function() {
        var tplPicker = $el('tb-mt-email-tpl-picker');
        var dripPicker = $el('tb-mt-email-drip-picker');
        if (tplPicker) tplPicker.style.display = r.value === 'template' ? '' : 'none';
        if (dripPicker) dripPicker.style.display = r.value === 'drip' ? '' : 'none';
      });
    });
    // SMS type toggle
    var smsRadios = _root.querySelectorAll('input[name="tb-mt-sms-reminder-type"]');
    smsRadios.forEach(function(r) {
      r.addEventListener('change', function() {
        var tplPicker = $el('tb-mt-sms-tpl-picker');
        var dripPicker = $el('tb-mt-sms-drip-picker');
        if (tplPicker) tplPicker.style.display = r.value === 'template' ? '' : 'none';
        if (dripPicker) dripPicker.style.display = r.value === 'drip' ? '' : 'none';
      });
    });
  }

  function collectReminderConfig() {
    var config = {};
    // Email
    var emailType = (_root.querySelector('input[name="tb-mt-email-reminder-type"]:checked') || {}).value || 'none';
    if (emailType === 'template') {
      var emailTplId = (($el('tb-mt-email-tpl-select') || {}).value) || '';
      if (emailTplId) config.email = { type: 'template', id: emailTplId };
    } else if (emailType === 'drip') {
      var emailDripId = (($el('tb-mt-email-drip-select') || {}).value) || '';
      if (emailDripId) config.email = { type: 'drip', id: emailDripId };
    }
    // SMS
    var smsType = (_root.querySelector('input[name="tb-mt-sms-reminder-type"]:checked') || {}).value || 'none';
    if (smsType === 'template') {
      var smsTplId = (($el('tb-mt-sms-tpl-select') || {}).value) || '';
      if (smsTplId) config.sms = { type: 'template', id: smsTplId };
    } else if (smsType === 'drip') {
      var smsDripId = (($el('tb-mt-sms-drip-select') || {}).value) || '';
      if (smsDripId) config.sms = { type: 'drip', id: smsDripId };
    }
    return config;
  }

  // Migrate legacy reminder format to new config format
  function migrateReminderConfig(mt) {
    // New format: { email: { type, id }, sms: { type, id } }
    if (mt.reminderConfig) {
      try {
        var rc = typeof mt.reminderConfig === 'string' ? JSON.parse(mt.reminderConfig) : mt.reminderConfig;
        // Already in new format
        if (rc.email || rc.sms) return rc;
        // Legacy array format — no template IDs, just inline content — show as "none"
      } catch(e) {}
    }
    return {};
  }

  function setText(id, t) { var el = $el(id); if (el) el.textContent = t || ''; }
  function setVal(id, v) { var el = $el(id); if (el) el.value = v ?? ''; }
  function getVal(id) { var el = $el(id); return el ? el.value : ''; }
  function setChecked(id, v) { var el = $el(id); if (el) el.checked = !!v; }
  function isChecked(id) { var el = $el(id); return el ? el.checked : false; }
  function showEl(id) { var el = $el(id); if (el) el.style.display = ''; }
  function hideEl(id) { var el = $el(id); if (el) el.style.display = 'none'; }
})();
