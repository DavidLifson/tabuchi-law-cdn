/**
 * Tabuchi Law Booking System - Dashboard Settings
 * Handles: /dashboard-settings
 *
 * Requires: api-client.js loaded first
 *
 * Page element IDs:
 * - #tb-settings-form (the settings form)
 * - #tb-settings-name, #tb-settings-phone, #tb-settings-bio
 * - #tb-settings-photo-url (hidden), #tb-settings-timezone
 * - #tb-settings-avatar-preview, #tb-settings-avatar-img, #tb-settings-avatar-initials
 * - #tb-settings-photo-file (file upload), #tb-settings-sync-ms-photo, #tb-settings-remove-photo
 * - #tb-settings-hours-start, #tb-settings-hours-end (time inputs)
 * - #tb-settings-wd-mon..sun (working day checkboxes), #tb-sync-badge
 * - #tb-settings-email-reminders, #tb-settings-sms-reminders (checkboxes)
 * - #tb-settings-office-mon..fri (in-office day checkboxes)
 * - #tb-settings-save-btn
 * - #tb-settings-success, #tb-settings-error
 * - #tb-settings-slug (read-only display of staff slug)
 * - #tb-settings-email (read-only display of staff email)
 * - #tb-loading, #tb-error
 */

(async function SettingsPage() {
  'use strict';

  // Use last #tb-page-root to handle Webflow dual-embed (HTML Embed widget + Before </body> tag)
  const _roots = document.querySelectorAll('#tb-page-root');
  const _root = _roots[_roots.length - 1] || null;
  function $el(id) { return _root ? _root.querySelector('#' + id) : document.getElementById(id); }

  var token = localStorage.getItem('app_token');
  if (!token) { window.location.href = '/login'; return; }

  var staffData = null;

  TabuchiAPI.util.showLoading('tb-loading');

  try {
    var staffCache = null;
    try { staffCache = JSON.parse(localStorage.getItem('app_user') || 'null'); } catch(e) {}

    if (staffCache && staffCache.slug) {
      var result = await TabuchiAPI.getStaff(staffCache.slug);
      staffData = result.staff;
    } else {
      var bookingsResult = await TabuchiAPI.dashboard.getBookings('upcoming');
      if (bookingsResult.staff) {
        staffData = bookingsResult.staff;
        localStorage.setItem('app_user', JSON.stringify(staffData));
      }
    }

    hideEl('tb-loading');
    populateForm();

    // Auto-sync Microsoft photo if no photo and user has MS account
    var currentPhoto = staffData.photoUrl || staffData.photo_url || '';
    if (!currentPhoto && staffData.msUserId) {
      TabuchiAPI.dashboard.syncMicrosoft().then(function(result) {
        if (result.photo) {
          setVal('tb-settings-photo-url', result.photo);
          updateAvatar(result.photo, staffData.name || '');
        }
      }).catch(function() { /* silent fail */ });
    }

  } catch (err) {
    hideEl('tb-loading');
    if (err.status === 401) { window.location.href = '/login'; return; }
    TabuchiAPI.util.showError('tb-error', err.error || 'Unable to load settings.');
  }

  function populateForm() {
    if (!staffData) return;
    setVal('tb-settings-name', staffData.name || '');
    setVal('tb-settings-phone', staffData.phone || '');
    setVal('tb-settings-bio', staffData.bio || '');
    setVal('tb-settings-photo-url', staffData.photoUrl || staffData.photo_url || '');
    setVal('tb-settings-timezone', staffData.timezone || 'America/Toronto');
    setChecked('tb-settings-email-reminders', staffData.emailReminders !== undefined ? staffData.emailReminders : true);
    setChecked('tb-settings-sms-reminders', staffData.smsReminders !== undefined ? staffData.smsReminders : true);
    setText('tb-settings-slug', staffData.slug || '');
    setText('tb-settings-email', staffData.email || '');

    // In-Office Days
    var inOfficeDays = [];
    try { inOfficeDays = JSON.parse(staffData.inOfficeDays || staffData.In_Office_Days || '[]'); } catch(e) {}
    setChecked('tb-settings-office-mon', inOfficeDays.includes('Mon'));
    setChecked('tb-settings-office-tue', inOfficeDays.includes('Tue'));
    setChecked('tb-settings-office-wed', inOfficeDays.includes('Wed'));
    setChecked('tb-settings-office-thu', inOfficeDays.includes('Thu'));
    setChecked('tb-settings-office-fri', inOfficeDays.includes('Fri'));

    // Working Hours
    setVal('tb-settings-hours-start', staffData.workingHoursStart || '09:00');
    setVal('tb-settings-hours-end', staffData.workingHoursEnd || '17:00');

    // Working Days (7-day checkboxes)
    var workingDays = staffData.workingDays || ['Mon','Tue','Wed','Thu','Fri'];
    if (typeof workingDays === 'string') { try { workingDays = JSON.parse(workingDays); } catch(e) { workingDays = []; } }
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(day) {
      setChecked('tb-settings-wd-' + day.toLowerCase(), workingDays.includes(day));
    });

    // Booking constraints
    setVal('tb-settings-buffer', staffData.bufferMinutes || staffData.buffer_minutes || 15);
    setVal('tb-settings-min-notice', staffData.minNoticeHours || staffData.min_notice_hours || 24);
    setVal('tb-settings-max-advance', staffData.maxAdvanceDays || staffData.max_advance_days || 60);

    // O365 sync badge
    if (staffData.o365SyncEnabled) {
      var badge = $el('tb-sync-badge');
      if (badge) badge.style.display = '';
    }

    // Avatar with initials fallback
    updateAvatar(staffData.photoUrl || staffData.photo_url || '', staffData.name || '');

    // Show "Sync from Microsoft" button if user has MS account
    if (staffData.msUserId) {
      var syncBtn = $el('tb-settings-sync-ms-photo');
      if (syncBtn) syncBtn.style.display = '';
    }

    var tzSelect = $el('tb-settings-timezone');
    if (tzSelect && tzSelect.options.length <= 1) {
      var timezones = ['America/Toronto','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Vancouver','America/Edmonton','America/Winnipeg','America/Halifax','America/St_Johns','UTC','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney'];
      tzSelect.innerHTML = timezones.map(function(tz) {
        return '<option value="' + tz + '"' + (tz === (staffData.timezone || 'America/Toronto') ? ' selected' : '') + '>' + tz + '</option>';
      }).join('');
    }
  }

  $el('tb-settings-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = $el('tb-settings-save-btn');
    var successEl = $el('tb-settings-success');
    var errorEl = $el('tb-settings-error');
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
    if (successEl) successEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';

    // Build In-Office Days array from checkboxes
    var officeDays = [];
    if (isChecked('tb-settings-office-mon')) officeDays.push('Mon');
    if (isChecked('tb-settings-office-tue')) officeDays.push('Tue');
    if (isChecked('tb-settings-office-wed')) officeDays.push('Wed');
    if (isChecked('tb-settings-office-thu')) officeDays.push('Thu');
    if (isChecked('tb-settings-office-fri')) officeDays.push('Fri');

    // Build Working Days array from checkboxes
    var workingDays = [];
    if (isChecked('tb-settings-wd-mon')) workingDays.push('Mon');
    if (isChecked('tb-settings-wd-tue')) workingDays.push('Tue');
    if (isChecked('tb-settings-wd-wed')) workingDays.push('Wed');
    if (isChecked('tb-settings-wd-thu')) workingDays.push('Thu');
    if (isChecked('tb-settings-wd-fri')) workingDays.push('Fri');
    if (isChecked('tb-settings-wd-sat')) workingDays.push('Sat');
    if (isChecked('tb-settings-wd-sun')) workingDays.push('Sun');

    var data = {
      name: getVal('tb-settings-name'),
      phone: getVal('tb-settings-phone'),
      bio: getVal('tb-settings-bio'),
      photoUrl: getVal('tb-settings-photo-url'),
      timezone: getVal('tb-settings-timezone'),
      emailReminders: isChecked('tb-settings-email-reminders'),
      smsReminders: isChecked('tb-settings-sms-reminders'),
      inOfficeDays: JSON.stringify(officeDays),
      workingHoursStart: getVal('tb-settings-hours-start'),
      workingHoursEnd: getVal('tb-settings-hours-end'),
      workingDays: workingDays
    };

    // Booking constraint fields (moved from Availability page)
    var availData = {
      workingHoursStart: getVal('tb-settings-hours-start'),
      workingHoursEnd: getVal('tb-settings-hours-end'),
      workingDays: workingDays,
      bufferMinutes: parseInt(getVal('tb-settings-buffer')) || 0,
      minNoticeHours: parseInt(getVal('tb-settings-min-notice')) || 24,
      maxAdvanceDays: parseInt(getVal('tb-settings-max-advance')) || 60
    };

    try {
      var [result] = await Promise.all([
        TabuchiAPI.dashboard.updateSettings(data),
        TabuchiAPI.dashboard.updateAvailability(availData)
      ]);
      if (btn) { btn.textContent = 'Save Settings'; btn.disabled = false; }
      if (successEl) { successEl.textContent = 'Settings saved successfully!'; successEl.style.display = ''; }
      setTimeout(function() { if (successEl) successEl.style.display = 'none'; }, 3000);
      if (result.settings) {
        Object.assign(staffData, result.settings);
        localStorage.setItem('app_user', JSON.stringify(staffData));
      }
    } catch (err) {
      if (btn) { btn.textContent = 'Save Settings'; btn.disabled = false; }
      if (errorEl) { errorEl.textContent = err.error || 'Unable to save settings.'; errorEl.style.display = ''; }
    }
  });

  // Avatar helper functions
  function getInitials(name) {
    return (name || '').split(' ').map(function(n) { return n[0]; }).join('').toUpperCase().substring(0, 2);
  }

  function updateAvatar(url, name) {
    var img = $el('tb-settings-avatar-img');
    var initials = $el('tb-settings-avatar-initials');
    var removeLink = $el('tb-settings-remove-photo');
    if (!img || !initials) return;

    if (url && (url.startsWith('http') || url.startsWith('data:'))) {
      img.src = url;
      img.style.display = '';
      initials.style.display = 'none';
      if (removeLink) removeLink.style.display = '';
      img.onerror = function() {
        img.style.display = 'none';
        initials.textContent = getInitials(name);
        initials.style.display = '';
        if (removeLink) removeLink.style.display = 'none';
      };
    } else {
      img.style.display = 'none';
      initials.textContent = getInitials(name);
      initials.style.display = '';
      if (removeLink) removeLink.style.display = 'none';
    }
  }

  // File upload handler
  $el('tb-settings-photo-file')?.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 500000) { alert('Photo must be under 500KB'); return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      var dataUrl = ev.target.result;
      setVal('tb-settings-photo-url', dataUrl);
      updateAvatar(dataUrl, getVal('tb-settings-name'));
    };
    reader.readAsDataURL(file);
  });

  // Sync from Microsoft button handler
  $el('tb-settings-sync-ms-photo')?.addEventListener('click', async function() {
    var btn = this;
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    try {
      var result = await TabuchiAPI.dashboard.syncMicrosoft();
      if (result.photo) {
        setVal('tb-settings-photo-url', result.photo);
        updateAvatar(result.photo, getVal('tb-settings-name'));
      }
      if (result.workingHours) {
        setVal('tb-settings-hours-start', result.workingHours.start);
        setVal('tb-settings-hours-end', result.workingHours.end);
        var days = result.workingHours.days || [];
        ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(day) {
          setChecked('tb-settings-wd-' + day.toLowerCase(), days.includes(day));
        });
      }
      if (result.profile && result.profile.name) {
        setVal('tb-settings-name', result.profile.name);
      }
      btn.textContent = 'Synced!';
      setTimeout(function() { btn.textContent = 'Sync from Microsoft'; btn.disabled = false; }, 2000);
    } catch(err) {
      btn.textContent = 'Sync from Microsoft';
      btn.disabled = false;
      alert('Sync failed: ' + (err.error || 'Unknown error'));
    }
  });

  // Remove photo handler
  $el('tb-settings-remove-photo')?.addEventListener('click', function(e) {
    e.preventDefault();
    setVal('tb-settings-photo-url', '');
    updateAvatar('', getVal('tb-settings-name'));
    var fileInput = $el('tb-settings-photo-file');
    if (fileInput) fileInput.value = '';
  });

  function setText(id, t) { var el = $el(id); if (el) el.textContent = t || ''; }
  function setVal(id, v) { var el = $el(id); if (el) el.value = v ?? ''; }
  function getVal(id) { var el = $el(id); return el ? el.value : ''; }
  function setChecked(id, v) { var el = $el(id); if (el) el.checked = !!v; }
  function isChecked(id) { var el = $el(id); return el ? el.checked : false; }
  function showEl(id) { var el = $el(id); if (el) el.style.display = ''; }
  function hideEl(id) { var el = $el(id); if (el) el.style.display = 'none'; }
})();
