/* ============================================================================
   Email: customer conversations from the business Gmail, inside the app.

   The owner reads and answers customers here without opening Gmail. Every
   conversation is one Gmail thread, so nothing new is stored anywhere: Gmail
   stays the single source of truth, and a reply sent from here lands in the
   same thread for the owner and in the same conversation for the customer.

   How an enquiry becomes one thread:
     1. The website emails the business inbox a "New booking - Name (REGO)..."
        notification, with Reply-To set to the customer.
     2. The owner's reply (from here, the Inquiries sheet, or the Gmail app) is
        sent into that thread with the same subject, In-Reply-To and
        References, so Gmail files it in the thread and the customer's mail
        app shows it as one conversation.
     3. The customer's answer carries those headers back, so Gmail files it
        in the same thread too.

   Refresh is manual (plus a quiet catch-up when the tab is opened). Push
   notifications from Gmail need a server with a Google Cloud Pub/Sub topic;
   the list refresh below only refetches threads Gmail says have changed, so
   pressing Refresh is cheap.

   Relies on globals from app.js: gFetch, getToken, cachedGToken, STATE, esc,
   icons, toast, relTime, firstName, openDetail, setView, encHeader, u8b64,
   b64url, sb. Loaded after app.js.
   ========================================================================== */
(function () {
  'use strict';

  const CACHE_KEY = 'mmqld_mail_v1';
  const PAGE = 25;
  const STALE_MS = 60000;

  /* Which threads count as customer conversations. The business inbox is
     mostly marketing and Google notices, so the default view is narrowed to
     website enquiries (and every reply in them), invoices and reports the app
     sent, and anything to or from someone who has enquired recently. */
  const BASE_CUSTOMER_TERMS = ['subject:"New booking"', 'subject:"Invoice from"', 'subject:"inspection report"', 'subject:"Your enquiry with"'];

  const MAIL = {
    tab: 'customers',       // customers | inbox
    q: '',                  // search box
    ids: [],                // thread ids in list order for the current tab/search
    next: null,             // Gmail page token for "Load more"
    meta: {},               // threadId -> summary
    me: '',                 // the business Gmail address
    lastSync: 0,
    loading: false,
    err: '',
    needsAuth: false,
    open: null,             // threadId being read
    thread: null,           // parsed messages of the open thread
    threadErr: '',
    drafts: {},             // threadId -> unsent reply text (survives repaints)
    sending: false,
    showQuoted: {},         // messageId -> true
  };

  /* ------------------------------------------------------------ storage -- */
  function loadCache() {
    try {
      const o = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!o) return;
      MAIL.meta = o.meta || {};
      MAIL.ids = o.ids || [];
      MAIL.me = o.me || '';
      MAIL.lastSync = o.lastSync || 0;
      MAIL.drafts = o.drafts || {};
    } catch (_) {}
  }
  function saveCache() {
    // Only the customer list is kept between visits; search results are not.
    if (MAIL.tab !== 'customers' || MAIL.q) return persistDrafts();
    const keep = {};
    MAIL.ids.slice(0, 60).forEach((id) => { if (MAIL.meta[id]) keep[id] = MAIL.meta[id]; });
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ meta: keep, ids: MAIL.ids.slice(0, 60), me: MAIL.me, lastSync: MAIL.lastSync, drafts: MAIL.drafts }));
    } catch (_) {}
  }
  function persistDrafts() {
    try {
      const o = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
      o.drafts = MAIL.drafts;
      localStorage.setItem(CACHE_KEY, JSON.stringify(o));
    } catch (_) {}
  }

  const connected = () => !!(typeof cachedGToken === 'function' && cachedGToken()) || !!(STATE.gtoken && Date.now() < STATE.gexp);

  /* ------------------------------------------------------------ helpers -- */
  function hdrs(payload) {
    const h = {};
    ((payload && payload.headers) || []).forEach((x) => { h[x.name.toLowerCase()] = x.value; });
    return h;
  }
  function parseAddr(s) {
    s = String(s || '').trim();
    if (!s) return { name: '', email: '' };
    const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
    return { name: '', email: s.replace(/[<>]/g, '').trim().toLowerCase() };
  }
  /* The website notification comes from Resend with the customer's name in
     the display name ("Jane Smith via My Mechanic QLD") and the customer as
     Reply-To. Treat it as written by the customer. */
  function isNotice(h) {
    const from = String(h.from || '');
    return !!h['reply-to'] && (/via my mechanic qld/i.test(from) || /resend\.dev|bookings@mymechanicqld/i.test(from)) && /new booking/i.test(h.subject || '');
  }
  /* Bounces and other robots. Never the customer, never replied to. */
  const isRobot = (h) => /mailer-daemon|postmaster|no-?reply|do-?not-?reply/i.test(parseAddr(h.from).email);
  const isMine = (m, h) => (m.labelIds || []).includes('SENT') || (MAIL.me && parseAddr(h.from).email === MAIL.me);
  const cleanSubject = (s) => String(s || '').replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, '').trim();

  /* "New booking — Jane Smith (ABC123) · Brake repair · Logan" -> parts. */
  function enquiryParts(subject) {
    const s = cleanSubject(subject);
    const m = s.match(/^New booking\s*[—–-]\s*(.+?)(?:\s*\(([^)]+)\))?\s*(?:·\s*(.+?))?(?:\s*·\s*([^·]+))?$/i);
    if (!m) return null;
    return { name: m[1], rego: m[2] || '', service: m[4] ? m[3] : '', suburb: m[4] || m[3] || '' };
  }

  function initials(name, email) {
    const n = (name || email || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    return ((n[0] || '?')[0] + (n.length > 1 ? n[n.length - 1][0] : '')).toUpperCase();
  }
  const AV_COLORS = ['#1E3A8A', '#047857', '#7C3AED', '#B45309', '#0E7490', '#BE123C', '#4D7C0F', '#9D174D'];
  function avColor(key) { let h = 0; for (const c of String(key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }

  function shortWhen(ms) {
    const d = new Date(ms), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if (now - d < 6 * 864e5) return d.toLocaleDateString('en-AU', { weekday: 'short' });
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }
  function longWhen(ms) {
    return new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  /* Run async jobs with a small concurrency cap: Gmail allows bursts, but a
     phone on 4G does better with a handful of requests in flight. */
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
    });
    await Promise.all(workers);
    return out;
  }

  /* Gmail call that understands an expired or revoked sign-in. */
  async function gm(path, opts) {
    try {
      return await gFetch(path, opts);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/Gmail 401/.test(msg)) {
        try { localStorage.removeItem('mmqld_gtok'); } catch (_) {}
        STATE.gtoken = null; STATE.gexp = 0;
        MAIL.needsAuth = true;
        throw new Error('Gmail sign-in has expired. Tap Connect Gmail to sign in again.');
      }
      if (/Gmail 429/.test(msg)) throw new Error('Gmail is busy right now. Give it a minute and refresh.');
      throw e;
    }
  }

  /* --------------------------------------------------------- the query -- */
  function customerQuery() {
    const terms = BASE_CUSTOMER_TERMS.slice();
    // Recent enquirers, so a customer who emails directly still shows up.
    const cutoff = Date.now() - 45 * 864e5;
    const seen = new Set();
    for (const r of STATE.rows || []) {
      if (seen.size >= 40) break;
      if (!r.email || new Date(r.created_at).getTime() < cutoff) continue;
      const e = String(r.email).trim().toLowerCase();
      if (!/^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/.test(e) || seen.has(e)) continue;
      seen.add(e);
      terms.push('from:' + e);
    }
    return '{' + terms.join(' ') + '}';
  }
  function currentQuery() {
    const base = MAIL.tab === 'inbox' ? 'in:inbox category:primary' : customerQuery();
    const q = MAIL.q.trim().replace(/"/g, '');
    return q ? base + ' "' + q + '"' : base;
  }

  /* ------------------------------------------------------ list loading -- */
  function summarise(th) {
    const msgs = th.messages || [];
    const first = msgs[0] || {}, last = msgs[msgs.length - 1] || {};
    const fh = hdrs(first.payload), lh = hdrs(last.payload);
    let cust = { name: '', email: '' };
    // The newest message not sent by the business tells us who the customer is.
    for (let i = msgs.length - 1; i >= 0; i--) {
      const h = hdrs(msgs[i].payload);
      if (isMine(msgs[i], h) || isRobot(h)) continue;
      cust = isNotice(h) ? parseAddr(h['reply-to']) : parseAddr(h.from);
      break;
    }
    if (!cust.email) {
      // Only the business has written (an invoice sent cold, say): use the recipient.
      cust = parseAddr(String(fh.to || '').split(',')[0]);
    }
    const subject = cleanSubject(fh.subject || lh.subject || '(no subject)');
    const enq = enquiryParts(subject);
    // The name typed on the website form beats whatever their mail app says.
    if (enq && enq.name) cust.name = enq.name;
    const lastNotice = isNotice(lh);
    // Who spoke last, ignoring bounces; a bounce after our last email means it never arrived.
    let lastHuman = msgs.length - 1;
    while (lastHuman > 0 && isRobot(hdrs(msgs[lastHuman].payload))) lastHuman--;
    const lastMine = isMine(msgs[lastHuman] || last, hdrs((msgs[lastHuman] || last).payload));
    const bounced = lastHuman < msgs.length - 1 && /mailer-daemon|postmaster/i.test(parseAddr(lh.from).email);
    return {
      id: th.id,
      historyId: th.historyId || last.historyId || '',
      subject,
      enq,
      kind: enq ? 'enquiry' : /invoice/i.test(subject) ? 'invoice' : /inspection|report/i.test(subject) ? 'report' : 'email',
      name: cust.name || (cust.email ? cust.email.split('@')[0] : 'Unknown'),
      email: cust.email,
      count: msgs.length,
      unread: msgs.some((m) => (m.labelIds || []).includes('UNREAD')),
      lastAt: Number(last.internalDate || 0),
      lastMine,
      lastNotice,
      snippet: decodeEntities(last.snippet || ''),
      waiting: !lastMine && !isRobot(lh),
      bounced,
    };
  }
  function decodeEntities(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }

  async function ensureMe() {
    if (MAIL.me) return;
    const p = await gm('/users/me/profile');
    MAIL.me = String(p.emailAddress || '').toLowerCase();
  }

  /* Fetch the list. Threads whose historyId has not moved since the last
     refresh are reused from memory, so a refresh with nothing new costs one
     request. */
  async function refreshList(more) {
    if (MAIL.loading) return;
    MAIL.loading = true; MAIL.err = '';
    paintList();
    try {
      await getToken();
      MAIL.needsAuth = false;
      await ensureMe();
      const qs = '?maxResults=' + PAGE + '&q=' + encodeURIComponent(currentQuery()) + (more && MAIL.next ? '&pageToken=' + encodeURIComponent(MAIL.next) : '');
      const res = await gm('/users/me/threads' + qs);
      const list = res.threads || [];
      const stale = list.filter((t) => !MAIL.meta[t.id] || MAIL.meta[t.id].historyId !== t.historyId);
      await pool(stale, 5, async (t) => {
        const th = await gm('/users/me/threads/' + t.id + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Reply-To');
        MAIL.meta[t.id] = summarise(th);
      });
      const ids = list.map((t) => t.id).filter((id) => MAIL.meta[id]);
      MAIL.ids = more ? MAIL.ids.concat(ids.filter((id) => !MAIL.ids.includes(id))) : ids;
      MAIL.next = res.nextPageToken || null;
      if (!MAIL.q && MAIL.tab === 'customers') MAIL.lastSync = Date.now();
      saveCache();
      updateBadge();
    } catch (e) {
      MAIL.err = String((e && e.message) || e);
      if (/sign-in|sign in|Google/i.test(MAIL.err) && !connected()) MAIL.needsAuth = true;
    } finally {
      MAIL.loading = false;
      paintList();
    }
  }

  /* Unread customer conversations, on the Email tab and its sidebar entry.
     Counted from the customer list only, never from a search or All inbox. */
  function updateBadge() {
    if (MAIL.tab !== 'customers' || MAIL.q) return;
    const n = MAIL.ids.filter((id) => MAIL.meta[id] && MAIL.meta[id].unread).length;
    document.querySelectorAll('[data-mail-badge]').forEach((b) => {
      b.textContent = n > 9 ? '9+' : String(n);
      b.hidden = !n;
    });
  }

  /* -------------------------------------------------- reading a thread -- */
  function b64dec(data, charset) {
    const bin = atob(String(data || '').replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch (_) { return new TextDecoder('utf-8').decode(bytes); }
  }
  function charsetOf(part) {
    const ct = (hdrs(part)['content-type'] || '');
    const m = ct.match(/charset="?([^";]+)"?/i);
    return m ? m[1] : 'utf-8';
  }
  function walkParts(p, out) {
    if (!p) return out;
    const mt = (p.mimeType || '').toLowerCase();
    if (p.filename && p.body && (p.body.attachmentId || p.body.data)) {
      out.files.push({ name: p.filename, size: p.body.size || 0, id: p.body.attachmentId || '', mime: mt, data: p.body.data || '' });
    } else if (mt === 'text/plain' && p.body && p.body.data && !out.text) {
      out.text = b64dec(p.body.data, charsetOf(p));
    } else if (mt === 'text/html' && p.body && p.body.data && !out.html) {
      out.html = b64dec(p.body.data, charsetOf(p));
    }
    (p.parts || []).forEach((q) => walkParts(q, out));
    return out;
  }

  /* HTML-only emails: turn them into readable text. Nothing from an email is
     ever inserted as HTML into the app. */
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style,script,head,title').forEach((n) => n.remove());
    // Mark where the quoted history starts so it can be folded away.
    doc.querySelectorAll('.gmail_quote, blockquote, #appendonsend, #divRplyFwdMsg, .yahoo_quoted').forEach((n) => {
      n.replaceWith(doc.createTextNode('\n\u0000QUOTE\u0000\n' + (n.textContent || '')));
    });
    const BLOCK = /^(P|DIV|TR|H[1-6]|UL|OL|TABLE|SECTION|ARTICLE|HEADER|FOOTER)$/;
    let out = '';
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue.replace(/\s+/g, ' ');
        else if (c.nodeType === 1) {
          if (c.tagName === 'BR') { out += '\n'; continue; }
          if (c.tagName === 'LI') out += '\n\u2022 ';
          walk(c);
          if (BLOCK.test(c.tagName)) out += '\n';
          else if (c.tagName === 'TD') out += '  ';
        }
      }
    })(doc.body || doc);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* Split a reply into what the person wrote and the history they quoted. */
  function splitQuoted(text) {
    const t = String(text || '').replace(/\r\n/g, '\n');
    const mark = t.indexOf('\u0000QUOTE\u0000');
    if (mark >= 0) return { body: t.slice(0, mark).trim(), quoted: t.slice(mark + 7).trim() };
    const lines = t.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // "On Thu, 1 Oct 2026, 8:44 am Jane <jane@x.com> wrote:", sometimes wrapped over two lines.
      const isOnWrote = /^\s*On\s.+/.test(l) && (/wrote:\s*$/.test(l) || /wrote:\s*$/.test(lines[i + 1] || ''));
      const isOutlook = /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || (/^_{8,}\s*$/.test(l) && /^From:/i.test(lines[i + 1] || '')) || (/^From:\s/.test(l) && /^(Sent|Date):\s/i.test(lines[i + 1] || ''));
      const isGt = /^>/.test(l) && lines.slice(i).every((x) => /^>|^\s*$/.test(x));
      if (isOnWrote || isOutlook || isGt) {
        return { body: lines.slice(0, i).join('\n').trim(), quoted: lines.slice(i).join('\n').trim() };
      }
    }
    return { body: t.trim(), quoted: '' };
  }

  /* Gmail's plain-text copy of a formatted email marks bold as *word*. */
  const unstar = (t) => String(t || '').replace(/(^|[\s(])\*([^*\n]{1,80})\*(?=[\s).,:;!?]|$)/gm, '$1$2');

  /* The website notification's plain text, as label/value pairs. */
  function parseNotice(text) {
    const out = { fields: [], notes: '' };
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let inNotes = false; const notes = [];
    for (const l of lines) {
      if (/^reply to this email/i.test(l.trim()) || /^saved to the dashboard/i.test(l.trim())) { inNotes = false; continue; }
      if (inNotes) { notes.push(l); continue; }
      if (/^notes:\s*$/i.test(l.trim())) { inNotes = true; continue; }
      const m = l.match(/^([A-Za-z][A-Za-z ]{1,18}):\s+(.+)$/);
      if (m && !/^new booking/i.test(l)) out.fields.push([m[1].trim(), m[2].trim()]);
    }
    out.notes = notes.join('\n').trim();
    return out;
  }

  function parseMessage(m) {
    const h = hdrs(m.payload);
    const parts = walkParts(m.payload, { text: '', html: '', files: [] });
    let text = parts.text;
    // A plain part that is just a stub ("view this in a browser") is worse than the HTML.
    if ((!text || text.trim().length < 20) && parts.html) text = htmlToText(parts.html);
    if (!text && m.payload && m.payload.body && m.payload.body.data) text = b64dec(m.payload.body.data, charsetOf(m.payload));
    const notice = isNotice(h);
    const robot = !notice && isRobot(h);
    const mine = !notice && !robot && isMine(m, h);
    const who = notice ? parseAddr(h['reply-to']) : parseAddr(h.from);
    return {
      id: m.id,
      at: Number(m.internalDate || 0),
      mine, notice, robot,
      name: mine ? 'You' : (who.name || who.email),
      email: who.email,
      to: h.to || '',
      subject: h.subject || '',
      messageId: h['message-id'] || '',
      references: h.references || '',
      unread: (m.labelIds || []).includes('UNREAD'),
      split: notice ? { body: text, quoted: '' } : splitQuoted(unstar(text)),
      noticeData: notice ? parseNotice(text) : null,
      files: parts.files,
    };
  }

  async function openThread(id, opts) {
    MAIL.open = id;
    MAIL.thread = null; MAIL.threadErr = '';
    if (!(opts && opts.noHistory)) { try { history.pushState({ mmqldMail: id }, ''); } catch (_) {} }
    if (STATE.view !== 'email') setView('email'); else paint();
    await loadThread(id, true);
  }
  async function loadThread(id, markRead) {
    try {
      await ensureMe();
      const th = await gm('/users/me/threads/' + id + '?format=full');
      if (MAIL.open !== id) return;
      MAIL.thread = (th.messages || []).map(parseMessage).sort((a, b) => a.at - b.at);
      MAIL.meta[id] = summarise(th);
      if (markRead && MAIL.thread.some((x) => x.unread)) {
        // Opening it here counts as reading it, same as in Gmail.
        gm('/users/me/threads/' + id + '/modify', { method: 'POST', body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) })
          .then(() => { if (MAIL.meta[id]) MAIL.meta[id].unread = false; saveCache(); updateBadge(); })
          .catch(() => {});
      }
    } catch (e) {
      MAIL.threadErr = String((e && e.message) || e);
    }
    if (MAIL.open === id) paintThread(true);
  }
  function closeThread(fromPop) {
    if (!MAIL.open) return;
    if (!fromPop && history.state && history.state.mmqldMail) { history.back(); return; }
    MAIL.open = null; MAIL.thread = null;
    document.body.classList.remove('mail-thread');
    paint();
  }
  window.addEventListener('popstate', () => { if (MAIL.open) closeThread(true); });

  /* Find the conversation for a customer (from the Inquiries sheet). */
  async function openFor(email) {
    email = String(email || '').trim().toLowerCase();
    if (!email) return toast('No email address on file', 'err');
    setView('email');
    try {
      await getToken();
      const res = await gm('/users/me/threads?maxResults=10&q=' + encodeURIComponent('"' + email + '"'));
      const list = res.threads || [];
      if (!list.length) return toast('No emails with ' + email + ' yet');
      // Prefer the enquiry thread; otherwise the most recent conversation.
      let pick = list[0].id;
      for (const t of list.slice(0, 5)) {
        const th = MAIL.meta[t.id] && MAIL.meta[t.id].historyId === t.historyId ? null
          : await gm('/users/me/threads/' + t.id + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Reply-To');
        if (th) MAIL.meta[t.id] = summarise(th);
        if (MAIL.meta[t.id] && MAIL.meta[t.id].kind === 'enquiry') { pick = t.id; break; }
      }
      openThread(pick);
    } catch (e) { toast(String((e && e.message) || e).slice(0, 90), 'err'); }
  }

  /* --------------------------------------------------------- replying -- */
  function replyTarget() {
    const msgs = MAIL.thread || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m.mine && !m.robot && m.email && m.email !== MAIL.me) return { name: m.name, email: m.email };
    }
    // Only the business has written so far: reply to whoever it went to.
    const last = msgs.filter((m) => m.mine).pop();
    const a = last ? parseAddr(String(last.to).split(',')[0]) : { email: '' };
    return a.email ? a : null;
  }
  const addrHeader = (a) => (a.name && a.name !== a.email ? encHeader('"' + a.name.replace(/["\\]/g, '') + '"') + ' <' + a.email + '>' : a.email);

  async function sendReply() {
    if (MAIL.sending || !MAIL.thread) return;
    const id = MAIL.open;
    const ta = document.getElementById('mail-compose');
    const body = (ta ? ta.value : '').trim();
    if (!body) return toast('Write a reply first', 'err');
    const to = replyTarget();
    if (!to) return toast('Could not work out who to reply to', 'err');
    MAIL.sending = true; paintComposer();
    try {
      const msgs = MAIL.thread;
      // Answer the newest real message; a bounce is not part of the conversation.
      const last = msgs.filter((m) => !m.robot).pop() || msgs[msgs.length - 1];
      // Gmail only keeps a message in a thread when the subject matches, so
      // reuse the conversation's own subject.
      const base = cleanSubject(msgs[0].subject) || 'Your enquiry';
      const refs = (last.references ? last.references.split(/\s+/) : []).concat(last.messageId ? [last.messageId] : []).filter(Boolean);
      const MS = window.MMQLD_SETTINGS;
      const text = body + (MS && sigOn() ? MS.signature() : '');
      const head = [
        'To: ' + addrHeader(to),
        'Subject: ' + encHeader('Re: ' + base),
        'MIME-Version: 1.0',
      ];
      // Plain text plus HTML with a unique ending, so Gmail never folds the signature (mail-mime.js).
      const alt = MMQLD_MIME.alternative(text);
      head.push('Content-Type: ' + alt.type);
      if (last.messageId) head.push('In-Reply-To: ' + last.messageId);
      if (refs.length) head.push('References: ' + refs.slice(-20).join(' '));
      const raw = b64url(head.join('\r\n') + '\r\n\r\n' + alt.body);
      await gm('/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw, threadId: id }) });
      delete MAIL.drafts[id];
      persistDrafts();
      // The box was redrawn while sending, so clear the one on screen now.
      const box = document.getElementById('mail-compose');
      if (box) box.value = '';
      toast('Reply sent', 'ok');
      markEnquiryContacted(to.email);
      MAIL.sending = false;
      await loadThread(id, false);
      // Move it to the top of the list.
      MAIL.ids = [id].concat(MAIL.ids.filter((x) => x !== id));
      saveCache();
    } catch (e) {
      MAIL.sending = false;
      paintComposer();
      toast(String((e && e.message) || e).slice(0, 90), 'err');
    }
  }

  /* A first reply moves a brand-new enquiry along, same as the Reply sheet. */
  function markEnquiryContacted(email) {
    const t = MAIL.meta[MAIL.open] || {};
    const row = linkedEnquiry(email, t.enq && t.enq.rego);
    if (!row || row.status !== 'new') return;
    sb.from('quote_submissions').update({ status: 'contacted' }).eq('id', row.id).then(({ error }) => {
      if (!error) { row.status = 'contacted'; }
    });
  }
  /* The enquiry behind a conversation. A repeat customer has several, so the
     rego in the thread's subject picks the right one when there is one. */
  function linkedEnquiry(email, rego) {
    email = String(email || '').toLowerCase();
    if (!email) return null;
    const plate = (v) => String(v || '').replace(/\s/g, '').toUpperCase();
    const mine = (STATE.rows || []).filter((r) => String(r.email || '').trim().toLowerCase() === email);
    return (rego && mine.find((r) => plate(r.vehicle_rego) === plate(rego))) || mine[0] || null;
  }

  async function openAttachment(msgId, idx) {
    const m = (MAIL.thread || []).find((x) => x.id === msgId);
    const f = m && m.files[idx];
    if (!f) return;
    // Open the tab inside the tap; iOS blocks it once we have awaited.
    const win = window.open('', '_blank');
    try {
      let data = f.data;
      if (!data) data = (await gm('/users/me/messages/' + msgId + '/attachments/' + f.id)).data;
      const bin = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mime || 'application/octet-stream' }));
      if (win) win.location.href = url; else location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (win) win.close();
      toast(String((e && e.message) || e).slice(0, 90), 'err');
    }
  }

  /* ------------------------------------------------------------ painting -- */
  const root = () => document.getElementById('view-email');

  function paint() {
    const el = root();
    if (!el) return;
    if (MAIL.open) {
      document.body.classList.add('mail-thread');
      if (el.dataset.mode !== 'thread:' + MAIL.open) paintThread(false);
      return;
    }
    document.body.classList.remove('mail-thread');
    if (el.dataset.mode !== 'list') {
      el.dataset.mode = 'list';
      el.innerHTML = `
        <div class="view-head mail-head">
          <div><h2>Email</h2><div class="meta" id="mail-sync"></div></div>
          <button class="mail-refresh" id="mail-refresh" aria-label="Refresh emails"><i data-lucide="refresh-cw"></i><span>Refresh</span></button>
        </div>
        <div class="seg mail-seg" id="mail-seg">
          <button data-mtab="customers">Customers</button>
          <button data-mtab="inbox">All inbox</button>
        </div>
        <div class="search-bar"><i data-lucide="search"></i><input id="mail-search" type="search" placeholder="Search name, rego or email" autocomplete="off" /></div>
        <div id="mail-body"></div>`;
      const s = document.getElementById('mail-search');
      s.value = MAIL.q;
      let t = null;
      s.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { MAIL.q = s.value; MAIL.next = null; MAIL.ids = []; refreshList(false); }, 450);
      });
      icons();
    }
    paintList();
  }

  function paintList() {
    const el = root();
    if (!el || MAIL.open || el.dataset.mode !== 'list') return;
    document.querySelectorAll('#mail-seg [data-mtab]').forEach((b) => b.classList.toggle('active', b.dataset.mtab === MAIL.tab));
    const rb = document.getElementById('mail-refresh');
    if (rb) { rb.classList.toggle('spinning', MAIL.loading); rb.disabled = MAIL.loading; }
    const sync = document.getElementById('mail-sync');
    if (sync) sync.textContent = MAIL.loading ? 'Checking Gmail...' : MAIL.lastSync ? 'Updated ' + relTime(new Date(MAIL.lastSync).toISOString()) : (MAIL.me || 'Business Gmail');
    const body = document.getElementById('mail-body');
    if (!body) return;

    if (!connected() && (MAIL.needsAuth || !MAIL.ids.length)) {
      body.innerHTML = `
        <div class="mail-connect">
          <div class="mail-connect__ic"><i data-lucide="mail"></i></div>
          <h3>Connect the business Gmail</h3>
          <p>Customer emails show up here, grouped into conversations. You can read and reply without opening Gmail.</p>
          <button class="btn primary" id="mail-connect"><i data-lucide="log-in"></i>Connect Gmail</button>
        </div>
        ${MAIL.ids.length ? '<div class="section-title" style="margin-top:20px">Last checked</div>' + listHtml() : ''}`;
      icons();
      return;
    }
    const errHtml = MAIL.err ? `<div class="mail-err"><i data-lucide="alert-circle"></i><span>${esc(MAIL.err)}</span></div>` : '';
    if (!MAIL.ids.length) {
      body.innerHTML = errHtml + (MAIL.loading
        ? '<div class="list">' + '<div class="skeleton" style="height:76px"></div>'.repeat(5) + '</div>'
        : emptyBox());
      icons();
      return;
    }
    body.innerHTML = errHtml + listHtml() + (MAIL.next ? `<button class="btn ghost full" id="mail-more" style="margin-top:14px" ${MAIL.loading ? 'disabled' : ''}>${MAIL.loading ? '<span class="spin"></span>Loading...' : '<i data-lucide="chevrons-down"></i>Load older'}</button>` : '');
    icons();
  }
  function emptyBox() {
    if (MAIL.q) return `<div class="empty"><i data-lucide="search-x"></i><h3>No emails found</h3><p>Nothing in Gmail matches "${esc(MAIL.q)}".</p></div>`;
    return `<div class="empty"><i data-lucide="inbox"></i><h3>No conversations yet</h3><p>Tap Refresh to check Gmail.</p></div>`;
  }

  /* An enquiry nobody has answered yet: the notification's snippet is just
     the form's labels, so show what the customer actually wrote. */
  function snippetFor(t) {
    if (!t.lastNotice) return t.snippet;
    const row = linkedEnquiry(t.email, t.enq && t.enq.rego);
    const words = row && row.symptoms ? String(row.symptoms).trim() : '';
    return words || ('New website enquiry' + (t.enq && t.enq.suburb ? ' from ' + t.enq.suburb : ''));
  }

  function listHtml() {
    return '<div class="mail-list">' + MAIL.ids.map((id) => MAIL.meta[id]).filter(Boolean).map((t) => {
      const sub = t.enq ? [t.enq.service, t.enq.rego].filter(Boolean).join(' \u00b7 ') || 'Website enquiry' : t.subject;
      const tag = t.kind === 'enquiry' ? '<span class="mtag mtag--enq">Enquiry</span>' : t.kind === 'invoice' ? '<span class="mtag">Invoice</span>' : t.kind === 'report' ? '<span class="mtag">Report</span>' : '';
      const status = t.bounced ? '<span class="mtag mtag--bad">Not delivered</span>' : t.waiting && t.count > 0 ? '<span class="mtag mtag--wait">Needs reply</span>' : '';
      return `
      <button class="mrow ${t.unread ? 'unread' : ''}" data-thread="${esc(t.id)}">
        <span class="mav" style="background:${avColor(t.email || t.name)}">${esc(initials(t.name, t.email))}</span>
        <span class="mrow__body">
          <span class="mrow__top"><span class="mrow__name">${esc(t.name)}</span>${t.count > 1 ? `<span class="mrow__n">${t.count}</span>` : ''}<span class="mrow__when">${esc(shortWhen(t.lastAt))}</span></span>
          <span class="mrow__sub">${esc(sub)}</span>
          <span class="mrow__snip">${t.lastMine ? '<b>You:</b> ' : ''}${esc(snippetFor(t))}</span>
          ${tag || status ? `<span class="mrow__tags">${tag}${status}</span>` : ''}
        </span>
        ${t.unread ? '<span class="mrow__dot"></span>' : ''}
      </button>`;
    }).join('') + '</div>';
  }

  function paintThread(force) {
    const el = root();
    if (!el || !MAIL.open) return;
    const id = MAIL.open;
    const t = MAIL.meta[id] || {};
    const fresh = el.dataset.mode !== 'thread:' + id;
    if (fresh) {
      el.dataset.mode = 'thread:' + id;
      el.innerHTML = `
        <div class="mail-thread">
          <div class="mt-bar">
            <button class="mt-back" id="mt-back" aria-label="Back to conversations"><i data-lucide="chevron-left"></i></button>
            <div class="mt-who" id="mt-who"></div>
            <a class="mt-gmail" id="mt-gmail" target="_blank" rel="noopener" aria-label="Open in Gmail"><i data-lucide="external-link"></i></a>
          </div>
          <div class="mt-log" id="mt-log"></div>
          <div class="mt-compose" id="mt-compose"></div>
        </div>`;
    }
    document.body.classList.add('mail-thread');
    const who = document.getElementById('mt-who');
    const target = MAIL.thread ? replyTarget() : null;
    const name = t.name || (target && target.name) || 'Conversation';
    who.innerHTML = `<div class="mt-name">${esc(name)}</div><div class="mt-sub">${esc(t.subject || '')}</div>`;
    document.getElementById('mt-gmail').href = 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(id);

    const log = document.getElementById('mt-log');
    if (MAIL.threadErr) {
      log.innerHTML = `<div class="mail-err"><i data-lucide="alert-circle"></i><span>${esc(MAIL.threadErr)}</span></div>
        <button class="btn ghost" id="mt-retry" style="margin-top:10px"><i data-lucide="rotate-cw"></i>Try again</button>`;
    } else if (!MAIL.thread) {
      log.innerHTML = '<div class="mt-loading"><span class="spin dark"></span>Opening conversation...</div>';
    } else if (force || fresh) {
      log.innerHTML = threadHtml(target);
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }
    if (force || fresh) paintComposer();
    icons();
  }

  function threadHtml(target) {
    const msgs = MAIL.thread;
    const t = MAIL.meta[MAIL.open] || {};
    const enq = target ? linkedEnquiry(target.email, t.enq && t.enq.rego) : null;
    let html = '';
    if (enq) {
      const tel = enq.phone ? String(enq.phone).replace(/\s/g, '') : '';
      html += `<div class="mt-link">
        <button class="mt-chip" data-open-enq="${esc(enq.id)}"><i data-lucide="inbox"></i>Open enquiry</button>
        ${tel ? `<a class="mt-chip" href="tel:${esc(tel)}"><i data-lucide="phone"></i>Call</a>` : ''}
      </div>`;
    }
    let lastDay = '';
    msgs.forEach((m) => {
      const day = new Date(m.at).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        html += `<div class="mt-day">${esc(new Date(m.at).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`;
      }
      html += m.notice ? noticeHtml(m) : m.robot ? robotHtml(m) : bubbleHtml(m);
    });
    return html;
  }

  function noticeHtml(m) {
    const d = m.noticeData || { fields: [], notes: '' };
    const skip = /^(name|email)$/i;
    const rows = d.fields.filter(([k]) => !skip.test(k));
    const body = rows.length >= 3
      ? `<div class="mn-grid">${rows.map(([k, v]) => `<div class="mn-k">${esc(k)}</div><div class="mn-v">${/^rego$/i.test(k) ? `<span class="rego">${esc(v)}</span>` : esc(v)}</div>`).join('')}</div>
         ${d.notes ? `<div class="mn-notes"><div class="mn-k">What they said</div>${esc(d.notes)}</div>` : ''}`
      : `<div class="mn-notes">${esc(m.split.body)}</div>`;
    return `<div class="mnotice">
      <div class="mn-head"><span class="mn-badge"><i data-lucide="globe"></i>Website enquiry</span><span class="mn-when">${esc(longWhen(m.at))}</span></div>
      <div class="mn-from">${esc(m.name)} <span>${esc(m.email)}</span></div>
      ${body}
    </div>`;
  }

  /* A bounce or automatic notice: one line, not a chat bubble. */
  function robotHtml(m) {
    const bounce = /mailer-daemon|postmaster/i.test(m.email);
    const why = (m.split.body.match(/(address[^.\n]*not (?:be )?found|does not exist|couldn't be delivered|could not be delivered|wasn't delivered|address not found)[^.\n]*/i) || [''])[0];
    return `<div class="mrobot ${bounce ? 'bad' : ''}"><i data-lucide="${bounce ? 'mail-x' : 'bot'}"></i><div>
      <b>${bounce ? 'Email not delivered' : esc(m.name)}</b>
      <span>${esc(bounce ? (why ? why.replace(/[^A-Za-z' ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) + '. Check the address for a typo.' : 'The customer\'s mail server sent it back. Check the address for a typo.') : m.split.body.slice(0, 160))}</span>
      <em>${esc(longWhen(m.at))}</em></div></div>`;
  }

  function bubbleHtml(m) {
    const quoted = m.split.quoted;
    const open = MAIL.showQuoted[m.id];
    const files = m.files.length ? `<div class="mb-files">${m.files.map((f, i) => `<button class="mb-file" data-att="${esc(m.id)}" data-att-i="${i}"><i data-lucide="${/pdf/.test(f.mime) ? 'file-text' : /image/.test(f.mime) ? 'image' : 'paperclip'}"></i><span>${esc(f.name)}</span></button>`).join('')}</div>` : '';
    const body = m.split.body || (quoted ? '' : '(No text)');
    return `<div class="mb ${m.mine ? 'mine' : 'theirs'}">
      <div class="mb-meta">${m.mine ? 'You' : esc(m.name)} \u00b7 ${esc(longWhen(m.at))}</div>
      <div class="mb-bubble">${body ? `<div class="mb-text">${linkify(esc(body))}</div>` : ''}${files}
        ${quoted ? `<button class="mb-more" data-quoted="${esc(m.id)}" aria-label="Show earlier text">\u2022\u2022\u2022</button>${open ? `<div class="mb-quoted">${esc(quoted)}</div>` : ''}` : ''}
      </div>
    </div>`;
  }
  function linkify(s) {
    return s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  }

  function paintComposer() {
    const box = document.getElementById('mt-compose');
    if (!box || !MAIL.open) return;
    const id = MAIL.open;
    const target = MAIL.thread ? replyTarget() : null;
    const keep = document.getElementById('mail-compose');
    const val = keep ? keep.value : (MAIL.drafts[id] || '');
    const MS = window.MMQLD_SETTINGS;
    const sender = (MS && MS.get('sender_name')) || 'Ashley';
    const on = sigOn();
    box.innerHTML = `
      <div class="mc-to">${target ? `<span class="mc-addr">To <b>${esc(target.email)}</b></span>` : '<span class="mc-addr">Loading...</span>'}
        <button type="button" class="mc-sig ${on ? 'on' : ''}" id="mail-sig" role="switch" aria-checked="${on}" title="Add the signature to this reply">
          <span>${on ? 'Signed as ' + esc(sender) : 'No signature'}</span><i class="mc-switch"></i>
        </button>
      </div>
      <div class="mc-row">
        <textarea id="mail-compose" rows="1" placeholder="Write a reply..." ${MAIL.sending || !MAIL.thread ? 'disabled' : ''}></textarea>
        <button class="mc-send" id="mail-send" aria-label="Send reply" ${MAIL.sending || !MAIL.thread ? 'disabled' : ''}>${MAIL.sending ? '<span class="spin"></span>' : '<i data-lucide="send"></i>'}</button>
      </div>`;
    const ta = document.getElementById('mail-compose');
    ta.value = val;
    grow(ta);
    ta.addEventListener('input', () => {
      MAIL.drafts[id] = ta.value;
      grow(ta);
      clearTimeout(paintComposer._t);
      paintComposer._t = setTimeout(persistDrafts, 600);
    });
    icons();
  }
  /* Signature on Email tab replies: on unless switched off, remembered on
     this phone (and synced with Settings > Business > Signing off). */
  function sigOn() {
    const MS = window.MMQLD_SETTINGS;
    if (!MS) return true;
    const v = MS.get('email_reply_signature');
    return !(v === false || v === 'false');
  }
  function toggleSig() {
    const MS = window.MMQLD_SETTINGS;
    if (!MS) return;
    const next = !sigOn();
    MS.save({ email_reply_signature: next });
    paintComposer();
    toast(next ? 'Signature on' : 'Signature off for replies');
  }

  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; }

  /* --------------------------------------------------------------- wire -- */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#view-email')) return;
    const row = e.target.closest('[data-thread]');
    if (row) return openThread(row.dataset.thread);
    const tab = e.target.closest('[data-mtab]');
    if (tab) {
      if (MAIL.tab === tab.dataset.mtab) return;
      MAIL.tab = tab.dataset.mtab; MAIL.ids = []; MAIL.next = null;
      if (MAIL.tab === 'customers' && !MAIL.q) loadCache();
      paintList();
      return refreshList(false);
    }
    if (e.target.closest('#mail-refresh')) return refreshList(false);
    if (e.target.closest('#mail-more')) return refreshList(true);
    if (e.target.closest('#mail-connect')) {
      // Straight from the tap, so Google's sign-in window is allowed to open.
      getToken().then(() => { MAIL.needsAuth = false; toast('Gmail connected', 'ok'); refreshList(false); })
        .catch((err) => toast(String((err && err.message) || err).slice(0, 120), 'err'));
      return;
    }
    if (e.target.closest('#mt-back')) return closeThread(false);
    if (e.target.closest('#mt-retry')) { MAIL.threadErr = ''; paintThread(true); return loadThread(MAIL.open, true); }
    if (e.target.closest('#mail-send')) return sendReply();
    if (e.target.closest('#mail-sig')) return toggleSig();
    const q = e.target.closest('[data-quoted]');
    if (q) { MAIL.showQuoted[q.dataset.quoted] = !MAIL.showQuoted[q.dataset.quoted]; const log = document.getElementById('mt-log'); const y = log.scrollTop; log.innerHTML = threadHtml(replyTarget()); log.scrollTop = y; icons(); return; }
    const att = e.target.closest('[data-att]');
    if (att) return openAttachment(att.dataset.att, +att.dataset.attI);
    const enq = e.target.closest('[data-open-enq]');
    if (enq) return openDetail(enq.dataset.openEnq);
  });

  /* Called by app.js render(). The app repaints the active view every minute;
     this only paints what is missing, so a half-written reply is never lost. */
  function renderEmail() {
    paint();
    if (!MAIL.open && connected() && !MAIL.loading && Date.now() - MAIL.lastSync > STALE_MS && !MAIL.q && MAIL.tab === 'customers') {
      refreshList(false);
    }
  }

  loadCache();
  // Show the last known unread count on the tab straight away.
  setTimeout(updateBadge, 0);

  window.renderEmail = renderEmail;
  window.MMQLD_MAIL = { openFor, openThread, refresh: () => refreshList(false), isOpen: () => !!MAIL.open, close: () => closeThread(false) };
})();
