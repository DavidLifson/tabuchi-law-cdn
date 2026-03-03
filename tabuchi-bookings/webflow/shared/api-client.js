/**
 * Tabuchi Law Booking System - API Client
 * Shared helper for all Webflow pages to communicate with n8n backend.
 *
 * Usage: Include this script before page-specific scripts.
 * Loaded via Webflow site-wide footer custom code.
 */

const TabuchiAPI = (() => {
  // n8n production webhook URLs - each workflow may have a different webhookId prefix.
  // These are the actual registered production URLs confirmed from n8n's "Copy production url".
  const WH = 'https://tabuchilaw.app.n8n.cloud/webhook';
  const ROUTES = {
    '/api/staff':               `${WH}`,
    '/api/meeting-type':        `${WH}`,
    '/api/availability':        `${WH}`,
    '/api/availability-batch':  `${WH}`,
    '/api/book':                `${WH}`,
    '/api/booking':             `${WH}`,
    '/api/reschedule':          `${WH}`,
    '/api/cancel':              `${WH}`,
    '/api/dashboard/bookings':  `${WH}`,
    '/api/dashboard/meeting-type': `${WH}`,
    '/api/dashboard/availability': `${WH}`,
    '/api/dashboard/blocked-dates': `${WH}`,
    '/api/dashboard/settings':  `${WH}`,
    '/api/dashboard/sync-microsoft': `${WH}`,
    '/api/admin/staff':         `${WH}`,
    '/api/admin/categories':    `${WH}`,
    '/api/dashboard/login-sso': `${WH}`
  };

  // ─── Availability Cache (in-memory) ────────────────────────────
  // Key: `${staffId}-${meetingTypeId}-${date}`, Value: { slots, available, fetchedAt }
  const _availCache = new Map();
  const AVAIL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes (server cache is 15 min)

  // Hydrate availability cache from localStorage on load
  (function() {
    try {
      var stored = JSON.parse(localStorage.getItem('tb_avail_cache') || '{}');
      var now = Date.now();
      for (var key in stored) {
        if (stored.hasOwnProperty(key) && now - stored[key].fetchedAt < AVAIL_CACHE_TTL) {
          _availCache.set(key, stored[key]);
        }
      }
    } catch(e) {}
  })();

  function _persistAvailCache() {
    try {
      var obj = {};
      _availCache.forEach(function(val, key) { obj[key] = val; });
      localStorage.setItem('tb_avail_cache', JSON.stringify(obj));
    } catch(e) {}
  }

  // Stale-while-revalidate helper for dashboard API calls
  async function _cachedRequest(cacheKey, fetchFn, freshMs, staleMs) {
    try {
      var raw = localStorage.getItem(cacheKey);
      if (raw) {
        var parsed = JSON.parse(raw);
        var age = Date.now() - parsed.at;
        if (age < freshMs) return parsed.data;
        if (age < staleMs) {
          fetchFn().then(function(d) {
            localStorage.setItem(cacheKey, JSON.stringify({data:d, at:Date.now()}));
          }).catch(function(){});
          return parsed.data;
        }
      }
    } catch(e) {}
    var data = await fetchFn();
    try { localStorage.setItem(cacheKey, JSON.stringify({data:data, at:Date.now()})); } catch(e) {}
    return data;
  }

  // ─── localStorage Cache for Meeting-Type Data ─────────────────
  const MT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (meeting types rarely change)

  function resolveUrl(path) {
    // Check longest prefixes first to avoid partial matches
    const keys = Object.keys(ROUTES).sort((a, b) => b.length - a.length);
    for (const prefix of keys) {
      if (path === prefix || path.startsWith(prefix)) {
        return `${ROUTES[prefix]}${path}`;
      }
    }
    return `${WH}${path}`;
  }

  async function request(method, path, options = {}) {
    const url = new URL(resolveUrl(path));
    if (options.params) {
      Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    if (options.body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url.toString(), fetchOptions);
      const data = await response.json();
      if (!response.ok) {
        throw { status: response.status, ...data };
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      throw { status: 0, success: false, error: 'Network error. Please try again.' };
    }
  }

  // ─── Public Booking APIs ────────────────────────────────────────

  /**
   * Get staff profile + meeting types by slug
   * @param {string} slug - Staff URL slug (e.g., "david-l")
   */
  async function getStaff(slug) {
    return request('GET', '/api/staff', {
      params: { slug }
    });
  }

  /**
   * Get meeting type details + intake questions
   * @param {string} staffSlug - Staff URL slug
   * @param {string} meetingSlug - Meeting type URL slug
   */
  async function getMeetingType(staffSlug, meetingSlug) {
    const cacheKey = `tabuchi_mt_${staffSlug}_${meetingSlug}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data, cachedAt } = JSON.parse(cached);
        if (Date.now() - cachedAt < MT_CACHE_TTL) return data;
      }
    } catch (e) { /* ignore parse errors */ }

    const data = await request('GET', '/api/meeting-type', {
      params: { staffSlug, meetingSlug }
    });

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, cachedAt: Date.now() }));
    } catch (e) { /* quota exceeded or unavailable */ }

    return data;
  }

  /**
   * Get available time slots for a date
   * @param {string} staffId - Airtable staff record ID
   * @param {string} meetingTypeId - Airtable meeting type record ID
   * @param {string} date - YYYY-MM-DD format
   */
  async function getAvailability(staffId, meetingTypeId, date) {
    // Check in-memory cache first
    const key = `${staffId}-${meetingTypeId}-${date}`;
    const cached = _availCache.get(key);
    if (cached && (Date.now() - cached.fetchedAt) < AVAIL_CACHE_TTL) {
      return { success: true, slots: cached.slots };
    }

    // Cache miss — fall back to single-date API
    const data = await request('GET', '/api/availability', {
      params: { staffId, meetingTypeId, date }
    });

    // Store in cache
    _availCache.set(key, {
      slots: data.slots || [],
      available: (data.slots || []).length > 0,
      fetchedAt: Date.now()
    });
    _persistAvailCache();

    return data;
  }

  /**
   * Batch-fetch availability for a date range (up to 42 days).
   * Populates the in-memory cache so subsequent getAvailability() calls are instant.
   * @param {string} staffId - Airtable staff record ID
   * @param {string} meetingTypeId - Airtable meeting type record ID
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {{ availability: Object<string, { available: boolean, slots: string[] }> }}
   */
  async function getBatchAvailability(staffId, meetingTypeId, startDate, endDate) {
    const data = await request('GET', '/api/availability-batch', {
      params: { staffId, meetingTypeId, startDate, endDate }
    });

    // Populate cache for every date in the response
    if (data.success && data.availability) {
      const now = Date.now();
      for (const [date, info] of Object.entries(data.availability)) {
        _availCache.set(`${staffId}-${meetingTypeId}-${date}`, {
          slots: info.slots || [],
          available: info.available,
          fetchedAt: now
        });
      }
      _persistAvailCache();
    }

    return data;
  }

  /**
   * Get day-level availability indicators from cache (no API call).
   * Returns { date: boolean } for each date in range that is cached.
   */
  function getCachedDayIndicators(staffId, meetingTypeId, startDate, endDate) {
    const result = {};
    const cur = new Date(startDate + 'T12:00:00');
    const end = new Date(endDate + 'T12:00:00');
    while (cur <= end) {
      const dateStr = cur.toISOString().split('T')[0];
      const cached = _availCache.get(`${staffId}-${meetingTypeId}-${dateStr}`);
      if (cached && (Date.now() - cached.fetchedAt) < AVAIL_CACHE_TTL) {
        result[dateStr] = cached.available;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }

  /** Clear all cached availability (call after booking/reschedule/cancel). */
  function clearAvailabilityCache() {
    _availCache.clear();
    try { localStorage.removeItem('tb_avail_cache'); } catch(e) {}
  }

  /**
   * Create a booking
   * @param {Object} bookingData - { meetingTypeId, date, time, clientName, clientEmail, clientPhone, intakeResponses }
   */
  async function createBooking(bookingData) {
    return request('POST', '/api/book', { body: bookingData });
  }

  /**
   * Get booking details (for reschedule/cancel pages)
   * @param {string} bookingId - Booking ID (e.g., "BK-20250215-A3F2")
   * @param {string} token - Reschedule or cancel token
   */
  async function getBooking(bookingId, token) {
    return request('GET', '/api/booking', {
      params: { bookingId, token }
    });
  }

  /**
   * Reschedule a booking
   * @param {Object} data - { bookingId, token, newDate, newTime }
   */
  async function rescheduleBooking(data) {
    return request('POST', '/api/reschedule', { body: data });
  }

  /**
   * Cancel a booking
   * @param {Object} data - { bookingId, token, reason }
   */
  async function cancelBooking(data) {
    return request('POST', '/api/cancel', { body: data });
  }

  // ─── Staff Dashboard APIs ──────────────────────────────────────

  function dashboardHeaders() {
    const token = localStorage.getItem('app_token') || '';
    return { 'Dashboard_Token': token };
  }

  async function dashboardLoginSSO(idToken) {
    return request('POST', '/api/dashboard/login-sso', {
      body: { id_token: idToken }
    });
  }

  async function dashboardGetBookings(status = 'upcoming') {
    return _cachedRequest('tb_dash_bk_' + status, function() {
      return request('GET', '/api/dashboard/bookings', {
        params: { status },
        headers: dashboardHeaders()
      });
    }, 60000, 300000); // 1 min fresh, 5 min stale
  }

  async function dashboardSaveMeetingType(meetingTypeData) {
    return request('POST', '/api/dashboard/meeting-type', {
      body: meetingTypeData,
      headers: dashboardHeaders()
    });
  }

  async function dashboardDeleteMeetingType(meetingTypeId) {
    return request('POST', '/api/dashboard/meeting-type', {
      body: { id: meetingTypeId, _action: 'delete' },
      headers: dashboardHeaders()
    });
  }

  async function dashboardUpdateAvailability(availabilityData) {
    return request('POST', '/api/dashboard/availability', {
      body: availabilityData,
      headers: dashboardHeaders()
    });
  }

  async function dashboardBlockedDates(data) {
    return request('POST', '/api/dashboard/blocked-dates', {
      body: data,
      headers: dashboardHeaders()
    });
  }

  async function dashboardGetBlockedDates() {
    return request('GET', '/api/dashboard/blocked-dates', {
      headers: dashboardHeaders()
    });
  }

  async function dashboardUpdateSettings(settingsData) {
    return request('POST', '/api/dashboard/settings', {
      body: settingsData,
      headers: dashboardHeaders()
    });
  }

  async function dashboardSyncMicrosoft() {
    return request('POST', '/api/dashboard/sync-microsoft', {
      headers: dashboardHeaders()
    });
  }

  // ─── Admin APIs ───────────────────────────────────────────────

  function adminHeaders() {
    // Admin uses the unified app_token; backend WF-19 validates via Admin_Token header
    const token = localStorage.getItem('app_token') || '';
    return { 'Admin_Token': token };
  }

  async function adminListOffice365Users() {
    return request('POST', '/api/admin/staff', {
      body: { action: 'list-office365-users' },
      headers: adminHeaders()
    });
  }

  async function adminImportUser(userId, displayName, email) {
    return request('POST', '/api/admin/staff', {
      body: { action: 'import-user', userId, displayName, email },
      headers: adminHeaders()
    });
  }

  async function adminListStaff() {
    return request('POST', '/api/admin/staff', {
      body: { action: 'list-staff' },
      headers: adminHeaders()
    });
  }

  async function adminToggleStaff(staffId, active) {
    return request('POST', '/api/admin/staff', {
      body: { action: 'toggle-staff', staffId, active },
      headers: adminHeaders()
    });
  }

  async function adminCategories(action, data = {}) {
    return request('POST', '/api/admin/categories', {
      body: { action, ...data },
      headers: dashboardHeaders()
    });
  }

  // ─── Utility Helpers ───────────────────────────────────────────

  /**
   * Format a date string for display
   * @param {string} dateStr - YYYY-MM-DD
   * @returns {string} "Monday, February 15, 2025"
   */
  function formatDate(dateStr) {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  /**
   * Format a time string for display
   * @param {string} time - "14:00"
   * @returns {string} "2:00 PM"
   */
  function formatTime(time) {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  /**
   * Generate an .ics calendar file content
   */
  function generateICS(booking) {
    const start = `${booking.date.replace(/-/g, '')}T${booking.time.replace(':', '')}00`;
    const end = `${booking.date.replace(/-/g, '')}T${booking.endTime.replace(':', '')}00`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Tabuchi Law//Booking System//EN',
      'BEGIN:VEVENT',
      `DTSTART;TZID=America/Toronto:${start}`,
      `DTEND;TZID=America/Toronto:${end}`,
      `SUMMARY:${booking.meetingTypeName} - ${booking.staffName}`
    ];
    if (booking.joinUrl) {
      const label = booking.joinUrl.includes('zoom.us') ? 'Join Zoom Meeting' : 'Join Teams Meeting';
      lines.push(`DESCRIPTION:${label}: ${booking.joinUrl}`);
      lines.push(`URL:${booking.joinUrl}`);
    } else {
      lines.push(`DESCRIPTION:${booking.meetingTypeName} with ${booking.staffName}`);
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
  }

  /**
   * Download an .ics file
   */
  function downloadICS(booking) {
    const ics = generateICS(booking);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${booking.meetingTypeName.replace(/\s+/g, '-')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Generate a Google Calendar URL for adding an event
   * @param {Object} booking - { date, time, endTime, meetingTypeName, staffName, joinUrl }
   * @returns {string} Google Calendar URL
   */
  function generateGoogleCalUrl(booking) {
    const start = `${booking.date.replace(/-/g, '')}T${booking.time.replace(':', '')}00`;
    const end = `${booking.date.replace(/-/g, '')}T${booking.endTime.replace(':', '')}00`;
    const title = `${booking.meetingTypeName} - ${booking.staffName}`;
    let details = `${booking.meetingTypeName} with ${booking.staffName}`;
    if (booking.joinUrl) {
      const label = booking.joinUrl.includes('zoom.us') ? 'Join Zoom Meeting' : 'Join Teams Meeting';
      details += `\n\n${label}: ${booking.joinUrl}`;
    }
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${start}/${end}`,
      details: details,
      ctz: 'America/Toronto'
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /**
   * Generate an Outlook.com calendar URL for adding an event
   * @param {Object} booking - { date, time, endTime, meetingTypeName, staffName, joinUrl }
   * @returns {string} Outlook calendar URL
   */
  function generateOutlookCalUrl(booking) {
    const title = `${booking.meetingTypeName} - ${booking.staffName}`;
    const startDt = `${booking.date}T${booking.time}:00`;
    const endDt = `${booking.date}T${booking.endTime}:00`;
    let body = `${booking.meetingTypeName} with ${booking.staffName}`;
    if (booking.joinUrl) {
      const label = booking.joinUrl.includes('zoom.us') ? 'Join Zoom Meeting' : 'Join Teams Meeting';
      body += `\n\n${label}: ${booking.joinUrl}`;
    }
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: title,
      startdt: startDt,
      enddt: endDt,
      body: body
    });
    return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
  }

  /**
   * Get URL parameters
   */
  function getUrlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  /**
   * Get path segments from URL
   * e.g., /book/david-l/estate-planning → ["book", "david-l", "estate-planning"]
   */
  function getPathSegments() {
    return window.location.pathname.split('/').filter(Boolean);
  }

  /**
   * Show a loading spinner in a container
   */
  function showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="tb-loading"><div class="tb-spinner"></div><p>Loading...</p></div>';
  }

  /**
   * Show an error message in a container
   */
  function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `<div class="tb-error"><p>${message}</p></div>`;
  }

  // Public API
  return {
    getStaff, getMeetingType, getAvailability, getBatchAvailability,
    getCachedDayIndicators, clearAvailabilityCache,
    createBooking, getBooking, rescheduleBooking, cancelBooking,
    dashboard: {
      loginSSO: dashboardLoginSSO,
      getBookings: dashboardGetBookings,
      saveMeetingType: dashboardSaveMeetingType,
      deleteMeetingType: dashboardDeleteMeetingType,
      updateAvailability: dashboardUpdateAvailability,
      blockedDates: dashboardBlockedDates,
      getBlockedDates: dashboardGetBlockedDates,
      updateSettings: dashboardUpdateSettings,
      syncMicrosoft: dashboardSyncMicrosoft
    },
    admin: {
      listOffice365Users: adminListOffice365Users,
      importUser: adminImportUser,
      listStaff: adminListStaff,
      toggleStaff: adminToggleStaff,
      categories: adminCategories
    },
    util: {
      formatDate, formatTime, generateICS, downloadICS,
      generateGoogleCalUrl, generateOutlookCalUrl,
      getUrlParams, getPathSegments, showLoading, showError
    }
  };
})();
