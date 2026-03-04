/**
 * Tabuchi Law Booking System - Confirmation Page
 * Handles: /book/confirm?bookingId=...&date=...&time=...
 *
 * Requires: api-client.js loaded first
 *
 * Page element IDs:
 * - #tb-confirm-message, #tb-confirm-meeting, #tb-confirm-staff
 * - #tb-confirm-date, #tb-confirm-time, #tb-confirm-duration
 * - #tb-confirm-join-url, #tb-confirm-join-link
 * - #tb-reschedule-link, #tb-cancel-link
 * - #tb-add-calendar-btn
 */

(function ConfirmPage() {
  'use strict';

  const params = TabuchiAPI.util.getUrlParams();

  if (!params.bookingId) {
    TabuchiAPI.util.showError('tb-confirm-message', 'No booking information found.');
    return;
  }

  // Populate confirmation details
  setText('tb-confirm-message', params.message || 'Your booking is confirmed!');
  setText('tb-confirm-meeting', params.meetingType);
  setText('tb-confirm-staff', params.staffName);
  setText('tb-confirm-date', TabuchiAPI.util.formatDate(params.date));
  setText('tb-confirm-time', `${TabuchiAPI.util.formatTime(params.time)} - ${TabuchiAPI.util.formatTime(params.endTime)}`);
  setText('tb-confirm-duration', `${params.duration} minutes`);
  setText('tb-confirm-location', params.location || '');
  setText('tb-confirm-booking-id', params.bookingId);

  // Join URL — adapt label by location type and hide if no URL
  const joinLink = document.getElementById('tb-confirm-join-link');
  const joinContainer = document.getElementById('tb-confirm-join-url');
  if (joinLink && params.joinUrl) {
    joinLink.href = params.joinUrl;
    // Determine label from joinUrl or location param
    if (params.joinUrl.includes('zoom.us')) {
      joinLink.textContent = 'Join Zoom Meeting';
    } else {
      joinLink.textContent = 'Join Teams Meeting';
    }
  } else if (joinContainer) {
    // No join URL (In-Office or Phone Call) — hide the join section
    joinContainer.style.display = 'none';
  }

  // Reschedule / Cancel links
  const rescheduleLink = document.getElementById('tb-reschedule-link');
  if (rescheduleLink && params.rescheduleUrl) {
    rescheduleLink.href = params.rescheduleUrl;
  }

  const cancelLink = document.getElementById('tb-cancel-link');
  if (cancelLink && params.cancelUrl) {
    cancelLink.href = params.cancelUrl;
  }

  // Add to Calendar button
  const calBtn = document.getElementById('tb-add-calendar-btn');
  if (calBtn) {
    calBtn.addEventListener('click', () => {
      TabuchiAPI.util.downloadICS({
        date: params.date,
        time: params.time,
        endTime: params.endTime,
        meetingTypeName: params.meetingType,
        staffName: params.staffName,
        joinUrl: params.joinUrl
      });
    });
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }
})();
