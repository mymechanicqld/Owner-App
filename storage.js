/* ============================================================================
   Shared Supabase storage + logging for saved documents.
   Saves invoice / inspection PDFs into per-type storage buckets and logs the
   text data into tables so they are searchable later. Relies on config.js
   (CONFIG.SUPABASE_URL / SUPABASE_KEY / STORAGE) loaded first.
   Files are named  <YYYY-MM-DD>_<REGO>.pdf  for easy lookup by date or rego.
   ========================================================================== */
(function () {
  let client = null;
  function db() {
    if (!client) client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth: { persistSession: false } });
    return client;
  }

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

  // Upload a base64 PDF; returns { path, url }
  async function uploadPdf(bucket, name, pdfBase64) {
    const blob = b64ToBlob(pdfBase64, 'application/pdf');
    const { error } = await db().storage.from(bucket).upload(name, blob, { contentType: 'application/pdf', upsert: true });
    if (error) throw error;
    const { data } = db().storage.from(bucket).getPublicUrl(name);
    return { path: name, url: data ? data.publicUrl : '' };
  }

  async function logRow(table, row) {
    const { error } = await db().from(table).insert(row);
    if (error) throw error;
  }

  // Save an invoice: upload PDF then log the text record. Returns the file path.
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

  window.MMQLD_STORE = { db, fileName, uploadPdf, saveInvoice, saveInspection };
})();
