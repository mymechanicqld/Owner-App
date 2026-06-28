/* ────────────────────────────────────────────────────────────────────
   My Mechanic QLD — Invoice Generator
   PDF generation: pdfmake (real client-side PDFs, selectable text).
   No live preview — just the input form, mobile-first.

   File layout for this tool:
     index.html   — semantic form markup
     styles.css   — all styles
     app.js       — state, events, PDF doc definition  (this file)
     assets.js    — embedded base64 PNG logo + watermark
   ─────────────────────────────────────────────────────────────────── */

(function () {
'use strict';

/* ────────────────────────────────────────────────────────────────────
   Business profile — single source of truth for company info that
   ends up on every invoice. Edit here once.
   ─────────────────────────────────────────────────────────────────── */
const BUSINESS = {
  name:    'My Mechanic QLD',
  tagline: 'WE COME TO YOU',
  phone:   '+61 0451 159 954',
  email:   'contact@mymechanicqld.com.au',
  website: 'www.mymechanicqld.com.au',
  abn:     '85 829 529 258',
};

/* ────────────────────────────────────────────────────────────────────
   Auto invoice numbering — INV_YYYYMMDD_NNNN, counter in localStorage
   so consecutive invoices increment naturally.
   ─────────────────────────────────────────────────────────────────── */
const COUNTER_KEY = 'mmqld_invoice_counter';

function autoInvoiceNumber() {
  const d = new Date();
  const ymd = d.getFullYear()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const next = (parseInt(localStorage.getItem(COUNTER_KEY) || '49', 10) + 1);
  return `INV_${ymd}_${String(next).padStart(4, '0')}`;
}

function bumpInvoiceCounter() {
  const next = (parseInt(localStorage.getItem(COUNTER_KEY) || '49', 10) + 1);
  localStorage.setItem(COUNTER_KEY, String(next));
}

/* ────────────────────────────────────────────────────────────────────
   State
   ─────────────────────────────────────────────────────────────────── */
const today = () => new Date().toISOString().slice(0, 10);
const uid   = () => crypto.randomUUID();

const blankItem    = () => ({ id: uid(), desc: '', qty: 1, price: 0 });

/* Pre-saved common line items, for the "Saved items" quick-add picker. */
const SAVED_ITEMS = [
  { desc: 'Standard (regular) service', price: 369 },
  { desc: 'Mobile diagnostic (inspect and test)', price: 189 },
  { desc: 'Front brake pads supplied and fitted', price: 359 },
  { desc: 'Rear brake pads supplied and fitted', price: 369 },
  { desc: 'Battery replacement (supplied and fitted)', price: 260 },
  { desc: 'Mobile service fee', price: 55 },
];
const blankReceipt = () => ({ id: uid(), date: today(), ref: '', amount: 0 });

function sampleState() {
  return {
    customer: {
      name: 'Clinton Case',
      address: '201/56 Caloola Dr, Tweed Heads\nNSW 2485\nAustralia',
    },
    vehicle: { rego: 'ABC123', makeModel: 'Toyota Hilux SR5', year: '2019' },
    invoice: {
      number: autoInvoiceNumber(),
      date: today(),
      due: today(),
      status: 'paid',
    },
    items: [
      { id: uid(), desc: 'Rocker cover gasket kit & Labour', qty: 2, price: 182 },
      { id: uid(), desc: 'Manifold gasket kit',              qty: 1, price: 123 },
      { id: uid(), desc: 'Spark plugs',                      qty: 6, price: 34  },
      { id: uid(), desc: 'Ignition coil',                    qty: 6, price: 143 },
      { id: uid(), desc: 'Labour',                           qty: 1, price: 675 },
    ],
    gstInclusive: true,
    receipts: [
      { id: uid(), date: today(), ref: 'PR00045', amount: 2224 },
    ],
    notes: '',
    signature: { name: '', dataUrl: '' },
  };
}

function blankState() {
  return {
    customer: { name: '', address: '' },
    vehicle:  { rego: '', makeModel: '', year: '' },
    invoice:  { number: autoInvoiceNumber(), date: today(), due: today(), status: 'outstanding' },
    items: [blankItem()],
    gstInclusive: true,
    receipts: [],
    notes: '',
    signature: { name: '', dataUrl: '' },
  };
}

let state = sampleState();

/* URL-param prefill — populated in init() from query string. email is kept
   here because it is not a form field but is needed for the send step. */
let PREFILL = { email: '', phone: '', rego: '', name: '' };

/* ────────────────────────────────────────────────────────────────────
   Money + date helpers — Australian formats
   ─────────────────────────────────────────────────────────────────── */
const fmtMoney = (n) => '$' + (Number(n) || 0).toLocaleString('en-AU', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmtMoneyPlain = (n) => (Number(n) || 0).toFixed(2);
const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
};

/* ────────────────────────────────────────────────────────────────────
   Totals — single source of truth so the form, the snapshot block and
   the generated PDF all show identical numbers.
   ─────────────────────────────────────────────────────────────────── */
function compute() {
  const subtotal = state.items.reduce((s, it) => s + ((it.qty || 0) * (it.price || 0)), 0);
  let gst, total;
  if (state.gstInclusive) {
    gst = subtotal * (1 / 11);
    total = subtotal;
  } else {
    gst = subtotal * 0.1;
    total = subtotal + gst;
  }
  const paid = state.receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  const outstanding = Math.max(0, total - paid);
  return { subtotal, gst, total, paid, outstanding };
}

/* ────────────────────────────────────────────────────────────────────
   HTML helpers
   ─────────────────────────────────────────────────────────────────── */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const escA = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ────────────────────────────────────────────────────────────────────
   Render — top-level form binding
   ─────────────────────────────────────────────────────────────────── */
function renderAll() {
  // Branding (logo)
  $('#brandLogo').src = window.MMQLD_ASSETS.logoPng;

  // Top-level fields with data-bind
  $$('[data-bind]').forEach(el => {
    const val = getByPath(state, el.dataset.bind);
    if (el.value !== val) el.value = val ?? '';
  });

  // Status segment
  $$('#statusSeg .seg__opt').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.status === state.invoice.status));
  });

  // GST toggle
  $('#gstToggle').dataset.on = state.gstInclusive ? 'true' : 'false';

  // Items + receipts
  renderItems();
  renderReceipts();

  // Totals
  renderTotals();
}

function renderItems() {
  const list = $('#itemsList');
  list.innerHTML = state.items.map((it, i) => `
    <div class="item" data-id="${it.id}">
      <input type="text" class="item__desc" placeholder="Description" data-field="desc"
             value="${escA(it.desc)}" />
      <div class="item__row">
        <label class="item__cell">
          <span class="item__cell-label">Qty</span>
          <input class="item__num" type="number" inputmode="decimal" min="0" step="0.5"
                 placeholder="1" data-field="qty" value="${it.qty || ''}" />
        </label>
        <label class="item__cell">
          <span class="item__cell-label">Unit price</span>
          <input class="item__num" type="number" inputmode="decimal" min="0" step="0.01"
                 placeholder="0.00" data-field="price" value="${it.price || ''}" />
        </label>
        <div class="item__cell">
          <span class="item__cell-label">Amount</span>
          <span class="item__amount" data-amount-for="${it.id}">${fmtMoney(it.qty * it.price)}</span>
        </div>
        <button type="button" class="item__remove" data-remove="${it.id}" aria-label="Remove item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `).join('');
  $('#itemsCountHint').textContent = state.items.length === 1 ? '1 item' : `${state.items.length} items`;
}

function renderReceipts() {
  const list = $('#receiptsList');
  if (state.receipts.length === 0) {
    list.innerHTML = '<div style="color: var(--subtle); font-size: 13.5px; text-align: center; padding: 18px 0;">No payments recorded yet.</div>';
  } else {
    list.innerHTML = state.receipts.map(r => `
      <div class="item" data-rid="${r.id}">
        <div class="item__row">
          <label class="item__cell">
            <span class="item__cell-label">Date</span>
            <input class="item__num" type="date" data-rfield="date" value="${r.date}" />
          </label>
          <label class="item__cell">
            <span class="item__cell-label">Reference</span>
            <input class="item__num" type="text" placeholder="PR00045" data-rfield="ref" value="${escA(r.ref)}" />
          </label>
          <label class="item__cell">
            <span class="item__cell-label">Amount</span>
            <input class="item__num" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" data-rfield="amount" value="${r.amount || ''}" />
          </label>
          <button type="button" class="item__remove" data-rremove="${r.id}" aria-label="Remove payment">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  }
  const n = state.receipts.length;
  $('#receiptsCountHint').textContent = n === 0 ? 'No payments' : (n === 1 ? '1 payment' : `${n} payments`);
}

function renderTotals() {
  const t = compute();
  const block = $('#totalsBlock');
  const rows = [];
  if (state.gstInclusive) {
    rows.push(`<div class="totals__row"><span>Subtotal</span><strong>${fmtMoney(t.subtotal)}</strong></div>`);
    rows.push(`<div class="totals__row"><span>Includes GST (10%)</span><strong>${fmtMoney(t.gst)}</strong></div>`);
  } else {
    rows.push(`<div class="totals__row"><span>Subtotal</span><strong>${fmtMoney(t.subtotal)}</strong></div>`);
    rows.push(`<div class="totals__row"><span>GST (10%)</span><strong>${fmtMoney(t.gst)}</strong></div>`);
  }
  rows.push(`<div class="totals__row totals__row--total"><span>Total</span><strong>${fmtMoney(t.total)}</strong></div>`);
  if (t.paid > 0) {
    rows.push(`<div class="totals__row totals__row--paid"><span>Balance paid</span><strong>${fmtMoney(t.paid)}</strong></div>`);
  }
  if (t.outstanding > 0) {
    rows.push(`<div class="totals__row totals__row--out"><span>Outstanding</span><strong>${fmtMoney(t.outstanding)}</strong></div>`);
  }
  block.innerHTML = rows.join('');
}

/* ────────────────────────────────────────────────────────────────────
   Two-way binding helpers
   ─────────────────────────────────────────────────────────────────── */
function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setByPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

/* ────────────────────────────────────────────────────────────────────
   Event wiring (event delegation — survives re-renders)
   ─────────────────────────────────────────────────────────────────── */
document.addEventListener('input', (e) => {
  const t = e.target;

  // Top-level fields
  if (t.dataset.bind) {
    setByPath(state, t.dataset.bind, t.value);
    return;
  }

  // Line items
  const itemEl = t.closest('.item[data-id]');
  if (itemEl && t.dataset.field) {
    const item = state.items.find(x => x.id === itemEl.dataset.id);
    if (!item) return;
    if (t.dataset.field === 'qty' || t.dataset.field === 'price') {
      item[t.dataset.field] = Number(t.value) || 0;
      const amount = $(`[data-amount-for="${item.id}"]`);
      if (amount) amount.textContent = fmtMoney(item.qty * item.price);
      renderTotals();
    } else {
      item[t.dataset.field] = t.value;
    }
    return;
  }

  // Receipts
  const recEl = t.closest('.item[data-rid]');
  if (recEl && t.dataset.rfield) {
    const r = state.receipts.find(x => x.id === recEl.dataset.rid);
    if (!r) return;
    if (t.dataset.rfield === 'amount') {
      r.amount = Number(t.value) || 0;
      renderTotals();
    } else {
      r[t.dataset.rfield] = t.value;
    }
  }
});

document.addEventListener('click', (e) => {
  // Status segment
  const seg = e.target.closest('#statusSeg .seg__opt');
  if (seg) {
    state.invoice.status = seg.dataset.status;
    $$('#statusSeg .seg__opt').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.status === state.invoice.status))
    );
    return;
  }

  // Remove item
  const rmItem = e.target.closest('[data-remove]');
  if (rmItem) {
    state.items = state.items.filter(x => x.id !== rmItem.dataset.remove);
    renderItems();
    renderTotals();
    return;
  }

  // Remove receipt
  const rmRec = e.target.closest('[data-rremove]');
  if (rmRec) {
    state.receipts = state.receipts.filter(x => x.id !== rmRec.dataset.rremove);
    renderReceipts();
    renderTotals();
    return;
  }
});

// GST toggle (keyboard + click)
$('#gstToggle').addEventListener('click', () => {
  state.gstInclusive = !state.gstInclusive;
  $('#gstToggle').dataset.on = state.gstInclusive ? 'true' : 'false';
  renderTotals();
});
$('#gstToggle').addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    $('#gstToggle').click();
  }
});

// Add buttons
$('#addItem').addEventListener('click', () => {
  state.items.push(blankItem());
  renderItems();
  renderTotals();
  // Focus the new item's desc
  const last = $$('.item[data-id]').pop();
  last?.querySelector('.item__desc')?.focus();
});

$('#addReceipt').addEventListener('click', () => {
  state.receipts.push(blankReceipt());
  renderReceipts();
  renderTotals();
});

// New invoice
$('#newBtn').addEventListener('click', () => {
  if (!confirm('Start a new invoice? Unsaved changes will be lost.')) return;
  state = blankState();
  renderAll();
  toast('New invoice started.');
});

// Drafts + saved-items panels (share the scrim)
const draftsPanel = $('#draftsPanel');
const savedPanel = $('#savedPanel');
const scrim = $('#scrim');
function closeOverlays() { draftsPanel.hidden = true; savedPanel.hidden = true; scrim.hidden = true; }
function openDrafts() { renderDrafts(); draftsPanel.hidden = false; scrim.hidden = false; }
function closeDrafts() { closeOverlays(); }
function openSaved() { renderSaved(); savedPanel.hidden = false; scrim.hidden = false; }
function renderSaved() {
  $('#savedList').innerHTML = SAVED_ITEMS.map((it, i) =>
    `<label class="saved-item"><input type="checkbox" data-i="${i}"><span class="saved-item__desc">${escA(it.desc)}</span><span class="saved-item__price">$${it.price}</span></label>`
  ).join('');
}
$('#loadBtn').addEventListener('click', openDrafts);
$('#closeDraftsBtn').addEventListener('click', closeDrafts);
$('#savedItemsBtn').addEventListener('click', openSaved);
$('#closeSavedBtn').addEventListener('click', closeOverlays);
$('#scrim').addEventListener('click', closeOverlays);
$('#addSelectedBtn').addEventListener('click', () => {
  const checks = $$('#savedList input[type="checkbox"]');
  let added = 0;
  checks.forEach((c) => {
    if (c.checked) { const it = SAVED_ITEMS[+c.dataset.i]; state.items.push({ id: uid(), desc: it.desc, qty: 1, price: it.price }); added++; }
  });
  if (!added) { toast('Select at least one item'); return; }
  renderItems();
  renderTotals();
  closeOverlays();
  toast(added + (added > 1 ? ' items' : ' item') + ' added');
});

// Save draft
$('#saveBtn').addEventListener('click', () => {
  saveDraft();
});

// Export PDF
$('#pdfBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.classList.contains('fab__btn--loading')) return;
  btn.classList.add('fab__btn--loading');
  try {
    await exportPdf();
  } catch (err) {
    console.error(err);
    toast('PDF export failed: ' + (err.message || err), 'error');
  } finally {
    btn.classList.remove('fab__btn--loading');
  }
});

/* ────────────────────────────────────────────────────────────────────
   Drafts (localStorage)
   ─────────────────────────────────────────────────────────────────── */
const DRAFTS_KEY = 'mmqld_invoice_drafts_v2';

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); }
  catch { return []; }
}

function saveDraft() {
  const drafts = loadDrafts();
  const t = compute();
  const id = state.invoice.number || uid();
  const draft = {
    id,
    name: state.customer.name || 'Untitled',
    number: state.invoice.number,
    total: t.total,
    savedAt: Date.now(),
    state: JSON.parse(JSON.stringify(state)),
  };
  const i = drafts.findIndex(d => d.id === id);
  if (i >= 0) drafts[i] = draft;
  else drafts.unshift(draft);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 30)));
  toast('Draft saved.', 'success');
}

function renderDrafts() {
  const list = $('#draftsList');
  const drafts = loadDrafts();
  if (drafts.length === 0) {
    list.innerHTML = '<div class="drafts__empty">No saved drafts yet.</div>';
    return;
  }
  list.innerHTML = drafts.map(d => `
    <div class="draft-item" data-load="${d.id}">
      <div class="draft-item__meta">
        <div class="draft-item__name">${escA(d.name)} · ${fmtMoney(d.total)}</div>
        <div class="draft-item__when">${escA(d.number)} · ${new Date(d.savedAt).toLocaleString('en-AU')}</div>
      </div>
      <button class="draft-item__del" data-del="${d.id}" aria-label="Delete draft">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
  `).join('');
}

$('#draftsList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    const drafts = loadDrafts().filter(d => d.id !== del.dataset.del);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    renderDrafts();
    return;
  }
  const load = e.target.closest('[data-load]');
  if (load) {
    const d = loadDrafts().find(x => x.id === load.dataset.load);
    if (!d) return;
    state = d.state;
    // Older drafts predate the signature field — keep state shape stable.
    if (!state.signature) state.signature = { name: '', dataUrl: '' };
    renderAll();
    closeDrafts();
    toast('Draft loaded.');
  }
});

/* ────────────────────────────────────────────────────────────────────
   Toasts
   ─────────────────────────────────────────────────────────────────── */
function toast(msg, kind) {
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast--' + kind : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ────────────────────────────────────────────────────────────────────
   PDF Export — pdfmake document definition
   This is the entire visual definition of the printed invoice.
   pdfmake builds a real PDF: text is selectable, file size is small,
   the layout works on every browser.
   ─────────────────────────────────────────────────────────────────── */

const COLOR = {
  navy:        '#1E3A8A',
  navyDeep:    '#1A2E6E',
  navyBright:  '#2563EB',
  navyTint:    '#E8EEFB',
  ink:         '#0C0A09',
  muted:       '#44403C',
  subtle:      '#78716C',
  hairline:    '#E7E5E0',
  soft:        '#F5F4EF',
  surface:     '#FFFFFF',
  success:     '#047857',
  successBg:   '#D1FAE5',
  warning:     '#B45309',
  warningBg:   '#FEF3C7',
  danger:      '#B91C1C',
  dangerBg:    '#FEE2E2',
};

async function exportPdf() {
  if (typeof pdfMake === 'undefined') {
    throw new Error('PDF library still loading. Try again in a second.');
  }
  toast('Generating PDF…');

  const t = compute();
  const A = window.MMQLD_ASSETS;
  const filename = (state.invoice.number || 'invoice') + '.pdf';

  const docDef = buildInvoiceDoc(t, A);

  await new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(docDef).download(filename, () => resolve());
    } catch (err) { reject(err); }
  });

  // Also log the record to Supabase (does not block the download).
  pdfMake.createPdf(docDef).getBase64(b64 => saveInvoiceRecord(b64));

  bumpInvoiceCounter();
  toast('PDF downloaded.', 'success');
}

/* ────────────────────────────────────────────────────────────────────
   Save record to Supabase — logs the computed invoice + uploads the PDF.
   Never blocks export/send; failure just shows a soft toast.
   ─────────────────────────────────────────────────────────────────── */
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function saveInvoiceRecord(b64) {
  if (!window.MMQLD_STORE) { toast('Records helper not loaded, please refresh the page'); return; }
  try {
    const t = compute();
    const vehicle = [state.vehicle.makeModel, state.vehicle.year]
      .filter(Boolean).join(' ').trim();
    const meta = {
      invoice_number: state.invoice.number || null,
      customer_name:  state.customer.name || null,
      customer_email: PREFILL.email || null,
      vehicle_rego:   state.vehicle.rego || null,
      vehicle:        vehicle || null,
      issue_date:     state.invoice.date || null,
      due_date:       state.invoice.due || null,
      status:         state.invoice.status || null,
      subtotal:       t.subtotal,
      gst:            t.gst,
      total:          t.total,
      paid:           t.paid,
      balance:        t.outstanding,
      items:          state.items,
      signer_name:    (state.signature && state.signature.name) || state.customer.name || null,
      notes:          state.notes || null,
      submission_id:  isUuid(PREFILL.id) ? PREFILL.id : null,
    };
    await MMQLD_STORE.saveInvoice(meta, b64);
    toast('Saved to records', 'success');
  } catch (err) {
    console.error(err);
    toast('Could not save: ' + String((err && err.message) || err).slice(0, 80));
  }
}

function buildInvoiceDoc(t, A) {
  const statusMap = {
    paid:        { label: 'PAID IN FULL',    bg: COLOR.successBg, fg: COLOR.success },
    partial:     { label: 'PARTIAL PAYMENT', bg: COLOR.warningBg, fg: COLOR.warning },
    outstanding: { label: 'OUTSTANDING',     bg: COLOR.dangerBg,  fg: COLOR.danger  },
  };
  const status = statusMap[state.invoice.status];

  // pdfmake document uses points (1 pt = 1/72 inch). A4 = 595 × 842 pt.
  const HEADER_H = 110;   // navy header band — tightened from 150 to free up body space
  const FOOTER_H = 30;    // navy footer strip

  return {
    pageSize: 'A4',
    pageMargins: [40, HEADER_H + 18, 40, FOOTER_H + 12],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: COLOR.ink, lineHeight: 1.25 },

    info: {
      title: state.invoice.number || 'Invoice',
      author: BUSINESS.name,
      subject: 'Tax invoice',
      creator: BUSINESS.name + ' invoice generator',
    },

    /* Background runs first on every page — used for the watermark, the
       navy header band and the navy footer strip. */
    background: function (currentPage, pageSize) {
      return [
        // Centered watermark — gear+wrench+M
        {
          image: A.watermarkPng,
          width: 320,
          opacity: 0.08,
          absolutePosition: {
            x: (pageSize.width - 320) / 2,
            y: (pageSize.height - 320) / 2,
          },
        },
        // Navy header band on every page
        {
          canvas: [
            { type: 'rect', x: 0, y: 0, w: pageSize.width, h: HEADER_H,
              color: COLOR.navy },
            // Subtle gradient overlay (right edge a touch brighter)
            { type: 'rect', x: pageSize.width - 220, y: 0, w: 220, h: HEADER_H,
              color: COLOR.navyBright, fillOpacity: 0.18 },
          ],
        },
        // Footer strip
        {
          canvas: [
            { type: 'rect', x: 0, y: pageSize.height - FOOTER_H,
              w: pageSize.width, h: FOOTER_H, color: COLOR.navyDeep },
            { type: 'rect', x: 0, y: pageSize.height - FOOTER_H - 4,
              w: pageSize.width, h: 4, color: COLOR.navyBright },
          ],
        },
      ];
    },

    /* The header column on every page: logo + contact info, sitting on
       top of the navy band. Tighter than the original to free up the
       page body. */
    header: function () {
      return {
        margin: [40, 22, 40, 0],
        columns: [
          // Logo + brand block
          {
            width: '*',
            columns: [
              {
                image: A.logoPng,
                width: 46,
                height: 46,
              },
              {
                width: '*',
                margin: [10, 4, 0, 0],
                stack: [
                  { text: BUSINESS.name, color: 'white', fontSize: 17, bold: true, characterSpacing: -0.2 },
                  { text: BUSINESS.tagline, color: 'white', fontSize: 8.5, characterSpacing: 2, margin: [0, 2, 0, 0], opacity: 0.78 },
                ],
              },
            ],
          },
          // Contact info — denser stack
          {
            width: 220,
            alignment: 'right',
            margin: [0, 2, 0, 0],
            stack: [
              { text: BUSINESS.phone,             color: 'white', fontSize: 9.5,  margin: [0, 0, 0, 0] },
              { text: BUSINESS.email,             color: 'white', fontSize: 9.5,  margin: [0, 1, 0, 0] },
              { text: BUSINESS.website,           color: 'white', fontSize: 9.5,  margin: [0, 1, 0, 0] },
              { text: 'ABN ' + BUSINESS.abn,      color: 'white', fontSize: 8.5,  opacity: 0.78, margin: [0, 3, 0, 0], characterSpacing: 0.5 },
            ],
          },
        ],
      };
    },

    /* Footer — repeats on every page */
    footer: function (currentPage, pageCount) {
      return {
        margin: [40, 10, 40, 0],
        columns: [
          { text: BUSINESS.website, color: 'white', fontSize: 10, alignment: 'left' },
          { text: 'Page ' + currentPage + ' of ' + pageCount,
            color: 'white', fontSize: 9, alignment: 'right', opacity: 0.7 },
        ],
      };
    },

    content: [

      /* ─── Customer (with vehicle bullets) + invoice meta block ─── */
      {
        columns: [
          // Customer (left) — name, address, then vehicle bullets
          {
            width: '*',
            stack: [
              { text: 'BILL TO', style: 'eyebrow' },
              { text: state.customer.name || '—',
                style: 'customerName', margin: [0, 3, 0, 3] },
              { text: state.customer.address || '',
                color: COLOR.muted, fontSize: 10.5, lineHeight: 1.45 },
              ...vehicleBullets(),
            ],
          },
          // Invoice meta (right)
          {
            width: 200,
            alignment: 'right',
            stack: [
              { text: 'TAX INVOICE', style: 'docTitle' },
              { text: [
                  { text: 'No.  ', style: 'metaKey' },
                  { text: state.invoice.number || '', style: 'metaVal' },
                ], margin: [0, 6, 0, 0] },
              { text: [
                  { text: 'Issued  ', style: 'metaKey' },
                  { text: fmtDate(state.invoice.date), style: 'metaVal' },
                ], margin: [0, 1, 0, 0] },
              { text: [
                  { text: 'Due by  ', style: 'metaKey' },
                  { text: fmtDate(state.invoice.due), style: 'metaVal' },
                ], margin: [0, 1, 0, 0] },
            ],
          },
        ],
      },

      /* ─── Line items table ─── */
      itemsTable(),

      /* ─── Totals + notes ─── */
      {
        margin: [0, 10, 0, 0],
        columns: [
          // Notes (left)
          {
            width: '*',
            stack: notesBlock(),
          },
          // Totals (right)
          {
            width: 230,
            stack: totalsStack(t, status),
          },
        ],
      },

      /* ─── Receipts table + subtle status pill (only when there are receipts) ─── */
      paymentSection(status, t),

      /* ─── Customer signature block (only when signed) ─── */
      ...signatureBlock(),

      /* ─── Sign-off line ─── */
      {
        margin: [0, 22, 0, 0],
        columns: [
          { text: 'Drive safe — call us if anything comes up.', color: COLOR.subtle, italics: true, fontSize: 10 },
          { text: 'Issued by ' + BUSINESS.name, color: COLOR.subtle, alignment: 'right', fontSize: 10 },
        ],
      },

    ],

    styles: {
      eyebrow:      { fontSize: 9,  bold: true, characterSpacing: 1.4, color: COLOR.subtle },
      customerName: { fontSize: 15, bold: true,  color: COLOR.ink },
      docTitle:     { fontSize: 22, bold: true,  characterSpacing: -0.3, color: COLOR.ink },
      metaKey:      { fontSize: 10.5, bold: true,  color: COLOR.ink },
      metaVal:      { fontSize: 10.5, color: COLOR.muted },
      th:           { fontSize: 9.5, bold: true, characterSpacing: 1.1, color: COLOR.subtle },
      tdDesc:       { fontSize: 11, color: COLOR.ink, bold: false },
      tdNum:        { fontSize: 11, alignment: 'right', color: COLOR.ink },
      vehLabel:     { fontSize: 9, bold: true, characterSpacing: 1.4, color: COLOR.subtle },
      vehValue:     { fontSize: 12, bold: true, color: COLOR.ink },
    },
  };
}

function vehicleBullets() {
  // Compact vehicle card under the customer address. A small navy "rego
  // plate" sits left, make/model + year stack right, all inside a soft
  // tinted background. Skipped entirely when no fields are filled.
  const v = state.vehicle || {};
  if (!v.rego && !v.makeModel && !v.year) return [];

  // Build the right-hand stack
  const rightStack = [];
  if (v.makeModel) rightStack.push({
    text: v.makeModel, fontSize: 11.5, bold: true, color: COLOR.ink,
  });
  if (v.year) rightStack.push({
    text: 'Year  ' + v.year, fontSize: 10, color: COLOR.muted, margin: [0, 2, 0, 0],
  });
  if (!v.makeModel && !v.year) rightStack.push({
    text: 'Vehicle on record', fontSize: 10, color: COLOR.subtle, italics: true,
  });

  // Compose: optional rego plate (left) + details (right)
  const cells = [];
  if (v.rego) cells.push({
    width: 'auto',
    stack: [
      { text: 'REGO', fontSize: 7, bold: true, color: 'white', characterSpacing: 1.8, opacity: 0.72 },
      { text: v.rego.toUpperCase(), fontSize: 13, bold: true, color: 'white', characterSpacing: 1.5, margin: [0, 3, 0, 0] },
    ],
    fillColor: COLOR.navy,
    margin: [12, 7, 12, 7],
  });
  cells.push({
    width: '*',
    stack: rightStack,
    margin: [v.rego ? 12 : 14, v.rego ? 8 : 9, 14, 8],
  });

  return [
    { text: 'VEHICLE', style: 'eyebrow', margin: [0, 14, 0, 6] },
    {
      table: {
        widths: v.rego ? ['auto', '*'] : ['*'],
        body: [[
          // Cells with their own fill colors — wrap in a single row
          ...cells.map((c, i) => ({
            ...c,
            border: [false, false, false, false],
            // Soft fill for the right-hand details cell
            ...(i === cells.length - 1 && v.rego ? { fillColor: COLOR.soft } : {}),
            ...(!v.rego && i === 0 ? { fillColor: COLOR.soft } : {}),
          })),
        ]],
      },
      layout: 'noBorders',
    },
  ];
}

function itemsTable() {
  const headerRow = [
    { text: 'DESCRIPTION', style: 'th' },
    { text: 'QTY / HRS',   style: 'th', alignment: 'right' },
    { text: 'UNIT PRICE',  style: 'th', alignment: 'right' },
    { text: 'AMOUNT',      style: 'th', alignment: 'right' },
  ];
  const body = [headerRow];
  if (state.items.length === 0) {
    body.push([
      { text: 'No items', italics: true, color: COLOR.subtle, colSpan: 4, alignment: 'center', margin: [0, 10, 0, 10] },
      {}, {}, {},
    ]);
  } else {
    state.items.forEach(it => {
      body.push([
        { text: it.desc || 'Untitled item', style: 'tdDesc', margin: [0, 5, 0, 5] },
        { text: String(it.qty || 0), style: 'tdNum', margin: [0, 5, 0, 5] },
        { text: fmtMoney(it.price), style: 'tdNum', margin: [0, 5, 0, 5] },
        { text: fmtMoney((it.qty || 0) * (it.price || 0)), style: 'tdNum', bold: true, margin: [0, 5, 0, 5] },
      ]);
    });
  }

  return {
    margin: [0, 18, 0, 0],
    table: {
      headerRows: 1,
      widths: ['*', 60, 80, 80],
      body,
    },
    layout: {
      hLineWidth: (i, node) => {
        if (i === 0) return 0;
        if (i === 1) return 1.5;
        if (i === node.table.body.length) return 1;
        return 0.5;
      },
      vLineWidth: () => 0,
      hLineColor: (i, node) => i === 1 ? COLOR.ink : COLOR.hairline,
      paddingTop: () => 3,
      paddingBottom: () => 3,
      paddingLeft: (i) => i === 0 ? 0 : 6,
      paddingRight: (i, node) => i === node.table.widths.length - 1 ? 0 : 6,
    },
  };
}

function notesBlock() {
  const out = [];
  if (state.notes && state.notes.trim()) {
    out.push({
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: 'NOTES', style: 'eyebrow', color: COLOR.navy },
            { text: state.notes, color: COLOR.muted, margin: [0, 4, 0, 0], lineHeight: 1.55 },
          ],
          fillColor: COLOR.soft,
          border: [true, false, false, false],
          borderColor: [COLOR.navy, COLOR.navy, COLOR.navy, COLOR.navy],
          margin: [12, 10, 12, 10],
        }]],
      },
      layout: {
        defaultBorder: false,
        vLineWidth: (i) => i === 0 ? 3 : 0,
        vLineColor: () => COLOR.navy,
      },
    });
  }
  return out;
}

function totalsStack(t, status) {
  const rows = [];
  // If no receipts recorded but a status is set, the small status pill
  // rides above the totals so it still appears on the invoice.
  if (state.receipts.length === 0 && status) {
    rows.push({
      alignment: 'right',
      margin: [0, 0, 0, 6],
      columns: [
        { text: '', width: '*' },
        {
          width: 'auto',
          table: { body: [[{
            text: status.label,
            color: status.fg, fillColor: status.bg,
            fontSize: 8.5, bold: true, characterSpacing: 1.1,
            margin: [9, 3, 9, 3], border: [false, false, false, false],
          }]] },
          layout: 'noBorders',
        },
      ],
    });
  }
  if (state.gstInclusive) {
    rows.push({ columns: [
      { text: 'Subtotal', color: COLOR.muted, fontSize: 10.5 },
      { text: fmtMoney(t.subtotal), alignment: 'right', fontSize: 10.5, bold: true },
    ]});
    rows.push({ columns: [
      { text: 'Includes GST (10%)', color: COLOR.muted, fontSize: 10.5 },
      { text: fmtMoney(t.gst), alignment: 'right', fontSize: 10.5, bold: true },
    ], margin: [0, 4, 0, 0] });
  } else {
    rows.push({ columns: [
      { text: 'Subtotal', color: COLOR.muted, fontSize: 10.5 },
      { text: fmtMoney(t.subtotal), alignment: 'right', fontSize: 10.5, bold: true },
    ]});
    rows.push({ columns: [
      { text: 'GST (10%)', color: COLOR.muted, fontSize: 10.5 },
      { text: fmtMoney(t.gst), alignment: 'right', fontSize: 10.5, bold: true },
    ], margin: [0, 4, 0, 0] });
  }
  // Total — bold rule above
  rows.push({
    margin: [0, 10, 0, 0],
    table: {
      widths: ['*', 'auto'],
      body: [[
        { text: 'TOTAL', bold: true, fontSize: 13, color: COLOR.ink, border: [false, true, false, false], borderColor: [COLOR.ink, COLOR.ink, COLOR.ink, COLOR.ink], margin: [0, 8, 0, 0] },
        { text: fmtMoney(t.total), bold: true, fontSize: 14, color: COLOR.ink, alignment: 'right', border: [false, true, false, false], borderColor: [COLOR.ink, COLOR.ink, COLOR.ink, COLOR.ink], margin: [0, 8, 0, 0] },
      ]],
    },
    layout: {
      defaultBorder: false,
      hLineWidth: (i) => i === 0 ? 1.5 : 0,
      hLineColor: () => COLOR.ink,
    },
  });
  if (t.paid > 0) {
    rows.push({ columns: [
      { text: 'Balance paid', color: COLOR.success, fontSize: 10.5 },
      { text: fmtMoney(t.paid), alignment: 'right', color: COLOR.success, fontSize: 10.5, bold: true },
    ], margin: [0, 6, 0, 0] });
  }
  if (t.outstanding > 0) {
    rows.push({ columns: [
      { text: 'OUTSTANDING', color: COLOR.danger, fontSize: 11.5, bold: true, characterSpacing: 0.5 },
      { text: fmtMoney(t.outstanding), alignment: 'right', color: COLOR.danger, fontSize: 12, bold: true },
    ], margin: [0, 4, 0, 0] });
  }
  return rows;
}

function paymentSection(status, t) {
  // If there are no receipts, the status pill rides inline with the
  // totals stack (handled in totalsStack). Nothing to render here.
  if (state.receipts.length === 0) return { text: '' };

  // Subtle status pill — tiny next to the section heading
  const statusPill = {
    width: 'auto',
    table: {
      widths: ['auto'],
      body: [[
        {
          text: status.label,
          color: status.fg,
          fontSize: 8.5,
          bold: true,
          characterSpacing: 1.1,
          fillColor: status.bg,
          margin: [9, 3, 9, 3],
          border: [false, false, false, false],
        },
      ]],
    },
    layout: 'noBorders',
  };

  const receiptsTable = {
    margin: [0, 8, 0, 0],
    table: {
      headerRows: 1,
      widths: [80, '*', 80],
      body: [
        [
          { text: 'PAYMENT DATE', style: 'th' },
          { text: 'REFERENCE',    style: 'th' },
          { text: 'AMOUNT PAID',  style: 'th', alignment: 'right' },
        ],
        ...state.receipts.map(r => [
          { text: fmtDate(r.date), fontSize: 10, margin: [0, 4, 0, 4] },
          { text: r.ref || '—',    fontSize: 10, color: COLOR.muted, margin: [0, 4, 0, 4] },
          { text: fmtMoney(r.amount), fontSize: 10, alignment: 'right', bold: true, margin: [0, 4, 0, 4] },
        ]),
      ],
    },
    layout: {
      hLineWidth: (i, node) => i === 0 ? 0 : (i === 1 ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => COLOR.hairline,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
  };

  return {
    margin: [0, 24, 0, 0],
    stack: [
      // Header row: section label on left, subtle status pill on right
      {
        columns: [
          { text: 'PAYMENTS RECEIVED', style: 'eyebrow', width: '*', margin: [0, 4, 0, 0] },
          statusPill,
        ],
      },
      receiptsTable,
    ],
  };
}

function signatureBlock() {
  // Only render when the customer has actually signed.
  const sig = state.signature || {};
  if (!sig.dataUrl) return [];
  const signer = sig.name || state.customer.name || '';
  return [{
    margin: [0, 24, 0, 0],
    columns: [
      { width: '*', text: '' },
      {
        width: 220,
        stack: [
          { text: 'CUSTOMER SIGNATURE', style: 'eyebrow', margin: [0, 0, 0, 4] },
          { image: sig.dataUrl, fit: [160, 64], margin: [0, 0, 0, 4] },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.6, lineColor: COLOR.ink }] },
          { text: 'Signed by: ' + (signer || '—'), color: COLOR.muted, fontSize: 10, margin: [0, 5, 0, 0] },
          { text: fmtDate(state.invoice.date), color: COLOR.subtle, fontSize: 9.5, margin: [0, 1, 0, 0] },
        ],
      },
    ],
  }];
}

/* ────────────────────────────────────────────────────────────────────
   Bootstrap — wait for assets.js, render the form, then we're live.
   ─────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────
   URL-param prefill — fills the form from params passed by the owner app.
   Only non-empty params override defaults.
   ─────────────────────────────────────────────────────────────────── */
function applyPrefill() {
  const p = new URLSearchParams(location.search);
  const get = (k) => { const v = p.get(k); return v && v.trim() ? v.trim() : ''; };

  const name   = get('name');
  const email  = get('email');
  const phone  = get('phone');
  const suburb = get('suburb');
  const rego   = get('rego');
  const make   = get('make');
  const year   = get('year');

  // Stash for the send step (email is not a form field)
  PREFILL = { email, phone, rego, name, id: get('id') };

  if (name)   setByPath(state, 'customer.name', name);
  if (suburb) setByPath(state, 'customer.address', suburb);
  if (rego)   setByPath(state, 'vehicle.rego', rego);
  if (make)   setByPath(state, 'vehicle.makeModel', make);
  if (year)   setByPath(state, 'vehicle.year', year);
}

/* ────────────────────────────────────────────────────────────────────
   Send to client — emails the same PDF the Export button builds, threaded
   into the customer's Gmail conversation when one is found.
   ─────────────────────────────────────────────────────────────────── */
async function sendToClient(btn) {
  if (typeof pdfMake === 'undefined') {
    toast('PDF library still loading. Try again in a second.', 'error');
    return;
  }
  if (!PREFILL.email) {
    toast('No customer email', 'error');
    return;
  }

  const t = compute();
  const A = window.MMQLD_ASSETS;
  const docDef = buildInvoiceDoc(t, A);
  const firstName = (PREFILL.name || '').split(/\s+/)[0] || 'there';
  const filename = 'invoice-' + (state.invoice.number || 'mmqld') + '.pdf';
  const subject = 'Invoice from ' + CONFIG.BUSINESS_NAME;
  const bodyText =
`Hi ${firstName},

Please find your invoice attached. Let me know if you have any questions.

Thank you,
Ashley
My Mechanic QLD
0451159954`;

  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('fab__btn--loading');
  toast('Sending to client…');

  pdfMake.createPdf(docDef).getBase64(async (b64) => {
    try {
      const thread = await MMQLD_GMAIL.findThread(PREFILL.email, PREFILL.rego);
      await MMQLD_GMAIL.sendWithAttachment({
        to: PREFILL.email, subject, bodyText, filename, pdfBase64: b64, thread,
      });
      toast('Sent to client', 'success');
      // Sending also logs the record (reuse the same base64).
      await saveInvoiceRecord(b64);
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('fab__btn--loading');
      btn.innerHTML = original;
    }
  });
}

const _sendBtn = $('#sendBtn');
if (_sendBtn) _sendBtn.addEventListener('click', (e) => sendToClient(e.currentTarget));

/* ────────────────────────────────────────────────────────────────────
   Customer signature pad — mirrors the inspection generator's canvas
   approach (mouse + touch, stores a PNG dataURL in state.signature).
   ─────────────────────────────────────────────────────────────────── */
let sigCtx = null, sigDrawing = false, sigLast = null;
function setupSignature() {
  const canvas = $('#sigCanvas');
  if (!canvas) return;

  function resizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      const prev = canvas.toDataURL();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      sigCtx = canvas.getContext('2d');
      sigCtx.scale(dpr, dpr);
      sigCtx.lineWidth = 2.4;
      sigCtx.lineCap = 'round';
      sigCtx.lineJoin = 'round';
      sigCtx.strokeStyle = '#0C0A09';
      if (prev && prev !== 'data:,' && prev.length > 100) {
        const im = new Image();
        im.onload = () => sigCtx.drawImage(im, 0, 0, r.width, r.height);
        im.src = prev;
      }
    }
  }
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(canvas.parentElement);

  // Restore a saved signature (e.g. loaded draft)
  if (state.signature && state.signature.dataUrl) {
    const im = new Image();
    im.onload = () => sigCtx.drawImage(im, 0, 0, canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
    im.src = state.signature.dataUrl;
  }

  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    const ev = e.touches ? e.touches[0] : e;
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const start = (x, y) => { sigDrawing = true; sigLast = [x, y]; };
  const move = (x, y) => {
    if (!sigDrawing) return;
    sigCtx.beginPath();
    sigCtx.moveTo(sigLast[0], sigLast[1]);
    sigCtx.lineTo(x, y);
    sigCtx.stroke();
    sigLast = [x, y];
  };
  const end = () => {
    if (!sigDrawing) return;
    sigDrawing = false;
    state.signature.dataUrl = canvas.toDataURL('image/png');
  };

  canvas.addEventListener('mousedown', e => { const [x, y] = pt(e); start(x, y); });
  canvas.addEventListener('mousemove', e => { const [x, y] = pt(e); move(x, y); });
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); const [x, y] = pt(e); start(x, y); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); const [x, y] = pt(e); move(x, y); }, { passive: false });
  canvas.addEventListener('touchend', end);

  const clearBtn = $('#sigClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    sigCtx.clearRect(0, 0, canvas.width, canvas.height);
    state.signature.dataUrl = '';
  });
}

function init() {
  if (!window.MMQLD_ASSETS) {
    // assets.js may load slightly after app.js — wait a tick.
    setTimeout(init, 30);
    return;
  }
  applyPrefill();
  // Default the "Signed by" name to the customer when not already set.
  if (state.signature && !state.signature.name) {
    state.signature.name = state.customer.name || PREFILL.name || '';
  }
  renderAll();
  setupSignature();
}

init();

})();
