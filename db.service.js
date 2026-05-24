// ═══════════════════════════════════════════
// YID PLUS — Firestore Database Service
// src/firebase/db.service.js
// ═══════════════════════════════════════════

import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy,
  limit, onSnapshot, serverTimestamp, increment,
  arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { db, COL, OWNER_EMAIL } from "./config.js";

// ════════════════════════════
// SHORTS
// ════════════════════════════

export async function uploadShort({ uid, nickname, caption, tags, videoURL, thumbURL, music }) {
  const ref = await addDoc(collection(db, COL.shorts), {
    uid, nickname, caption, tags, videoURL, thumbURL, music,
    likes:     0,
    views:     0,
    comments:  0,
    likedBy:   [],
    createdAt: serverTimestamp(),
  });
  // Also link to user's channel
  await addDoc(collection(db, COL.channels, uid, "shorts"), { shortId: ref.id, createdAt: serverTimestamp() });
  return ref.id;
}

export function listenShortsFeed(callback) {
  const q = query(collection(db, COL.shorts), orderBy("createdAt", "desc"), limit(20));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function likeShort(shortId, uid) {
  const ref = doc(db, COL.shorts, shortId);
  const snap = await getDoc(ref);
  const liked = snap.data()?.likedBy?.includes(uid);
  await updateDoc(ref, {
    likes:   increment(liked ? -1 : 1),
    likedBy: liked ? arrayRemove(uid) : arrayUnion(uid),
  });
  return !liked;
}

export async function addComment(shortId, { uid, nickname, text }) {
  await addDoc(collection(db, COL.shorts, shortId, "comments"), {
    uid, nickname, text,
    likes:     0,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, COL.shorts, shortId), { comments: increment(1) });
}

export function listenComments(shortId, callback) {
  const q = query(
    collection(db, COL.shorts, shortId, "comments"),
    orderBy("createdAt", "asc"), limit(50)
  );
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function deleteShort(shortId) {
  await deleteDoc(doc(db, COL.shorts, shortId));
}

// ════════════════════════════
// CHAT & MESSAGES
// ════════════════════════════

export async function getOrCreateDM(uid1, uid2) {
  const roomId = [uid1, uid2].sort().join("_");
  const ref    = doc(db, COL.groups, roomId);
  const snap   = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type:      "private",
      members:   [uid1, uid2],
      createdAt: serverTimestamp(),
      lastMsg:   "",
      lastTime:  serverTimestamp(),
    });
  }
  return roomId;
}

export async function sendMessage(roomId, { uid, nickname, text, type = "text", mediaURL = null, replyTo = null }) {
  await addDoc(collection(db, COL.messages, roomId, "msgs"), {
    uid, nickname, text, type, mediaURL, replyTo,
    readBy:    [uid],
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, COL.groups, roomId), {
    lastMsg:  text || type,
    lastTime: serverTimestamp(),
  });
}

export function listenMessages(roomId, callback) {
  const q = query(
    collection(db, COL.messages, roomId, "msgs"),
    orderBy("createdAt", "asc"), limit(100)
  );
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export function listenUserRooms(uid, callback) {
  const q = query(collection(db, COL.groups), where("members", "array-contains", uid), orderBy("lastTime", "desc"));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function deleteMessage(roomId, msgId) {
  await deleteDoc(doc(db, COL.messages, roomId, "msgs", msgId));
}

export async function markRead(roomId, msgId, uid) {
  await updateDoc(doc(db, COL.messages, roomId, "msgs", msgId), {
    readBy: arrayUnion(uid),
  });
}

// ════════════════════════════
// MUSIC
// ════════════════════════════

export async function uploadTrack({ uid, nickname, name, artist, type, emoji, audioURL, coverURL, videoURL, duration }) {
  return await addDoc(collection(db, COL.music), {
    uid, nickname, name, artist,
    type,      // "single" | "album" | "video"
    emoji, audioURL, coverURL, videoURL, duration,
    plays:    0,
    likes:    0,
    trending: false,
    createdAt: serverTimestamp(),
  });
}

export function listenMusicFeed(type, callback) {
  const q = type
    ? query(collection(db, COL.music), where("type", "==", type), orderBy("createdAt", "desc"))
    : query(collection(db, COL.music), orderBy("createdAt", "desc"), limit(30));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function likeTrack(trackId, uid) {
  await updateDoc(doc(db, COL.music, trackId), { likes: increment(1) });
  // Save to user's liked songs
  await setDoc(doc(db, "userLikes", uid, "music", trackId), { likedAt: serverTimestamp() });
}

export async function setTrackTrending(trackId, trending) {
  await updateDoc(doc(db, COL.music, trackId), { trending });
}

export async function deleteTrack(trackId) {
  await deleteDoc(doc(db, COL.music, trackId));
}

// ════════════════════════════
// STATUSES / STORIES
// ════════════════════════════

export async function postStatus({ uid, nickname, type, text, mediaURL, bg, color }) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return await addDoc(collection(db, COL.statuses), {
    uid, nickname, type, text, mediaURL, bg, color,
    views:     [],
    expiresAt,
    createdAt: serverTimestamp(),
  });
}

export function listenStatuses(callback) {
  const now = new Date();
  const q   = query(collection(db, COL.statuses), where("expiresAt", ">", now), orderBy("expiresAt"));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function viewStatus(statusId, uid) {
  await updateDoc(doc(db, COL.statuses, statusId), { views: arrayUnion(uid) });
}

// ════════════════════════════
// ADS
// ════════════════════════════

export function listenAds(callback) {
  const q = query(collection(db, COL.ads), where("active", "==", true), orderBy("order"));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ════════════════════════════
// BROADCASTS
// ════════════════════════════

export async function sendBroadcast(text, senderEmail) {
  await addDoc(collection(db, COL.broadcasts), {
    text, senderEmail,
    sentAt: serverTimestamp(),
  });
}

export function listenBroadcasts(callback) {
  const q = query(collection(db, COL.broadcasts), orderBy("sentAt", "desc"), limit(5));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ════════════════════════════
// FEEDBACK
// ════════════════════════════

export async function submitFeedback({ uid, nickname, type, text, device }) {
  await addDoc(collection(db, COL.feedback), {
    uid, nickname, type, text, device,
    resolved:  false,
    createdAt: serverTimestamp(),
  });
}

// ════════════════════════════
// CHANNELS
// ════════════════════════════

export async function getChannel(uid) {
  const snap = await getDoc(doc(db, COL.channels, uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function followChannel(targetUID, myUID) {
  await updateDoc(doc(db, COL.channels, targetUID), { followers: increment(1) });
  await updateDoc(doc(db, COL.channels, myUID),     { following: increment(1) });
  await setDoc(doc(db, "follows", `${myUID}_${targetUID}`), {
    follower: myUID, following: targetUID, createdAt: serverTimestamp(),
  });
}

export async function unfollowChannel(targetUID, myUID) {
  await updateDoc(doc(db, COL.channels, targetUID), { followers: increment(-1) });
  await updateDoc(doc(db, COL.channels, myUID),     { following: increment(-1) });
  await deleteDoc(doc(db, "follows", `${myUID}_${targetUID}`));
}

// ════════════════════════════
// ADMIN — USERS
// ════════════════════════════

export async function getAllUsers() {
  const snap = await getDocs(collection(db, COL.users));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function setUserRole(uid, role) {
  await updateDoc(doc(db, COL.users, uid), { role });
}

export async function setUserBlocked(uid, blocked) {
  await updateDoc(doc(db, COL.users, uid), { blocked });
}

export async function setUserVerified(uid, verified) {
  await updateDoc(doc(db, COL.users, uid), { verified });
  await updateDoc(doc(db, COL.channels, uid), { verified });
}

// ════════════════════════════
// ONLINE PRESENCE (Realtime DB)
// ════════════════════════════
// Used via rtdb — see presence.service.js
