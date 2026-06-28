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

  // Upload a base64 PDF to a storage bucket. Returns { path, url }.
  async function uploadPdf(bucket, name, pdfBase64) {
    const blob = b64ToBlob(pdfBase64, 'application/pdf');
    const url = base() + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(name);
    const r = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/pdf', 'x-upsert': 'true', 'cache-control': '3600' },
      body: blob,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('upload ' + r.status + ' ' + t.slice(0, 100));
    }
    return { path: name, url: base() + '/storage/v1/object/public/' + bucket + '/' + name };
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
