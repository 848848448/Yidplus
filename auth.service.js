// ═══════════════════════════════════════════
// YID PLUS — Firebase Auth Service
// src/firebase/auth.service.js
// ═══════════════════════════════════════════

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { auth, db, OWNER_EMAIL, COL } from "./config.js";

// ─────────────────────────────────────────
// REGISTER — creates user + Firestore doc + channel
// ─────────────────────────────────────────
export async function registerUser({ email, nickname, phone, password }) {
  // 1. Create Firebase Auth account
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;

  const role = email === OWNER_EMAIL ? "owner" : "user";

  // 2. Write user document to Firestore
  await setDoc(doc(db, COL.users, uid), {
    uid,
    email,
    nickname,
    phone,          // stored privately — never shown publicly
    role,
    verified:       false,
    blocked:        false,
    followers:      0,
    following:      0,
    createdAt:      serverTimestamp(),
    lastSeen:       serverTimestamp(),
    onlineStatus:   true,
    profilePhoto:   "",
    bio:            "",
    chatWallpaper:  "#0A0A0F",
  });

  // 3. Auto-create personal Channel Portfolio
  await setDoc(doc(db, COL.channels, uid), {
    ownerUID:    uid,
    nickname,
    followers:   0,
    following:   0,
    totalViews:  0,
    verified:    false,
    bio:         "",
    website:     "",
    location:    "",
    coverEmoji:  "👤",
    createdAt:   serverTimestamp(),
  });

  return { uid, email, nickname, role };
}

// ─────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────
export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;

  // Fetch user profile from Firestore
  const snap = await getDoc(doc(db, COL.users, uid));
  if (!snap.exists()) throw new Error("User profile not found.");

  const data = snap.data();

  if (data.blocked) throw new Error("This account has been suspended.");

  // Update last seen + online status
  await updateDoc(doc(db, COL.users, uid), {
    lastSeen:     serverTimestamp(),
    onlineStatus: true,
  });

  return { uid, email, nickname: data.nickname, role: data.role, ...data };
}

// ─────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────
export async function logoutUser(uid) {
  if (uid) {
    await updateDoc(doc(db, COL.users, uid), {
      onlineStatus: false,
      lastSeen:     serverTimestamp(),
    }).catch(() => {});
  }
  await signOut(auth);
  localStorage.removeItem("yp_session");
  localStorage.removeItem("yp_remember");
}

// ─────────────────────────────────────────
// AUTH STATE OBSERVER
// ─────────────────────────────────────────
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────
export async function changePassword(user, currentPassword, newPassword) {
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(auth.currentUser, credential);
  await updatePassword(auth.currentUser, newPassword);
}

// ─────────────────────────────────────────
// GET USER PROFILE
// ─────────────────────────────────────────
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, COL.users, uid));
  return snap.exists() ? snap.data() : null;
}

// ─────────────────────────────────────────
// UPDATE USER PROFILE
// ─────────────────────────────────────────
export async function updateUserProfile(uid, updates) {
  // Never allow updating role via client-side call
  delete updates.role;
  delete updates.email;
  await updateDoc(doc(db, COL.users, uid), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}
