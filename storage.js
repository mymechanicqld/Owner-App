/* ============================================================================
   Shared Supabase storage + logging for saved documents.
   Uses direct REST/Storage fetch calls (no supabase-js dependency), so it works
   even if the supabase-js CDN does not load on the device. Files are named
   <YYYY-MM-DD>_<REGO>.pdf for easy lookup by date or rego.
   Relies on config.js (CONFIG.SUPABASE_URL / SUPABASE_KEY / STORAGE).
   ========================================================================== */
(function () {
  const base = () => CONFIG.SUPABASE_URL.replace(/\/+$/, '');
  const authHeaders = () => ({ apikey: CONFIG.SUPABASE_KEY, Authorization: 'Bearer ' + CONFIG.SUPABASE_KEY });

  function fileName(rego, suffix) {
    const d = new Date();
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const r = (rego || 'NOREGO').toString().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'NOREGO';
    return date + '_' + r + (suffix ? '_' + suffix : '') + '.pdf';
  }

  function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: type || 'application/pdf' });
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // Confirm an object actually exists (public bucket GET works even on iOS).
  async function objectExists(bucket, name) {
    try {
      const r = await fetch(base() + '/storage/v1/object/public/' + bucket + '/' + name + '?t=' + Date.now(), { method: 'GET', cache: 'no-store' });
      return r.ok;
    } catch (_) { return false; }
  }

  // Upload a base64 PDF to a storage bucket. Returns { path, url }.
  // Sends raw bytes (not a Blob) to dodge the iOS WebKit binary-body bug, and
  // verifies the object afterwards so a misreported error still counts as saved.
  async function uploadPdf(bucket, name, pdfBase64) {
    const bytes = b64ToBytes(pdfBase64);
    const url = base() + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(name);
    const pub = base() + '/storage/v1/object/public/' + bucket + '/' + name;
    let lastErr = null;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: bytes,
      });
      if (r.ok) return { path: name, url: pub };
      lastErr = new Error('upload ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 80));
    } catch (e) {
      lastErr = e;
    }
    // The request may have actually succeeded even if the browser reported an
    // error. Check the object, and treat its presence as success.
    if (await objectExists(bucket, name)) return { path: name, url: pub };
    throw lastErr || new Error('upload failed (storage)');
  }

  // Insert a row into a table via PostgREST.
  async function logRow(table, row) {
    const r = await fetch(base() + '/rest/v1/' + table, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('log ' + r.status + ' ' + t.slice(0, 100));
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

  window.MMQLD_STORE = { fileName, uploadPdf, saveInvoice, saveInspection };
})();
