/* ============================================================================
   Shared Gmail sender for the generator pages (invoice + inspection).
   Sends a PDF as an attachment via the owner's Gmail, threaded into the
   customer's existing conversation when one is found. Sign-in comes from
   gmail-auth.js, loaded before this file.
   ========================================================================== */
(function () {
  /* Sign-in is gmail-auth.js (loaded first), shared with the main app: one
     tap connects a phone for good and the access token renews quietly. */
  const getToken = () => MMQLD_GAUTH.getToken();
  const ensureGis = (ms) => MMQLD_GAUTH.ensureGis(ms);

  async function gFetch(path, opts = {}) {
    const call = async () => fetch('https://gmail.googleapis.com/gmail/v1' + path, {
      ...opts, headers: { Authorization: 'Bearer ' + (await getToken()), 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    let r = await call();
    if (r.status === 401) { MMQLD_GAUTH.expire(); if (MMQLD_GAUTH.lasting()) r = await call(); }
    if (!r.ok) throw new Error('Gmail ' + r.status);
    return r.json();
  }

  async function findThread(email, rego) {
    const q = async (s) => (await gFetch('/users/me/messages?maxResults=10&q=' + encodeURIComponent(s))).messages || [];
    let m = email ? await q('"' + email + '"') : [];
    if (!m.length && rego) m = await q('"' + rego + '"');
    if (!m.length) return null;
    let best = null;
    for (const x of m) {
      const meta = await gFetch('/users/me/messages/' + x.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID');
      const h = {}; (meta.payload.headers || []).forEach((z) => (h[z.name.toLowerCase()] = z.value));
      const rec = { threadId: meta.threadId, messageId: h['message-id'], subject: h['subject'] || '' };
      if (/new booking|quote request|booking request/i.test(rec.subject)) { best = rec; break; }
      if (!best) best = rec;
    }
    return latestInThread(best);
  }

  /* Reply to the newest message in the conversation, not the first: the
     customer's mail app threads on In-Reply-To/References, so this keeps every
     email the app sends in one conversation on their side too. The subject
     stays the enquiry's own, because Gmail needs it to match the thread. */
  async function latestInThread(found) {
    if (!found || !found.threadId) return found;
    try {
      const th = await gFetch('/users/me/threads/' + found.threadId + '?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=From');
      const msgs = (th.messages || []).filter((m) => {
        const from = ((m.payload.headers || []).find((x) => x.name.toLowerCase() === 'from') || {}).value || '';
        return !/mailer-daemon|postmaster/i.test(from);
      });
      const last = msgs[msgs.length - 1];
      if (!last) return found;
      const h = {}; (last.payload.headers || []).forEach((x) => (h[x.name.toLowerCase()] = x.value));
      if (!h['message-id']) return found;
      const refs = (h.references ? h.references.split(/\s+/) : []).concat(h['message-id']).filter(Boolean).slice(-20);
      return { ...found, messageId: h['message-id'], references: refs.join(' ') };
    } catch (_) { return found; }
  }

  const u8b64 = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64url = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Email headers must be ASCII; encode non-ASCII per RFC 2047.
  const encHeader = (str) => (/[^\x00-\x7F]/.test(str) ? '=?UTF-8?B?' + u8b64(str) + '?=' : str);

  // opts: { to, subject, bodyText, filename, pdfBase64, thread }
  async function sendWithAttachment(opts) {
    const boundary = 'mmqld_' + Math.random().toString(36).slice(2);
    let subj = opts.thread && opts.thread.subject
      ? (/^re:/i.test(opts.thread.subject) ? opts.thread.subject : 'Re: ' + opts.thread.subject)
      : opts.subject;
    const head = ['To: ' + opts.to, 'Subject: ' + encHeader(subj), 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"'];
    if (opts.thread && opts.thread.messageId) { head.push('In-Reply-To: ' + opts.thread.messageId); head.push('References: ' + (opts.thread.references || opts.thread.messageId)); }
    // Plain text plus HTML with a unique ending, so Gmail never folds the signature (mail-mime.js).
    const alt = MMQLD_MIME.alternative(opts.bodyText);
    const body = [
      '--' + boundary,
      'Content-Type: ' + alt.type, '',
      alt.body,
      '--' + boundary,
      'Content-Type: application/pdf; name="' + opts.filename + '"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="' + opts.filename + '"', '',
      opts.pdfBase64, '',
      '--' + boundary + '--', '',
    ];
    const raw = head.join('\r\n') + '\r\n\r\n' + body.join('\r\n');
    const payload = { raw: b64url(raw) };
    if (opts.thread && opts.thread.threadId) payload.threadId = opts.thread.threadId;
    return gFetch('/users/me/messages/send', { method: 'POST', body: JSON.stringify(payload) });
  }


  window.MMQLD_GMAIL = { findThread, sendWithAttachment, getToken, ensureGis };
})();
