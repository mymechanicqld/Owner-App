/* ============================================================================
   Email body builder, shared by every page that sends email.

   Why this exists: Gmail folds repeated text at the end of an email in a
   conversation into a grey "..." button. Every reply the app sends ends with
   the same signature, so from the second reply on, the recipient saw the
   signature hidden away. Gmail only folds a repeated ending, so each email
   now ends with a tiny invisible reference that is different every time,
   and nothing repeated is left at the end to fold.

   The email goes out as multipart/alternative: the plain text exactly as
   written, plus the same text as simple HTML (what Gmail and most apps
   show), which carries the invisible reference.

     MMQLD_MIME.alternative(text) -> { type, body }
       type: the Content-Type header value for this part
       body: the encoded part, ready to put after a blank line
   ========================================================================== */
(function () {
  'use strict';

  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  // Base64 lines kept under the 76-character limit some mail servers enforce.
  const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n').trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function uniqueRef() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function html(text) {
    const ref = uniqueRef();
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map(esc);
    // Invisible but real text (not display:none, which mail apps may drop
    // before comparing), so this email's ending never matches an earlier one.
    const hidden = '<span style="color:transparent;opacity:0;font-size:1px;line-height:1px;mso-hide:all">' + ref + '</span>';
    return '<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222">'
      + lines.join('<br>') + '</div>' + hidden;
  }

  function alternative(text) {
    const boundary = 'mmqld_alt_' + uniqueRef();
    const body = [
      '--' + boundary,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(b64(text)),
      '',
      '--' + boundary,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(b64(html(text))),
      '',
      '--' + boundary + '--',
      '',
    ].join('\r\n');
    return { type: 'multipart/alternative; boundary="' + boundary + '"', body };
  }

  window.MMQLD_MIME = { alternative, html };
})();
