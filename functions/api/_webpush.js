// functions/api/_webpush.js
// A from-scratch implementation of the Web Push protocol (VAPID auth +
// RFC 8291 aes128gcm payload encryption), built entirely on the Web Crypto
// API since this project has no npm/bundler setup to pull in the standard
// 'web-push' library. Used by functions/api/push/send.js.

function b64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatBytes(...arrs) {
  const total = arrs.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) { out.set(a, offset); offset += a.length; }
  return out;
}

// ── VAPID: sign a short-lived JWT with the server's ES256 private key ──
async function signVapidJwt(audience, subject, publicKeyB64url, privateKeyB64url) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12h, max allowed is ~24h
  const payload = { aud: audience, exp: expiration, sub: subject };

  const encHeader = b64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;

  const pubRaw = b64urlDecode(publicKeyB64url); // 65 bytes, uncompressed point
  const dRaw = b64urlDecode(privateKeyB64url);   // 32 bytes

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pubRaw.slice(1, 33)),
    y: b64urlEncode(pubRaw.slice(33, 65)),
    d: b64urlEncode(dRaw),
    ext: true,
  };

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );

  // WebCrypto returns raw (r||s) ECDSA signature — exactly what JWS ES256 wants.
  const encSig = b64urlEncode(sigBuf);
  return `${signingInput}.${encSig}`;
}

// ── HKDF (RFC 5869) built on Web Crypto's HMAC ──
async function hkdf(salt, ikm, info, length) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = await crypto.subtle.sign('HMAC', saltKey, ikm);

  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoAndCounter = concatBytes(info, new Uint8Array([1]));
  const okm = await crypto.subtle.sign('HMAC', prkKey, infoAndCounter);
  return new Uint8Array(okm).slice(0, length);
}

// ── RFC 8291 payload encryption (aes128gcm content-coding) ──
async function encryptPayload(payloadText, p256dhB64url, authB64url) {
  const clientPub = b64urlDecode(p256dhB64url);   // 65 bytes
  const authSecret = b64urlDecode(authB64url);     // 16 bytes

  // Import the client's public key so we can do ECDH against it.
  const clientKey = await crypto.subtle.importKey(
    'raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // Generate an ephemeral P-256 key pair for this message.
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const ephemeralPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, ephemeral.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // PRK = HKDF(salt=auth_secret, ikm=shared_secret, info="WebPush: info\0" + client_pub + ephemeral_pub)
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    clientPub,
    ephemeralPubRaw
  );
  const prk = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdf(salt, prk, cekInfo, 16);

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, prk, nonceInfo, 12);

  // Plaintext gets a single 0x02 delimiter byte appended (last record, no padding).
  const plaintext = concatBytes(new TextEncoder().encode(payloadText), new Uint8Array([2]));

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, cekKey, plaintext
  );
  const ciphertext = new Uint8Array(ciphertextBuf);

  // aes128gcm header: salt(16) || rs(4, record size) || idlen(1) || keyid(idlen)
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(
    salt,
    recordSize,
    new Uint8Array([ephemeralPubRaw.length]),
    ephemeralPubRaw
  );

  return concatBytes(header, ciphertext);
}

// ── Public entry point: send one push message to one subscription ──
export async function sendWebPush(subscription, payloadObj, env) {
  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;
  const vapidSubject = env.VAPID_SUBJECT || 'mailto:admin@yidplus.com';

  if (!vapidPublic || !vapidPrivate) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not configured on the server');
  }

  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin;

  const jwt = await signVapidJwt(audience, vapidSubject, vapidPublic, vapidPrivate);
  const body = await encryptPayload(JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${vapidPublic}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body,
  });

  return { ok: res.ok, status: res.status };
}
