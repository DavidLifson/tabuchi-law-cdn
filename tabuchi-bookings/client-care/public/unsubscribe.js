/**
 * Tabuchi Law Client Care - Unsubscribe Page
 * Handles: /unsubscribe?token=...
 *
 * Requires: cc-api-client.js loaded first
 *
 * Public page — no auth required.
 * Token is a UUID identifying the subscription record.
 * Immediately processes unsubscribe on load (one-click unsubscribe).
 * Shows confirmation or error message.
 *
 * Page element IDs:
 * - #cc-unsubscribe-container  (main container)
 */

(function Unsubscribe() {
  'use strict';

  var API = ClientCareAPI;
  var $el = function(id) { return document.getElementById(id); };

  // ─── Parse Token ───────────────────────────────────────────
  function getToken() {
    var params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
  }

  // ─── Render States ─────────────────────────────────────────
  function showLoading() {
    var el = $el('cc-unsubscribe-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-unsub-card">' +
        '<div class="cc-loading"><div class="cc-spinner"></div><p>Processing your unsubscribe request...</p></div>' +
      '</div>';
  }

  function showSuccess() {
    var el = $el('cc-unsubscribe-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-unsub-card">' +
        '<div class="cc-unsub-icon cc-unsub-icon-success">&#10003;</div>' +
        '<h2>You have been unsubscribed</h2>' +
        '<p>You will no longer receive marketing emails from Tabuchi Law Professional Corporation.</p>' +
        '<p class="cc-unsub-note">If this was a mistake, please contact us at ' +
          '<a href="mailto:info@tabuchilaw.com" class="cc-link">info@tabuchilaw.com</a> to re-subscribe.</p>' +
      '</div>';
  }

  function showError(message) {
    var el = $el('cc-unsubscribe-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-unsub-card">' +
        '<div class="cc-unsub-icon cc-unsub-icon-error">&#10007;</div>' +
        '<h2>Unable to process request</h2>' +
        '<p>' + escapeHtml(message) + '</p>' +
        '<p class="cc-unsub-note">Please contact us at ' +
          '<a href="mailto:info@tabuchilaw.com" class="cc-link">info@tabuchilaw.com</a> for assistance.</p>' +
      '</div>';
  }

  function showMissingToken() {
    var el = $el('cc-unsubscribe-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-unsub-card">' +
        '<div class="cc-unsub-icon cc-unsub-icon-error">&#10007;</div>' +
        '<h2>Invalid unsubscribe link</h2>' +
        '<p>This link appears to be invalid or incomplete. Please use the unsubscribe link from your email.</p>' +
        '<p class="cc-unsub-note">If you continue to receive unwanted emails, contact us at ' +
          '<a href="mailto:info@tabuchilaw.com" class="cc-link">info@tabuchilaw.com</a>.</p>' +
      '</div>';
  }

  // ─── Process Unsubscribe ───────────────────────────────────
  async function processUnsubscribe(token) {
    showLoading();

    try {
      var result = await API.subscriptions.unsubscribe(token);
      if (result.success) {
        showSuccess();
      } else {
        showError(result.error || 'Failed to process unsubscribe request.');
      }
    } catch (err) {
      if (err.status === 404) {
        showError('This unsubscribe link has expired or is no longer valid.');
      } else {
        showError(err.error || 'An error occurred. Please try again later.');
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Initialize ────────────────────────────────────────────
  function init() {
    var token = getToken();
    if (!token) {
      showMissingToken();
      return;
    }
    processUnsubscribe(token);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
