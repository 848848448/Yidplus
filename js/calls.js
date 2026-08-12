// ══════════════════════════════════════════════════════════════════════════
// YID PLUS voice/video calls (WebRTC, 1-on-1). Signals relay through /api/call.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var CALL = {
    pc: null, local: null, remote: null,
    id: null, role: null, kind: 'video',
    cursor: 0, poll: null, ring: null, incPoll: null,
    peerName: '', peerPhoto: '', pendingIce: [], haveRemote: false,
  };
  window.CALL = CALL;

  // Keep video light so it doesn't saturate a weak connection (which makes the
  // whole internet feel "stuck"). Modest resolution + a bitrate cap.
  function _videoConstraints() {
    return { width: { ideal: 320, max: 480 }, height: { ideal: 240, max: 360 }, frameRate: { ideal: 15, max: 20 } };
  }
  // Cap the video bandwidth right in the SDP so the encoder never bursts and
  // chokes the connection (which was knocking the whole browser offline).
  window._capSdp = function (sdp, kbps) {
    try {
      if (!sdp) return sdp;
      var out = [], lines = sdp.split(/\r\n|\n/), inVideo = false;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        out.push(l);
        if (l.indexOf('m=video') === 0) {
          inVideo = true;
          // Insert b=AS right after the m=video line (after any c= line).
          if (lines[i + 1] && lines[i + 1].indexOf('c=') === 0) { out.push(lines[++i]); }
          out.push('b=AS:' + kbps);
          out.push('b=TIAS:' + (kbps * 1000));
        } else if (l.indexOf('m=') === 0) { inVideo = false; }
      }
      return out.join('\r\n');
    } catch (e) { return sdp; }
  }
  function _mediaFor(kind) {
    return { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: kind === 'video' ? _videoConstraints() : false };
  }
  function _capBitrate(pc, kbps) {
    try {
      (pc.getSenders() || []).forEach(function (snd) {
        if (snd.track && snd.track.kind === 'video' && snd.getParameters) {
          var p = snd.getParameters();
          if (!p.encodings || !p.encodings.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = kbps * 1000;
          p.encodings[0].scaleResolutionDownBy = 1;
          snd.setParameters(p).catch(function () {});
        }
      });
    } catch (e) {}
  }

  function api(path, body, method) {
    return fetch((window.CONFIG ? CONFIG.API_BASE : '/api') + path, {
      method: method || (body ? 'POST' : 'GET'),
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json(); });
  }

  function getIce() {
    return api('/turn-credentials').then(function (r) {
      return (r && r.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }];
    }).catch(function () { return [{ urls: 'stun:stun.l.google.com:19302' }]; });
  }

  // ── Public: start a call (caller) ──
  window.startCall = function (userId, name, kind, photo) {
    if (CALL.id) { toast && toast('Already in a call'); return; }
    if (!userId) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast && toast('This device/browser can\'t make calls'); return; }
    CALL.role = 'caller'; CALL.kind = kind === 'audio' ? 'audio' : 'video';
    CALL.peerName = name || 'User'; CALL.peerPhoto = photo || '';
    _showCallUI('Requesting camera & mic…');

    navigator.mediaDevices.getUserMedia(_mediaFor(CALL.kind))
      .then(function (stream) {
        CALL.local = stream;
        _attachLocal(stream);
        _setStatus('Connecting…');
        return getIce();
      })
      .then(function (ice) {
        _makePc(ice);
        CALL.local.getTracks().forEach(function (t) { CALL.pc.addTrack(t, CALL.local); });
        return CALL.pc.createOffer();
      })
      .then(function (offer) {
        offer.sdp = _capSdp(offer.sdp, 350);
        return CALL.pc.setLocalDescription(offer).then(function () { return offer; });
      })
      .then(function (offer) {
        return api('/call', { action: 'start', callee_id: userId, kind: CALL.kind, offer: offer });
      })
      .then(function (res) {
        if (!res.ok) { _fail(res.error || 'Could not start call'); return; }
        CALL.id = res.call_id;
        // Send buffered ICE candidates spaced out, so we don't burst a weak link.
        (function flush(list, i) {
          if (i >= list.length) return;
          api('/call', { action: 'ice', call_id: CALL.id, candidate: list[i] });
          setTimeout(function () { flush(list, i + 1); }, 120);
        })(CALL.outIce || [], 0);
        CALL.outIce = [];
        _setStatus('Ringing ' + CALL.peerName + '…');
        _startPoll();
        _playRingback();
      })
      .catch(function (e) { _fail(_mediaErr(e)); });
  };

  // ── Public: answer an incoming call (callee) ──
  window.answerIncoming = function () {
    var inc = CALL._incoming; if (!inc) return;
    _stopRing();
    CALL.role = 'callee'; CALL.id = inc.id; CALL.kind = inc.kind;
    CALL.peerName = inc.caller_nick || 'User'; CALL.peerPhoto = inc.caller_photo || '';
    _showCallUI('Connecting…');
    var offer = JSON.parse(inc.offer);

    navigator.mediaDevices.getUserMedia(_mediaFor(CALL.kind))
      .then(function (stream) { CALL.local = stream; _attachLocal(stream); return getIce(); })
      .then(function (ice) {
        _makePc(ice);
        CALL.local.getTracks().forEach(function (t) { CALL.pc.addTrack(t, CALL.local); });
        return CALL.pc.setRemoteDescription(new RTCSessionDescription(offer));
      })
      .then(function () { CALL.haveRemote = true; _flushIce(); return CALL.pc.createAnswer(); })
      .then(function (ans) { ans.sdp = _capSdp(ans.sdp, 350); return CALL.pc.setLocalDescription(ans).then(function () { return ans; }); })
      .then(function (ans) { return api('/call', { action: 'answer', call_id: CALL.id, answer: ans }); })
      .then(function () { _startPoll(); })
      .catch(function (e) { _fail(_mediaErr(e)); });
  };

  window.declineIncoming = function () {
    var inc = CALL._incoming; _stopRing();
    if (inc) api('/call', { action: 'decline', call_id: inc.id });
    CALL._incoming = null; _hideIncoming();
  };

  window.endCall = function () {
    if (CALL.id) api('/call', { action: CALL.role === 'caller' ? 'cancel' : 'end', call_id: CALL.id });
    _cleanup();
  };

  window.toggleMute = function (btn) {
    if (!CALL.local) return;
    var on = CALL.local.getAudioTracks()[0] && CALL.local.getAudioTracks()[0].enabled;
    CALL.local.getAudioTracks().forEach(function (t) { t.enabled = !on; });
    if (btn) btn.classList.toggle('call-btn-off', on);
  };
  window.toggleCam = function (btn) {
    if (!CALL.local) return;
    var v = CALL.local.getVideoTracks()[0]; if (!v) return;
    v.enabled = !v.enabled;
    if (btn) btn.classList.toggle('call-btn-off', !v.enabled);
  };

  // ── Peer connection ──
  function _makePc(ice) {
    var pc = new RTCPeerConnection({ iceServers: ice });
    CALL.pc = pc;
    pc.onicecandidate = function (e) {
      if (!e.candidate) return;
      if (CALL.id) api('/call', { action: 'ice', call_id: CALL.id, candidate: e.candidate });
      else { CALL.outIce = CALL.outIce || []; CALL.outIce.push(e.candidate); }  // no id yet — buffer
    };
    pc.ontrack = function (e) {
      CALL.remote = e.streams[0];
      var rv = document.getElementById('call-remote-video');
      if (rv) { rv.srcObject = e.streams[0]; rv.play && rv.play().catch(function () {}); }
      // Reveal the remote video (the avatar fallback sits on top) once media flows.
      var hasVideo = e.streams[0] && e.streams[0].getVideoTracks && e.streams[0].getVideoTracks().length > 0;
      var fb = document.getElementById('call-remote-fallback');
      if (fb) fb.style.display = hasVideo ? 'none' : '';
      _setStatus('Connected');
      _stopRing();
    };
    pc.oniceconnectionstatechange = function () {
      var st = pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') { _setStatus('Connected'); _stopRing(); }
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected') { _setStatus('Connected'); _stopRing(); _capBitrate(pc, 350); }
      else if (pc.connectionState === 'failed') { _setStatus('Connection failed'); }
      else if (pc.connectionState === 'disconnected') { _setStatus('Reconnecting…'); }
    };
  }

  function _flushIce() {
    CALL.pendingIce.forEach(function (c) { CALL.pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {}); });
    CALL.pendingIce = [];
  }

  // ── Signal polling ──
  function _startPoll() {
    clearInterval(CALL.poll);
    CALL.poll = setInterval(function () {
      if (!CALL.id) return;
      api('/call?call_id=' + CALL.id + '&since=' + CALL.cursor).then(function (res) {
        if (!res.ok) return;
        if (res.status === 'ended' || res.status === 'declined') {
          _setStatus(res.status === 'declined' ? 'Call declined' : 'Call ended');
          setTimeout(_cleanup, 1200); return;
        }
        (res.signals || []).forEach(function (s) {
          if (s.id > CALL.cursor) CALL.cursor = s.id;
          var data = JSON.parse(s.data);
          if (s.type === 'answer') {
            CALL.pc.setRemoteDescription(new RTCSessionDescription(data))
              .then(function () { CALL.haveRemote = true; _flushIce(); }).catch(function () {});
          } else if (s.type === 'ice') {
            if (CALL.haveRemote) CALL.pc.addIceCandidate(new RTCIceCandidate(data)).catch(function () {});
            else CALL.pendingIce.push(data);
          }
        });
      }).catch(function () {});
    }, 2000);
  }

  // ── Incoming-call watcher (runs whenever signed in on the chat page) ──
  window.startCallWatcher = function () {
    if (CALL.incPoll) return;
    CALL.incPoll = setInterval(function () {
      if (CALL.id || CALL._incoming) return;               // busy
      if (!window.STATE || !STATE.user) return;
      api('/call?incoming=1').then(function (res) {
        if (res && res.ok && res.call) { CALL._incoming = res.call; _showIncoming(res.call); }
      }).catch(function () {});
    }, 3000);
  };

  // ══════════ UI ══════════
  function _attachLocal(stream) {
    var lv = document.getElementById('call-local-video');
    if (lv) { lv.srcObject = stream; lv.muted = true; lv.play && lv.play().catch(function () {}); }
  }
  function _setStatus(t) {
    var el = document.getElementById('call-status'); if (el) el.textContent = t;
    var tb = document.getElementById('call-top-status'); if (tb) tb.textContent = t;
  }

  function _showCallUI(status) {
    _hideIncoming();
    var ov = document.getElementById('call-overlay'); if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'call-overlay';
    var isVideo = CALL.kind === 'video';
    ov.innerHTML =
      '<video id="call-remote-video" autoplay playsinline></video>' +
      '<div id="call-top-bar"><div class="call-top-name">' + (CALL.peerName || 'User') + '</div><div id="call-top-status">' + status + '</div></div>' +
      '<div id="call-remote-fallback"><div class="call-av-big"' + (CALL.peerPhoto ? ' style="background-image:url(' + CALL.peerPhoto + ')"' : '') + '>' + (CALL.peerPhoto ? '' : (CALL.peerName || '?').slice(0,1).toUpperCase()) + '</div>' +
        '<div class="call-peer-name">' + (CALL.peerName || 'User') + '</div>' +
        '<div id="call-status">' + status + '</div></div>' +
      (isVideo ? '<video id="call-local-video" autoplay playsinline muted></video>' : '') +
      '<div class="call-controls">' +
        '<button class="call-btn" onclick="toggleMute(this)" title="Mute"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.9V21a1 1 0 0 0 2 0v-3.1A7 7 0 0 0 19 11z"/></svg></button>' +
        (isVideo ? '<button class="call-btn" onclick="toggleCam(this)" title="Camera"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg></button>' : '') +
        (isVideo ? '<button class="call-btn" onclick="flipCamera(this)" title="Flip camera"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1"/><path d="M8 11l2-2-2-2"/><path d="M16 13l-2 2 2 2"/><circle cx="12" cy="14" r="2.2"/></svg></button>' : '') +
        (isVideo ? '<button class="call-btn" onclick="shareScreen(this)" title="Share screen"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M12 7v6M9 10l3-3 3 3"/></svg></button>' : '') +
        '<button class="call-btn call-btn-end" onclick="endCall()" title="End"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15.5c-1.2 0-2.4-.2-3.5-.6a1 1 0 0 0-1 .2l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .2-1A11 11 0 0 1 9.5 4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z" transform="rotate(135 12 12)"/></svg></button>' +
      '</div>';
    document.body.appendChild(ov);
    var lv = document.getElementById('call-local-video');
    if (lv) _makeDraggable(lv);
  }

  // Drag the local PiP anywhere (touch + mouse), like WhatsApp.
  function _makeDraggable(el) {
    var sx, sy, ox, oy, moved = false, dragging = false;
    function down(e) {
      dragging = true; moved = false;
      var p = e.touches ? e.touches[0] : e;
      sx = p.clientX; sy = p.clientY;
      var r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      el.style.transition = 'none';
    }
    function move(e) {
      if (!dragging) return;
      var p = e.touches ? e.touches[0] : e;
      var dx = p.clientX - sx, dy = p.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (e.cancelable) e.preventDefault();
      var nx = Math.max(6, Math.min(window.innerWidth - el.offsetWidth - 6, ox + dx));
      var ny = Math.max(50, Math.min(window.innerHeight - el.offsetHeight - 100, oy + dy));
      el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    }
    function up() { dragging = false; }
    el.addEventListener('mousedown', down);
    el.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
  }

  // Flip between front and back camera.
  window.flipCamera = function (btn) {
    if (!CALL.local || CALL.kind !== 'video' || !CALL.pc) { toast && toast('Flip is only for video calls'); return; }
    if (CALL._flipping) return; CALL._flipping = true;
    CALL._facing = CALL._facing === 'environment' ? 'user' : 'environment';
    var old = CALL.local.getVideoTracks()[0];
    // Some phones only allow one camera open at a time — release the old one first.
    if (old) { try { old.stop(); } catch (e) {} }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: CALL._facing } } })
      .then(function (stream) {
        var nt = stream.getVideoTracks()[0];
        if (!nt) throw new Error('no track');
        var sender = CALL.pc.getSenders().filter(function (s) { return s.track && s.track.kind === 'video'; })[0];
        if (sender) sender.replaceTrack(nt);
        if (old) { try { CALL.local.removeTrack(old); } catch (e) {} }
        CALL.local.addTrack(nt);
        // Mirror the self-view only for the front camera (like the phone camera app).
        var lv = document.getElementById('call-local-video');
        if (lv) lv.style.transform = CALL._facing === 'user' ? 'scaleX(-1)' : 'none';
        _attachLocal(CALL.local);
        CALL._flipping = false;
      })
      .catch(function () {
        CALL._flipping = false;
        // Restore the previous camera if the flip failed.
        navigator.mediaDevices.getUserMedia({ audio: false, video: _videoConstraints() })
          .then(function (s2) {
            var t2 = s2.getVideoTracks()[0]; if (!t2) return;
            var snd = CALL.pc.getSenders().filter(function (s) { return s.track && s.track.kind === 'video'; })[0];
            if (snd) snd.replaceTrack(t2);
            CALL.local.addTrack(t2); _attachLocal(CALL.local);
          }).catch(function () {});
        toast && toast('This device has only one camera');
      });
  };

  // Share your screen (swap the camera track for the screen track).
  window.shareScreen = function (btn) {
    if (!CALL.pc) return;
    if (CALL._sharing) { _stopScreen(btn); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast && toast('Screen sharing not supported here'); return; }
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(function (stream) {
      var st = stream.getVideoTracks()[0]; if (!st) return;
      var sender = CALL.pc.getSenders().filter(function (s) { return s.track && s.track.kind === 'video'; })[0];
      if (sender) sender.replaceTrack(st);
      CALL._sharing = true; CALL._screen = stream;
      if (btn) btn.classList.add('call-btn-off');
      var lv = document.getElementById('call-local-video'); if (lv) { lv.srcObject = stream; lv.play && lv.play().catch(function () {}); }
      st.onended = function () { _stopScreen(btn); };
    }).catch(function () {});
  };
  function _stopScreen(btn) {
    if (CALL._screen) { CALL._screen.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); CALL._screen = null; }
    var cam = CALL.local && CALL.local.getVideoTracks()[0];
    var sender = CALL.pc && CALL.pc.getSenders().filter(function (s) { return s.track && s.track.kind === 'video'; })[0];
    if (sender && cam) sender.replaceTrack(cam);
    CALL._sharing = false;
    if (btn) btn.classList.remove('call-btn-off');
    _attachLocal(CALL.local);
  }

  function _showIncoming(call) {
    _hideIncoming();
    var ov = document.createElement('div');
    ov.id = 'call-incoming';
    ov.innerHTML =
      '<div class="call-inc-card">' +
        '<div class="call-av-big"' + (call.caller_photo ? ' style="background-image:url(' + call.caller_photo + ')"' : '') + '>' + (call.caller_photo ? '' : (call.caller_nick || '?').slice(0,1).toUpperCase()) + '</div>' +
        '<div class="call-peer-name">' + (call.caller_nick || 'Someone') + '</div>' +
        '<div style="color:#cbd5e1;font-size:.85rem;margin-bottom:1.4rem">Incoming ' + (call.kind === 'audio' ? 'voice' : 'video') + ' call…</div>' +
        '<div style="display:flex;gap:2.5rem;justify-content:center">' +
          '<button class="call-btn call-btn-end" onclick="declineIncoming()"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15.5c-1.2 0-2.4-.2-3.5-.6a1 1 0 0 0-1 .2l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .2-1A11 11 0 0 1 9.5 4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z" transform="rotate(135 12 12)"/></svg></button>' +
          '<button class="call-btn call-btn-accept" onclick="answerIncoming()"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15.5c-1.2 0-2.4-.2-3.5-.6a1 1 0 0 0-1 .2l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .2-1A11 11 0 0 1 9.5 4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z"/></svg></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    _playRingtone();
    // Auto-dismiss if the caller gives up.
    CALL._incTimeout = setTimeout(function () { window.declineIncoming(); }, 45000);
  }
  function _hideIncoming() { var el = document.getElementById('call-incoming'); if (el) el.remove(); clearTimeout(CALL._incTimeout); }

  // ── Ringtones (WebAudio, no files) ──
  function _callsSilent() {
    try { return localStorage.getItem('yp_silent_calls') === '1'; } catch (e) { return false; }
  }
  function _playRingtone() {
    if (_callsSilent()) return;   // silent mode — show the call, make no sound
    try {
      _stopRing();
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      CALL.ringCtx = ctx;
      CALL.ring = setInterval(function () {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 480; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
        o.start(); o.stop(ctx.currentTime + 0.85);
      }, 2000);
    } catch (e) {}
  }
  function _playRingback() {
    try {
      _stopRing();
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      CALL.ringCtx = ctx;
      CALL.ring = setInterval(function () {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 420; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1);
        o.start(); o.stop(ctx.currentTime + 1.1);
      }, 3000);
    } catch (e) {}
  }
  function _stopRing() {
    clearInterval(CALL.ring); CALL.ring = null;
    if (CALL.ringCtx) { try { CALL.ringCtx.close(); } catch (e) {} CALL.ringCtx = null; }
  }

  function _mediaErr(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) return 'Camera/microphone permission denied.';
    if (e && e.name === 'NotFoundError') return 'No camera or microphone found.';
    return 'Could not start the call.';
  }
  function _fail(msg) { _setStatus(msg || 'Call failed'); toast && toast('❌ ' + (msg || 'Call failed')); setTimeout(_cleanup, 1600); }

  function _cleanup() {
    _stopRing();
    clearInterval(CALL.poll); CALL.poll = null;
    if (CALL.pc) { try { CALL.pc.close(); } catch (e) {} CALL.pc = null; }
    if (CALL.local) { CALL.local.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); CALL.local = null; }
    CALL.remote = null; CALL.id = null; CALL.role = null; CALL.cursor = 0;
    CALL.haveRemote = false; CALL.pendingIce = []; CALL.outIce = []; CALL._incoming = null;
    var ov = document.getElementById('call-overlay'); if (ov) ov.remove();
    _hideIncoming();
  }
})();

// ══════════════════════════════════════════════════════════════════════════
// GROUP CALLS (mesh — everyone connects to everyone). Best for small groups.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var GCALL = { roomId: null, kind: 'video', local: null, me: null, peers: {}, names: {}, cursor: 0, poll: null, ice: null };
  window.GCALL = GCALL;

  function gapi(path, body) {
    return fetch((window.CONFIG ? CONFIG.API_BASE : '/api') + path, {
      method: body ? 'POST' : 'GET', credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json(); });
  }
  function gIce() {
    return gapi('/turn-credentials').then(function (r) { return (r && r.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }]; })
      .catch(function () { return [{ urls: 'stun:stun.l.google.com:19302' }]; });
  }

  window.startGroupCall = function (roomId, kind) {
    if (GCALL.roomId || (window.CALL && CALL.id)) { toast && toast('Already in a call'); return; }
    if (!roomId) return;
    GCALL.roomId = roomId; GCALL.kind = kind === 'audio' ? 'audio' : 'video';
    GCALL.peers = {}; GCALL.names = {}; GCALL.cursor = 0;
    _gShowUI();
    navigator.mediaDevices.getUserMedia({ audio: true, video: GCALL.kind === 'video' })
      .then(function (stream) { GCALL.local = stream; _gAddTile('local', 'You', stream, true); return gIce(); })
      .then(function (ice) { GCALL.ice = ice; return gapi('/group-call', { action: 'join', room_id: roomId, kind: GCALL.kind }); })
      .then(function (res) {
        if (!res.ok) { _gFail(res.error || 'Could not join'); return; }
        GCALL.me = res.me;
        (res.participants || []).forEach(function (p) { GCALL.names[p.user_id] = p.nickname || 'User'; _gConnect(p.user_id); });
        _gPoll();
      })
      .catch(function (e) { _gFail(_gMediaErr(e)); });
  };

  window.endGroupCall = function () {
    if (GCALL.roomId) gapi('/group-call', { action: 'leave', room_id: GCALL.roomId });
    _gCleanup();
  };
  window.gToggleMute = function (btn) {
    if (!GCALL.local) return;
    var on = GCALL.local.getAudioTracks()[0] && GCALL.local.getAudioTracks()[0].enabled;
    GCALL.local.getAudioTracks().forEach(function (t) { t.enabled = !on; });
    if (btn) btn.classList.toggle('call-btn-off', on);
  };
  window.gToggleCam = function (btn) {
    if (!GCALL.local) return;
    var v = GCALL.local.getVideoTracks()[0]; if (!v) return;
    v.enabled = !v.enabled;
    if (btn) btn.classList.toggle('call-btn-off', !v.enabled);
  };

  function _gPeerObj(id) {
    if (GCALL.peers[id]) return GCALL.peers[id];
    var pc = new RTCPeerConnection({ iceServers: GCALL.ice });
    var peer = { pc: pc, haveRemote: false, pendingIce: [] };
    GCALL.peers[id] = peer;
    GCALL.local.getTracks().forEach(function (t) { pc.addTrack(t, GCALL.local); });
    pc.onicecandidate = function (e) { if (e.candidate) _gSignal(id, 'ice', e.candidate); };
    pc.ontrack = function (e) { _gAddTile(id, GCALL.names[id] || 'User', e.streams[0], false); };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') _gRemovePeer(id);
    };
    return peer;
  }
  // The peer with the smaller id creates the offer (avoids glare).
  function _gConnect(id) {
    if (GCALL.peers[id]) return;
    if (String(GCALL.me) < String(id)) {
      var peer = _gPeerObj(id);
      peer.pc.createOffer()
        .then(function (o) { o.sdp = _capSdp(o.sdp, 300); return peer.pc.setLocalDescription(o).then(function () { return o; }); })
        .then(function (o) { _gSignal(id, 'offer', o); })
        .catch(function () {});
    }
    // else: wait for their offer (handled in the poll)
  }
  function _gSignal(toId, type, data) { gapi('/group-call', { action: 'signal', room_id: GCALL.roomId, to_id: toId, type: type, data: data }); }
  function _gFlush(id) {
    var peer = GCALL.peers[id]; if (!peer) return;
    peer.pendingIce.forEach(function (c) { peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {}); });
    peer.pendingIce = [];
  }

  function _gPoll() {
    clearInterval(GCALL.poll);
    GCALL.poll = setInterval(function () {
      if (!GCALL.roomId) return;
      gapi('/group-call?room_id=' + GCALL.roomId + '&since=' + GCALL.cursor).then(function (res) {
        if (!res.ok) return;
        var present = {};
        (res.participants || []).forEach(function (p) {
          present[p.user_id] = 1; GCALL.names[p.user_id] = p.nickname || 'User';
          if (!GCALL.peers[p.user_id]) _gConnect(p.user_id);
        });
        Object.keys(GCALL.peers).forEach(function (id) { if (!present[id]) _gRemovePeer(id); });
        (res.signals || []).forEach(function (s) {
          if (s.id > GCALL.cursor) GCALL.cursor = s.id;
          var data = JSON.parse(s.data);
          var peer = _gPeerObj(s.from_id);
          if (s.type === 'offer') {
            peer.pc.setRemoteDescription(new RTCSessionDescription(data))
              .then(function () { peer.haveRemote = true; _gFlush(s.from_id); return peer.pc.createAnswer(); })
              .then(function (a) { a.sdp = _capSdp(a.sdp, 300); return peer.pc.setLocalDescription(a).then(function () { return a; }); })
              .then(function (a) { _gSignal(s.from_id, 'answer', a); }).catch(function () {});
          } else if (s.type === 'answer') {
            peer.pc.setRemoteDescription(new RTCSessionDescription(data)).then(function () { peer.haveRemote = true; _gFlush(s.from_id); }).catch(function () {});
          } else if (s.type === 'ice') {
            if (peer.haveRemote) peer.pc.addIceCandidate(new RTCIceCandidate(data)).catch(function () {});
            else peer.pendingIce.push(data);
          }
        });
      }).catch(function () {});
    }, 1500);
  }

  function _gRemovePeer(id) {
    var peer = GCALL.peers[id];
    if (peer) { try { peer.pc.close(); } catch (e) {} delete GCALL.peers[id]; }
    var tile = document.getElementById('gtile-' + _gSafe(id)); if (tile) tile.remove();
    _gRelayout();
  }
  function _gSafe(id) { return String(id).replace(/[^a-zA-Z0-9]/g, ''); }

  // ── UI ──
  function _gShowUI() {
    var ov = document.getElementById('gcall-overlay'); if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'gcall-overlay';
    ov.innerHTML =
      '<div id="gcall-grid"></div>' +
      '<div class="call-controls">' +
        '<button class="call-btn" onclick="gToggleMute(this)"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.9V21a1 1 0 0 0 2 0v-3.1A7 7 0 0 0 19 11z"/></svg></button>' +
        (GCALL.kind === 'video' ? '<button class="call-btn" onclick="gToggleCam(this)"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg></button>' : '') +
        '<button class="call-btn call-btn-end" onclick="endGroupCall()"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15.5c-1.2 0-2.4-.2-3.5-.6a1 1 0 0 0-1 .2l-2.2 2.2a15 15 0 0 1-6.6-6.6l2.2-2.2a1 1 0 0 0 .2-1A11 11 0 0 1 9.5 4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1z" transform="rotate(135 12 12)"/></svg></button>' +
      '</div>';
    document.body.appendChild(ov);
  }
  function _gAddTile(id, name, stream, isLocal) {
    var grid = document.getElementById('gcall-grid'); if (!grid) return;
    var tid = 'gtile-' + _gSafe(id);
    var tile = document.getElementById(tid);
    if (!tile) {
      tile = document.createElement('div'); tile.className = 'gtile'; tile.id = tid;
      tile.innerHTML = '<video autoplay playsinline' + (isLocal ? ' muted' : '') + '></video><div class="gtile-name">' + (name || 'User') + '</div>';
      grid.appendChild(tile);
    }
    var v = tile.querySelector('video');
    if (v && stream) { v.srcObject = stream; v.play && v.play().catch(function () {}); }
    _gRelayout();
  }
  function _gRelayout() {
    var grid = document.getElementById('gcall-grid'); if (!grid) return;
    var n = grid.children.length;
    var cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
  }

  function _gMediaErr(e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) return 'Camera/microphone permission denied.';
    if (e && e.name === 'NotFoundError') return 'No camera or microphone found.';
    return 'Could not start the call.';
  }
  function _gFail(msg) { toast && toast('❌ ' + (msg || 'Call failed')); setTimeout(_gCleanup, 800); }
  function _gCleanup() {
    clearInterval(GCALL.poll); GCALL.poll = null;
    Object.keys(GCALL.peers).forEach(function (id) { try { GCALL.peers[id].pc.close(); } catch (e) {} });
    GCALL.peers = {};
    if (GCALL.local) { GCALL.local.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); GCALL.local = null; }
    GCALL.roomId = null; GCALL.me = null; GCALL.cursor = 0;
    var ov = document.getElementById('gcall-overlay'); if (ov) ov.remove();
  }
})();

// Start the incoming-call watcher on ANY page (not just chat), once signed in,
// so a call reaches you wherever you are in the app.
(function () {
  function boot() {
    if (typeof startCallWatcher === 'function') { try { startCallWatcher(); } catch (e) {} }
  }
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
