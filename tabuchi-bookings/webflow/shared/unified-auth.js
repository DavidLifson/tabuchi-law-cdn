/**
 * Tabuchi Law - Unified Authentication (Microsoft SSO)
 * Handles: /login
 *
 * Replaces both crm-auth.js and dashboard-auth.js.
 * Uses unified localStorage keys: app_token, app_user
 *
 * Requires: MSAL.js loaded in page
 *
 * Flow:
 * 1. User clicks "Sign in with Microsoft"
 * 2. MSAL popup authenticates with Azure AD (Entra)
 * 3. id_token sent to WF-UNIFIED-LOGIN (/api/login-sso)
 * 4. Backend validates JWT, looks up Staff + CC_Users, returns unified token + user
 * 5. Stored in localStorage as app_token + app_user, redirect to /crm
 *
 * Page element IDs:
 * - #app-sso-btn       (Sign in with Microsoft button)
 * - #app-login-error   (error message container)
 * - #app-login-status  (optional status text)
 */

(function UnifiedAuth() {
  'use strict';

  var _root = document.querySelector('#app-page-root');
  function $el(id) { return _root ? _root.querySelector('#' + id) : document.getElementById(id); }

  // If already logged in, redirect based on role
  var existingToken = localStorage.getItem('app_token');
  if (existingToken && !window.location.search.includes('logout')) {
    try {
      var _u = JSON.parse(localStorage.getItem('app_user') || '{}');
      window.location.href = (_u.role === 'BOOKINGS') ? '/dashboard' : '/crm';
    } catch (e) {
      window.location.href = '/crm';
    }
    return;
  }

  // Handle ?logout query param — clear ALL legacy and unified keys
  if (window.location.search.includes('logout')) {
    localStorage.removeItem('app_token');
    localStorage.removeItem('app_user');
    // Clean up any legacy keys from before the merge
    localStorage.removeItem('cc_dashboard_token');
    localStorage.removeItem('cc_user');
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_staff');
    localStorage.removeItem('admin_token');
    history.replaceState(null, '', '/login');
  }

  // Show expired session message if redirected from 401
  if (window.location.search.includes('expired')) {
    var statusEl = $el('app-login-status');
    if (statusEl) {
      statusEl.textContent = 'Your session has expired. Please sign in again.';
      statusEl.style.display = '';
    }
  }

  // MSAL configuration — Entra app registration shared with both systems
  var msalConfig = {
    auth: {
      clientId: '4df869dd-ca95-49dd-8939-aa796e515df5',
      authority: 'https://login.microsoftonline.com/8d1a9049-44e6-4a26-b9e5-d0c405e82e30',
      redirectUri: window.location.origin + '/crm'
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false
    }
  };

  var msalInstance = new msal.PublicClientApplication(msalConfig);

  var loginRequest = {
    scopes: ['openid', 'profile', 'email']
  };

  var btn = $el('app-sso-btn');
  var errorEl = $el('app-login-error');

  if (!btn) return;

  // Add spinner animation style
  if (!document.querySelector('#app-spin-style')) {
    var style = document.createElement('style');
    style.id = 'app-spin-style';
    style.textContent = '@keyframes app-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  var spinnerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:app-spin 0.8s linear infinite;"></span>';
  var msIconHTML = '<svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>';

  function setButtonState(loading, text) {
    btn.disabled = loading;
    btn.innerHTML = (loading ? spinnerHTML : msIconHTML) + ' ' + text;
  }

  btn.addEventListener('click', async function() {
    if (errorEl) errorEl.style.display = 'none';
    setButtonState(true, 'Signing in...');

    try {
      // Step 1: Microsoft SSO popup
      var authResult = await msalInstance.loginPopup(loginRequest);
      var idToken = authResult.idToken;

      if (!idToken) throw { error: 'No ID token received from Microsoft.' };

      // Step 2: Validate with unified backend endpoint
      setButtonState(true, 'Verifying...');

      var response = await fetch('https://tabuchilaw.app.n8n.cloud/webhook/cc/login-sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken })
      });
      var result = await response.json();

      if (!result.success) {
        throw { error: result.error || 'Login failed. You may not have access. Contact your administrator.' };
      }

      // Step 3: Store unified credentials
      localStorage.setItem('app_token', result.token);

      if (result.user) {
        localStorage.setItem('app_user', JSON.stringify(result.user));
      }

      // Step 4: Redirect based on role
      var _dest = '/crm';
      if (result.user && result.user.role === 'BOOKINGS') _dest = '/dashboard';
      window.location.href = _dest;

    } catch (err) {
      setButtonState(false, 'Sign in with Microsoft');

      if (errorEl) {
        if (err.errorCode === 'user_cancelled' || err.errorCode === 'popup_window_error') {
          errorEl.textContent = 'Sign-in was cancelled. Please try again.';
        } else if (err.errorCode === 'interaction_in_progress') {
          errorEl.textContent = 'A sign-in is already in progress. Please wait.';
        } else {
          errorEl.textContent = err.error || err.message || 'Unable to sign in. Please try again.';
        }
        errorEl.style.display = '';
      }
    }
  });
})();
