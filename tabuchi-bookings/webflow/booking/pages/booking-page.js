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
 * - #tb-date-time-section (wraps calendar + slots side-by-side)
 * - #tb-meeting-info (meeting type card)
 * - #tb-booking-badge, #tb-badge-name (booking badge pill)
 */

(async function BookingPage() {
  'use strict';

  // ─── Parse URL ─────────────────────────────────────────────────
  const params = TabuchiAPI.util.getUrlParams();
  const staffSlug = params.staff;
  const meetingSlug = params.type;

  // Only run in booking mode: both ?staff= and ?type= present
  if (!staffSlug || !meetingSlug) {
    var errorEl = document.getElementById('tb-error');
    if (errorEl) {
      errorEl.textContent = 'Invalid booking link. Please use a booking link provided by our team, or visit our website to select a meeting type.';
      errorEl.style.display = '';
      errorEl.style.padding = '1.5rem';
      errorEl.style.color = '#b91c1c';
      errorEl.style.background = '#fef2f2';
      errorEl.style.borderRadius = '8px';
      errorEl.style.textAlign = 'center';
      errorEl.style.margin = '2rem auto';
      errorEl.style.maxWidth = '600px';
    }
    return;
  }

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
      border-radius: 50%; position: absolute; bottom: 3px;
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

    // Show the sections
    showElement('tb-meeting-info');
    showElement('tb-booking-badge');
    showElement('tb-staff-header');
    showElement('tb-date-time-section');

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
    const img = document.getElementById('tb-staff-photo');
    if (img) {
      if (staffData.photoUrl) { img.src = staffData.photoUrl; img.alt = staffData.name; }
      else { img.style.display = 'none'; }
    }
  }

  function renderMeetingTypeInfo() {
    setText('tb-meeting-name', meetingTypeData.name);
    setText('tb-meeting-duration', (meetingTypeData.duration || meetingTypeData.durationMinutes || '--') + ' min');
    setText('tb-meeting-description', meetingTypeData.description);
    setText('tb-meeting-location', meetingTypeData.location || 'Video Call');
    setText('tb-badge-name', meetingTypeData.name);

    // Read more toggle for long descriptions
    var desc = meetingTypeData.description || '';
    if (desc.length > 120) {
      var descEl = document.getElementById('tb-meeting-description');
      var readMoreBtn = document.getElementById('tb-read-more-btn');
      if (descEl && readMoreBtn) {
        var shortDesc = desc.substring(0, 120) + '...';
        descEl.textContent = shortDesc;
        readMoreBtn.style.display = 'inline';
        var expanded = false;
        readMoreBtn.addEventListener('click', function() {
          expanded = !expanded;
          descEl.textContent = expanded ? desc : shortDesc;
          readMoreBtn.textContent = expanded ? 'Show less' : 'Read more';
        });
      }
    }

    // Set color accent if available
    if (meetingTypeData.color) {
      document.documentElement.style.setProperty('--tb-accent', meetingTypeData.color);
    }

    // Show witness note if meeting type requires witnesses
    if (meetingTypeData.requiredWitnesses > 0) {
      var noteEl = document.getElementById('tb-witness-note');
      if (noteEl) {
        noteEl.textContent = 'This meeting will include ' + meetingTypeData.requiredWitnesses + ' additional staff member' + (meetingTypeData.requiredWitnesses > 1 ? 's' : '') + ' as witness' + (meetingTypeData.requiredWitnesses > 1 ? 'es' : '') + '.';
        noteEl.style.display = '';
      }
    }
  }

  // ─── Batch Availability Helpers ─────────────────────────────────

  async function fetchMonthAvailability(monthDate) {
    if (!staffData || !meetingTypeData) return;
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth();
    var key = year + '-' + month;
    if (_fetchedMonths.has(key)) { applyDayIndicators(); return; }

    var startDate = year + '-' + String(month + 1).padStart(2, '0') + '-01';
    var lastDay = new Date(year, month + 1, 0).getDate();
    var endDate = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');

    try {
      await TabuchiAPI.getBatchAvailability(staffData.id, meetingTypeData.id, startDate, endDate);
      _fetchedMonths.add(key);
      applyDayIndicators();
    } catch (e) { /* silently fail — user can still click individual dates */ }
  }

  function applyDayIndicators() {
    if (!staffData || !meetingTypeData) return;
    document.querySelectorAll('.tb-cal-day[data-date]').forEach(function(el) {
      var date = el.dataset.date;
      var indicators = TabuchiAPI.getCachedDayIndicators(staffData.id, meetingTypeData.id, date, date);
      if (date in indicators) {
        el.classList.remove('tb-has-availability', 'tb-no-availability');
        el.classList.add(indicators[date] ? 'tb-has-availability' : 'tb-no-availability');
      }
    });
  }

  function renderCalendar() {
    var container = document.getElementById('tb-calendar-container');
    if (!container) return;

    var today = new Date();
    var maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + (meetingTypeData.maxAdvanceDays || 60));

    var currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    function buildMonth(monthDate) {
      var year = monthDate.getFullYear();
      var month = monthDate.getMonth();
      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var monthName = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      var html = '<div class="tb-calendar">' +
        '<div class="tb-calendar-header">' +
          '<button class="tb-cal-prev" id="tb-cal-prev">&larr;</button>' +
          '<span class="tb-cal-month">' + monthName + '</span>' +
          '<button class="tb-cal-next" id="tb-cal-next">&rarr;</button>' +
        '</div>' +
        '<div class="tb-calendar-grid">' +
          '<div class="tb-cal-day-header">Sun</div>' +
          '<div class="tb-cal-day-header">Mon</div>' +
          '<div class="tb-cal-day-header">Tue</div>' +
          '<div class="tb-cal-day-header">Wed</div>' +
          '<div class="tb-cal-day-header">Thu</div>' +
          '<div class="tb-cal-day-header">Fri</div>' +
          '<div class="tb-cal-day-header">Sat</div>';

      // Empty cells before first day
      for (var i = 0; i < firstDay; i++) {
        html += '<div class="tb-cal-day tb-cal-empty"></div>';
      }

      // Day cells
      for (var day = 1; day <= daysInMonth; day++) {
        var dateObj = new Date(year, month, day);
        var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        var isPast = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        var isTooFar = dateObj > maxDate;
        var isSelected = dateStr === selectedDate;
        var isToday = dateObj.toDateString() === today.toDateString();

        var classes = 'tb-cal-day';
        if (isPast || isTooFar) classes += ' tb-cal-disabled';
        else classes += ' tb-cal-available';
        if (isSelected) classes += ' tb-cal-selected';
        if (isToday) classes += ' tb-cal-today';

        html += '<div class="' + classes + '" data-date="' + dateStr + '">' + day + '</div>';
      }

      html += '</div></div>';
      return html;
    }

    function render() {
      container.innerHTML = buildMonth(currentMonth);

      // Bind navigation
      var prev = document.getElementById('tb-cal-prev');
      var next = document.getElementById('tb-cal-next');
      if (prev) prev.addEventListener('click', function() {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        if (currentMonth < new Date(today.getFullYear(), today.getMonth(), 1)) {
          currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        render();
        fetchMonthAvailability(currentMonth);
      });
      if (next) next.addEventListener('click', function() {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        render();
        fetchMonthAvailability(currentMonth);
      });

      // Bind day clicks
      container.querySelectorAll('.tb-cal-available').forEach(function(el) {
        el.addEventListener('click', function() { onDateSelected(el.dataset.date); });
      });
    }

    render();
  }

  async function onDateSelected(dateStr) {
    selectedDate = dateStr;
    selectedTime = null;

    // Update calendar selection visually
    document.querySelectorAll('.tb-cal-day').forEach(function(el) { el.classList.remove('tb-cal-selected'); });
    var selectedEl = document.querySelector('[data-date="' + dateStr + '"]');
    if (selectedEl) selectedEl.classList.add('tb-cal-selected');

    // Load time slots in the side panel
    var slotsContainer = document.getElementById('tb-slots-container');
    if (!slotsContainer) return;

    var indicators = TabuchiAPI.getCachedDayIndicators(staffData.id, meetingTypeData.id, dateStr, dateStr);
    var isCached = dateStr in indicators;

    if (!isCached) {
      slotsContainer.innerHTML = '<div class="tb-loading"><div class="tb-spinner"></div><p>Loading times...</p></div>';
    }

    try {
      var result = await TabuchiAPI.getAvailability(staffData.id, meetingTypeData.id, dateStr);
      currentStep = 'time';
      if (result.slots.length === 0) {
        slotsContainer.innerHTML = '<p class="tb-no-slots">No available times on ' + TabuchiAPI.util.formatDate(dateStr) + '.</p>';
      } else {
        renderTimeSlots(result.slots);
      }
    } catch (err) {
      slotsContainer.innerHTML = '<p class="tb-error">Unable to load available times. Please try again.</p>';
    }
  }

  function renderTimeSlots(slots) {
    var container = document.getElementById('tb-slots-container');
    if (!container) return;

    var html = '<h3 class="tb-slots-title">' + TabuchiAPI.util.formatDate(selectedDate) + '</h3><div class="tb-slots-grid">';
    for (var i = 0; i < slots.length; i++) {
      html += '<button class="tb-slot" data-time="' + slots[i] + '">' + TabuchiAPI.util.formatTime(slots[i]) + '</button>';
    }
    html += '</div>';
    container.innerHTML = html;

    // Bind slot clicks
    container.querySelectorAll('.tb-slot').forEach(function(el) {
      el.addEventListener('click', function() {
        selectedTime = el.dataset.time;
        document.querySelectorAll('.tb-slot').forEach(function(s) { s.classList.remove('tb-slot-selected'); });
        el.classList.add('tb-slot-selected');
        currentStep = 'form';
        showElement('tb-form-container');
        updateFormSummary();
        // Scroll form into view
        var formEl = document.getElementById('tb-form-container');
        if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderIntakeForm() {
    var container = document.getElementById('tb-intake-fields');
    if (!container || intakeQuestions.length === 0) return;

    var html = '';
    for (var i = 0; i < intakeQuestions.length; i++) {
      var q = intakeQuestions[i];
      var reqAttr = q.required ? 'required' : '';
      var reqStar = q.required ? '<span class="tb-required">*</span>' : '';
      var safeId = escapeAttr(q.id);

      html += '<div class="tb-form-field">';
      html += '<label for="intake-' + safeId + '">' + escapeHtml(q.label) + reqStar + '</label>';

      switch (q.fieldType) {
        case 'textarea':
          html += '<textarea id="intake-' + safeId + '" name="intake-' + safeId + '" rows="3" ' + reqAttr + '></textarea>';
          break;
        case 'select':
          html += '<select id="intake-' + safeId + '" name="intake-' + safeId + '" ' + reqAttr + '><option value="">Select...</option>';
          for (var j = 0; j < (q.options || []).length; j++) {
            html += '<option value="' + escapeAttr(q.options[j]) + '">' + escapeHtml(q.options[j]) + '</option>';
          }
          html += '</select>';
          break;
        case 'checkbox':
          html += '<input type="checkbox" id="intake-' + safeId + '" name="intake-' + safeId + '" ' + reqAttr + '>';
          break;
        case 'email':
          html += '<input type="email" id="intake-' + safeId + '" name="intake-' + safeId + '" ' + reqAttr + '>';
          break;
        case 'phone':
          html += '<input type="tel" id="intake-' + safeId + '" name="intake-' + safeId + '" ' + reqAttr + '>';
          break;
        default: // text
          html += '<input type="text" id="intake-' + safeId + '" name="intake-' + safeId + '" ' + reqAttr + '>';
      }
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function updateFormSummary() {
    setText('tb-summary-date', TabuchiAPI.util.formatDate(selectedDate));
    setText('tb-summary-time', TabuchiAPI.util.formatTime(selectedTime));
    setText('tb-summary-duration', (meetingTypeData.duration || meetingTypeData.durationMinutes || '--') + ' min');
    setText('tb-summary-meeting', meetingTypeData.name);
    setText('tb-summary-staff', staffData.name);
  }

  // ─── Form Submission ───────────────────────────────────────────
  document.addEventListener('submit', async function(e) {
    if (!e.target.matches('#tb-booking-form')) return;
    e.preventDefault();

    var form = e.target;
    var submitBtn = form.querySelector('[type="submit"]');
    var originalText = submitBtn ? submitBtn.textContent : '';

    try {
      if (submitBtn) { submitBtn.textContent = 'Booking...'; submitBtn.disabled = true; }

      // Collect intake responses
      var intakeResponses = {};
      for (var i = 0; i < intakeQuestions.length; i++) {
        var q = intakeQuestions[i];
        var el = document.getElementById('intake-' + q.id);
        if (el) {
          intakeResponses[q.label] = q.fieldType === 'checkbox' ? el.checked : el.value;
        }
      }

      var bookingData = {
        meetingTypeId: meetingTypeData.id,
        date: selectedDate,
        time: selectedTime,
        clientName: form.querySelector('[name="clientName"]') ? form.querySelector('[name="clientName"]').value : '',
        clientEmail: form.querySelector('[name="clientEmail"]') ? form.querySelector('[name="clientEmail"]').value : '',
        clientPhone: form.querySelector('[name="clientPhone"]') ? form.querySelector('[name="clientPhone"]').value : '',
        intakeResponses: intakeResponses
      };

      var result = await TabuchiAPI.createBooking(bookingData);

      // Clear availability cache since a slot is now taken
      TabuchiAPI.clearAvailabilityCache();

      // Redirect to confirmation page with booking data
      var confirmParams = {
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
      var qp = new URLSearchParams(confirmParams);
      window.location.href = '/book-confirm?' + qp.toString();

    } catch (err) {
      if (submitBtn) { submitBtn.textContent = originalText; submitBtn.disabled = false; }
      var errorEl = document.getElementById('tb-form-error');
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
    var el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }
  function showElement(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = '';
  }
  function hideElement(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

})();
