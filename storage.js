/* ============================================================================
   Shared Supabase storage + logging for saved documents.
   Uses direct REST/Storage fetch calls (no supabase-js dependency), so it works
   even if the supabase-js CDN does not load on the device. Files are named
   <YYYY-MM-DD>_<REGO>.pdf for easy lookup by date or rego.
   Relies on config.js (CONFIG.SUPABASE_URL / SUPABASE_KEY / STORAGE).

   iOS note: WebKit (every iPhone browser, incl. Chrome) can report a perfectly
   good cross-origin upload as a bare "Load failed". To stay honest we (a) tag
   every network step so the surfaced error names exactly what broke, and (b)
   verify the object actually landed before deciding an upload failed.
   ========================================================================== */
(function () {
  const base = () => CONFIG.SUPABASE_URL.replace(/\/+$/, '');
  const authHeaders = () => ({ apikey: CONFIG.SUPABASE_KEY, Authorization: 'Bearer ' + CONFIG.SUPABASE_KEY });

  // Wrap a thrown error so the surfaced message names the step + whether it was
  // a network/CORS failure (TypeError "Load failed") or a real HTTP response.
  function tag(step, err) {
    const msg = (err && err.message) || String(err);
    const isNet = (err instanceof TypeError) || /load failed|networkerror|failed to fetch/i.test(msg);
    const e = new Error(step + (isNet ? ': network/blocked' : ': ' + msg));
    e.step = step;
    e.network = isNet;
    return e;
  }

  // <YYYY-MM-DD>_<REGO>[_<suffix>]_<HHMMSS>.pdf — the trailing time keeps every
  // save a unique object (a fresh INSERT), which sidesteps the owner/UPDATE RLS
  // check that rejects browser overwrites with a 403. Still sorts/searches by
  // the date_rego prefix.
  function fileName(rego, suffix) {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const date = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const time = p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    const r = (rego || 'NOREGO').toString().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'NOREGO';
    return date + '_' + r + (suffix ? '_' + suffix : '') + '_' + time + '.pdf';
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // Confirm an object actually exists (public bucket GET is a "simple" request,
  // so it works even on iOS where the upload POST can misreport). Never throws.
  async function objectExists(bucket, name) {
    try {
      const r = await fetch(base() + '/storage/v1/object/public/' + bucket + '/' + name + '?t=' + Date.now(), { method: 'GET', cache: 'no-store' });
      return r.ok;
    } catch (_) { return false; }
  }

  // Upload a base64 PDF to a storage bucket. Returns { path, url }.
  // iOS WebKit (esp. when the page is controlled by a service worker) refuses
  // some cross-origin POST body shapes with a bare "Load failed". We try a few
  // shapes in order and accept the first that returns OK or that we can verify
  // actually landed via the public GET. Each failure is recorded so a total
  // failure reports exactly which shapes were blocked.
  async function uploadPdf(bucket, name, pdfBase64) {
    const bytes = b64ToBytes(pdfBase64);
    const path = base() + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(name);
    const pub = base() + '/storage/v1/object/public/' + bucket + '/' + name;
    const ok = { path: name, url: pub };
    const errors = [];

    const strategies = [
      // 1. fetch, multipart FormData. The browser sets the multipart content-type
      //    and the storage-api reads the file part. This is the path supabase-js
      //    uses on React Native / iOS and the only shape that survives iOS WebKit.
      async () => {
        const fd = new FormData();
        fd.append('cacheControl', '3600');
        fd.append('', new Blob([bytes], { type: 'application/pdf' }), name);
        const r = await fetch(path, { method: 'POST', headers: { ...authHeaders(), 'x-upsert': 'true' }, body: fd });
        if (!r.ok) throw new Error('http ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 60));
      },
      // 2. fetch, raw bytes (smallest payload; works on desktop)
      async () => {
        const r = await fetch(path, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: bytes });
        if (!r.ok) throw new Error('http ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 60));
      },
      // 3. fetch, Blob body (different body machinery than a typed array)
      async () => {
        const r = await fetch(path, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: new Blob([bytes], { type: 'application/pdf' }) });
        if (!r.ok) throw new Error('http ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 60));
      },
      // 4. XMLHttpRequest, Blob body (entirely separate network stack from fetch)
      async () => {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', path, true);
          const h = authHeaders();
          xhr.setRequestHeader('apikey', h.apikey);
          xhr.setRequestHeader('Authorization', h.Authorization);
          xhr.setRequestHeader('Content-Type', 'application/pdf');
          xhr.setRequestHeader('x-upsert', 'true');
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error('http ' + xhr.status + ' ' + String(xhr.responseText || '').slice(0, 60)));
          xhr.onerror = () => reject(new Error('network'));
          xhr.send(new Blob([bytes], { type: 'application/pdf' }));
        });
      },
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        await strategies[i]();
        return ok; // got a 2xx
      } catch (e) {
        const m = (e instanceof TypeError) ? 'network' : ((e && e.message) || String(e));
        errors.push('#' + (i + 1) + ' ' + m);
        // The request may have landed even if the browser reported an error.
        if (await objectExists(bucket, name)) return ok;
      }
    }
    const e = new Error('upload all-blocked [' + errors.join(' | ').slice(0, 160) + ']');
    e.step = 'upload';
    e.network = true;
    throw e;
  }

  // Insert a row into a table via PostgREST. Step-tagged on failure.
  async function logRow(table, row) {
    let r;
    try {
      r = await fetch(base() + '/rest/v1/' + table, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row),
      });
    } catch (e) {
      throw tag('log-row', e);
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('log-row ' + r.status + ' ' + t.slice(0, 100));
    }
  }

  async function saveInvoice(meta, pdfBase64) {
    const name = fileName(meta.vehicle_rego, meta.invoice_number ? String(meta.invoice_number).replace(/[^A-Za-z0-9]/g, '') : '');
    const up = await uploadPdf(CONFIG.STORAGE.invoices, name, pdfBase64);
    await logRow('invoices', { ...meta, pdf_path: up.path });
    return up;
  }

  async function saveInspection(meta, pdfBase64) {
    const name = fileName(meta.vehicle_rego);
    const up = await uploadPdf(CONFIG.STORAGE.inspections, name, pdfBase64);
    await logRow('inspection_reports', { ...meta, pdf_path: up.path });
    return up;
  }

  window.MMQLD_STORE = { fileName, uploadPdf, saveInvoice, saveInspection, objectExists, _tag: tag };
})();
