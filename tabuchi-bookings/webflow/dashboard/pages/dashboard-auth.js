/**
 * DEPRECATED — Replaced by webflow/shared/unified-auth.js
 * This file is kept for reference only. It is no longer loaded by any page.
 * The unified login flow at /login handles all authentication.
 */

/**
 * Tabuchi Law Booking System - Dashboard Authentication (Microsoft SSO)
 * Handles: /dashboard-login
 *
 * Requires: api-client.js loaded first, MSAL.js loaded in page
 *
 * Flow:
 * 1. User clicks "Sign in with Microsoft"
 * 2. MSAL popup authenticates with Azure AD
 * 3. id_token sent to WF 20 (/api/dashboard/login-sso)
 * 4. Backend validates JWT, looks up staff, returns dashboard_token + staff info
 * 5. Stored in localStorage, redirect to /dashboard
 *
 * Page element IDs:
 * - #tb-sso-btn (Sign in with Microsoft button)
 * - #tb-login-error (error message container)
 */

(function DashboardAuth() {
  'use strict';

  var _root = document.querySelector('#tb-page-root');
  function $el(id) { return _root ? _root.querySelector('#' + id) : document.getElementById(id); }

  // If already logged in, redirect to dashboard
  var existingToken = localStorage.getItem('dashboard_token');
  if (existingToken && !window.location.search.includes('logout')) {
    window.location.href = '/dashboard';
    return;
  }

  // Handle ?logout query param
  if (window.location.search.includes('logout')) {
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_staff');
    localStorage.removeItem('admin_token');
    history.replaceState(null, '', '/dashboard-login');
  }

  // MSAL configuration
  var msalConfig = {
    auth: {
      clientId: '4df869dd-ca95-49dd-8939-aa796e515df5',
      authority: 'https://login.microsoftonline.com/8d1a9049-44e6-4a26-b9e5-d0c405e82e30',
      redirectUri: window.location.origin + '/dashboard'
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

  var btn = $el('tb-sso-btn');
  var errorEl = $el('tb-login-error');

  if (!btn) return;

  btn.addEventListener('click', async function() {
    if (errorEl) errorEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.8s linear infinite;"></span> Signing in...';

    // Add spinner animation
    if (!document.querySelector('#tb-spin-style')) {
      var style = document.createElement('style');
      style.id = 'tb-spin-style';
      style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    try {
      // Step 1: Microsoft SSO popup
      var authResult = await msalInstance.loginPopup(loginRequest);
      var idToken = authResult.idToken;

      if (!idToken) throw { error: 'No ID token received from Microsoft.' };

      // Step 2: Validate with backend (WF 20)
      btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.8s linear infinite;"></span> Verifying...';

      var result = await TabuchiAPI.dashboard.loginSSO(idToken);

      if (!result.success) {
        throw { error: result.error || 'Login failed. Please contact your administrator.' };
      }

      // Step 3: Store credentials
      localStorage.setItem('dashboard_token', result.token);

      if (result.staff) {
        localStorage.setItem('dashboard_staff', JSON.stringify(result.staff));
      }

      // Store admin_token if the user is an admin (for backward compat with WF 19)
      if (result.app_credentials && result.app_credentials.admin_token) {
        localStorage.setItem('admin_token', result.app_credentials.admin_token);
      }

      // Step 4: Redirect to dashboard
      window.location.href = '/dashboard';

    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg> Sign in with Microsoft';

      if (errorEl) {
        // Handle MSAL popup cancelled/blocked
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
