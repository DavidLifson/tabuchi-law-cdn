/**
 * Tabuchi Law Booking System - Dashboard Bookings List
 * Handles: /dashboard/bookings
 *
 * Requires: api-client.js loaded first
 *
 * Full bookings management with status filter tabs.
 *
 * Page element IDs:
 * - #tb-bookings-tab-upcoming, #tb-bookings-tab-past, #tb-bookings-tab-cancelled (tab buttons)
 * - #tb-bookings-list (bookings container)
 * - #tb-bookings-count (total count display)
 * - #tb-category-filter (category filter dropdown)
 * - #tb-sort (sort dropdown: date | name)
 * - #tb-sort-dir (sort direction toggle button: ↑ asc / ↓ desc)
 * - #tb-loading, #tb-error
 */

(async function BookingsListPage() {
  'use strict';

  // Auth check
  const token = localStorage.getItem('app_token');
  if (!token) { window.location.href = '/login'; return; }

  let currentTab = 'upcoming';
  let currentSort = 'date';
  let sortDir = 'asc';
  let currentCategory = '';
  let bookings = [];

  function getDefaultSortDir() {
    if (currentSort === 'name') return 'asc';
    return currentTab === 'upcoming' ? 'asc' : 'desc';
  }

  function updateSortDirButton() {
    const btn = document.getElementById('tb-sort-dir');
    if (btn) btn.textContent = sortDir === 'asc' ? '↑' : '↓';
  }

  // Bind tab buttons
  ['upcoming', 'past', 'cancelled'].forEach(tab => {
    document.getElementById(`tb-bookings-tab-${tab}`)?.addEventListener('click', () => {
      currentTab = tab;
      currentSort = 'date';
      sortDir = getDefaultSortDir();
      const sortEl = document.getElementById('tb-sort');
      if (sortEl) sortEl.value = 'date';
      updateSortDirButton();
      updateTabStyles();
      loadBookings();
    });
  });

  // Bind sort dropdown
  const sortDropdown = document.getElementById('tb-sort');
  if (sortDropdown) sortDropdown.addEventListener('change', function() {
    currentSort = this.value;
    sortDir = getDefaultSortDir();
    updateSortDirButton();
    renderBookings();
  });

  // Bind sort direction toggle
  const sortDirBtn = document.getElementById('tb-sort-dir');
  if (sortDirBtn) sortDirBtn.addEventListener('click', function() {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    updateSortDirButton();
    renderBookings();
  });

  // Bind category filter
  const catFilterEl = document.getElementById('tb-category-filter');
  if (catFilterEl) catFilterEl.addEventListener('change', function() {
    currentCategory = this.value;
    renderBookings();
  });

  function populateCategoryFilter() {
    const filterEl = document.getElementById('tb-category-filter');
    if (!filterEl) return;
    const cats = {};
    for (const b of bookings) {
      const c = (b.category || '').trim();
      if (c) cats[c] = true;
    }
    const sorted = Object.keys(cats).sort();
    let html = '<option value="">\u2014</option>';
    for (const cat of sorted) {
      html += `<option value="${cat}"${currentCategory === cat ? ' selected' : ''}>${cat}</option>`;
    }
    filterEl.innerHTML = html;
  }

  // Initial load
  updateTabStyles();
  await loadBookings();

  async function loadBookings() {
    const container = document.getElementById('tb-bookings-list');
    if (container) container.innerHTML = '<div class="tb-loading"><div class="tb-spinner"></div></div>';

    try {
      const result = await TabuchiAPI.dashboard.getBookings(currentTab);
      bookings = result.bookings || [];
      populateCategoryFilter();
      renderBookings();
    } catch (err) {
      if (err.status === 401) { window.location.href = '/login'; return; }
      if (container) container.innerHTML = `<div class="tb-error">${err.error || 'Unable to load bookings.'}</div>`;
    }
  }

  function renderBookings() {
    const container = document.getElementById('tb-bookings-list');
    if (!container) return;

    if (bookings.length === 0) {
      const messages = {
        upcoming: 'No upcoming bookings.',
        past: 'No past bookings.',
        cancelled: 'No cancelled bookings.'
      };
      container.innerHTML = `<p class="tb-no-slots">${messages[currentTab]}</p>`;
      setText('tb-bookings-count', '0 bookings');
      return;
    }

    // Filter by category
    let filtered = bookings;
    if (currentCategory) {
      filtered = bookings.filter(b => b.category === currentCategory);
    }

    setText('tb-bookings-count', `${filtered.length} booking${filtered.length !== 1 ? 's' : ''}`);

    if (filtered.length === 0) {
      container.innerHTML = '<p class="tb-no-slots">No bookings in this category.</p>';
      return;
    }

    // Sort filtered list
    const dir = sortDir === 'asc' ? 1 : -1;
    if (currentSort === 'name') {
      filtered.sort((a, b) => {
        const nameA = (a.clientName || '').toLowerCase();
        const nameB = (b.clientName || '').toLowerCase();
        return (nameA < nameB ? -1 : nameA > nameB ? 1 : 0) * dir;
      });
    } else {
      filtered.sort((a, b) => {
        const da = a.date + (a.time || a.startTime || '');
        const db = b.date + (b.time || b.startTime || '');
        return (da < db ? -1 : da > db ? 1 : 0) * dir;
      });
    }

    let html = '';
    let currentDate = '';

    for (const booking of filtered) {
      // Date group header (only when sorted by date)
      if (currentSort === 'date' && booking.date !== currentDate) {
        currentDate = booking.date;
        html += `<div style="padding:0.75rem 0 0.25rem;font-weight:600;color:var(--tb-text);border-bottom:2px solid var(--tb-border);margin-top:0.5rem;">${TabuchiAPI.util.formatDate(booking.date)}</div>`;
      }

      const statusClass = `tb-status-${(booking.status || 'confirmed').toLowerCase()}`;
      const time = booking.time || booking.startTime;

      html += `
        <div class="tb-booking-row" style="flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <strong>${booking.clientName || 'Unknown'}</strong>
              <span class="tb-status-badge ${statusClass}">${booking.status || 'confirmed'}</span>
            </div>
            <div style="font-size:0.85rem;color:var(--tb-text-light);margin-top:0.2rem;">
              ${time ? TabuchiAPI.util.formatTime(time) : ''} &middot;
              ${booking.serviceName || booking.meetingTypeName || 'Appointment'} &middot;
              ${booking.duration || ''} min
              ${booking.witnessNames && booking.witnessNames.length > 0 ? ` &middot; <span style="color:#7C3AED;">Witnesses: ${booking.witnessNames.join(', ')}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            ${booking.clientEmail ? `<a href="mailto:${booking.clientEmail}" style="font-size:0.8rem;color:var(--tb-accent);">${booking.clientEmail}</a>` : ''}
            ${booking.clientPhone ? `<span style="font-size:0.8rem;color:var(--tb-text-light);">${booking.clientPhone}</span>` : ''}
            ${booking.meetingLink && booking.status !== 'cancelled' ? `<a href="${booking.meetingLink}" target="_blank" class="tb-btn tb-btn-secondary" style="padding:0.3rem 0.6rem;font-size:0.8rem;">Join Meeting</a>` : ''}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  function updateTabStyles() {
    ['upcoming', 'past', 'cancelled'].forEach(tab => {
      const btn = document.getElementById(`tb-bookings-tab-${tab}`);
      if (btn) {
        if (tab === currentTab) {
          btn.classList.add('tb-btn-primary');
          btn.classList.remove('tb-btn-secondary');
        } else {
          btn.classList.remove('tb-btn-primary');
          btn.classList.add('tb-btn-secondary');
        }
      }
    });
  }

  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t || ''; }
})();
