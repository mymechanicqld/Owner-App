/* ============================================================================
   Phone notifications: switch them on or off for this device.

   Alerts come from the listener Worker (cloudflare/listener): new enquiries
   and customer email replies, encrypted Web Push. This file only registers
   the notification service worker (push/sw.js, scope /push/ so it never
   controls an app page), subscribes, and tells the listener.

   Only a phone with Gmail connected can sign up: the listener checks the
   Gmail device key (gmail-auth.js), because alerts carry customer names.

   iPhone: needs iOS 16.4 or later and the app opened from the Home Screen
   icon, not from Safari. Turning on must come from a tap.

     MMQLD_PUSH.support()   '' when this device can, otherwise why not
     MMQLD_PUSH.status()    'on' | 'off' | 'blocked'
     MMQLD_PUSH.enable(prefs) / disable() / test() / prefs() / setPrefs(p)
   ========================================================================== */
(function () {
  'use strict';

  const PREFS_KEY = 'mmqld_push_prefs';
  const cfg = () => (typeof CONFIG === 'undefined' ? {} : (CONFIG.LISTENER || {}));
  const endpoint = () => String(cfg().ENDPOINT || '').replace(/\/+$/, '');

  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  function support() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return isIos() && !standalone()
        ? 'Open the app from its Home Screen icon (not Safari) to turn on notifications. Needs iOS 16.4 or later.'
        : 'This browser cannot show notifications.';
    }
    if (!endpoint() || !cfg().VAPID_PUBLIC) return 'Notifications are not set up yet.';
    return '';
  }

  const reg = () => navigator.serviceWorker.getRegistration('/push/');
  async function subscription() {
    if (support()) return null;
    const r = await reg();
    return r ? r.pushManager.getSubscription() : null;
  }
  async function status() {
    if (support()) return 'off';
    if (Notification.permission === 'denied') return 'blocked';
    return (await subscription()) ? 'on' : 'off';
  }

  function prefs() {
    try { return Object.assign({ enquiries: true, replies: true }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (_) { return { enquiries: true, replies: true }; }
  }

  async function call(path, body) {
    const key = (function () { try { return localStorage.getItem('mmqld_gdev') || ''; } catch (_) { return ''; } })();
    const r = await fetch(endpoint() + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': key }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Connect Gmail on this phone first (Settings > Gmail). Notifications need it.');
    if (!r.ok) throw new Error('Could not reach the notification service (' + (j.error || r.status) + ')');
    return j;
  }

  const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));

  /* navigator.serviceWorker.ready only settles for a worker that controls the
     page, and this one never does (scope /push/), so wait on it directly. */
  function activated(r) {
    const w = r.installing || r.waiting;
    if (r.active && !w) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, 8000);
      w.addEventListener('statechange', () => { if (w.state === 'activated') { clearTimeout(t); resolve(); } });
    });
  }

  /* From a tap: ask permission, subscribe, register with the listener. */
  async function enable(p) {
    const why = support();
    if (why) throw new Error(why);
    if (!(window.MMQLD_GAUTH && MMQLD_GAUTH.lasting())) throw new Error('Connect Gmail on this phone first (Settings > Gmail). Notifications need it.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Allow them for this app in the phone\'s Settings, then try again.' : 'Notifications were not allowed.');
    const r = await navigator.serviceWorker.register('/push/sw.js', { scope: '/push/' });
    await activated(r);
    let sub = await r.pushManager.getSubscription();
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg().VAPID_PUBLIC) });
    const pr = Object.assign(prefs(), p || {});
    await call('/subscribe', { subscription: sub.toJSON(), prefs: pr });
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(pr)); } catch (_) {}
    return true;
  }

  async function setPrefs(p) {
    const pr = Object.assign(prefs(), p || {});
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(pr)); } catch (_) {}
    const sub = await subscription();
    if (sub) await call('/subscribe', { subscription: sub.toJSON(), prefs: pr });
    return pr;
  }

  async function disable() {
    const sub = await subscription();
    if (sub) {
      try { await call('/unsubscribe', { endpoint: sub.endpoint }); } catch (_) {}
      await sub.unsubscribe().catch(() => {});
    }
  }

  async function test() {
    const sub = await subscription();
    if (!sub) throw new Error('Notifications are off on this phone.');
    await call('/test', { endpoint: sub.endpoint });
  }

  window.MMQLD_PUSH = { support, status, enable, disable, test, prefs, setPrefs };
})();
