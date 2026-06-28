/* ============================================================================
   Shared Gmail sender for the generator pages (invoice + inspection).
   Sends a PDF as an attachment via the owner's Google sign-in (GIS token flow),
   threaded into the customer's existing Gmail conversation when one is found.
   Relies on CONFIG.GOOGLE_CLIENT_ID from config.js (loaded first).
   ========================================================================== */
(function () {
  let tokenClient = null, pending = null, token = null, exp = 0;

  function getToken() {
    return new Promise((resolve, reject) => {
      if (token && Date.now() < exp) return resolve(token);
      if (!window.google || !google.accounts || !google.accounts.oauth2) return reject(new Error('Google sign-in still loading, try again'));
      if (!window.CONFIG || String(CONFIG.GOOGLE_CLIENT_ID).indexOf('PASTE_') === 0) return reject(new Error('Google client id not set in config.js'));
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
          callback: (r) => {
            if (r.error) return pending && pending.reject(new Error(r.error));
            token = r.access_token; exp = Date.now() + ((r.expires_in || 3600) - 60) * 1000;
            pending && pending.resolve(token);
          },
        });
      }
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
    });
  }

  async function gFetch(path, opts = {}) {
    const t = await getToken();
    const r = await fetch('https://gmail.googleapis.com/gmail/v1' + path, {
      ...opts, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
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
    return best;
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
    if (opts.thread && opts.thread.messageId) { head.push('In-Reply-To: ' + opts.thread.messageId); head.push('References: ' + opts.thread.messageId); }
    const body = [
      '--' + boundary,
      'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
      u8b64(opts.bodyText), '',
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

  window.MMQLD_GMAIL = { findThread, sendWithAttachment };
})();
