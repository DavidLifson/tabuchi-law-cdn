/**
 * Tabuchi Law Client Care - Preference Center
 * Handles: /preferences?token=...
 *
 * Requires: cc-api-client.js loaded first
 *
 * Public page — no auth required.
 * Token is a UUID identifying the subscription record.
 * Shows toggleable preferences grouped by channel.
 *
 * Page element IDs:
 * - #cc-preferences-container  (main container)
 */

(function PreferenceCenter() {
  'use strict';

  var API = ClientCareAPI;
  var $el = function(id) { return document.getElementById(id); };

  // ─── Parse Token ───────────────────────────────────────────
  function getToken() {
    var params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
  }

  // ─── Helpers ───────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Render States ─────────────────────────────────────────
  function showLoading() {
    var el = $el('cc-preferences-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-pref-card">' +
        '<div class="cc-loading"><div class="cc-spinner"></div><p>Loading your preferences...</p></div>' +
      '</div>';
  }

  function showError(message) {
    var el = $el('cc-preferences-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-pref-card">' +
        '<div class="cc-pref-icon cc-pref-icon-error">&#10007;</div>' +
        '<h2>Unable to load preferences</h2>' +
        '<p>' + escapeHtml(message) + '</p>' +
        '<p class="cc-pref-note">Please contact us at ' +
          '<a href="mailto:info@tabuchilaw.com" class="cc-link">info@tabuchilaw.com</a> for assistance.</p>' +
      '</div>';
  }

  function showMissingToken() {
    var el = $el('cc-preferences-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-pref-card">' +
        '<div class="cc-pref-icon cc-pref-icon-error">&#10007;</div>' +
        '<h2>Invalid preferences link</h2>' +
        '<p>This link appears to be invalid or incomplete. Please use the link from your email.</p>' +
        '<p class="cc-pref-note">If you continue to receive unwanted communications, contact us at ' +
          '<a href="mailto:info@tabuchilaw.com" class="cc-link">info@tabuchilaw.com</a>.</p>' +
      '</div>';
  }

  function showSuccess() {
    var el = $el('cc-preferences-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-pref-card">' +
        '<div class="cc-pref-icon cc-pref-icon-success">&#10003;</div>' +
        '<h2>Preferences saved</h2>' +
        '<p>Your communication preferences have been updated.</p>' +
      '</div>';
  }

  function showUnsubscribedAll() {
    var el = $el('cc-preferences-container');
    if (!el) return;
    el.innerHTML =
      '<div class="cc-pref-card">' +
        '<div class="cc-pref-icon cc-pref-icon-success">&#10003;</div>' +
        '<h2>You have been unsubscribed</h2>' +
        '<p>You will no longer receive any communications from Tabuchi Law Professional Corporation.</p>' +
        '<p class="cc-pref-note">Changed your mind? ' +
          '<a href="javascript:void(0)" id="cc-resubscribe-link" class="cc-link">Click here to manage preferences</a>.</p>' +
      '</div>';
    var resubLink = $el('cc-resubscribe-link');
    if (resubLink) {
      resubLink.addEventListener('click', function() { loadPreferences(getToken()); });
    }
  }

  // ─── Render Preference Form ────────────────────────────────
  function renderPreferences(data) {
    var el = $el('cc-preferences-container');
    if (!el) return;

    var categories = data.categories || [];
    var emailCats = categories.filter(function(c) { return c.channel === 'EMAIL'; });
    var smsCats = categories.filter(function(c) { return c.channel === 'SMS'; });

    var html = '<div class="cc-pref-card">';
    html += '<h2 class="cc-pref-title">Communication Preferences</h2>';
    html += '<p class="cc-pref-subtitle">Choose which messages you would like to receive from Tabuchi Law.</p>';

    if (data.email) {
      html += '<p class="cc-pref-email">Managing preferences for: <strong>' + escapeHtml(data.email) + '</strong></p>';
    }

    // Email section
    if (emailCats.length > 0) {
      html += '<div class="cc-pref-section">';
      html += '<h3 class="cc-pref-section-title">Email</h3>';
      emailCats.forEach(function(cat) {
        html += renderToggle(cat);
      });
      html += '</div>';
    }

    // SMS section
    if (smsCats.length > 0) {
      html += '<div class="cc-pref-section">';
      html += '<h3 class="cc-pref-section-title">Text Messages (SMS)</h3>';
      smsCats.forEach(function(cat) {
        html += renderToggle(cat);
      });
      html += '</div>';
    }

    html += '<div class="cc-pref-actions">';
    html += '<button type="button" id="cc-pref-save" class="cc-pref-btn cc-pref-btn-primary">Save Preferences</button>';
    html += '</div>';

    html += '<div class="cc-pref-unsub-all">';
    html += '<a href="javascript:void(0)" id="cc-unsub-all-link" class="cc-link">Unsubscribe from all communications</a>';
    html += '</div>';

    html += '</div>';

    el.innerHTML = html;
    bindToggleEvents();
    bindSaveButton(data);
    bindUnsubAllLink();
  }

  function renderToggle(cat) {
    var checked = cat.value ? ' checked' : '';
    return '<div class="cc-pref-toggle-row">' +
      '<label class="cc-pref-toggle-label">' +
        '<span class="cc-pref-toggle-text">' + escapeHtml(cat.label) + '</span>' +
        '<span class="cc-pref-switch">' +
          '<input type="checkbox" class="cc-pref-checkbox" data-field="' + escapeHtml(cat.field) + '"' + checked + ' />' +
          '<span class="cc-pref-slider"></span>' +
        '</span>' +
      '</label>' +
    '</div>';
  }

  function bindToggleEvents() {
    // Toggle visual state handled by CSS
  }

  function bindSaveButton(originalData) {
    var btn = $el('cc-pref-save');
    if (!btn) return;
    btn.addEventListener('click', async function() {
      btn.disabled = true;
      btn.textContent = 'Saving...';

      var checkboxes = document.querySelectorAll('.cc-pref-checkbox');
      var preferences = {};
      checkboxes.forEach(function(cb) {
        preferences[cb.getAttribute('data-field')] = cb.checked;
      });

      try {
        var result = await API.subscriptions.updatePreferences(getToken(), preferences);
        if (result.success) {
          showSuccess();
        } else {
          btn.disabled = false;
          btn.textContent = 'Save Preferences';
          alert(result.error || 'Failed to save preferences.');
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Save Preferences';
        alert('An error occurred. Please try again.');
      }
    });
  }

  function bindUnsubAllLink() {
    var link = $el('cc-unsub-all-link');
    if (!link) return;
    link.addEventListener('click', async function() {
      if (!confirm('Are you sure you want to unsubscribe from all communications?')) return;
      try {
        var result = await API.subscriptions.unsubscribeAll(getToken());
        if (result.success) {
          showUnsubscribedAll();
        } else {
          alert(result.error || 'Failed to unsubscribe.');
        }
      } catch (err) {
        alert('An error occurred. Please try again.');
      }
    });
  }

  // ─── Load Preferences ──────────────────────────────────────
  async function loadPreferences(token) {
    showLoading();

    try {
      var data = await API.subscriptions.getPreferences(token);
      if (data.success) {
        renderPreferences(data);
      } else if (data.statusCode === 404) {
        showError('This preferences link has expired or is no longer valid.');
      } else {
        showError(data.error || 'Failed to load preferences.');
      }
    } catch (err) {
      showError('An error occurred. Please try again later.');
    }
  }

  // ─── Initialize ────────────────────────────────────────────
  function init() {
    var token = getToken();
    if (!token) {
      showMissingToken();
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
      showMissingToken();
      return;
    }
    loadPreferences(token);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
