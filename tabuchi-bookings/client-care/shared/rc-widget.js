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

  var _clientId = '';
  var _state = {
    loaded: false,
    ready: false,
    loggedIn: false,
    callActive: false,
    callEndCb: null,
    callStartTime: null,
    recordingUri: null
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

  // ── Dial ─────────────────────────────────────────────────────

  /**
   * Initiate a call via the RC Embeddable widget.
   * @param {string} phoneNumber - Number to dial
   * @param {function} onCallEnd - Callback with call result object
   */
  function dial(phoneNumber, onCallEnd) {
    _state.callEndCb = onCallEnd;
    _state.recordingUri = null;
    _state.callActive = false;
    _state.callStartTime = null;

    if (!_state.loaded) {
      onCallEnd({ error: 'RingCentral widget not loaded.' });
      return;
    }

    _tryDial(phoneNumber, 0);
  }

  function _tryDial(phoneNumber, attempts) {
    var frame = document.querySelector('#rc-widget-adapter-frame');
    if (frame && _state.ready) {
      // Normalize phone number — strip spaces, dashes, parens; ensure +1 prefix for 10-digit NA numbers
      var cleaned = phoneNumber.replace(/[\s\-\(\)\.]/g, '');
      if (/^\d{10}$/.test(cleaned)) cleaned = '+1' + cleaned;
      else if (/^1\d{10}$/.test(cleaned)) cleaned = '+' + cleaned;

      if (!_state.loggedIn) {
        // Widget is loaded but user not logged in — open widget and prompt
        frame.contentWindow.postMessage({ type: 'rc-adapter-new-call', phoneNumber: cleaned, toCall: false }, '*');
        _fireCallback({ error: 'Please log in to RingCentral first. Click the phone icon in the bottom-right to sign in, then try calling again.' });
        return;
      }

      frame.contentWindow.postMessage({
        type: 'rc-adapter-new-call',
        phoneNumber: cleaned,
        toCall: true
      }, '*');
    } else if (attempts < DIAL_MAX_RETRIES) {
      setTimeout(function() { _tryDial(phoneNumber, attempts + 1); }, DIAL_RETRY_INTERVAL);
    } else {
      _fireCallback({ error: 'RingCentral widget did not become ready. Please log in to RingCentral and try again.' });
    }
  }

  // ── Widget Message Handler ──────────────────────────────────

  function _handleMessage(e) {
    if (!e.data || typeof e.data.type !== 'string') return;
    var data = e.data;

    switch (data.type) {
      case 'rc-adapter-pushAdapterState':
        _state.ready = true;
        break;

      case 'rc-login-status-notify':
        _state.loggedIn = !!data.loggedIn;
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
