/**
 * Tabuchi Law Booking System - Cancel Page
 * Handles: /book/cancel?bookingId=...&token=...
 *
 * Requires: api-client.js loaded first
 *
 * Page element IDs:
 * - #tb-loading, #tb-error
 * - #tb-cancel-details (shows booking info)
 * - #tb-cancel-date, #tb-cancel-time, #tb-cancel-meeting, #tb-cancel-staff
 * - #tb-cancel-reason (textarea)
 * - #tb-cancel-confirm-btn
 * - #tb-cancel-success, #tb-cancel-error
 */

(async function CancelPage() {
  'use strict';

  const params = TabuchiAPI.util.getUrlParams();
  const bookingId = params.bookingId;
  const token = params.token;

  if (!bookingId || !token) {
    TabuchiAPI.util.showError('tb-error', 'Invalid cancellation link.');
    return;
  }

  // Load booking details
  TabuchiAPI.util.showLoading('tb-loading');
  try {
    const result = await TabuchiAPI.getBooking(bookingId, token);
    const booking = result.booking;

    hideEl('tb-loading');

    if (booking.status === 'cancelled') {
      TabuchiAPI.util.showError('tb-error', 'This booking has already been cancelled.');
      return;
    }

    setText('tb-cancel-date', TabuchiAPI.util.formatDate(booking.date));
    setText('tb-cancel-time', TabuchiAPI.util.formatTime(booking.startTime));
    setText('tb-cancel-client', booking.clientName);
    showEl('tb-cancel-details');

  } catch (err) {
    hideEl('tb-loading');
    TabuchiAPI.util.showError('tb-error', err.error || 'Unable to load booking details.');
    return;
  }

  // Cancel button handler
  document.getElementById('tb-cancel-confirm-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('tb-cancel-confirm-btn');
    const reason = document.getElementById('tb-cancel-reason')?.value || '';

    if (btn) { btn.textContent = 'Cancelling...'; btn.disabled = true; }

    try {
      await TabuchiAPI.cancelBooking({ bookingId, token, reason });

      const successEl = document.getElementById('tb-cancel-success');
      if (successEl) {
        successEl.innerHTML = '<h3>Booking Cancelled</h3><p>Your booking has been cancelled. A confirmation will be sent to your email.</p><p><a href="/book" class="tb-btn tb-btn-secondary">Book a New Appointment</a></p>';
        successEl.style.display = '';
      }
      hideEl('tb-cancel-details');

    } catch (err) {
      if (btn) { btn.textContent = 'Cancel Booking'; btn.disabled = false; }
      const errEl = document.getElementById('tb-cancel-error');
      if (errEl) { errEl.textContent = err.error || 'Unable to cancel booking.'; errEl.style.display = ''; }
    }
  });

  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t || ''; }
  function showEl(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
  function hideEl(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
})();
