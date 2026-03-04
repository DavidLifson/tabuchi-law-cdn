/**
 * Tabuchi Law Booking System - Staff Landing Page (Disabled)
 * Handles: /book?staff={slug} (no ?type= param)
 *
 * Meeting type selection has been removed. Each meeting type now has its own
 * direct booking link. If someone arrives here without a ?type= param, show
 * a friendly message telling them to use the specific link they were given.
 *
 * Requires: api-client.js loaded first
 *
 * Page element IDs:
 * - #tb-loading, #tb-error
 * - #tb-meeting-types-list (hidden)
 */

(function StaffLandingPage() {
  'use strict';

  const params = TabuchiAPI.util.getUrlParams();
  const staffSlug = params.staff;

  // Only run in staff-landing mode: ?staff= present but no ?type=
  if (!staffSlug || params.type) return;

  // Hide loading spinner
  const loadingEl = document.getElementById('tb-loading');
  if (loadingEl) loadingEl.style.display = 'none';

  // Hide the meeting types list
  const listEl = document.getElementById('tb-meeting-types-list');
  if (listEl) listEl.style.display = 'none';

  // Show a friendly message
  TabuchiAPI.util.showError('tb-error',
    'This link is incomplete. Please use the specific booking link provided to you by Tabuchi Law. ' +
    'If you need assistance, contact our office directly.'
  );
})();
