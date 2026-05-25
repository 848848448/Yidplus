// firebase/config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage }    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getDatabase }   from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDjGmskzkMi3FNu02RomBPUyp45zhPEhEY",
  authDomain:        "shorts-e05cc.firebaseapp.com",
  databaseURL:       "https://shorts-e05cc-default-rtdb.firebaseio.com",
  projectId:         "shorts-e05cc",
  storageBucket:     "shorts-e05cc.firebasestorage.app",
  messagingSenderId: "677889813755",
  appId:             "1:677889813755:web:e28c37e6dba645d0fc545e",
};

const app = initializeApp(firebaseConfig);
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
export const rtdb    = getDatabase(app);
export const OWNER_EMAIL = "avrumy5872877@gmail.com";
export const ADMIN_PIN   = "1234";
export const COL = {
  users:"users", channels:"channels", shorts:"shorts",
  messages:"messages", groups:"groups", music:"music",
  statuses:"statuses", ads:"ads", broadcasts:"broadcasts", feedback:"feedback",
};
