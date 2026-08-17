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
  // apikey header ONLY. The publishable key is not a JWT, so sending it as an
  // Authorization: Bearer token is what iOS WebKit appears to choke on (403 on
  // the upload). Supabase accepts the apikey header alone for anon, verified
  // against storage upload + PostgREST read/insert/delete from a real browser.
  const authHeaders = () => ({ apikey: CONFIG.SUPABASE_KEY });

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
          xhr.setRequestHeader('apikey', authHeaders().apikey);
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
    const e = new Error('upload all-blocked ' + bucket + '/' + name + ' [' + errors.join(' | ').slice(0, 220) + ']');
    e.step = 'upload';
    e.network = true;
    throw e;
  }

  // Insert a row into a table via PostgREST, returning the created record.
  // Forward-compatible: if the DB does not have a column yet (a schema migration
  // has not been applied), drop that field and retry so saving still works.
  async function logRow(table, row) {
    const body = { ...row };
    for (let attempt = 0; attempt < 8; attempt++) {
      let r;
      try {
        r = await fetch(base() + '/rest/v1/' + table, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw tag('save-record', e);
      }
      if (r.ok) {
        const j = await r.json().catch(() => null);
        return Array.isArray(j) ? j[0] : j;
      }
      const t = await r.text().catch(() => '');
      const m = t.match(/Could not find the '([^']+)' column/i);
      if (r.status === 400 && m && Object.prototype.hasOwnProperty.call(body, m[1])) {
        delete body[m[1]];
        continue;
      }
      throw new Error('save-record ' + r.status + ' ' + t.slice(0, 100));
    }
    throw new Error('save-record: too many unknown columns');
  }

  // Update an existing row by id via PostgREST PATCH. Same forward-compatible
  // unknown-column handling as logRow.
  async function patchRow(table, id, row) {
    const body = { ...row };
    for (let attempt = 0; attempt < 8; attempt++) {
      let r;
      try {
        r = await fetch(base() + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw tag('update-row', e);
      }
      if (r.ok) return;
      const t = await r.text().catch(() => '');
      const m = t.match(/Could not find the '([^']+)' column/i);
      if (r.status === 400 && m && Object.prototype.hasOwnProperty.call(body, m[1])) { delete body[m[1]]; continue; }
      throw new Error('update-row ' + r.status + ' ' + t.slice(0, 100));
    }
    throw new Error('update-row: too many unknown columns');
  }

  /* Write the record FIRST, then attach the PDF.

     The record is what the owner actually needs (it drives the Invoices /
     Reports lists, and it carries the full generator state so the document can
     be re-opened, edited and re-sent). Uploading binary to Storage is the
     fragile step on mobile Safari, so it must never be able to lose the
     invoice. A blocked upload leaves a complete record with no pdf_path, and
     is reported back via `uploaded:false` rather than thrown. */
  async function saveDoc(table, bucket, name, meta, pdfBase64) {
    const row = await logRow(table, { ...meta, pdf_path: null });
    const id = row && row.id;
    let up = null, uploadError = null;
    try {
      up = await uploadPdf(bucket, name, pdfBase64);
    } catch (e) { uploadError = e; }
    if (up && id) { try { await patchRow(table, id, { pdf_path: up.path }); } catch (_) {} }
    return { id, path: up ? up.path : '', url: up ? up.url : '', uploaded: !!up, uploadError };
  }

  async function updateDoc(table, bucket, id, name, meta, pdfBase64) {
    await patchRow(table, id, meta);
    let up = null, uploadError = null;
    try {
      up = await uploadPdf(bucket, name, pdfBase64);
    } catch (e) { uploadError = e; }
    if (up) { try { await patchRow(table, id, { pdf_path: up.path }); } catch (_) {} }
    return { id, path: up ? up.path : '', url: up ? up.url : '', uploaded: !!up, uploadError };
  }

  const invoiceFile = (meta) => fileName(meta.vehicle_rego, meta.invoice_number ? String(meta.invoice_number).replace(/[^A-Za-z0-9]/g, '') : '');

  const saveInvoice = (meta, b64) =>
    saveDoc('invoices', CONFIG.STORAGE.invoices, invoiceFile(meta), meta, b64);
  const saveInspection = (meta, b64) =>
    saveDoc('inspection_reports', CONFIG.STORAGE.inspections, fileName(meta.vehicle_rego), meta, b64);
  const updateInvoice = (id, meta, b64) =>
    updateDoc('invoices', CONFIG.STORAGE.invoices, id, invoiceFile(meta), meta, b64);
  const updateInspection = (id, meta, b64) =>
    updateDoc('inspection_reports', CONFIG.STORAGE.inspections, id, fileName(meta.vehicle_rego), meta, b64);

  window.MMQLD_STORE = { fileName, uploadPdf, saveInvoice, saveInspection, updateInvoice, updateInspection, objectExists, _tag: tag };
})();
