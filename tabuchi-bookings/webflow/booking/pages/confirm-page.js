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
    TabuchiAPI.util.showError('tb-confirm-message', 'No meeting information found.');
    return;
  }

  // Populate confirmation details
  setText('tb-confirm-message', params.message || 'Your meeting is confirmed!');
  setText('tb-confirm-meeting', params.meetingType);
  setText('tb-confirm-staff', params.staffName);
  setText('tb-confirm-date', TabuchiAPI.util.formatDate(params.date));
  setText('tb-confirm-time', `${TabuchiAPI.util.formatTime(params.time)} - ${TabuchiAPI.util.formatTime(params.endTime)}`);
  setText('tb-confirm-duration', `${params.duration} minutes`);
  setText('tb-confirm-location', params.location || '');
  setText('tb-confirm-booking-id', params.bookingId);

  // Hide Join Meeting button on confirmation page — meeting link is sent via email
  const joinContainer = document.getElementById('tb-confirm-join-url');
  if (joinContainer) joinContainer.style.display = 'none';

  // Reschedule / Cancel links — restrict to same origin to prevent open redirects
  function isSameOrigin(url) {
    if (!url) return false;
    if (url.startsWith('/')) return true;
    try { return new URL(url).origin === window.location.origin; } catch (e) { return false; }
  }

  const rescheduleLink = document.getElementById('tb-reschedule-link');
  if (rescheduleLink && isSameOrigin(params.rescheduleUrl)) {
    rescheduleLink.href = params.rescheduleUrl;
  }

  const cancelLink = document.getElementById('tb-cancel-link');
  if (cancelLink && isSameOrigin(params.cancelUrl)) {
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
