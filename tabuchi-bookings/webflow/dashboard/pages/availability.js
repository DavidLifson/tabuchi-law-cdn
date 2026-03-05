/**
 * Tabuchi Law Booking System - Dashboard Availability & Blocked Dates
 * Handles: /dashboard-availability
 *
 * Requires: api-client.js loaded first
 *
 * Page element IDs:
 * - #tb-avail-form (working hours form)
 * - #tb-avail-start, #tb-avail-end (time inputs)
 * - #tb-avail-days (container for day checkboxes: #tb-day-Mon, #tb-day-Tue, etc.)
 * - #tb-avail-buffer (buffer minutes input)
 * - #tb-avail-min-notice (min notice hours input)
 * - #tb-avail-max-advance (max advance days input)
 * - #tb-avail-save-btn
 * - #tb-avail-success, #tb-avail-error
 *
 * O365 Calendar Sync section:
 * - #tb-o365-sync-enabled (checkbox, checked by default)
 * - #tb-o365-last-sync (last sync timestamp display)
 * - #tb-o365-sync-status (info box, shown when enabled)
 *
 * Blocked Dates section:
 * - #tb-blocked-list (container for blocked date rows)
 * - #tb-blocked-date-input, #tb-blocked-reason-input
 * - #tb-blocked-allday (checkbox)
 * - #tb-blocked-start-time, #tb-blocked-end-time (for partial day blocks)
 * - #tb-blocked-recurring (checkbox)
 * - #tb-blocked-add-btn
 * - #tb-loading, #tb-error
 *
 * NOTE: Time Block % has been moved to per-meeting-type config (meeting-types.js)
 */

(async function AvailabilityPage() {
  'use strict';

  const _root = document.querySelector('#tb-page-root');
  function $el(id) { return _root ? _root.querySelector('#' + id) : document.getElementById(id); }

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
  let blockedDates = [];

  // Fix: hide time inputs by default (all-day is checked)
  var timeInputsEl = $el('tb-blocked-time-inputs');
  if (timeInputsEl) timeInputsEl.style.display = 'none';

  TabuchiAPI.util.showLoading('tb-loading');

  try {
    let staffCache = null;
    try { staffCache = JSON.parse(localStorage.getItem('app_user') || 'null'); } catch(e) {}

    if (staffCache && staffCache.slug) {
      const result = await TabuchiAPI.getStaff(staffCache.slug);
      staffData = result.staff;
    }

    const blockedResult = await TabuchiAPI.dashboard.getBlockedDates();
    blockedDates = blockedResult.blockedDates || [];

    hideEl('tb-loading');
    populateAvailabilityForm();
    renderBlockedDates();

  } catch (err) {
    hideEl('tb-loading');
    if (err.status === 401) { window.location.href = '/login'; return; }
    TabuchiAPI.util.showError('tb-error', err.error || 'Unable to load availability settings.');
  }

  function populateAvailabilityForm() {
    if (!staffData) return;
    setVal('tb-avail-start', staffData.workingHoursStart || staffData.working_hours_start || '09:00');
    setVal('tb-avail-end', staffData.workingHoursEnd || staffData.working_hours_end || '17:00');
    setVal('tb-avail-buffer', staffData.bufferMinutes || staffData.buffer_minutes || 15);
    setVal('tb-avail-min-notice', staffData.minNoticeHours || staffData.min_notice_hours || 24);
    setVal('tb-avail-max-advance', staffData.maxAdvanceDays || staffData.max_advance_days || 60);

    const days = staffData.workingDays || staffData.working_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function(d) {
      var cb = $el('tb-day-' + d);
      if (cb) cb.checked = days.includes(d);
    });

    // O365 sync
    var o365Enabled = staffData.o365SyncEnabled || staffData.o365_sync_enabled || false;
    var o365Cb = $el('tb-o365-sync-enabled');
    if (o365Cb) o365Cb.checked = o365Enabled;
    var statusBox = $el('tb-o365-sync-status');
    if (statusBox) statusBox.style.display = o365Enabled ? '' : 'none';
    var lastSync = staffData.lastO365Sync || staffData.last_o365_sync;
    var lastSyncEl = $el('tb-o365-last-sync');
    if (lastSyncEl && lastSync) {
      lastSyncEl.textContent = 'Last synced: ' + new Date(lastSync).toLocaleString();
    }
  }

  $el('tb-avail-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = $el('tb-avail-save-btn');
    var successEl = $el('tb-avail-success');
    var errorEl = $el('tb-avail-error');
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
    if (successEl) successEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';

    var workingDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter(function(d) {
      var cb = $el('tb-day-' + d);
      return cb && cb.checked;
    });

    var data = {
      workingHoursStart: getVal('tb-avail-start'),
      workingHoursEnd: getVal('tb-avail-end'),
      workingDays: workingDays,
      bufferMinutes: parseInt(getVal('tb-avail-buffer')) || 0,
      minNoticeHours: parseInt(getVal('tb-avail-min-notice')) || 24,
      maxAdvanceDays: parseInt(getVal('tb-avail-max-advance')) || 60,
      o365SyncEnabled: isChecked('tb-o365-sync-enabled')
    };

    try {
      await TabuchiAPI.dashboard.updateAvailability(data);
      if (btn) { btn.textContent = 'Save Availability'; btn.disabled = false; }
      if (successEl) { successEl.textContent = 'Availability settings saved!'; successEl.style.display = ''; }
      setTimeout(function() { if (successEl) successEl.style.display = 'none'; }, 3000);
    } catch (err) {
      if (btn) { btn.textContent = 'Save Availability'; btn.disabled = false; }
      if (errorEl) { errorEl.textContent = err.error || 'Unable to save settings.'; errorEl.style.display = ''; }
    }
  });

  function renderBlockedDates() {
    var container = $el('tb-blocked-list');
    if (!container) return;
    if (blockedDates.length === 0) {
      container.innerHTML = '<p class="tb-no-slots">No blocked dates. Use the form below to add time off or blocked periods.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < blockedDates.length; i++) {
      var bd = blockedDates[i];
      var dateDisplay = TabuchiAPI.util.formatDate(bd.date);
      var timeDisplay = bd.allDay ? 'All day' : TabuchiAPI.util.formatTime(bd.startTime) + ' - ' + TabuchiAPI.util.formatTime(bd.endTime);
      var recurring = bd.recurring ? '<span class="tb-status-badge tb-status-rescheduled">Recurring</span>' : '';
      html += '<div class="tb-booking-row"><div><strong>' + dateDisplay + '</strong>'
        + '<div style="font-size:0.85rem;color:var(--tb-text-light);">' + timeDisplay + (bd.reason ? ' &middot; ' + bd.reason : '') + ' ' + recurring + '</div></div>'
        + '<button class="tb-btn tb-btn-danger tb-blocked-remove-btn" data-id="' + bd.id + '" style="padding:0.3rem 0.6rem;font-size:0.8rem;">Remove</button></div>';
    }
    container.innerHTML = html;
    container.querySelectorAll('.tb-blocked-remove-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { removeBlockedDate(btn.dataset.id); });
    });
  }

  $el('tb-blocked-add-btn')?.addEventListener('click', async function() {
    var date = getVal('tb-blocked-date-input');
    var reason = getVal('tb-blocked-reason-input');
    var allDay = isChecked('tb-blocked-allday');
    var startTime = getVal('tb-blocked-start-time');
    var endTime = getVal('tb-blocked-end-time');
    var recurring = isChecked('tb-blocked-recurring');

    if (!date) { alert('Please select a date.'); return; }

    var btn = $el('tb-blocked-add-btn');
    if (btn) { btn.textContent = 'Adding...'; btn.disabled = true; }

    try {
      var result = await TabuchiAPI.dashboard.blockedDates({
        action: 'add', date: date, reason: reason, allDay: allDay,
        startTime: allDay ? undefined : startTime, endTime: allDay ? undefined : endTime,
        recurring: recurring
      });
      blockedDates = result.blockedDates || [];
      renderBlockedDates();
      setVal('tb-blocked-date-input', '');
      setVal('tb-blocked-reason-input', '');
      setChecked('tb-blocked-allday', true);
      setChecked('tb-blocked-recurring', false);
      if (timeInputsEl) timeInputsEl.style.display = 'none';
    } catch (err) { alert(err.error || 'Unable to add blocked date.'); }
    if (btn) { btn.textContent = 'Add Blocked Date'; btn.disabled = false; }
  });

  async function removeBlockedDate(id) {
    if (!confirm('Remove this blocked date?')) return;
    try {
      var result = await TabuchiAPI.dashboard.blockedDates({ action: 'remove', id: id });
      blockedDates = result.blockedDates || [];
      renderBlockedDates();
    } catch (err) { alert(err.error || 'Unable to remove blocked date.'); }
  }

  $el('tb-blocked-allday')?.addEventListener('change', function() {
    var ti = $el('tb-blocked-time-inputs');
    if (ti) ti.style.display = this.checked ? 'none' : '';
  });

  // Toggle O365 sync status box
  $el('tb-o365-sync-enabled')?.addEventListener('change', function() {
    var statusBox = $el('tb-o365-sync-status');
    if (statusBox) statusBox.style.display = this.checked ? '' : 'none';
  });

  function setVal(id, v) { var el = $el(id); if (el) el.value = v ?? ''; }
  function getVal(id) { var el = $el(id); return el ? el.value : ''; }
  function setChecked(id, v) { var el = $el(id); if (el) el.checked = !!v; }
  function isChecked(id) { var el = $el(id); return el ? el.checked : false; }
  function showEl(id) { var el = $el(id); if (el) el.style.display = ''; }
  function hideEl(id) { var el = $el(id); if (el) el.style.display = 'none'; }
})();
