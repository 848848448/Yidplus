// ═══════════════════════════════════════════
// YID PLUS — Realtime Presence Service
// src/firebase/presence.service.js
// Handles: Online status, Typing indicators
// ═══════════════════════════════════════════

import {
  ref as dbRef, set, onValue, onDisconnect,
  serverTimestamp as rtServerTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

import { rtdb } from "./config.js";

// ─────────────────────────────────────────
// Go ONLINE — call when user logs in
// Automatically goes offline on disconnect
// ─────────────────────────────────────────
export function goOnline(uid) {
  const presenceRef = dbRef(rtdb, `presence/${uid}`);
  const statusData  = { online: true, lastSeen: rtServerTimestamp() };

  set(presenceRef, statusData);

  // When browser closes / loses connection → auto offline
  onDisconnect(presenceRef).set({ online: false, lastSeen: rtServerTimestamp() });
}

// ─────────────────────────────────────────
// Go OFFLINE manually (on logout)
// ─────────────────────────────────────────
export function goOffline(uid) {
  const presenceRef = dbRef(rtdb, `presence/${uid}`);
  set(presenceRef, { online: false, lastSeen: rtServerTimestamp() });
}

// ─────────────────────────────────────────
// Listen to a user's online status
// callback({ online: bool, lastSeen: timestamp })
// ─────────────────────────────────────────
export function listenPresence(uid, callback) {
  const presenceRef = dbRef(rtdb, `presence/${uid}`);
  return onValue(presenceRef, snap => {
    callback(snap.val() || { online: false, lastSeen: null });
  });
}

// ─────────────────────────────────────────
// TYPING INDICATOR — set typing state in a chat room
// ─────────────────────────────────────────
export function setTyping(roomId, uid, isTyping) {
  const typingRef = dbRef(rtdb, `typing/${roomId}/${uid}`);
  set(typingRef, isTyping ? true : null);
}

// ─────────────────────────────────────────
// Listen to typing in a room
// callback([ uid1, uid2, ... ]) — array of who is typing
// ─────────────────────────────────────────
export function listenTyping(roomId, myUID, callback) {
  const typingRef = dbRef(rtdb, `typing/${roomId}`);
  return onValue(typingRef, snap => {
    const data   = snap.val() || {};
    const others = Object.keys(data).filter(uid => uid !== myUID);
    callback(others);
  });
}

// ─────────────────────────────────────────
// Listen to ONLINE COUNT (for admin analytics)
// ─────────────────────────────────────────
export function listenOnlineCount(callback) {
  const presenceRef = dbRef(rtdb, "presence");
  return onValue(presenceRef, snap => {
    const data  = snap.val() || {};
    const count = Object.values(data).filter(u => u.online).length;
    callback(count);
  });
}
