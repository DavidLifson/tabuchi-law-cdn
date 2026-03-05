/**
 * Tabuchi Law Booking System - Dashboard Meeting Types Manager
 * Handles: /dashboard-meeting-types
 *
 * Requires: api-client.js loaded first, Quill.js 1.3.7 (CDN) for email reminder editor
 *
 * Page element IDs:
 * - #tb-mt-list (container for meeting type cards)
 * - #tb-mt-add-btn (button to open create form)
 * - #tb-mt-form-modal (form modal/panel)
 * - #tb-mt-form (the form element)
 * - #tb-mt-form-title (modal title - "Create" or "Edit")
 * - #tb-mt-id (hidden input for record ID, empty for create)
 * - #tb-mt-name, #tb-mt-duration, #tb-mt-description
 * - #tb-mt-location, #tb-mt-color, #tb-mt-active
 * - #tb-mt-buffer-after
 * - #tb-mt-slot-interval (Time Between Meetings)
 * - #tb-mt-required-witnesses (greyed out unless In-Office)
 * - #tb-mt-time-block (range slider %), #tb-mt-time-block-val (label)
 * - #tb-mt-custom-avail-toggle, #tb-mt-custom-avail-panel, #tb-mt-avail-grid
 * - #tb-mt-confirmation-message
 * - #tb-mt-reminders-list (rich text reminder rows container)
 * - #tb-mt-add-reminder-btn
 * - #tb-mt-max-per-day
 * - #tb-mt-save-btn, #tb-mt-cancel-btn
 * - #tb-mt-form-error
 * - #tb-loading, #tb-error
 * - #tb-mt-booking-link (displays public booking URL)
 */

(async function MeetingTypesPage() {
  'use strict';

  const _root = document.querySelector('#tb-page-root');
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
  let currentSort = localStorage.getItem('tb-mt-sort') || 'name-asc';

  TabuchiAPI.util.showLoading('tb-loading');

  try {
    let staffCache = null;
    try { staffCache = JSON.parse(localStorage.getItem('app_user') || 'null'); } catch(e) {}

    if (staffCache && staffCache.slug) {
      const result = await TabuchiAPI.getStaff(staffCache.slug);
      staffData = result.staff;
      meetingTypes = result.meetingTypes || [];
    } else {
      const bookingsResult = await TabuchiAPI.dashboard.getBookings('upcoming');
      if (bookingsResult.staff) {
        staffData = bookingsResult.staff;
        localStorage.setItem('app_user', JSON.stringify(staffData));
        const result = await TabuchiAPI.getStaff(staffData.slug);
        meetingTypes = result.meetingTypes || [];
      }
    }

    // Tag each meeting type with original index for date-created sort
    meetingTypes.forEach(function(mt, i) { mt._origIdx = i; });

    hideEl('tb-loading');
    populateCategoryDropdown();
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
    if (err.status === 401) { window.location.href = '/login'; return; }
    TabuchiAPI.util.showError('tb-error', err.error || 'Unable to load meeting types.');
  }

  function populateCategoryDropdown() {
    const sel = $el('tb-mt-category');
    if (!sel) return;
    let cats = [];
    try {
      const cached = JSON.parse(localStorage.getItem('app_user') || '{}');
      cats = cached.categories || [];
    } catch (e) {}
    if (typeof cats === 'string') { try { cats = JSON.parse(cats); } catch (e) { cats = []; } }
    if (cats.length > 0 && typeof cats[0] === 'object') cats = cats.map(c => c.name || c);
    sel.innerHTML = '<option value="">\u2014 None \u2014</option>'
      + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
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
    sortSel.innerHTML = '<option value="name-asc">Name A\u2192Z</option>'
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

    // Apply sort
    filtered = sortMeetingTypes(filtered);

    if (filtered.length === 0) {
      container.innerHTML = currentCategory
        ? '<p class="tb-no-slots">No meeting types in the "' + currentCategory + '" category.</p>'
        : '<p class="tb-no-slots">No meeting types yet. Click "Add Meeting Type" to create one.</p>';
      return;
    }

    // Expand / Collapse All toggle
    let html = '<div style="margin-bottom:0.5rem;text-align:right;">'
      + '<a href="#" id="tb-mt-toggle-all" style="font-size:0.8rem;color:#60A5FA;text-decoration:none;">Expand All</a></div>';

    for (const mt of filtered) {
      const colorBorder = mt.color ? 'border-left: 4px solid ' + mt.color : '';
      const statusBadge = mt.active !== false
        ? '<span class="tb-status-badge tb-status-confirmed">Active</span>'
        : '<span class="tb-status-badge tb-status-cancelled">Inactive</span>';
      const bookingUrl = staffData ? window.location.origin + '/book?staff=' + staffData.slug + '&type=' + mt.slug : '';

      const catBadge = mt.category
        ? '<span style="display:inline-block;font-size:0.75rem;padding:0.15rem 0.5rem;background:#EEF2FF;color:#4338CA;border-radius:9999px;margin-left:0.5rem;">' + esc(mt.category) + '</span>'
        : '';

      html += '<div class="tb-dash-card" style="' + colorBorder + '">'
        // ── Header row (always visible, clickable to toggle) ──
        + '<div class="tb-meeting-card-header tb-mt-card-toggle" style="cursor:pointer;" data-mt-id="' + mt.id + '">'
        + '<div style="display:flex;align-items:center;gap:0.4rem;flex:1;min-width:0;">'
        + '<span class="tb-mt-chevron" style="font-size:0.75rem;color:#9CA3AF;flex-shrink:0;">\u25B8</span>'
        + '<h3 class="tb-meeting-card-name" style="margin:0;">' + esc(mt.name) + '</h3>'
        + '<span class="tb-meeting-card-duration">' + esc(String(mt.duration)) + ' min</span> ' + statusBadge + catBadge + '</div>'
        + '<div style="display:flex;gap:0.5rem;flex-shrink:0;" onclick="event.stopPropagation();">'
        + '<button class="tb-btn tb-btn-secondary tb-mt-edit-btn" data-id="' + mt.id + '" style="padding:0.4rem 0.8rem;font-size:0.85rem;">Edit</button>'
        + '<button class="tb-btn tb-btn-danger tb-mt-delete-btn" data-id="' + mt.id + '" data-name="' + esc(mt.name) + '" style="padding:0.4rem 0.8rem;font-size:0.85rem;">Delete</button>'
        + '</div></div>'
        // ── Body (collapsed by default) ──
        + '<div class="tb-mt-card-body" style="display:none;margin-top:0.5rem;">'
        + '<p class="tb-meeting-card-desc">' + esc(mt.description || 'No description') + '</p>'
        + '<div style="font-size:0.8rem;color:var(--tb-text-light);margin-top:0.5rem;">'
        + '<span>' + esc(mt.location || 'Teams Video Call') + '</span>'
        + '</div>'
        + (bookingUrl ? '<div style="background:#F0F7FF;border:1px solid #DBEAFE;border-radius:6px;padding:0.6rem 0.8rem;margin-top:0.75rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">'
        + '<span style="font-size:0.8rem;font-weight:600;color:#1E40AF;">Client Booking Link:</span>'
        + '<code style="font-size:0.75rem;color:#374151;word-break:break-all;flex:1;">' + bookingUrl + '</code>'
        + '<button class="tb-btn tb-btn-secondary tb-copy-link-btn" data-url="' + bookingUrl + '" style="padding:0.25rem 0.6rem;font-size:0.75rem;white-space:nowrap;">Copy Link</button>'
        + '</div>' : '')
        + '</div>'
        + '</div>';
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

    // Wire collapsible card toggles
    container.querySelectorAll('.tb-mt-card-toggle').forEach(function(hdr) {
      hdr.addEventListener('click', function() {
        var card = hdr.closest('.tb-dash-card');
        var body = card.querySelector('.tb-mt-card-body');
        var chevron = hdr.querySelector('.tb-mt-chevron');
        if (body.style.display === 'none') {
          body.style.display = '';
          if (chevron) chevron.textContent = '\u25BE';
        } else {
          body.style.display = 'none';
          if (chevron) chevron.textContent = '\u25B8';
        }
      });
    });

    // Wire Expand All / Collapse All
    var toggleAllLink = container.querySelector('#tb-mt-toggle-all');
    if (toggleAllLink) {
      toggleAllLink.addEventListener('click', function(e) {
        e.preventDefault();
        var expanding = toggleAllLink.textContent === 'Expand All';
        container.querySelectorAll('.tb-mt-card-body').forEach(function(body) {
          body.style.display = expanding ? '' : 'none';
        });
        container.querySelectorAll('.tb-mt-chevron').forEach(function(chev) {
          chev.textContent = expanding ? '\u25BE' : '\u25B8';
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
    renderReminders([
      {channel: 'email', hoursBefore: 24, template: defaultReminderTemplate('email')},
      {channel: 'sms', hoursBefore: 2, template: defaultReminderTemplate('sms')}
    ]);
    showEl('tb-mt-form-modal');
  }

  function openEditForm(mtId) {
    var mt = meetingTypes.find(function(m) { return m.id === mtId; });
    if (!mt) return;

    setText('tb-mt-form-title', 'Edit Meeting Type');
    setVal('tb-mt-id', mt.id);
    setVal('tb-mt-name', mt.name);
    setVal('tb-mt-category', mt.category || '');
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

    // Load reminders - parse from reminderConfig or fall back to legacy emailReminderSchedule
    var reminders = [];
    if (mt.reminderConfig) {
      try { reminders = typeof mt.reminderConfig === 'string' ? JSON.parse(mt.reminderConfig) : mt.reminderConfig; } catch(e) {}
    }
    if (!reminders || reminders.length === 0) {
      // Legacy fallback
      var legacyEmail = mt.emailReminderSchedule || '24h';
      if (legacyEmail !== 'none') {
        var hrs = legacyEmail === '24h' ? 24 : legacyEmail === '2h' ? 2 : 1;
        reminders = [{channel: 'email', hoursBefore: hrs, template: ''}];
      }
    }
    renderReminders(reminders);

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
      duration: parseInt(getVal('tb-mt-duration')) || 30,
      description: getVal('tb-mt-description'),
      location: getVal('tb-mt-location'),
      color: getVal('tb-mt-color'),
      bufferAfter: parseInt(getVal('tb-mt-buffer-after')) || 0,
      confirmationMessage: getVal('tb-mt-confirmation-message'),
      reminderConfig: JSON.stringify(collectReminders()),
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
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || d.innerText || '').trim();
  }

  // ─── Reminders List Builder (Quill Rich Text for Email, Textarea for SMS) ───
  var _quillInstances = [];

  function renderReminders(reminders) {
    var container = $el('tb-mt-reminders-list');
    if (!container) return;
    _quillInstances = [];
    container.innerHTML = '';

    (reminders || []).forEach(function(r, i) {
      var row = document.createElement('div');
      row.dataset.reminderIndex = i;
      row.style.cssText = 'margin-bottom:0.75rem;padding:0.75rem;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;';

      var isEmail = r.channel === 'email';

      // Decompose hoursBefore into days + hours for display
      var totalHours = r.hoursBefore || 24;
      var daysBefore = Math.floor(totalHours / 24);
      var hoursBefore = Math.round(totalHours - (daysBefore * 24));

      var topRow = '<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;">'
        + '<select data-field="channel" style="padding:0.4rem;border:1px solid #E5E7EB;border-radius:4px;font-size:0.85rem;">'
        + '<option value="email"' + (isEmail ? ' selected' : '') + '>Email</option>'
        + '<option value="sms"' + (!isEmail ? ' selected' : '') + '>SMS</option></select>'
        + '<div style="display:flex;align-items:center;gap:0.3rem;">'
        + '<input type="number" data-field="daysBefore" min="0" max="30" step="1" value="' + daysBefore + '" style="width:50px;padding:0.4rem;border:1px solid #E5E7EB;border-radius:4px;font-size:0.85rem;box-sizing:border-box;text-align:center;">'
        + '<span style="font-size:0.75rem;color:#9CA3AF;">days</span>'
        + '<input type="number" data-field="hoursBefore" min="0" max="23" step="1" value="' + hoursBefore + '" style="width:50px;padding:0.4rem;border:1px solid #E5E7EB;border-radius:4px;font-size:0.85rem;box-sizing:border-box;text-align:center;">'
        + '<span style="font-size:0.75rem;color:#9CA3AF;">hrs before</span>'
        + '</div>'
        + '<button type="button" class="tb-reminder-remove" style="background:none;border:none;color:#DC2626;cursor:pointer;font-size:1.2rem;padding:0.2rem;margin-left:auto;" title="Remove">&times;</button>'
        + '</div>';

      var editorHtml;
      if (isEmail) {
        editorHtml = '<div class="tb-quill-wrap"><div data-field="template" data-quill-idx="' + i + '">' + (r.template || '') + '</div></div>';
      } else {
        var plainText = stripHtml(r.template || '');
        editorHtml = '<textarea data-field="template" class="tb-sms-textarea">' + plainText.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>';
      }

      row.innerHTML = topRow + editorHtml;
      container.appendChild(row);
    });

    // Initialize Quill rich text editors for email reminders
    container.querySelectorAll('[data-quill-idx]').forEach(function(el) {
      var quill = new Quill(el, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            [{ 'align': [] }],
            ['link'],
            ['clean']
          ]
        },
        placeholder: 'Compose email reminder...'
      });
      _quillInstances.push({ idx: parseInt(el.dataset.quillIdx), quill: quill });
    });

    // Wire channel change to swap between rich text (email) and plain text (sms)
    container.querySelectorAll('[data-field="channel"]').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var current = collectReminders();
        var parentRow = sel.closest('[data-reminder-index]');
        var idx = parentRow ? parseInt(parentRow.dataset.reminderIndex) : -1;
        if (idx >= 0 && current[idx]) {
          var newChannel = sel.value;
          var oldDefault = defaultReminderTemplate(current[idx].channel);
          var curTpl = current[idx].template.trim();
          current[idx].channel = newChannel;
          if (!curTpl || curTpl === '<p><br></p>' || stripHtml(curTpl) === stripHtml(oldDefault)) {
            current[idx].template = defaultReminderTemplate(newChannel);
          }
          renderReminders(current);
        }
      });
    });

    // Wire remove buttons
    container.querySelectorAll('.tb-reminder-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var current = collectReminders();
        var parentRow = btn.closest('[data-reminder-index]');
        var idx = parentRow ? parseInt(parentRow.dataset.reminderIndex) : -1;
        if (idx >= 0) { current.splice(idx, 1); renderReminders(current); }
      });
    });
  }

  function collectReminders() {
    var container = $el('tb-mt-reminders-list');
    if (!container) return [];
    var rows = container.querySelectorAll('[data-reminder-index]');
    var result = [];
    rows.forEach(function(row) {
      var channel = row.querySelector('[data-field="channel"]').value;
      var daysBefore = parseInt(row.querySelector('[data-field="daysBefore"]').value) || 0;
      var hrs = parseInt(row.querySelector('[data-field="hoursBefore"]').value) || 0;
      var hoursBefore = (daysBefore * 24) + hrs;
      if (hoursBefore <= 0) hoursBefore = 1; // minimum 1 hour
      var template = '';
      if (channel === 'email') {
        var quillEl = row.querySelector('[data-quill-idx]');
        if (quillEl) {
          var idx = parseInt(quillEl.dataset.quillIdx);
          var inst = _quillInstances.find(function(q) { return q.idx === idx; });
          if (inst) {
            template = inst.quill.root.innerHTML;
            if (template === '<p><br></p>') template = '';
          }
        }
      } else {
        var ta = row.querySelector('textarea[data-field="template"]');
        if (ta) template = ta.value;
      }
      result.push({ channel: channel, hoursBefore: hoursBefore, template: template });
    });
    return result;
  }

  $el('tb-mt-add-reminder-btn')?.addEventListener('click', function() {
    var current = collectReminders();
    current.push({channel: 'email', hoursBefore: 24, template: defaultReminderTemplate('email')});
    renderReminders(current);
  });

  function setText(id, t) { var el = $el(id); if (el) el.textContent = t || ''; }
  function setVal(id, v) { var el = $el(id); if (el) el.value = v ?? ''; }
  function getVal(id) { var el = $el(id); return el ? el.value : ''; }
  function setChecked(id, v) { var el = $el(id); if (el) el.checked = !!v; }
  function isChecked(id) { var el = $el(id); return el ? el.checked : false; }
  function showEl(id) { var el = $el(id); if (el) el.style.display = ''; }
  function hideEl(id) { var el = $el(id); if (el) el.style.display = 'none'; }
})();
