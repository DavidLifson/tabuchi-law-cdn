/**
 * Tabuchi Law Booking System - Dashboard Overview
 * Handles: /dashboard
 *
 * Requires: api-client.js loaded first
 *
 * Shows:
 * - Today's bookings
 * - Quick stats (upcoming, this week, pending)
 * - Recent bookings list
 * - Navigation links to meeting types, availability, settings
 *
 * Page element IDs:
 * - #tb-dash-staff-name (displays logged in staff name)
 * - #tb-dash-today-count, #tb-dash-upcoming-count, #tb-dash-week-count
 * - #tb-dash-today-list (today's bookings container)
 * - #tb-dash-recent-list (recent upcoming bookings container)
 * - #tb-loading, #tb-error
 * - #tb-logout-btn
 */

(async function DashboardOverview() {
  'use strict';

  const _root = document.querySelector('#tb-page-root');
  function $el(id) { return _root ? _root.querySelector('#' + id) : document.getElementById(id); }

  // Auth check
  const token = localStorage.getItem('app_token');
  if (!token) {
    window.location.href = '/login';
    return;
  }

  // Show admin dropdown if user is an admin
  try {
    const staffInfo = JSON.parse(localStorage.getItem('app_user') || '{}');
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

  // Logout handler
  $el('tb-logout-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('app_token');
    localStorage.removeItem('app_user');
    window.location.href = '/login';
  });

  // Display staff name from cache
  try {
    const staffCache = JSON.parse(localStorage.getItem('app_user') || '{}');
    if (staffCache.name) setText('tb-dash-staff-name', staffCache.name);
  } catch(e) { /* ignore parse errors */ }

  // Load bookings
  TabuchiAPI.util.showLoading('tb-loading');

  try {
    const [upcomingResult, pastResult] = await Promise.all([
      TabuchiAPI.dashboard.getBookings('upcoming'),
      TabuchiAPI.dashboard.getBookings('past')
    ]);

    hideEl('tb-loading');

    const upcoming = upcomingResult.bookings || [];
    const past = pastResult.bookings || [];

    // Calculate stats
    const today = new Date().toISOString().split('T')[0];
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const weekStr = weekFromNow.toISOString().split('T')[0];

    const todayBookings = upcoming.filter(b => b.date === today);
    const weekBookings = upcoming.filter(b => b.date >= today && b.date <= weekStr);

    // Stats
    setText('tb-dash-today-count', String(todayBookings.length));
    setText('tb-dash-upcoming-count', String(upcoming.length));
    setText('tb-dash-week-count', String(weekBookings.length));

    // Today's bookings
    const todayContainer = $el('tb-dash-today-list');
    if (todayContainer) {
      if (todayBookings.length === 0) {
        todayContainer.innerHTML = '<p class="tb-no-slots">No bookings for today.</p>';
      } else {
        todayContainer.innerHTML = todayBookings.map(b => renderBookingRow(b)).join('');
      }
    }

    // Upcoming bookings
    const recentContainer = $el('tb-dash-recent-list');
    if (recentContainer) {
      const nextBookings = upcoming.slice(0, 10);
      if (nextBookings.length === 0) {
        recentContainer.innerHTML = '<p class="tb-no-slots">No upcoming bookings.</p>';
      } else {
        recentContainer.innerHTML = nextBookings.map(b => renderBookingRow(b)).join('');
      }
    }

    showEl('tb-dash-today-list');
    showEl('tb-dash-recent-list');

  } catch (err) {
    hideEl('tb-loading');
    if (err.status === 401) {
      localStorage.removeItem('app_token');
      window.location.href = '/login';
      return;
    }
    TabuchiAPI.util.showError('tb-error', err.error || 'Unable to load dashboard.');
  }

  function renderBookingRow(booking) {
    const statusClass = `tb-status-${(booking.status || 'confirmed').toLowerCase()}`;
    return `
      <div class="tb-booking-row">
        <div>
          <strong>${booking.clientName || 'Unknown'}</strong>
          <div style="font-size:0.85rem;color:var(--tb-text-light);">
            ${booking.serviceName || booking.meetingTypeName || ''} &middot;
            ${TabuchiAPI.util.formatDate(booking.date)} at ${TabuchiAPI.util.formatTime(booking.time || booking.startTime)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span class="tb-status-badge ${statusClass}">${booking.status || 'confirmed'}</span>
          ${booking.meetingLink ? `<a href="${booking.meetingLink}" target="_blank" class="tb-btn tb-btn-secondary" style="padding:0.3rem 0.6rem;font-size:0.8rem;">Join</a>` : ''}
        </div>
      </div>
    `;
  }

  function setText(id, t) { const el = $el(id); if (el) el.textContent = t || ''; }
  function showEl(id) { const el = $el(id); if (el) el.style.display = ''; }
  function hideEl(id) { const el = $el(id); if (el) el.style.display = 'none'; }
})();
