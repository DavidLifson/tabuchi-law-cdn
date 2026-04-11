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

  /* ── inject Tabuchi favicon if not already set ── */
  (function setFavicon() {
    try {
      var assetBase = 'https://davidlifson.github.io/tabuchi-law-cdn/tabuchi-bookings/assets/';
      // Remove existing favicons
      var existing = document.querySelectorAll('link[rel*="icon"]');
      for (var i = 0; i < existing.length; i++) existing[i].parentNode.removeChild(existing[i]);
      function addLink(rel, type, sizes, href) {
        var l = document.createElement('link');
        l.rel = rel;
        if (type) l.type = type;
        if (sizes) l.sizes = sizes;
        l.href = href;
        document.head.appendChild(l);
      }
      addLink('icon', 'image/x-icon', null, assetBase + 'favicon.ico');
      addLink('icon', 'image/png', '32x32', assetBase + 'favicon-32.png');
      addLink('icon', 'image/png', '16x16', assetBase + 'favicon-16.png');
      addLink('apple-touch-icon', null, '180x180', assetBase + 'apple-touch-icon.png');
    } catch (e) { /* ignore */ }
  })();

  /* ── inject modal + toast styles if not already present ── */
  if (!document.getElementById('cc-nav-styles')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'cc-nav-styles';
    styleEl.textContent =
      '.cc-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center}' +
      '.cc-modal{background:white;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.2);max-width:500px;width:90%;max-height:85vh;overflow-y:auto}' +
      '.cc-modal-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;border-bottom:1px solid #E5E7EB;font-weight:600;font-size:1.1rem}' +
      '.cc-modal-body{padding:1.5rem}' +
      '.cc-modal-footer{display:flex;justify-content:flex-end;gap:0.5rem;padding:1rem 1.5rem;border-top:1px solid #E5E7EB}' +
      '.cc-modal-close{background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6B7280;line-height:1}' +
      '.cc-modal-close:hover{color:#1F2937}' +
      '.cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;padding:0.5rem 1rem;border-radius:6px;font-size:0.9rem;font-weight:500;cursor:pointer;border:none;transition:opacity 0.15s}' +
      '.cc-btn:hover{opacity:0.85}.cc-btn:disabled{opacity:0.5;cursor:not-allowed}' +
      '.cc-btn-primary{background:#2563EB;color:white}' +
      '.cc-btn-secondary{background:#fff;color:#374151;border:1px solid #D1D5DB;padding:8px 16px;border-radius:6px;font-size:0.9rem;cursor:pointer}' +
      '.cc-input{width:100%;padding:0.5rem 0.75rem;border:1px solid #D1D5DB;border-radius:6px;font-size:0.9rem;color:#1F2937;box-sizing:border-box;background:white}' +
      '.cc-input:focus{outline:none;border-color:#2563EB;box-shadow:0 0 0 2px rgba(37,99,235,0.15)}' +
      '.cc-textarea{width:100%;padding:0.5rem 0.75rem;border:1px solid #D1D5DB;border-radius:6px;font-size:0.9rem;color:#1F2937;box-sizing:border-box;resize:vertical;min-height:80px;font-family:inherit;background:white}' +
      '.cc-settings-section{margin-bottom:20px}' +
      '.cc-settings-section h4{margin:0 0 8px;font-size:0.95rem;font-weight:600;color:#374151}' +
      '.cc-settings-section .cc-input{margin-bottom:8px}' +
      '.cc-sig-preview{border:1px solid #E5E7EB;border-radius:6px;padding:12px;background:#FAFAFA;min-height:60px;font-size:0.85rem;margin-top:4px}' +
      '.cc-settings-checks label{display:block;margin-bottom:6px;font-size:0.9rem;color:#374151}' +
      '.cc-toast{position:fixed;top:1rem;right:1rem;padding:0.75rem 1.25rem;border-radius:8px;color:white;font-size:0.9rem;z-index:2000;transform:translateX(120%);transition:transform 0.3s ease;box-shadow:0 4px 12px rgba(0,0,0,0.15)}' +
      '.cc-toast-visible{transform:translateX(0)}.cc-toast-success{background:#059669}.cc-toast-error{background:#DC2626}.cc-toast-info{background:#2563EB}';
    document.head.appendChild(styleEl);
  }

  /* ── locate the placeholder ── */
  function $last(id) {
    var els = document.querySelectorAll('[id="' + id + '"]');
    return els.length ? els[els.length - 1] : null;
  }
  /* Hide duplicate nav bars (HTML Embed widget + Before </body> custom code) */
  var allBars = document.querySelectorAll('[id="app-nav-bar"]');
  for (var nbi = 0; nbi < allBars.length - 1; nbi++) {
    allBars[nbi].style.display = 'none';
  }
  var bar = $last('app-nav-bar');
  if (!bar) return;

  var activePage = bar.getAttribute('data-active-page') || '';

  /* ── build HTML ── */
  var logoUrl = 'https://davidlifson.github.io/tabuchi-law-cdn/tabuchi-bookings/assets/logo-reverse.png';

  var html = '';
  // Brand
  html += '<a id="app-home-link" href="/" style="display:flex;align-items:center;text-decoration:none;">';
  html += '<img id="app-logo" src="' + logoUrl + '" alt="Tabuchi Law" style="height:44px;width:auto;">';
  html += '</a>';

  // Nav links
  html += '<nav id="app-nav" style="display:flex;gap:0.25rem;flex-wrap:wrap;align-items:center;">';

  // CRM links
  html += '<span id="app-crm-nav">';
  var crmLinks = [
    { href: '/crm/dashboard', nav: 'dashboard', label: 'Dashboard' },
    { href: '/crm',           nav: 'leads',     label: 'Leads' },
    { href: '/crm/contacts',  nav: 'contacts',  label: 'Contacts' },
    { href: '/crm/kanban',    nav: 'kanban',     label: 'Kanban' },
    { href: '/crm/reports',   nav: 'reports',    label: 'Reports' }
  ];
  crmLinks.forEach(function(lk) {
    html += '<a href="' + lk.href + '" data-nav="' + lk.nav + '" style="color:#D1D5DB;text-decoration:none;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;">' + lk.label + '</a>';
  });

  // Campaigns dropdown
  html += '<span id="app-camp-nav" style="position:relative;">';
  html += '<button id="app-camp-btn" data-nav="campaigns,campaign-templates" style="color:#D1D5DB;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;background:none;border:none;cursor:pointer;font-family:inherit;">Campaigns &#9662;</button>';
  html += '<div id="app-camp-dropdown" style="display:none;position:absolute;left:0;top:100%;background:white;border:1px solid #E5E7EB;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:170px;z-index:100;margin-top:0.25rem;">';
  html += '<a href="/crm/campaigns" data-nav="campaigns" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Campaigns</a>';
  html += '<a href="/crm/campaign-templates" data-nav="campaign-templates" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Templates</a>';
  html += '</div></span>';

  html += '</span>';

  // Bookings dropdown
  html += '<span id="app-bk-nav" style="position:relative;">';
  html += '<button id="app-bk-btn" data-nav="bk-overview,bk-types,bk-avail,bk-bookings" style="color:#D1D5DB;padding:0.3rem 0.6rem;font-size:0.9rem;border-radius:4px;background:none;border:none;cursor:pointer;font-family:inherit;">Meetings &#9662;</button>';
  html += '<div id="app-bk-dropdown" style="display:none;position:absolute;right:0;top:100%;background:white;border:1px solid #E5E7EB;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);min-width:170px;z-index:100;margin-top:0.25rem;">';
  html += '<a href="/dashboard" data-nav="bk-overview" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Overview</a>';
  html += '<a href="/dashboard-meeting-types" data-nav="bk-types" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Meeting Types</a>';
  html += '<a href="/dashboard-availability" data-nav="bk-avail" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Availability</a>';
  html += '<a href="/dashboard-bookings" data-nav="bk-bookings" style="display:block;padding:0.5rem 1rem;color:#1F2937;text-decoration:none;font-size:0.9rem;">Meetings</a>';
  html += '</div></span>';

  // Notification bell
  html += '<span id="app-notif-nav" style="position:relative;margin-left:0.5rem;">';
  html += '<button id="app-notif-btn" style="position:relative;background:none;border:none;cursor:pointer;padding:0.3rem 0.5rem;font-size:1.1rem;line-height:1;" title="Task Notifications">';
  html += '<span style="color:#D1D5DB;">&#128276;</span>';
  html += '<span id="app-notif-badge" style="display:none;position:absolute;top:0;right:0;background:#EF4444;color:white;font-size:0.6rem;font-weight:700;min-width:16px;height:16px;border-radius:8px;text-align:center;line-height:16px;padding:0 3px;"></span>';
  html += '</button>';
  html += '<div id="app-notif-dropdown" style="display:none;position:absolute;right:0;top:100%;background:white;border:1px solid #E5E7EB;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);width:340px;max-height:420px;overflow-y:auto;z-index:110;margin-top:0.25rem;">';
  html += '<div style="padding:0.75rem 1rem;border-bottom:1px solid #E5E7EB;font-weight:600;color:#1F2937;font-size:0.9rem;">Task Notifications</div>';
  html += '<div id="app-notif-list" style="padding:0.5rem 0;"><div style="padding:1rem;color:#9CA3AF;font-size:0.85rem;text-align:center;">Loading...</div></div>';
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
  // Flex on bar directly — logo left, nav right via margin-left:auto
  bar.style.cssText = 'background:#1F2937;padding:0.75rem 2rem;margin-top:-2rem;margin-bottom:2rem;display:flex;align-items:center;gap:0.5rem;border-bottom:1px solid #374151;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:visible;';
  bar.innerHTML = html;

  // Ensure nav is pushed right
  var navEl = document.getElementById('app-nav');
  if (navEl) navEl.style.marginLeft = 'auto';

  // Stretch bar to full viewport width — set actual width so flex layout uses it
  function positionNav() {
    bar.style.marginLeft = '';
    bar.style.marginRight = '';
    bar.style.width = '';
    var rect = bar.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    bar.style.width = vw + 'px';
    bar.style.marginLeft = (-rect.left) + 'px';
  }
  positionNav();
  window.addEventListener('resize', positionNav);

  // Enforce layout on page root — overflow visible so bar isn't clipped
  var allRoots = document.querySelectorAll('[id="cc-page-root"]');
  for (var r = 0; r < allRoots.length; r++) {
    allRoots[r].style.maxWidth = '1100px';
    allRoots[r].style.overflow = 'visible';
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
        meetingLink.title = 'Only available on Meetings pages';
      }
    }

    if (u.role === 'BOOKINGS') {
      var crmNav = bar.querySelector('#app-crm-nav');
      if (crmNav) crmNav.style.display = 'none';
    }

    var homeLink = bar.querySelector('#app-home-link');
    if (homeLink) {
      if (u.role === 'BOOKINGS') {
        homeLink.href = '/dashboard';
      } else {
        var startPage = u.start_page || localStorage.getItem('cc_start_page') || 'dashboard';
        homeLink.href = startPage === 'leads' ? '/crm' : '/crm/dashboard';
      }
    }
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
  setupToggle('app-notif-btn', 'app-notif-dropdown');
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

  /* ── Notification Bell: fetch overdue + due-today tasks ── */
  (function initNotifBell() {
    var CACHE_KEY = 'cc_notif_tasks';
    var CACHE_TS_KEY = 'cc_notif_tasks_ts';
    var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    var badge = bar.querySelector('#app-notif-badge');
    var listEl = bar.querySelector('#app-notif-list');
    if (!badge || !listEl) return;

    var token = '';
    var crmUserId = '';
    try {
      token = localStorage.getItem('app_token') || '';
      // Try CRM user ID first (cached from previous lookup)
      crmUserId = sessionStorage.getItem('cc_crm_user_id') || '';
    } catch (e) { /* ignore */ }
    if (!token) {
      listEl.innerHTML = '<div style="padding:1rem;color:#9CA3AF;font-size:0.85rem;text-align:center;">Not authenticated</div>';
      return;
    }

    function todayStr() {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function renderTasks(tasks) {
      if (!tasks || tasks.length === 0) {
        listEl.innerHTML = '<div style="padding:1rem;color:#9CA3AF;font-size:0.85rem;text-align:center;">No overdue or due-today tasks</div>';
        badge.style.display = 'none';
        return;
      }
      badge.style.display = '';
      badge.textContent = tasks.length > 99 ? '99+' : tasks.length;
      var today = todayStr();
      var html = '';
      tasks.forEach(function(t) {
        var isOverdue = t.Due_At && t.Due_At.slice(0, 10) < today;
        var tagColor = isOverdue ? '#EF4444' : '#F59E0B';
        var tagLabel = isOverdue ? 'Overdue' : 'Today';
        var dueLabel = t.Due_At ? t.Due_At.slice(0, 10) : 'No due date';
        var leadId = (t.Lead && t.Lead[0]) || '';
        var href = leadId ? '/crm/lead?id=' + leadId + '&tab=tasks' : '/crm/dashboard#tasks';
        html += '<div data-task-id="' + escapeHtml(t.id) + '" style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.6rem 1rem;border-bottom:1px solid #F3F4F6;transition:background 0.15s;" onmouseover="this.style.background=\'#F9FAFB\'" onmouseout="this.style.background=\'transparent\'">';
        // Checkbox for marking complete
        html += '<button type="button" class="cc-notif-complete-btn" data-task-id="' + escapeHtml(t.id) + '" title="Mark complete" style="flex-shrink:0;width:18px;height:18px;border:1.5px solid #D1D5DB;border-radius:4px;background:white;cursor:pointer;padding:0;margin-top:1px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;" onmouseover="this.style.borderColor=\'#1A2F4B\';this.style.background=\'#F3F0EB\'" onmouseout="this.style.borderColor=\'#D1D5DB\';this.style.background=\'white\'"></button>';
        // Task content (clickable to navigate)
        html += '<a href="' + href + '" style="flex:1;text-decoration:none;color:inherit;min-width:0;">';
        html += '<div style="display:flex;align-items:center;gap:0.5rem;">';
        html += '<span style="font-size:0.85rem;color:#1F2937;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.Title) + '</span>';
        html += '<span style="font-size:0.65rem;font-weight:600;color:white;background:' + tagColor + ';padding:1px 6px;border-radius:4px;white-space:nowrap;">' + tagLabel + '</span>';
        html += '</div>';
        html += '<div style="display:flex;gap:0.75rem;margin-top:0.2rem;font-size:0.75rem;color:#6B7280;">';
        html += '<span>' + escapeHtml(dueLabel) + '</span>';
        if (t.Lead_Name) html += '<span>' + escapeHtml(t.Lead_Name) + '</span>';
        html += '</div>';
        html += '</a>';
        html += '</div>';
      });
      listEl.innerHTML = html;

      // Wire up complete-task buttons
      var completeBtns = listEl.querySelectorAll('.cc-notif-complete-btn');
      for (var i = 0; i < completeBtns.length; i++) {
        completeBtns[i].addEventListener('click', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var btn = this;
          var taskId = btn.getAttribute('data-task-id');
          if (!taskId) return;
          btn.disabled = true;
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1A2F4B" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
          fetch('https://n8n.tabuchilaw.com/webhook/cc/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token },
            body: JSON.stringify({ action: 'update', id: taskId, fields: { Status: 'COMPLETED' } })
          }).then(function(r) { return r.json(); }).then(function(d) {
            // Remove the row
            var row = btn.closest('[data-task-id]');
            if (row) row.style.display = 'none';
            // Invalidate cache and re-render
            sessionStorage.removeItem(CACHE_KEY);
            sessionStorage.removeItem(CACHE_TS_KEY);
            // Decrement badge
            var current = parseInt(badge.textContent || '0', 10) - 1;
            if (current <= 0) {
              badge.style.display = 'none';
              listEl.innerHTML = '<div style="padding:1rem;color:#9CA3AF;font-size:0.85rem;text-align:center;">No overdue or due-today tasks</div>';
            } else {
              badge.textContent = current;
            }
          }).catch(function() {
            btn.disabled = false;
            btn.innerHTML = '';
            alert('Failed to mark task complete. Please try again.');
          });
        });
      }
    }

    function fetchAndRender() {
      // Check cache
      var cached = sessionStorage.getItem(CACHE_KEY);
      var cachedTs = parseInt(sessionStorage.getItem(CACHE_TS_KEY) || '0', 10);
      if (cached && (Date.now() - cachedTs) < CACHE_TTL) {
        try {
          var cachedTasks = JSON.parse(cached);
          renderTasks(cachedTasks);
          return;
        } catch (e) { /* fall through to fetch */ }
      }

      var today = todayStr();

      // Resolve CRM user ID if not cached (maps dashboard_token → CC_Users record ID)
      var resolveUser = crmUserId
        ? Promise.resolve(crmUserId)
        : fetch('https://n8n.tabuchilaw.com/webhook/cc/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token },
            body: JSON.stringify({ action: 'list_users' })
          }).then(function(r) { return r.json(); }).then(function(d) {
            var users = d.users || [];
            var me = users.find(function(u) { return u.dashboard_token === token; });
            var id = me ? me.id : '';
            if (id) sessionStorage.setItem('cc_crm_user_id', id);
            return id;
          }).catch(function() { return ''; });

      resolveUser.then(function(myId) {
        crmUserId = myId;
        return fetch('https://n8n.tabuchilaw.com/webhook/cc/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token },
          body: JSON.stringify({ action: 'list' })
        });
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Filter: OPEN tasks, due today or overdue, owned by current CRM user
        // Excludes unassigned tasks (e.g. SLA tasks not yet claimed)
        var tasks = (data.tasks || []).filter(function(t) {
          if (t.Status !== 'OPEN') return false;
          if (!t.Due_At) return false;
          if (t.Due_At.slice(0, 10) > today) return false;
          if (!crmUserId) return false; // can't determine ownership without user ID
          if (!t.Owner || t.Owner.length === 0) return false; // skip unassigned
          return t.Owner.indexOf(crmUserId) !== -1;
        });
        // Sort: overdue first, then today
        tasks.sort(function(a, b) {
          if (a.Due_At < b.Due_At) return -1;
          if (a.Due_At > b.Due_At) return 1;
          return 0;
        });
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(tasks));
        sessionStorage.setItem(CACHE_TS_KEY, String(Date.now()));
        renderTasks(tasks);
      })
      .catch(function() {
        listEl.innerHTML = '<div style="padding:1rem;color:#9CA3AF;font-size:0.85rem;text-align:center;">Failed to load</div>';
      });
    }

    // Fetch on first click, then periodically refresh
    var notifBtn = bar.querySelector('#app-notif-btn');
    var loaded = false;
    if (notifBtn) {
      notifBtn.addEventListener('click', function() {
        if (!loaded) { fetchAndRender(); loaded = true; }
      });
    }
    // Also fetch badge count eagerly (lightweight)
    fetchAndRender();
  })();

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
          '<div class="cc-settings-section">' +
            '<h4>Start Page</h4>' +
            '<p style="font-size:0.85rem;color:#6B7280;margin:0 0 8px;">Choose which page to show when you click Home</p>' +
            '<select id="cc-ms-start-page" class="cc-input" style="max-width:240px;">' +
              '<option value="dashboard">Dashboard</option>' +
              '<option value="leads">Leads</option>' +
            '</select>' +
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
              if (prefs.start_page) {
                document.getElementById('cc-ms-start-page').value = prefs.start_page;
              }
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
        var startPage = document.getElementById('cc-ms-start-page').value;
        var prefs = {
          email_notify: document.getElementById('cc-ms-notif-email').checked,
          sms_notify: document.getElementById('cc-ms-notif-sms').checked,
          call_log_auto: document.getElementById('cc-ms-notif-call-log').checked,
          start_page: startPage
        };
        localStorage.setItem('cc_start_page', startPage);
        // Update home link immediately
        var hl = document.querySelector('#app-home-link');
        if (hl) hl.href = startPage === 'leads' ? '/crm' : '/crm/dashboard';
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
