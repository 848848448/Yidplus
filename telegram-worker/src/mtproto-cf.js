// Cloudflare Workers environment for @mtproto/core.
//
// The package ships only "browser" and "node" envs. Both are unusable here:
// the browser one calls `new WebSocket(url)` and `window.localStorage`, neither
// of which exists in Workers. Everything the library needs is pluggable though,
// so this file supplies the six required pieces using Workers-native APIs.

import makeMTProto from '@mtproto/core/src/index.js';
import Obfuscated from '@mtproto/core/src/transport/obfuscated/index.js';

// ── crypto ── Workers expose Web Crypto globally, same shape as the browser.
async function SHA1(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-1', data));
}

async function SHA256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function PBKDF2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', password, { name: 'PBKDF2' }, false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations }, key, 512)
  );
}

function getRandomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// ── transport ──
// Workers cannot construct an outbound WebSocket directly; you ask fetch() for
// a protocol upgrade and take the socket off the response. The obfuscation,
// framing and MTProto plumbing all come from Obfuscated — this subclass only
// swaps in that connection mechanism.
const SUBDOMAINS = { 1: 'pluto', 2: 'venus', 3: 'aurora', 4: 'vesta', 5: 'flora' };

class CloudflareTransport extends Obfuscated {
  constructor(dc, cryptoImpl) {
    super();
    this.dc = dc;
    this.crypto = cryptoImpl;
    this.url = `https://${SUBDOMAINS[this.dc.id]}.web.telegram.org${this.dc.test ? '/apiws_test' : '/apiws'}`;
    this._open = false;
    this._closing = false;
    this.connect();
  }

  get isAvailable() {
    return this._open;
  }

  async connect() {
    try {
      const res = await fetch(this.url, {
        headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'binary' },
      });
      const socket = res.webSocket;
      if (!socket) {
        this.emit('error', { type: 'socket', message: `No WebSocket in response (HTTP ${res.status})` });
        return;
      }
      socket.accept();
      this.socket = socket;
      this._open = true;

      socket.addEventListener('message', (event) => { this.handleMessage(event); });
      socket.addEventListener('error', () => { this._open = false; this.emit('error', { type: 'socket' }); });
      socket.addEventListener('close', () => {
        this._open = false;
        // Don't auto-reconnect: a Worker invocation is short-lived, and a
        // reconnect loop here would outlive the request and burn the run.
        if (!this._closing) this.emit('error', { type: 'socket', message: 'closed' });
      });

      // accept() already leaves the socket open — there is no 'open' event.
      await this.handleOpen();
    } catch (err) {
      this.emit('error', { type: 'socket', message: err.message });
    }
  }

  async handleOpen() {
    const initialMessage = await this.generateObfuscationKeys();
    this.socket.send(initialMessage);
    this.emit('open');
  }

  async handleMessage(event) {
    try {
      const data = event.data instanceof ArrayBuffer
        ? event.data
        : await new Response(event.data).arrayBuffer();
      const bytes = await this.deobfuscate(new Uint8Array(data));
      const payload = this.getIntermediatePayload(bytes);
      this.emit('message', payload.buffer);
    } catch (err) {
      this.emit('error', { type: 'socket', message: 'bad frame: ' + err.message });
    }
  }

  async send(bytes) {
    const intermediateBytes = this.getIntermediateBytes(bytes);
    const { buffer } = await this.obfuscate(intermediateBytes);
    this.socket.send(buffer);
  }

  close() {
    this._closing = true;
    try { if (this.socket) this.socket.close(); } catch (e) { /* already gone */ }
    this._open = false;
  }
}

function createTransport(dc, cryptoImpl) {
  return new CloudflareTransport(dc, cryptoImpl);
}

// ── storage ──
// The library awaits get/set, so an async KV store drops straight in. Auth keys
// live here, which is what lets a later run skip the login handshake entirely.
export function makeKVStorage(kv) {
  return {
    async get(key) {
      return await kv.get('mtproto:' + key);
    },
    async set(key, value) {
      return await kv.put('mtproto:' + key, String(value));
    },
  };
}

// getLocalStorage is only used when no storage instance is passed; we always
// pass one, so this exists just to satisfy the required-methods check.
function getLocalStorage() {
  const mem = new Map();
  return {
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => { mem.set(k, String(v)); },
  };
}

const MTProto = makeMTProto({
  SHA1,
  SHA256,
  PBKDF2,
  getRandomBytes,
  getLocalStorage,
  createTransport,
});

export default MTProto;
