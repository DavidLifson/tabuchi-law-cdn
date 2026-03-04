/**
 * Tabuchi Law Booking System - Reschedule Page
 * Handles: /book/reschedule?bookingId=...&token=...
 *
 * Requires: api-client.js loaded first
 *
 * Page element IDs:
 * - #tb-loading, #tb-error
 * - #tb-current-booking (shows current booking details)
 * - #tb-current-date, #tb-current-time, #tb-current-meeting, #tb-current-staff
 * - #tb-reschedule-calendar (date picker for new date)
 * - #tb-reschedule-slots (time slots for new date)
 * - #tb-reschedule-confirm-btn
 * - #tb-reschedule-success, #tb-reschedule-error
 */

(async function ReschedulePage() {
  'use strict';

  const params = TabuchiAPI.util.getUrlParams();
  const bookingId = params.bookingId;
  const token = params.token;

  if (!bookingId || !token) {
    TabuchiAPI.util.showError('tb-error', 'Invalid reschedule link.');
    return;
  }

  let bookingData = null;
  let selectedDate = null;
  let selectedTime = null;

  // ─── Day Indicator CSS ─────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .tb-cal-day { position: relative; }
    .tb-cal-day.tb-has-availability::after {
      content: ''; width: 6px; height: 6px; background: #22c55e;
      border-radius: 50%; position: absolute; bottom: 4px;
      left: 50%; transform: translateX(-50%);
    }
    .tb-cal-day.tb-no-availability { opacity: 0.4; }
  `;
  document.head.appendChild(style);

  // Load current booking
  TabuchiAPI.util.showLoading('tb-loading');
  try {
    const result = await TabuchiAPI.getBooking(bookingId, token);
    bookingData = result.booking;
    hideEl('tb-loading');
    renderCurrentBooking();
    cleanupDuplicateElements();
    ensureHeadingAboveCalendar();
    renderCalendar();
    showEl('tb-current-booking');
    showEl('tb-select-date-heading');
    showEl('tb-reschedule-calendar');

    // Kick off batch availability fetch for current month (non-blocking)
    fetchMonthAvailability(new Date());
  } catch (err) {
    hideEl('tb-loading');
    TabuchiAPI.util.showError('tb-error', err.error || 'Unable to load booking. The link may be invalid or expired.');
    return;
  }

  // ─── Batch Availability & Day Indicators ─────────────────────
  const _fetchedMonths = new Set();

  async function fetchMonthAvailability(monthDate) {
    if (!bookingData) return;
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const key = `${year}-${month}`;
    if (_fetchedMonths.has(key)) { applyDayIndicators(); return; }

    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    try {
      await TabuchiAPI.getBatchAvailability(bookingData.staffId, bookingData.meetingTypeId, startDate, endDate);
      _fetchedMonths.add(key);
      applyDayIndicators();
    } catch (e) { /* silently fail — user can still click individual dates */ }
  }

  function applyDayIndicators() {
    if (!bookingData) return;
    document.querySelectorAll('.tb-cal-day[data-date]').forEach(el => {
      const date = el.dataset.date;
      const indicators = TabuchiAPI.getCachedDayIndicators(bookingData.staffId, bookingData.meetingTypeId, date, date);
      if (date in indicators) {
        el.classList.remove('tb-has-availability', 'tb-no-availability');
        el.classList.add(indicators[date] ? 'tb-has-availability' : 'tb-no-availability');
      }
    });
  }

  function renderCurrentBooking() {
    setText('tb-current-date', TabuchiAPI.util.formatDate(bookingData.date));
    setText('tb-current-time', TabuchiAPI.util.formatTime(bookingData.startTime));
    // Hide the "With:" row if staffName is not available from the API
    const staffName = bookingData.staffName || '';
    setText('tb-current-staff', staffName);
    if (!staffName) {
      const staffEl = document.getElementById('tb-current-staff');
      if (staffEl && staffEl.previousElementSibling) {
        // Hide both the "With:" label and the empty value span
        staffEl.previousElementSibling.style.display = 'none';
        staffEl.style.display = 'none';
      }
    }
  }

  function renderCalendar() {
    const container = document.getElementById('tb-reschedule-calendar');
    if (!container) return;

    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 60);
    let currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    function build() {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      let html = `<div class="tb-calendar"><div class="tb-calendar-header"><button id="tb-rsc-prev">&larr;</button><span>${monthName}</span><button id="tb-rsc-next">&rarr;</button></div><div class="tb-calendar-grid">`;
      html += ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="tb-cal-day-header">${d}</div>`).join('');
      for (let i = 0; i < firstDay; i++) html += '<div class="tb-cal-day tb-cal-empty"></div>';
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const past = d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const far = d > maxDate;
        let cls = 'tb-cal-day';
        if (past || far) cls += ' tb-cal-disabled'; else cls += ' tb-cal-available';
        if (ds === selectedDate) cls += ' tb-cal-selected';
        html += `<div class="${cls}" data-date="${ds}">${day}</div>`;
      }
      html += '</div></div>';
      container.innerHTML = html;

      document.getElementById('tb-rsc-prev')?.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth()-1);
        if (currentMonth < new Date(today.getFullYear(), today.getMonth(), 1)) currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        build();
        fetchMonthAvailability(currentMonth);
      });
      document.getElementById('tb-rsc-next')?.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth()+1);
        build();
        fetchMonthAvailability(currentMonth);
      });
      container.querySelectorAll('.tb-cal-available').forEach(el => el.addEventListener('click', () => loadSlots(el.dataset.date)));

      // Apply cached day indicators after building the calendar
      applyDayIndicators();
    }
    build();
  }

  async function loadSlots(dateStr) {
    selectedDate = dateStr;
    selectedTime = null;
    document.querySelectorAll('.tb-cal-day').forEach(el => el.classList.remove('tb-cal-selected'));
    document.querySelector(`[data-date="${dateStr}"]`)?.classList.add('tb-cal-selected');

    const container = document.getElementById('tb-reschedule-slots');
    if (!container) return;

    // Show spinner only if not cached (cached dates load instantly)
    const indicators = TabuchiAPI.getCachedDayIndicators(bookingData.staffId, bookingData.meetingTypeId, dateStr, dateStr);
    const isCached = dateStr in indicators;
    if (!isCached) {
      container.innerHTML = '<div class="tb-loading"><div class="tb-spinner"></div></div>';
    }
    showEl('tb-reschedule-slots');

    try {
      const result = await TabuchiAPI.getAvailability(bookingData.staffId, bookingData.meetingTypeId, dateStr);
      if (result.slots.length === 0) {
        container.innerHTML = '<p class="tb-no-slots">No available times on this date.</p>';
      } else {
        let html = '<div class="tb-slots-grid">';
        result.slots.forEach(s => html += `<button class="tb-slot" data-time="${s}">${TabuchiAPI.util.formatTime(s)}</button>`);
        html += '</div><button id="tb-reschedule-confirm-btn" class="tb-btn tb-btn-primary" style="margin-top:1rem;display:none;">Confirm Reschedule</button>';
        container.innerHTML = html;

        container.querySelectorAll('.tb-slot').forEach(el => {
          el.addEventListener('click', () => {
            selectedTime = el.dataset.time;
            container.querySelectorAll('.tb-slot').forEach(s => s.classList.remove('tb-slot-selected'));
            el.classList.add('tb-slot-selected');
            const btn = document.getElementById('tb-reschedule-confirm-btn');
            if (btn) btn.style.display = '';
          });
        });

        document.getElementById('tb-reschedule-confirm-btn')?.addEventListener('click', confirmReschedule);
      }
      renderBackButton(container);
    } catch (err) {
      container.innerHTML = '<p class="tb-error">Unable to load times.</p>';
    }
  }

  function renderBackButton(container) {
    const existing = container.querySelector('.tb-booking-nav');
    if (existing) existing.remove();

    const nav = document.createElement('div');
    nav.className = 'tb-booking-nav';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'tb-btn tb-btn-secondary tb-back-btn';
    backBtn.innerHTML = '&#8592; Back to Calendar';
    backBtn.addEventListener('click', () => {
      selectedDate = null;
      selectedTime = null;
      document.querySelectorAll('.tb-cal-day').forEach(el => el.classList.remove('tb-cal-selected'));
      hideEl('tb-reschedule-slots');
    });
    nav.appendChild(backBtn);

    container.insertBefore(nav, container.firstChild);
  }

  async function confirmReschedule() {
    if (!selectedDate || !selectedTime) return;
    const btn = document.getElementById('tb-reschedule-confirm-btn');
    if (btn) { btn.textContent = 'Rescheduling...'; btn.disabled = true; }

    try {
      const result = await TabuchiAPI.rescheduleBooking({
        bookingId, token, newDate: selectedDate, newTime: selectedTime
      });
      // Clear availability cache since slots have changed
      TabuchiAPI.clearAvailabilityCache();

      const successEl = document.getElementById('tb-reschedule-success');
      if (successEl) {
        successEl.innerHTML = `<h3>Rescheduled!</h3><p>Your new appointment is on <strong>${TabuchiAPI.util.formatDate(selectedDate)}</strong> at <strong>${TabuchiAPI.util.formatTime(selectedTime)}</strong>.</p><p>A new calendar invitation will be sent to your email.</p>`;
        successEl.style.display = '';
      }
      hideEl('tb-select-date-heading');
      hideEl('tb-reschedule-calendar');
      hideEl('tb-reschedule-slots');
    } catch (err) {
      if (btn) { btn.textContent = 'Confirm Reschedule'; btn.disabled = false; }
      const errEl = document.getElementById('tb-reschedule-error');
      if (errEl) { errEl.textContent = err.error || 'Unable to reschedule.'; errEl.style.display = ''; }
    }
  }

  // Ensure the "Select a New Date" heading is positioned above the calendar
  function ensureHeadingAboveCalendar() {
    const heading = document.getElementById('tb-select-date-heading');
    const calendar = document.getElementById('tb-reschedule-calendar');
    if (heading && calendar && calendar.parentNode) {
      calendar.parentNode.insertBefore(heading, calendar);
    }
  }

  // Remove duplicate "Select a New Date" headings (keep only #tb-select-date-heading)
  function cleanupDuplicateElements() {
    document.querySelectorAll('h3').forEach(h => {
      if (h.textContent.trim() === 'Select a New Date' && h.id !== 'tb-select-date-heading') {
        h.style.display = 'none';
      }
    });
  }

  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t || ''; }
  function showEl(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
  function hideEl(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
})();
