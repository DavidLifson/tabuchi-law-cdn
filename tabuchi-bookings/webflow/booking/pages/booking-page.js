/**
 * Tabuchi Law Booking System - Booking Page
 * Handles: /book?staff={slug}&type={meeting-type-slug}
 *
 * Requires: api-client.js loaded first
 *
 * Page must contain these element IDs:
 * - #tb-staff-name, #tb-staff-bio, #tb-staff-photo
 * - #tb-meeting-name, #tb-meeting-duration, #tb-meeting-description, #tb-meeting-location
 * - #tb-calendar-container (date picker goes here)
 * - #tb-slots-container (time slots go here)
 * - #tb-form-container (booking form goes here)
 * - #tb-intake-fields (dynamic intake questions go here)
 * - #tb-loading, #tb-error
 */

(async function BookingPage() {
  'use strict';

  // ─── Parse URL ─────────────────────────────────────────────────
  const params = TabuchiAPI.util.getUrlParams();
  const staffSlug = params.staff;
  const meetingSlug = params.type;

  // Only run in booking mode: both ?staff= and ?type= present
  if (!staffSlug || !meetingSlug) return;

  // ─── State ─────────────────────────────────────────────────────
  let staffData = null;
  let meetingTypeData = null;
  let intakeQuestions = [];
  let selectedDate = null;
  let selectedTime = null;
  let currentStep = 'date'; // 'date' | 'time' | 'form'
  const _fetchedMonths = new Set();

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

  // ─── Load Meeting Type Data ────────────────────────────────────
  TabuchiAPI.util.showLoading('tb-loading');

  try {
    const response = await TabuchiAPI.getMeetingType(staffSlug, meetingSlug);
    staffData = response.staff;
    meetingTypeData = response.meetingType;
    intakeQuestions = response.intakeQuestions || [];

    renderStaffInfo();
    renderMeetingTypeInfo();
    renderCalendar();
    renderIntakeForm();
    hideElement('tb-loading');
    showElement('tb-calendar-container');

    // Kick off batch availability fetch for current month (non-blocking)
    fetchMonthAvailability(new Date());
  } catch (err) {
    hideElement('tb-loading');
    TabuchiAPI.util.showError('tb-error', err.error || 'Unable to load booking page. Please try again.');
    return;
  }

  // ─── Render Functions ──────────────────────────────────────────

  function renderStaffInfo() {
    setText('tb-staff-name', staffData.name);
    setText('tb-staff-bio', staffData.bio);
    if (staffData.photoUrl) {
      const img = document.getElementById('tb-staff-photo');
      if (img) { img.src = staffData.photoUrl; img.alt = staffData.name; }
    }
  }

  function renderMeetingTypeInfo() {
    setText('tb-meeting-name', meetingTypeData.name);
    setText('tb-meeting-duration', `${meetingTypeData.duration} minutes`);
    setText('tb-meeting-description', meetingTypeData.description);
    setText('tb-meeting-location', meetingTypeData.location || 'Teams Video Call');

    // Set color accent if available
    if (meetingTypeData.color) {
      document.documentElement.style.setProperty('--tb-accent', meetingTypeData.color);
    }

    // Show witness note if meeting type requires witnesses
    if (meetingTypeData.requiredWitnesses > 0) {
      const noteEl = document.getElementById('tb-witness-note');
      if (noteEl) {
        noteEl.textContent = `This meeting will include ${meetingTypeData.requiredWitnesses} additional staff member${meetingTypeData.requiredWitnesses > 1 ? 's' : ''} as witness${meetingTypeData.requiredWitnesses > 1 ? 'es' : ''}.`;
        noteEl.style.display = '';
      }
    }
  }

  // ─── Batch Availability Helpers ─────────────────────────────────

  async function fetchMonthAvailability(monthDate) {
    if (!staffData || !meetingTypeData) return;
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const key = `${year}-${month}`;
    if (_fetchedMonths.has(key)) { applyDayIndicators(); return; }

    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    try {
      await TabuchiAPI.getBatchAvailability(staffData.id, meetingTypeData.id, startDate, endDate);
      _fetchedMonths.add(key);
      applyDayIndicators();
    } catch (e) { /* silently fail — user can still click individual dates */ }
  }

  function applyDayIndicators() {
    if (!staffData || !meetingTypeData) return;
    document.querySelectorAll('.tb-cal-day[data-date]').forEach(el => {
      const date = el.dataset.date;
      const indicators = TabuchiAPI.getCachedDayIndicators(staffData.id, meetingTypeData.id, date, date);
      if (date in indicators) {
        el.classList.remove('tb-has-availability', 'tb-no-availability');
        el.classList.add(indicators[date] ? 'tb-has-availability' : 'tb-no-availability');
      }
    });
  }

  function renderCalendar() {
    const container = document.getElementById('tb-calendar-container');
    if (!container) return;

    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + (meetingTypeData.maxAdvanceDays || 60));

    let currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    function buildMonth(monthDate) {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthName = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      let html = `
        <div class="tb-calendar">
          <div class="tb-calendar-header">
            <button class="tb-cal-prev" id="tb-cal-prev">&larr;</button>
            <span class="tb-cal-month">${monthName}</span>
            <button class="tb-cal-next" id="tb-cal-next">&rarr;</button>
          </div>
          <div class="tb-calendar-grid">
            <div class="tb-cal-day-header">Sun</div>
            <div class="tb-cal-day-header">Mon</div>
            <div class="tb-cal-day-header">Tue</div>
            <div class="tb-cal-day-header">Wed</div>
            <div class="tb-cal-day-header">Thu</div>
            <div class="tb-cal-day-header">Fri</div>
            <div class="tb-cal-day-header">Sat</div>
      `;

      // Empty cells before first day
      for (let i = 0; i < firstDay; i++) {
        html += '<div class="tb-cal-day tb-cal-empty"></div>';
      }

      // Day cells
      for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const isTooFar = dateObj > maxDate;
        const isSelected = dateStr === selectedDate;
        const isToday = dateObj.toDateString() === today.toDateString();

        let classes = 'tb-cal-day';
        if (isPast || isTooFar) classes += ' tb-cal-disabled';
        else classes += ' tb-cal-available';
        if (isSelected) classes += ' tb-cal-selected';
        if (isToday) classes += ' tb-cal-today';

        html += `<div class="${classes}" data-date="${dateStr}">${day}</div>`;
      }

      html += '</div></div>';
      return html;
    }

    function render() {
      container.innerHTML = buildMonth(currentMonth);

      // Bind navigation
      const prev = document.getElementById('tb-cal-prev');
      const next = document.getElementById('tb-cal-next');
      if (prev) prev.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        if (currentMonth < new Date(today.getFullYear(), today.getMonth(), 1)) {
          currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        render();
        fetchMonthAvailability(currentMonth);
      });
      if (next) next.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        render();
        fetchMonthAvailability(currentMonth);
      });

      // Bind day clicks
      container.querySelectorAll('.tb-cal-available').forEach(el => {
        el.addEventListener('click', () => onDateSelected(el.dataset.date));
      });
    }

    render();
  }

  async function onDateSelected(dateStr) {
    selectedDate = dateStr;
    selectedTime = null;

    // Update calendar selection visually
    document.querySelectorAll('.tb-cal-day').forEach(el => el.classList.remove('tb-cal-selected'));
    document.querySelector(`[data-date="${dateStr}"]`)?.classList.add('tb-cal-selected');

    // Load time slots — show spinner only if not cached
    const slotsContainer = document.getElementById('tb-slots-container');
    if (!slotsContainer) return;

    const indicators = TabuchiAPI.getCachedDayIndicators(staffData.id, meetingTypeData.id, dateStr, dateStr);
    const isCached = dateStr in indicators;

    if (!isCached) {
      slotsContainer.innerHTML = '<div class="tb-loading"><div class="tb-spinner"></div><p>Loading available times...</p></div>';
    }
    showElement('tb-slots-container');

    try {
      const result = await TabuchiAPI.getAvailability(staffData.id, meetingTypeData.id, dateStr);
      currentStep = 'time';
      if (result.slots.length === 0) {
        slotsContainer.innerHTML = `<p class="tb-no-slots">No available times on ${TabuchiAPI.util.formatDate(dateStr)}. Please select another date.</p>`;
      } else {
        renderTimeSlots(result.slots);
      }
      renderBackButton('tb-slots-container', 'Back to Calendar', 'date');
    } catch (err) {
      slotsContainer.innerHTML = '<p class="tb-error">Unable to load available times. Please try again.</p>';
    }
  }

  function renderTimeSlots(slots) {
    const container = document.getElementById('tb-slots-container');
    if (!container) return;

    let html = `<h3 class="tb-slots-title">Available times for ${TabuchiAPI.util.formatDate(selectedDate)}</h3><div class="tb-slots-grid">`;
    for (const slot of slots) {
      html += `<button class="tb-slot" data-time="${slot}">${TabuchiAPI.util.formatTime(slot)}</button>`;
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind slot clicks
    container.querySelectorAll('.tb-slot').forEach(el => {
      el.addEventListener('click', () => {
        selectedTime = el.dataset.time;
        document.querySelectorAll('.tb-slot').forEach(s => s.classList.remove('tb-slot-selected'));
        el.classList.add('tb-slot-selected');
        currentStep = 'form';
        showElement('tb-form-container');
        updateFormSummary();
        renderBackButton('tb-form-container', 'Back to Time Selection', 'time');
      });
    });
  }

  function renderIntakeForm() {
    const container = document.getElementById('tb-intake-fields');
    if (!container || intakeQuestions.length === 0) return;

    let html = '';
    for (const q of intakeQuestions) {
      const reqAttr = q.required ? 'required' : '';
      const reqStar = q.required ? '<span class="tb-required">*</span>' : '';

      html += `<div class="tb-form-field">`;
      html += `<label for="intake-${q.id}">${q.label}${reqStar}</label>`;

      switch (q.fieldType) {
        case 'textarea':
          html += `<textarea id="intake-${q.id}" name="intake-${q.id}" rows="3" ${reqAttr}></textarea>`;
          break;
        case 'select':
          html += `<select id="intake-${q.id}" name="intake-${q.id}" ${reqAttr}><option value="">Select...</option>`;
          for (const opt of q.options) {
            html += `<option value="${opt}">${opt}</option>`;
          }
          html += '</select>';
          break;
        case 'checkbox':
          html += `<input type="checkbox" id="intake-${q.id}" name="intake-${q.id}" ${reqAttr}>`;
          break;
        case 'email':
          html += `<input type="email" id="intake-${q.id}" name="intake-${q.id}" ${reqAttr}>`;
          break;
        case 'phone':
          html += `<input type="tel" id="intake-${q.id}" name="intake-${q.id}" ${reqAttr}>`;
          break;
        default: // text
          html += `<input type="text" id="intake-${q.id}" name="intake-${q.id}" ${reqAttr}>`;
      }
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function updateFormSummary() {
    setText('tb-summary-date', TabuchiAPI.util.formatDate(selectedDate));
    setText('tb-summary-time', TabuchiAPI.util.formatTime(selectedTime));
    setText('tb-summary-duration', `${meetingTypeData.duration} minutes`);
    setText('tb-summary-meeting', meetingTypeData.name);
    setText('tb-summary-staff', staffData.name);
  }

  // ─── Step Navigation ──────────────────────────────────────────
  function goToStep(step) {
    currentStep = step;
    switch (step) {
      case 'date':
        showElement('tb-calendar-container');
        hideElement('tb-slots-container');
        hideElement('tb-form-container');
        selectedDate = null;
        selectedTime = null;
        document.querySelectorAll('.tb-cal-day').forEach(el => el.classList.remove('tb-cal-selected'));
        break;
      case 'time':
        showElement('tb-calendar-container');
        showElement('tb-slots-container');
        hideElement('tb-form-container');
        selectedTime = null;
        document.querySelectorAll('.tb-slot').forEach(s => s.classList.remove('tb-slot-selected'));
        break;
      case 'form':
        showElement('tb-calendar-container');
        showElement('tb-slots-container');
        showElement('tb-form-container');
        break;
    }
  }

  function renderBackButton(containerId, label, targetStep) {
    const container = document.getElementById(containerId);
    if (!container) return;
    // Remove any existing nav
    const existing = container.querySelector('.tb-booking-nav');
    if (existing) existing.remove();

    const nav = document.createElement('div');
    nav.className = 'tb-booking-nav';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'tb-btn tb-btn-secondary tb-back-btn';
    backBtn.innerHTML = `&#8592; ${label}`;
    backBtn.addEventListener('click', () => goToStep(targetStep));
    nav.appendChild(backBtn);

    if (targetStep === 'time') {
      // On the form step, also add a cancel button
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'tb-btn tb-btn-secondary tb-cancel-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to cancel this booking?')) {
          window.history.back();
        }
      });
      nav.appendChild(cancelBtn);
    }

    container.insertBefore(nav, container.firstChild);
  }

  // ─── Form Submission ───────────────────────────────────────────
  document.addEventListener('submit', async function(e) {
    if (!e.target.matches('#tb-booking-form')) return;
    e.preventDefault();

    const form = e.target;
    const submitBtn = form.querySelector('[type="submit"]');
    const originalText = submitBtn?.textContent;

    try {
      if (submitBtn) { submitBtn.textContent = 'Booking...'; submitBtn.disabled = true; }

      // Collect intake responses
      const intakeResponses = {};
      for (const q of intakeQuestions) {
        const el = document.getElementById(`intake-${q.id}`);
        if (el) {
          intakeResponses[q.label] = q.fieldType === 'checkbox' ? el.checked : el.value;
        }
      }

      const bookingData = {
        meetingTypeId: meetingTypeData.id,
        date: selectedDate,
        time: selectedTime,
        clientName: form.querySelector('[name="clientName"]')?.value,
        clientEmail: form.querySelector('[name="clientEmail"]')?.value,
        clientPhone: form.querySelector('[name="clientPhone"]')?.value || '',
        intakeResponses
      };

      const result = await TabuchiAPI.createBooking(bookingData);

      // Clear availability cache since a slot is now taken
      TabuchiAPI.clearAvailabilityCache();

      // Redirect to confirmation page with booking data
      const confirmParams = {
        bookingId: result.booking.bookingId,
        staffName: result.booking.staffName,
        meetingType: result.booking.meetingTypeName,
        date: result.booking.date,
        time: result.booking.time,
        endTime: result.booking.endTime,
        duration: result.booking.duration,
        clientName: result.booking.clientName,
        rescheduleUrl: result.booking.rescheduleUrl,
        cancelUrl: result.booking.cancelUrl,
        location: result.booking.location || meetingTypeData.location || '',
        message: result.booking.confirmationMessage || result.message
      };
      // Only include joinUrl if present (not for In-Office/Phone)
      if (result.booking.joinUrl) confirmParams.joinUrl = result.booking.joinUrl;
      const params = new URLSearchParams(confirmParams);
      window.location.href = `/book-confirm?${params.toString()}`;

    } catch (err) {
      if (submitBtn) { submitBtn.textContent = originalText; submitBtn.disabled = false; }
      const errorEl = document.getElementById('tb-form-error');
      if (errorEl) {
        errorEl.textContent = err.error || 'Unable to complete booking. Please try again.';
        errorEl.style.display = 'block';
      }
      // If slot taken, clear cache and refresh availability
      if (err.status === 409) {
        TabuchiAPI.clearAvailabilityCache();
        onDateSelected(selectedDate);
      }
    }
  });

  // ─── Helpers ───────────────────────────────────────────────────
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }
  function showElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }
  function hideElement(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

})();
