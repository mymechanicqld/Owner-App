/* ============================================================================
   Web Push from a Worker, with Web Crypto only (no libraries).

     encrypt(subscriptionKeys, payload)   RFC 8291 "aes128gcm" message body
     vapidAuth(endpoint, jwk, publicKey)  RFC 8292 VAPID Authorization header
     sendPush(env, subscription, data)    both, then POST to the push service

   Checked against the worked example in RFC 8291 Appendix A
   (scripts in cloudflare/listener/test-webpush.mjs).
   ========================================================================== */

const enc = new TextEncoder();
export const b64u = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/* keys: { p256dh, auth } (base64url, from PushSubscription.toJSON()).
   opts.asKeys / opts.salt only for the RFC test vector. */
export async function encrypt(keys, payload, opts = {}) {
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  const as = opts.asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const body = typeof payload === 'string' ? enc.encode(payload) : payload;
  const plain = concat(body, new Uint8Array([2]));          // single record: delimiter 0x02
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/* VAPID: a short-lived ES256 JWT for the push service's origin. */
export async function vapidAuth(endpoint, privateJwk, publicKeyB64u, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return 'vapid t=' + header + '.' + claims + '.' + b64u(sig) + ', k=' + publicKeyB64u;
}

/* Returns the push service's HTTP status. 404/410 mean the phone dropped
   the subscription and it should be forgotten. */
export async function sendPush(env, subscription, data, ttl = 86400) {
  const body = await encrypt(subscription.keys, JSON.stringify(data));
  const r = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(subscription.endpoint, JSON.parse(env.VAPID_PRIVATE_JWK), env.VAPID_PUBLIC, env.VAPID_SUBJECT || 'mailto:mymechanicqld@gmail.com'),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body,
  });
  return r.status;
}
