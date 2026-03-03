/**
 * Tabuchi Law Client Care CRM - Authentication (Microsoft SSO)
 * Handles: /crm/login
 *
 * Requires: cc-api-client.js loaded first, MSAL.js loaded in page
 *
 * Flow:
 * 1. User clicks "Sign in with Microsoft"
 * 2. MSAL popup authenticates with Azure AD (Entra)
 * 3. id_token sent to CC-09 (/cc/login-sso)
 * 4. Backend validates JWT, looks up CC_Users, returns token + user profile
 * 5. Stored in localStorage, redirect to /crm
 *
 * Page element IDs:
 * - #cc-sso-btn        (Sign in with Microsoft button)
 * - #cc-login-error    (error message container)
 * - #cc-login-status   (optional status text)
 */

(function CRMAuth() {
  'use strict';

  var _root = document.querySelector('#cc-page-root');
  function $el(id) { return _root ? _root.querySelector('#' + id) : document.getElementById(id); }

  // If already logged in, redirect to CRM dashboard
  if (ClientCareAPI.auth.isAuthenticated() && !window.location.search.includes('logout')) {
    window.location.href = '/crm';
    return;
  }

  // Handle ?logout query param
  if (window.location.search.includes('logout')) {
    ClientCareAPI.auth.clearToken();
    history.replaceState(null, '', '/crm/login');
  }

  // Show expired session message if redirected from 401
  if (window.location.search.includes('expired')) {
    var statusEl = $el('cc-login-status');
    if (statusEl) {
      statusEl.textContent = 'Your session has expired. Please sign in again.';
      statusEl.style.display = '';
    }
  }

  // MSAL configuration — same Entra app registration as Meeting Booking dashboard
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

  var btn = $el('cc-sso-btn');
  var errorEl = $el('cc-login-error');

  if (!btn) return;

  // Add spinner animation style
  if (!document.querySelector('#cc-spin-style')) {
    var style = document.createElement('style');
    style.id = 'cc-spin-style';
    style.textContent = '@keyframes cc-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  var spinnerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:cc-spin 0.8s linear infinite;"></span>';
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

      // Step 2: Validate with backend (CC-09)
      setButtonState(true, 'Verifying...');

      var result = await ClientCareAPI.auth.loginSSO(idToken);

      if (!result.success) {
        throw { error: result.error || 'Login failed. You may not have CRM access. Contact your administrator.' };
      }

      // Step 3: Store credentials
      ClientCareAPI.auth.setToken(result.token);

      if (result.user) {
        ClientCareAPI.auth.setUser(result.user);
      }

      // Step 4: Redirect to CRM dashboard
      window.location.href = '/crm';

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
