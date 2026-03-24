/**
 * cc-nav.js — Shared Navigation Bar for Tabuchi Law Client Care
 *
 * Usage: Include this script on any page AFTER a placeholder div:
 *   <div id="app-nav-bar" data-active-page="dashboard"></div>
 *   <script src="...cc-nav.js"></script>
 *
 * The script auto-renders the full nav bar HTML and initialises
 * dropdown toggles, active-page highlighting, and user avatar/name.
 * Keeping the nav in one file guarantees every page is identical.
 */
(function ccNav() {
  'use strict';

  /* ── locate the placeholder ── */
  function $last(id) {
    var els = document.querySelectorAll('[id="' + id + '"]');
    return els.length ? els[els.length - 1] : null;
  }
  var bar = $last('app-nav-bar');
  if (!bar) return;

  var activePage = bar.getAttribute('data-active-page') || '';

  /* ── build HTML ── */
  var logoUrl = 'https://cdn.jsdelivr.net/gh/DavidLifson/tabuchi-law-cdn@main/tabuchi-bookings/assets/logo.png';

  var html = '';
  // Brand
  html += '<a id="app-home-link" href="/crm/dashboard" style="display:flex;align-items:center;gap:0.5rem;text-decoration:none;">';
  html += '<img id="app-logo" src="' + logoUrl + '" alt="Tabuchi Law" style="height:32px;width:auto;border-radius:6px;">';
  html += '<span style="font-weight:700;color:white;font-size:1.1rem;">Tabuchi Law</span>';
  html += '</a>';

  // Nav links + dropdowns + user (all right-justified)
  html += '<nav id="app-nav" style="display:flex;gap:0.25rem;flex-wrap:wrap;align-items:center;margin-left:auto;">';

  // CRM links
  html += '<span id="app-crm-nav">';
  var crmLinks = [
    { href: '/crm/dashboard', nav: 'dashboard', label: 'Dashboard' },
    { href: '/crm',           nav: 'leads',     label: 'Leads' },
    { href: '/crm/contacts',  nav: 'contacts',  label: 'Contacts' },
    { href: '/crm/kanban',    nav: 'kanban',     label: 'Kanban' },
    { href: '/crm/reports',   nav: 'reports',    label: 'Reports' },
  ];
  crmLinks.forEach(function(lk) {
    html += '<a href="' + lk.href + '" data-nav="' + lk.nav + '" style="color:#D1D5DB;text-decoration:none;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;">' + lk.label + '</a>';
  });

  // Campaigns dropdown
  html += '<span id="app-camp-nav" style="position:relative;">';
  html += '<button id="app-camp-btn" data-nav="campaigns,campaign-templates,drip-enrollment" style="color:#D1D5DB;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;background:none;border:none;cursor:pointer;font-family:inherit;">Campaigns &#9662;</button>';
  html += '<div id="app-camp-dropdown" style="display:none;position:absolute;left:0;top:100%;background:white;border:1px solid #E5E7EB;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:170px;z-index:100;margin-top:0.25rem;">';
  html += '<a href="/crm/campaigns" data-nav="campaigns" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Campaigns</a>';
  html += '<a href="/crm/campaign-templates" data-nav="campaign-templates" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Templates</a>';
  html += '<a href="/crm/admin#drip-enrollment" data-nav="drip-enrollment" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Drip Enrollment</a>';
  html += '</div></span>';

  html += '</span>';

  // Bookings dropdown
  html += '<span id="app-bk-nav" style="position:relative;">';
  html += '<button id="app-bk-btn" data-nav="bk-overview,bk-types,bk-avail,bk-bookings" style="color:#D1D5DB;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;background:none;border:none;cursor:pointer;font-family:inherit;">Bookings &#9662;</button>';
  html += '<div id="app-bk-dropdown" style="display:none;position:absolute;right:0;top:100%;background:white;border:1px solid #E5E7EB;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:170px;z-index:100;margin-top:0.25rem;">';
  html += '<a href="/dashboard" data-nav="bk-overview" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Overview</a>';
  html += '<a href="/dashboard-meeting-types" data-nav="bk-types" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Meeting Types</a>';
  html += '<a href="/dashboard-availability" data-nav="bk-avail" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Availability</a>';
  html += '<a href="/dashboard-bookings" data-nav="bk-bookings" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Bookings</a>';
  html += '</div></span>';

  // User dropdown
  html += '<span id="app-user-nav" style="position:relative;margin-left:0.5rem;">';
  html += '<button id="app-user-btn" data-nav="bk-settings,admin-crm" style="display:flex;align-items:center;gap:0.4rem;padding:0.2rem 0.5rem;border-radius:4px;background:none;border:none;cursor:pointer;font-family:inherit;">';
  html += '<span id="app-user-avatar" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#4B5563;color:white;font-size:0.7rem;font-weight:600;overflow:hidden;">';
  html += '<img id="app-user-avatar-img" style="display:none;width:100%;height:100%;object-fit:cover;" alt="">';
  html += '<span id="app-user-avatar-initials"></span>';
  html += '</span>';
  html += '<span id="app-user-name" style="color:#D1D5DB;font-size:0.85rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>';
  html += '<span style="color:#9CA3AF;font-size:0.6rem;">&#9662;</span>';
  html += '</button>';
  html += '<div id="app-user-dropdown" style="display:none;position:absolute;right:0;top:100%;background:white;border:1px solid #E5E7EB;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:170px;z-index:100;margin-top:0.25rem;">';
  html += '<a href="/dashboard-settings" data-nav="bk-settings" id="app-meeting-settings-link" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Meeting Settings</a>';
  html += '<a href="#" id="app-my-settings-link" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">My Settings</a>';
  html += '<a id="app-user-admin-link" href="/crm/admin" data-nav="admin-crm" style="display:none;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Admin Settings</a>';
  html += '<div style="border-top:1px solid #E5E7EB;margin:0.25rem 0;"></div>';
  html += '<a href="/login?logout" style="display:block;padding:0.5rem 1rem;color:#DC2626;text-decoration:none;font-size:0.9rem;">Logout</a>';
  html += '</div></span>';
  html += '</nav>';

  /* ── inject into bar ── */
  // Full viewport width via vw + translateX, flex directly on bar
  bar.style.cssText = 'background:#1F2937;padding:0.75rem 2rem;margin-top:-2rem;margin-bottom:2rem;display:flex;align-items:center;gap:0.5rem;border-bottom:1px solid #374151;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:visible;position:relative;width:100vw;left:50%;transform:translateX(-50%);';
  bar.innerHTML = html;

  // Enforce 1100px max-width on ALL cc-page-root elements (some pages have duplicates)
  var allRoots = document.querySelectorAll('[id="cc-page-root"]');
  for (var r = 0; r < allRoots.length; r++) {
    allRoots[r].style.maxWidth = '1100px';
  }

  /* ── user info from localStorage ── */
  function getInitials(name) {
    return (name || '').split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().substring(0, 2);
  }

  try {
    var u = JSON.parse(localStorage.getItem('app_user') || '{}');

    var nameEl = bar.querySelector('#app-user-name');
    if (nameEl && u.name) nameEl.textContent = u.name;

    var avatarImg = bar.querySelector('#app-user-avatar-img');
    var avatarInit = bar.querySelector('#app-user-avatar-initials');
    var photo = u.photoUrl || u.photo_url || '';

    if (photo && (photo.startsWith('http') || photo.startsWith('data:')) && avatarImg) {
      avatarImg.src = photo;
      avatarImg.style.display = '';
      if (avatarInit) avatarInit.style.display = 'none';
      avatarImg.onerror = function() {
        avatarImg.style.display = 'none';
        if (avatarInit) { avatarInit.style.display = ''; avatarInit.textContent = getInitials(u.name); }
      };
    } else if (avatarInit) {
      avatarInit.textContent = getInitials(u.name || '');
    }

    if (u.is_admin) {
      var adminLink = bar.querySelector('#app-user-admin-link');
      if (adminLink) adminLink.style.display = 'block';
    }

    // Grey out Meeting Settings if not on a booking page
    var meetingLink = bar.querySelector('#app-meeting-settings-link');
    if (meetingLink) {
      var onBookingPage = window.location.pathname.indexOf('/dashboard') === 0;
      if (!onBookingPage) {
        meetingLink.style.color = '#9CA3AF';
        meetingLink.style.cursor = 'default';
        meetingLink.style.pointerEvents = 'none';
        meetingLink.title = 'Only available on Bookings pages';
      }
    }

    if (u.role === 'BOOKINGS') {
      var crmNav = bar.querySelector('#app-crm-nav');
      if (crmNav) crmNav.style.display = 'none';
    }

    var homeLink = bar.querySelector('#app-home-link');
    if (homeLink) homeLink.href = (u.role === 'BOOKINGS') ? '/dashboard' : '/crm/dashboard';
  } catch (e) { /* ignore */ }

  /* ── active page highlighting ── */
  var navItems = bar.querySelectorAll('[data-nav]');
  for (var i = 0; i < navItems.length; i++) {
    var navValues = navItems[i].getAttribute('data-nav').split(',');
    if (navValues.indexOf(activePage) !== -1) {
      if (navItems[i].tagName === 'A') {
        navItems[i].style.color = 'white';
        navItems[i].style.background = '#374151';
      } else if (navItems[i].tagName === 'BUTTON') {
        navItems[i].style.color = 'white';
        navItems[i].style.background = '#374151';
      }
    }
  }

  // Highlight dropdown items
  var ddLinks = bar.querySelectorAll('[id$="-dropdown"] a');
  for (var j = 0; j < ddLinks.length; j++) {
    if (ddLinks[j].getAttribute('data-nav') === activePage) {
      ddLinks[j].style.background = '#F3F4F6';
      ddLinks[j].style.fontWeight = '600';
    }
  }

  /* ── dropdown toggles ── */
  function setupToggle(btnId, ddId) {
    var btn = bar.querySelector('#' + btnId);
    var dd = bar.querySelector('#' + ddId);
    if (!btn || !dd) return;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var allDDs = bar.querySelectorAll('[id$="-dropdown"]');
      for (var k = 0; k < allDDs.length; k++) {
        if (allDDs[k] !== dd) allDDs[k].style.display = 'none';
      }
      dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
    });
  }
  setupToggle('app-camp-btn', 'app-camp-dropdown');
  setupToggle('app-bk-btn', 'app-bk-dropdown');
  setupToggle('app-user-btn', 'app-user-dropdown');

  document.addEventListener('click', function() {
    var allDDs = bar.querySelectorAll('[id$="-dropdown"]');
    for (var k = 0; k < allDDs.length; k++) allDDs[k].style.display = 'none';
  });

  var dropdowns = bar.querySelectorAll('[id$="-dropdown"]');
  for (var m = 0; m < dropdowns.length; m++) {
    dropdowns[m].addEventListener('click', function(e) { e.stopPropagation(); });
  }

  /* ── My Settings Modal ── */
  var settingsLink = bar.querySelector('#app-my-settings-link');
  if (settingsLink) {
    settingsLink.addEventListener('click', function(e) {
      e.preventDefault();
      // Close dropdown
      var allDDs = bar.querySelectorAll('[id$="-dropdown"]');
      for (var k = 0; k < allDDs.length; k++) allDDs[k].style.display = 'none';
      showMySettingsModal();
    });
  }

  function escapeHtml(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function showMySettingsModal() {
    var API = window.ClientCareAPI;
    if (!API) return;

    var overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML =
      '<div class="cc-modal" style="max-width:550px">' +
        '<div class="cc-modal-header"><h3>My Settings</h3>' +
          '<button class="cc-modal-close" id="cc-ms-close">&times;</button></div>' +
        '<div class="cc-modal-body">' +
          '<div class="cc-settings-section">' +
            '<h4>RingCentral Extension</h4>' +
            '<input type="text" id="cc-ms-rc-ext" class="cc-input" placeholder="e.g. 101">' +
          '</div>' +
          '<div class="cc-settings-section">' +
            '<h4>Email Signature</h4>' +
            '<textarea id="cc-ms-sig" class="cc-input cc-textarea" rows="4" placeholder="Your HTML email signature..."></textarea>' +
            '<div class="cc-sig-preview" id="cc-ms-sig-preview">Preview will appear here</div>' +
          '</div>' +
          '<div class="cc-settings-section">' +
            '<h4>Notification Preferences</h4>' +
            '<div class="cc-settings-checks">' +
              '<label><input type="checkbox" id="cc-ms-notif-email" checked> Email notifications</label>' +
              '<label><input type="checkbox" id="cc-ms-notif-sms"> SMS notifications</label>' +
              '<label><input type="checkbox" id="cc-ms-notif-call-log" checked> Auto-prompt call log after RingCentral calls</label>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cc-modal-footer">' +
          '<button class="cc-btn cc-btn-primary" id="cc-ms-save">Save Settings</button> ' +
          '<button class="cc-btn cc-btn-secondary" id="cc-ms-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var close = function() { overlay.remove(); };
    document.getElementById('cc-ms-close').addEventListener('click', close);
    document.getElementById('cc-ms-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    // Live signature preview
    var sigInput = document.getElementById('cc-ms-sig');
    var sigPreview = document.getElementById('cc-ms-sig-preview');
    sigInput.addEventListener('input', function() {
      sigPreview.innerHTML = sigInput.value || '<span style="color:#9CA3AF;">Preview will appear here</span>';
    });

    // Load current settings
    var user = API.auth.getUser();
    if (user && user.id) {
      API.admin.getUserSettings(user.id).then(function(result) {
        if (result && result.settings) {
          var s = result.settings;
          if (s.rc_extension) document.getElementById('cc-ms-rc-ext').value = s.rc_extension;
          if (s.email_signature) {
            sigInput.value = s.email_signature;
            sigPreview.innerHTML = s.email_signature;
          }
          if (s.notification_prefs) {
            try {
              var prefs = typeof s.notification_prefs === 'string' ? JSON.parse(s.notification_prefs) : s.notification_prefs;
              if (typeof prefs.email_notify !== 'undefined') document.getElementById('cc-ms-notif-email').checked = prefs.email_notify;
              if (typeof prefs.sms_notify !== 'undefined') document.getElementById('cc-ms-notif-sms').checked = prefs.sms_notify;
              if (typeof prefs.call_log_auto !== 'undefined') document.getElementById('cc-ms-notif-call-log').checked = prefs.call_log_auto;
            } catch (e) { /* ignore parse errors */ }
          }
        }
      }).catch(function() { /* silently fail — settings may not exist yet */ });
    }

    // Save
    document.getElementById('cc-ms-save').addEventListener('click', async function() {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        var prefs = {
          email_notify: document.getElementById('cc-ms-notif-email').checked,
          sms_notify: document.getElementById('cc-ms-notif-sms').checked,
          call_log_auto: document.getElementById('cc-ms-notif-call-log').checked
        };
        await API.admin.updateUserSettings({
          user_id: user.id,
          rc_extension: document.getElementById('cc-ms-rc-ext').value.trim(),
          email_signature: sigInput.value,
          notification_prefs: JSON.stringify(prefs)
        });
        // Show success inline
        btn.textContent = 'Saved!';
        btn.style.background = '#059669';
        setTimeout(close, 800);
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Save Settings';
        alert('Failed to save settings: ' + (err.error || 'Network error'));
      }
    });
  }
})();
