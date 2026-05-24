// ═══════════════════════════════════════════
// YID PLUS — Firebase Storage Service
// src/firebase/storage.service.js
// ═══════════════════════════════════════════

import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import { storage } from "./config.js";

// ─────────────────────────────────────────
// Generic uploader with progress callback
// ─────────────────────────────────────────
function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const storageRef  = ref(storage, path);
    const uploadTask  = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      snapshot => {
        const pct = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        if (typeof onProgress === "function") onProgress(Math.round(pct));
      },
      error  => reject(error),
      async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(url);
      }
    );
  });
}

// ─────────────────────────────────────────
// Upload a SHORT video
// path: shorts/{uid}/{timestamp}_{filename}
// ─────────────────────────────────────────
export async function uploadShortVideo(uid, file, onProgress) {
  const path = `shorts/${uid}/${Date.now()}_${file.name}`;
  return await uploadFile(path, file, onProgress);
}

// ─────────────────────────────────────────
// Upload a PROFILE PHOTO
// ─────────────────────────────────────────
export async function uploadProfilePhoto(uid, file, onProgress) {
  const path = `profiles/${uid}/avatar_${Date.now()}`;
  return await uploadFile(path, file, onProgress);
}

// ─────────────────────────────────────────
// Upload a STATUS (photo or video)
// ─────────────────────────────────────────
export async function uploadStatusMedia(uid, file, onProgress) {
  const path = `statuses/${uid}/${Date.now()}_${file.name}`;
  return await uploadFile(path, file, onProgress);
}

// ─────────────────────────────────────────
// Upload MUSIC (mp3)
// ─────────────────────────────────────────
export async function uploadAudioFile(uid, file, onProgress) {
  const path = `music/${uid}/${Date.now()}_${file.name}`;
  return await uploadFile(path, file, onProgress);
}

// ─────────────────────────────────────────
// Upload ALBUM COVER / THUMBNAIL
// ─────────────────────────────────────────
export async function uploadCoverImage(uid, file, onProgress) {
  const path = `covers/${uid}/${Date.now()}_${file.name}`;
  return await uploadFile(path, file, onProgress);
}

// ─────────────────────────────────────────
// Upload CHAT MEDIA (photo/video in chat)
// ─────────────────────────────────────────
export async function uploadChatMedia(uid, file, onProgress) {
  const path = `chat/${uid}/${Date.now()}_${file.name}`;
  return await uploadFile(path, file, onProgress);
}

// ─────────────────────────────────────────
// Delete a file by its full storage path
// ─────────────────────────────────────────
export async function deleteStorageFile(fullPath) {
  const fileRef = ref(storage, fullPath);
  await deleteObject(fileRef);
}
