/**
 * RingCentral Embeddable Widget Integration
 * Exposes window.ClientCareRC for CRM pages to initiate calls,
 * track duration, and capture recording URLs automatically.
 *
 * Usage:
 *   ClientCareRC.init(clientId);          // or auto-loads from CC_Config
 *   ClientCareRC.dial(phoneNumber, cb);   // cb receives { duration_minutes, outcome, recording_url, session_id }
 *
 * Requires: cc-api-client.js loaded (for config lookup)
 */
(function() {
  'use strict';

  var RC_APP_SERVER = 'https://platform.ringcentral.com';
  var RECORDING_FETCH_DELAY = 4000; // ms to wait for recording to process
  var RECORDING_FETCH_TIMEOUT = 12000;
  var DIAL_RETRY_INTERVAL = 500;
  var DIAL_MAX_RETRIES = 40; // 20 seconds
  var LOGIN_WAIT_TIMEOUT = 120000; // 2 minutes max wait for login

  var _clientId = '';
  var _state = {
    loaded: false,
    ready: false,
    loggedIn: false,
    callActive: false,
    callEndCb: null,
    callStartTime: null,
    recordingUri: null,
    pendingDial: null  // queued phone number to dial after login
  };

  // ── Initialization ──────────────────────────────────────────

  /**
   * Load the RC Embeddable widget. Call once.
   * @param {string} clientId - RingCentral app clientId
   */
  function init(clientId) {
    if (_state.loaded) return true;
    if (clientId) _clientId = clientId;
    if (!_clientId) {
      console.warn('[RC Widget] No clientId — call init(clientId) first');
      return false;
    }
    _state.loaded = true;

    // Inject the RC Embeddable adapter script
    var s = document.createElement('script');
    s.src = 'https://ringcentral.github.io/ringcentral-embeddable/adapter.js?' +
      'clientId=' + encodeURIComponent(_clientId) +
      '&appServer=' + encodeURIComponent(RC_APP_SERVER) +
      '&disableMinimize=false' +
      '&disableMessages=true' +
      '&disableGlip=true' +
      '&disableConferenceInvite=true' +
      '&disableConferenceCall=true';
    s.async = true;
    document.body.appendChild(s);

    window.addEventListener('message', _handleMessage);
    return true;
  }

  /**
   * Auto-load clientId from CC_Config, then init.
   * Returns a Promise that resolves to true/false.
   */
  function autoInit() {
    if (_state.loaded) return Promise.resolve(true);

    // Check sessionStorage cache first
    var cached = sessionStorage.getItem('cc_rc_client_id');
    if (cached) { return Promise.resolve(init(cached)); }

    // Fetch from CC_Config
    var API = window.ClientCareAPI;
    if (!API || !API.admin || !API.admin.config) {
      return Promise.resolve(false);
    }
    return API.admin.config.list().then(function(result) {
      var configs = result.configs || result.data || [];
      for (var i = 0; i < configs.length; i++) {
        if (configs[i].Config_Key === 'rc_client_id' && configs[i].Meta) {
          _clientId = configs[i].Meta;
          sessionStorage.setItem('cc_rc_client_id', _clientId);
          return init(_clientId);
        }
      }
      return false;
    }).catch(function() { return false; });
  }

  // ── Helpers ────────────────────────────────────────────────

  function _normalizePhone(phoneNumber) {
    var cleaned = phoneNumber.replace(/[\s\-\(\)\.]/g, '');
    if (/^\d{10}$/.test(cleaned)) cleaned = '+1' + cleaned;
    else if (/^1\d{10}$/.test(cleaned)) cleaned = '+' + cleaned;
    return cleaned;
  }

  function _showWidget() {
    var frame = document.querySelector('#rc-widget-adapter-frame');
    if (frame) {
      frame.contentWindow.postMessage({ type: 'rc-adapter-set-minimized', minimized: false }, '*');
    }
  }

  /**
   * Check microphone permission. Prompts user if not yet granted.
   * Returns a Promise resolving to true (granted) or false (denied/failed).
   */
  function _checkMicrophone() {
    // Try the Permissions API first (non-intrusive check)
    if (navigator.permissions && navigator.permissions.query) {
      return navigator.permissions.query({ name: 'microphone' }).then(function(result) {
        if (result.state === 'granted') return true;
        if (result.state === 'denied') {
          _ccToast('Microphone access is blocked. Please allow microphone in your browser settings (click the lock icon in the address bar).', 'error');
          return false;
        }
        // 'prompt' — trigger the permission dialog
        return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
          stream.getTracks().forEach(function(t) { t.stop(); }); // release immediately
          return true;
        }).catch(function() {
          _ccToast('Microphone access is required for RingCentral calls. Please allow microphone access and try again.', 'error');
          return false;
        });
      }).catch(function() {
        // Permissions API not supported — try getUserMedia directly
        return _requestMicDirect();
      });
    }
    return _requestMicDirect();
  }

  function _requestMicDirect() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(true); // can't check, let the widget handle it
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      stream.getTracks().forEach(function(t) { t.stop(); });
      return true;
    }).catch(function() {
      _ccToast('Microphone access is required for RingCentral calls. Please allow microphone access and try again.', 'error');
      return false;
    });
  }

  // ── Dial ─────────────────────────────────────────────────────

  /**
   * Initiate a call via the RC Embeddable widget.
   * Checks microphone permission first, then dials.
   * @param {string} phoneNumber - Number to dial
   * @param {function} onCallEnd - Callback with call result object
   */
  function dial(phoneNumber, onCallEnd) {
    _state.callEndCb = onCallEnd;
    _state.recordingUri = null;
    _state.callActive = false;
    _state.callStartTime = null;
    _state.pendingDial = null;

    if (!_state.loaded) {
      onCallEnd({ error: 'RingCentral widget not loaded.' });
      return;
    }

    var cleaned = _normalizePhone(phoneNumber);

    // Step 1: Check microphone permission
    _checkMicrophone().then(function(micOk) {
      if (!micOk) {
        _fireCallback({ error: 'Microphone access denied.' });
        return;
      }

      // Step 2: Wait for widget to be ready
      _waitForReady(function(isReady) {
        if (!isReady) {
          _fireCallback({ error: 'RingCentral widget did not become ready. Please try again.' });
          return;
        }

        // Step 3: Show widget and dial with retry
        _showWidget();
        _executeDialWithRetry(cleaned, 0);
      });
    });
  }

  function _waitForReady(cb) {
    var attempts = 0;
    function check() {
      var frame = document.querySelector('#rc-widget-adapter-frame');
      if (frame && _state.ready) {
        cb(true);
      } else if (attempts < DIAL_MAX_RETRIES) {
        attempts++;
        setTimeout(check, DIAL_RETRY_INTERVAL);
      } else {
        cb(false);
      }
    }
    check();
  }

  /**
   * Send the dial command, retrying a few times with delay to handle
   * widget timing issues (widget may report ready before fully initialized).
   */
  function _executeDialWithRetry(cleaned, attempt) {
    console.log('[RC Widget] Dialing (attempt ' + (attempt + 1) + '):', cleaned);

    // Method 1: Use RCAdapter.clickToCall if available (official adapter API)
    if (window.RCAdapter && typeof window.RCAdapter.clickToCall === 'function') {
      console.log('[RC Widget] Using RCAdapter.clickToCall');
      window.RCAdapter.clickToCall(cleaned);
      return; // no retry needed — clickToCall is reliable
    }

    // Method 2: Fall back to postMessage
    var frame = document.querySelector('#rc-widget-adapter-frame');
    if (!frame) {
      _fireCallback({ error: 'RingCentral widget not found.' });
      return;
    }
    console.log('[RC Widget] Using postMessage fallback');
    frame.contentWindow.postMessage({
      type: 'rc-adapter-new-call',
      phoneNumber: cleaned,
      toCall: true
    }, '*');

    // Retry up to 3 times with increasing delay
    if (attempt < 3) {
      setTimeout(function() {
        if (!_state.callActive) {
          _executeDialWithRetry(cleaned, attempt + 1);
        }
      }, 1500 * (attempt + 1));
    }
  }

  function _ccToast(msg, type) {
    // Use CRM toast if available, otherwise console
    if (typeof window.ccToast === 'function') {
      window.ccToast(msg, type || 'info');
    } else {
      console.log('[RC Widget]', msg);
    }
  }

  // ── Widget Message Handler ──────────────────────────────────

  function _handleMessage(e) {
    if (!e.data || typeof e.data.type !== 'string') return;
    var data = e.data;

    // Log RC messages for debugging
    if (data.type.indexOf('rc-') === 0 && data.type !== 'rc-adapter-pushAdapterState') {
      console.log('[RC Widget] Message:', data.type, data.loggedIn !== undefined ? 'loggedIn=' + data.loggedIn : '');
    }

    switch (data.type) {
      case 'rc-adapter-pushAdapterState':
        if (!_state.ready) {
          _state.ready = true;
          console.log('[RC Widget] Adapter ready');
        }
        break;

      case 'rc-login-status-notify':
        var wasLoggedIn = _state.loggedIn;
        _state.loggedIn = !!data.loggedIn;
        console.log('[RC Widget] Login status:', _state.loggedIn);

        // If user just logged in and there's a pending dial, execute it
        if (!wasLoggedIn && _state.loggedIn && _state.pendingDial) {
          var numberToDial = _state.pendingDial;
          _state.pendingDial = null;
          console.log('[RC Widget] Login detected! Auto-dialing pending number:', numberToDial);
          _ccToast('Logged in! Dialing now...', 'success');
          // Small delay to let the widget finish initializing after login
          setTimeout(function() { _executeDial(numberToDial); }, 1500);
        }
        break;

      case 'rc-call-init-notify':
        // Outbound call initiated (ringing)
        _state.callActive = true;
        _state.callStartTime = Date.now();
        break;

      case 'rc-call-start-notify':
        // Call connected
        if (!_state.callStartTime) _state.callStartTime = Date.now();
        break;

      case 'rc-recording-notify':
        // Recording started or stopped
        if (data.recording && data.recording.uri) {
          _state.recordingUri = data.recording.uri;
        }
        break;

      case 'rc-call-end-notify':
        // Call ended
        _state.callActive = false;
        _onCallEnd(data.call || {});
        break;
    }
  }

  // ── Call End Processing ─────────────────────────────────────

  function _onCallEnd(call) {
    var durationSec = call.duration || 0;
    // Fallback: compute from our own start time if RC didn't provide
    if (!durationSec && _state.callStartTime) {
      durationSec = Math.round((Date.now() - _state.callStartTime) / 1000);
    }

    var callInfo = {
      session_id: call.telephonySessionId || call.sessionId || '',
      duration_seconds: durationSec,
      duration_minutes: Math.ceil(durationSec / 60),
      result: call.result || '',
      outcome: _mapOutcome(call.result),
      recording_url: _state.recordingUri || ''
    };

    // Try to fetch recording from RC Call Log API
    _fetchRecording(callInfo);
  }

  function _fetchRecording(callInfo) {
    var frame = document.querySelector('#rc-widget-adapter-frame');
    if (!frame) {
      _fireCallback(callInfo);
      return;
    }

    // Delay to allow RC to process the recording
    setTimeout(function() {
      var reqId = 'ccrc-' + Date.now();
      var handled = false;

      var handler = function(e) {
        if (handled) return;
        if (e.data && e.data.type === 'rc-adapter-message-response' && e.data.requestId === reqId) {
          handled = true;
          window.removeEventListener('message', handler);

          var resp = e.data.response || {};
          var body = (typeof resp.body === 'object') ? resp.body : resp;
          var records = body.records || [];

          // Find most recent recording
          for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (rec.recording) {
              callInfo.recording_url = rec.recording.contentUri || rec.recording.uri || '';
              callInfo.rc_recording_id = rec.recording.id || '';
              break;
            }
          }
          _fireCallback(callInfo);
        }
      };
      window.addEventListener('message', handler);

      // Query recent call log with recordings
      var dateFrom = new Date(Date.now() - 600000).toISOString(); // last 10 min
      frame.contentWindow.postMessage({
        type: 'rc-adapter-message-request',
        requestId: reqId,
        path: '/restapi/v1.0/account/~/extension/~/call-log?dateFrom=' + dateFrom +
              '&perPage=5&withRecording=true&view=Detailed',
        method: 'GET'
      }, '*');

      // Timeout fallback — don't block forever
      setTimeout(function() {
        if (!handled) {
          handled = true;
          window.removeEventListener('message', handler);
          _fireCallback(callInfo);
        }
      }, RECORDING_FETCH_TIMEOUT);

    }, RECORDING_FETCH_DELAY);
  }

  function _fireCallback(callInfo) {
    var cb = _state.callEndCb;
    _state.callEndCb = null;
    _state.recordingUri = null;
    _state.callStartTime = null;
    if (cb) cb(callInfo);
  }

  function _mapOutcome(rcResult) {
    var map = {
      'Disconnected': 'COMPLETED',
      'HangUp': 'COMPLETED',
      'CallConnected': 'COMPLETED',
      'Voicemail': 'LEFT_VOICEMAIL',
      'VMGreeting': 'LEFT_VOICEMAIL',
      'Busy': 'BUSY',
      'LineBusy': 'BUSY',
      'NoAnswer': 'NO_ANSWER',
      'Rejected': 'NO_ANSWER',
      'CallerAbandoned': 'NO_ANSWER',
      'FaxReceive': 'COMPLETED',
      'Unknown': 'COMPLETED'
    };
    return map[rcResult] || 'COMPLETED';
  }

  // ── Public API ──────────────────────────────────────────────

  window.ClientCareRC = {
    init: init,
    autoInit: autoInit,
    dial: dial,
    isLoaded: function() { return _state.loaded; },
    isReady: function() { return _state.ready; },
    isLoggedIn: function() { return _state.loggedIn; },
    isCallActive: function() { return _state.callActive; }
  };
})();
