// js/auth.js — Login, Register, Logout
import { auth, db, OWNER_EMAIL, COL } from '../firebase/config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let remMe = !!localStorage.getItem('yp_remember');

// Session observer — runs on every page load
onAuthStateChanged(auth, async user => {
  if (user) {
    const snap = await getDoc(doc(db, COL.users, user.uid)).catch(() => null);
    const data = snap?.data() || {};
    APP.user = {
      uid:      user.uid,
      email:    user.email,
      nickname: data.nickname || user.email.split('@')[0],
      role:     data.role || 'user',
      isOwner:  user.email === OWNER_EMAIL,
    };
    if (APP.screen === 'auth') navTo('home');
  } else {
    APP.user = null;
    navTo('auth');
  }
});

window.authTab = function(tab) {
  document.getElementById('auth-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', i === 0 ? tab === 'login' : tab === 'register')
  );
  const m = document.getElementById('auth-msg');
  if (m) m.className = 'auth-msg';
};

window.toggleRemember = function() {
  remMe = !remMe;
  document.getElementById('rem-tog').classList.toggle('on', remMe);
};

function authMsg(type, text) {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.className = 'auth-msg ' + type;
  el.innerHTML = (type === 'err' ? '⚠ ' : '✓ ') + text;
}

window.doLogin = async function() {
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass)    return authMsg('err', 'Please fill in all fields.');
  if (!validEmail(email)) return authMsg('err', 'Enter a valid email address.');
  setLoad('l', true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    if (remMe) localStorage.setItem('yp_remember', email);
    else       localStorage.removeItem('yp_remember');
    authMsg('ok', APP.user?.isOwner ? 'Welcome back, Owner! 👑' : 'Signed in! Loading your feed...');
  } catch(e) {
    authMsg('err', e.code === 'auth/invalid-credential' ? 'Wrong email or password.' : e.message);
  }
  setLoad('l', false);
};

window.doRegister = async function() {
  const email = document.getElementById('r-email').value.trim();
  const nick  = document.getElementById('r-nick').value.trim();
  const phone = document.getElementById('r-phone').value.trim();
  const pass  = document.getElementById('r-pass').value;
  const pass2 = document.getElementById('r-pass2').value;
  if (!email || !nick || !pass || !pass2) return authMsg('err', 'Please fill in all required fields.');
  if (!validEmail(email))                 return authMsg('err', 'Enter a valid email address.');
  if (nick.length < 3)                    return authMsg('err', 'Nickname must be at least 3 characters.');
  if (pass.length < 6)                    return authMsg('err', 'Password must be at least 6 characters.');
  if (pass !== pass2)                     return authMsg('err', 'Passwords do not match.');
  setLoad('r', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid  = cred.user.uid;
    const role = email === OWNER_EMAIL ? 'owner' : 'user';
    await setDoc(doc(db, COL.users, uid), {
      uid, email, nickname: nick, phone, role,
      verified: false, blocked: false, onlineStatus: true,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, COL.channels, uid), {
      ownerUID: uid, nickname: nick,
      followers: 0, following: 0, totalViews: 0,
      verified: false, bio: '', createdAt: serverTimestamp(),
    });
    authMsg('ok', 'Account created! Your channel is being set up...');
  } catch(e) {
    authMsg('err', e.code === 'auth/email-already-in-use' ? 'This email is already registered.' : e.message);
  }
  setLoad('r', false);
};

window.doLogout = async function() {
  if (!confirm('Sign out of YID PLUS?')) return;
  if (APP.user?.uid) {
    await updateDoc(doc(db, COL.users, APP.user.uid), { onlineStatus: false }).catch(() => {});
  }
  await signOut(auth);
  toast('👋 Signed out.');
};

// Restore saved email on load
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('yp_remember');
  if (saved) {
    const el = document.getElementById('l-email');
    if (el) el.value = saved;
    remMe = true;
    const tog = document.getElementById('rem-tog');
    if (tog) tog.classList.add('on');
  }
  const lp = document.getElementById('l-pass');
  if (lp) lp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
});
