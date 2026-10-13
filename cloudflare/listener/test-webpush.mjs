// Checks encrypt() against RFC 8291 Appendix A, and a VAPID signature round trip.
//   node cloudflare/listener/test-webpush.mjs
import { encrypt, vapidAuth, b64u, unb64u } from './src/webpush.js';

const asPriv = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
const asPub = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const raw = unb64u(asPub);
const jwk = { kty: 'EC', crv: 'P-256', d: asPriv, x: b64u(raw.slice(1, 33)), y: b64u(raw.slice(33, 65)) };
const asKeys = {
  privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
  publicKey: await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
};
const out = await encrypt(
  { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
  'When I grow up, I want to be a watermelon',
  { asKeys, salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw') },
);
const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
console.log('RFC 8291 test vector:', b64u(out) === expected ? 'MATCH' : 'MISMATCH\n got ' + b64u(out));

// VAPID: sign with a fresh key and verify the JWT signature with its public half.
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
const h = await vapidAuth('https://web.push.apple.com/abc', priv, pub, 'mailto:test@example.com');
const jwt = h.match(/t=([^,]+)/)[1];
const [a, b, c] = jwt.split('.');
const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, unb64u(c), new TextEncoder().encode(a + '.' + b));
console.log('VAPID signature verifies:', ok, '| aud', JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/'))).aud);
