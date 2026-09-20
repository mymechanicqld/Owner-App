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
  phone:   '0451 159 954',
  email:   'mymechanicqld@gmail.com',
  website: 'www.mymechanicqld.com.au',
  abn:     '85 829 529 258',
  // Printed on every invoice so a customer always knows where to pay.
  bank: { name: 'My Mechanic Qld', bsb: '484-799', account: '506731007' },
  signoff: 'Drive safe, and call us if anything comes up.',
};
/* The details actually printed: Settings wins, BUSINESS above is only the
   fallback if settings.js failed to load. */
const MS = window.MMQLD_SETTINGS || null;
const businessProfile = () => (MS ? MS.business() : BUSINESS);

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
/* The phone's own date, not UTC. toISOString() would date a Brisbane
   morning as yesterday, because UTC is still on the previous day until 10am. */
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const uid   = () => crypto.randomUUID();

const blankItem    = () => ({ id: uid(), desc: '', qty: 1, price: 0 });

/* The quick-add picker is fed by the owner's own price list, edited at
   /prices/ and stored in Supabase. Whatever he saves there shows up here on the
   next invoice, with no step in between. FALLBACK_ITEMS only ever appears if
   the price list is empty or unreachable, so the picker is never blank. */
const FALLBACK_ITEMS = [
  { desc: 'Standard Service', price: 369 },
  { desc: 'Mobile diagnostic (inspect and test)', price: 189 },
  { desc: 'Front brake pads supplied and fitted', price: 359 },
  { desc: 'Rear brake pads supplied and fitted', price: 369 },
  { desc: 'Battery replacement (supplied and fitted)', price: 260 },
  { desc: 'Mobile service fee', price: 55 },
];
const PRODUCTS_CACHE = 'mmqld_products_cache';
let SAVED_ITEMS = FALLBACK_ITEMS.slice();
let savedFilter = '';

/* Cache-first so the picker opens instantly and still works with no signal,
   then refresh in the background. */
(function loadPriceList() {
  try {
    const c = JSON.parse(localStorage.getItem(PRODUCTS_CACHE) || 'null');
    if (Array.isArray(c) && c.length) SAVED_ITEMS = c;
  } catch (_) {}

  fetch(CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/products?select=id,code,name,description,price&active=eq.true&order=name.asc',
    { headers: { apikey: CONFIG.SUPABASE_KEY } })
    .then((r) => (r.ok ? r.json() : null))
    .then((rows) => {
      if (!rows || !rows.length) return;
      SAVED_ITEMS = rows.map((r) => ({
        code: r.code,
        desc: r.name,
        price: r.price == null ? 0 : Number(r.price),
        note: r.description || '',
      }));
      try { localStorage.setItem(PRODUCTS_CACHE, JSON.stringify(SAVED_ITEMS)); } catch (_) {}
      if (savedPanel && !savedPanel.hidden) renderSaved();
    })
    .catch(() => {});
})();
const PAY_METHODS = ['Cash', 'Bank transfer', 'Card', 'EFTPOS', 'Cheque', 'Other'];
const blankReceipt = () => ({ id: uid(), date: today(), method: '', amount: 0 });

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
      { id: uid(), date: today(), method: 'Bank transfer', amount: 2224 },
    ],
    notes: '',
    signature: { name: '', dataUrl: '' },
  };
}

/* New invoices start from Settings > Invoices: GST mode, payment terms and
   any standing note. Payment terms default to "On receipt", so the due date
   matches the issue date until it is changed by hand. */
function dueFromTerms(from) {
  const days = MS ? MS.num('invoice_terms_days') : 0;
  const d = from ? new Date(from + 'T00:00:00') : new Date();
  if (isNaN(d)) return today();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function blankState() {
  return {
    customer: { name: '', email: '', address: '', business: '', billTo: 'person' },
    vehicle:  { rego: '', makeModel: '', year: '', odometer: '' },
    invoice:  { number: autoInvoiceNumber(), date: today(), due: dueFromTerms(), status: 'outstanding' },
    items: [blankItem()],
    gstInclusive: MS ? MS.bool('invoice_gst_inclusive') : true,
    receipts: [],
    notes: MS ? String(MS.get('invoice_default_notes') || '') : '',
    signature: { name: '', dataUrl: '' },
  };
}

let state = blankState();
/* The form as it was last loaded or saved. Anything different is unsaved. */
let CLEAN = '';
function markClean() { CLEAN = JSON.stringify(state); }

/* URL-param prefill — populated in init() from query string. Kept separately
   so the send and inquiry-link paths still work with older saved state. */
let PREFILL = { email: '', phone: '', rego: '', name: '' };
/* When editing an existing saved invoice, its row id. Save then updates that
   record instead of creating a new one. */
let EDIT_ID = null;

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

  // Partial payments are not offered any more; older invoices read as outstanding.
  if (state.invoice && state.invoice.status === 'partial') state.invoice.status = 'outstanding';

  // Status segment
  $$('#statusSeg .seg__opt').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.status === state.invoice.status));
  });

  // Bill-to (person vs business)
  renderBillTo();

  // GST toggle
  $('#gstToggle').dataset.on = state.gstInclusive ? 'true' : 'false';

  // Items + receipts
  renderItems();
  renderReceipts();

  // Totals
  renderTotals();
}

function renderBillTo() {
  const mode = (state.customer && state.customer.billTo === 'business') ? 'business' : 'person';
  $$('#billToSeg .seg__opt').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.billto === mode)));
  const bizField = $('#bizNameField');
  if (bizField) bizField.hidden = mode !== 'business';
  const lbl = $('#custNameLabel');
  if (lbl) lbl.textContent = mode === 'business' ? 'Contact person (optional)' : 'Customer name';
}

function renderItems() {
  const list = $('#itemsList');
  list.innerHTML = state.items.map((it, i) => `
    <div class="item" data-id="${it.id}">
      <input type="text" class="item__desc" placeholder="Description" data-field="desc"
             value="${escA(it.desc)}" />
      ${detailsHtml(it)}
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
        <label class="item__cell">
          <span class="item__cell-label">Amount</span>
          <input class="item__num" type="number" inputmode="decimal" min="0" step="0.01"
                 placeholder="0.00" data-field="amount" value="${(it.qty && it.price) ? (Math.round(it.qty * it.price * 100) / 100) : ''}" />
        </label>
        <button type="button" class="item__remove" data-remove="${it.id}" aria-label="Remove item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `).join('');
  $('#itemsCountHint').textContent = state.items.length === 1 ? '1 item' : `${state.items.length} items`;
}

/* Optional details under a line, printed on the invoice beneath it (the
   Standard Service checklist, say). Filled from the price list when the item
   is added; shown for editing only once there is something to show. */
const openDetails = new Set();
function detailsHtml(it) {
  if (!it.details && !openDetails.has(it.id)) {
    return `<button type="button" class="item__more" data-details="${it.id}">+ Add details for the customer</button>`;
  }
  const rows = Math.min(14, Math.max(3, String(it.details || '').split('\n').length + 1));
  return `<label class="item__details-wrap"><span class="item__cell-label">Details printed on the invoice</span>
    <textarea class="item__details" data-field="details" rows="${rows}" placeholder="One point per line. End a line with a colon to start a checklist, e.g. Inspected the following:">${escA(it.details || '')}</textarea></label>`;
}

function renderReceipts() {
  const list = $('#receiptsList');
  if (state.receipts.length === 0) {
    list.innerHTML = '<div style="color: var(--subtle); font-size: 13.5px; text-align: center; padding: 18px 0;">No payments recorded yet.</div>';
  } else {
    list.innerHTML = state.receipts.map(r => `
      <div class="item" data-rid="${r.id}">
        <div class="item__row item__row--rc1">
          <label class="item__cell">
            <span class="item__cell-label">Date</span>
            <input class="item__num" type="date" data-rfield="date" value="${r.date}" />
          </label>
          <label class="item__cell">
            <span class="item__cell-label">Payment method</span>
            <select class="item__num" data-rfield="method">
              <option value="" ${!r.method ? 'selected' : ''}>Select</option>
              ${PAY_METHODS.map(m => `<option value="${escA(m)}" ${r.method === m ? 'selected' : ''}>${escA(m)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="item__remove" data-rremove="${r.id}" aria-label="Remove payment">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="item__row item__row--rc2">
          <label class="item__cell">
            <span class="item__cell-label">Amount</span>
            <input class="item__num" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" data-rfield="amount" value="${r.amount || ''}" />
          </label>
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
    // The due date follows the issue date until he sets one himself.
    if (t.dataset.bind === 'invoice.due') state.invoice.dueTouched = true;
    if (t.dataset.bind === 'invoice.date' && !state.invoice.dueTouched) {
      state.invoice.due = dueFromTerms(t.value);
      const dueIn = $('#invDue');
      if (dueIn && document.activeElement !== dueIn) dueIn.value = state.invoice.due;
    }
    return;
  }

  // Line items
  const itemEl = t.closest('.item[data-id]');
  if (itemEl && t.dataset.field) {
    const item = state.items.find(x => x.id === itemEl.dataset.id);
    if (!item) return;
    if (t.dataset.field === 'qty' || t.dataset.field === 'price') {
      item[t.dataset.field] = Number(t.value) || 0;
      const amtIn = itemEl.querySelector('[data-field="amount"]');
      if (amtIn && document.activeElement !== amtIn) amtIn.value = (item.qty && item.price) ? (Math.round(item.qty * item.price * 100) / 100) : '';
      renderTotals();
    } else if (t.dataset.field === 'amount') {
      // Editing the line total back-calculates the unit price (qty stays).
      const amt = Number(t.value) || 0;
      const q = item.qty || 1;
      item.price = q ? amt / q : amt;
      const priceIn = itemEl.querySelector('[data-field="price"]');
      if (priceIn && document.activeElement !== priceIn) priceIn.value = item.price || '';
      renderTotals();
    } else {
      item[t.dataset.field] = t.value;
      if (t.dataset.field === 'details') t.rows = Math.min(14, Math.max(3, t.value.split('\n').length + 1));
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
    // Marking Paid auto-records a payment for the outstanding balance so the
    // invoice reads as paid in full.
    if (state.invoice.status === 'paid') {
      const t = compute();
      if (t.outstanding > 0.005) {
        state.receipts.push({ id: uid(), date: today(), method: '', amount: Math.round(t.outstanding * 100) / 100 });
        renderReceipts();
        renderTotals();
      }
    }
    return;
  }

  // Bill-to segment (person vs business)
  const bseg = e.target.closest('#billToSeg .seg__opt');
  if (bseg) {
    state.customer.billTo = bseg.dataset.billto;
    renderBillTo();
    return;
  }

  // Show the details box for a line
  const more = e.target.closest('[data-details]');
  if (more) {
    openDetails.add(more.dataset.details);
    renderItems();
    const box = $(`.item[data-id="${more.dataset.details}"] .item__details`);
    if (box) box.focus();
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
  markClean();
  toast('New invoice started.');
});

// Drafts + saved-items panels (share the scrim)
const draftsPanel = $('#draftsPanel');
const savedPanel = $('#savedPanel');
const scrim = $('#scrim');
function closeOverlays() { draftsPanel.hidden = true; savedPanel.hidden = true; scrim.hidden = true; }
function openDrafts() { renderDrafts(); draftsPanel.hidden = false; scrim.hidden = false; }
function closeDrafts() { closeOverlays(); }
/* ─── Item picker ───
   One button opens it. Search the price list, tap a row to put it on the
   invoice (tap again for another), and if it is not there, add it as a new
   item, which is also saved to the price list for next time. */
let pickAdded = 0;

/* Ranking: the name starting with what was typed beats a word inside the
   name starting with it, which beats the letters merely appearing somewhere.
   "se" puts "Service..." above "Brake service" above "Hose". Every typed
   word must match somewhere, so "front pad" narrows properly. */
function pickScore(it, q) {
  const name = String(it.desc || '').toLowerCase();
  const note = String(it.note || '').toLowerCase();
  const toks = q.split(/\s+/).filter(Boolean);
  if (!toks.every((t) => name.includes(t) || note.includes(t))) return -1;
  const first = toks[0];
  if (name.startsWith(q)) return 0;
  if (name.startsWith(first)) return 1;
  if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(first))) return 2;
  if (name.includes(first)) return 3;
  return 4;                                   // matched on the description only
}
function highlight(name, q) {
  const first = q.split(/\s+/).filter(Boolean)[0];
  if (!first) return escA(name);
  const lower = name.toLowerCase();
  let at = lower.startsWith(first) ? 0 : -1;
  if (at < 0) { const m = lower.match(new RegExp('[^a-z0-9]' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); if (m) at = m.index + 1; }
  if (at < 0) return escA(name);
  return escA(name.slice(0, at)) + '<mark>' + escA(name.slice(at, at + first.length)) + '</mark>' + escA(name.slice(at + first.length));
}
function linesFor(desc) {
  return state.items.filter((x) => x.desc === desc).reduce((n, x) => n + (Number(x.qty) || 0), 0);
}
function openSaved() {
  savedFilter = '';
  pickAdded = 0;
  const sf = $('#savedFilter'); if (sf) sf.value = '';
  showPickList();
  renderSaved();
  savedPanel.hidden = false; scrim.hidden = false;
}
function showPickList() {
  $('#pickView').hidden = false; $('#newView').hidden = true;
  $('#newBackBtn').hidden = true;
  $('#addSelectedBtn').textContent = pickAdded ? 'Done, ' + pickAdded + ' added' : 'Done';
}
function renderSaved() {
  const q = savedFilter.trim().toLowerCase();
  const rows = SAVED_ITEMS
    .map((it, i) => ({ it, i, sc: q ? pickScore(it, q) : 0 }))
    .filter((r) => r.sc >= 0)
    .sort((a, b) => a.sc - b.sc || String(a.it.desc).localeCompare(String(b.it.desc)));
  $('#savedCount').textContent = q ? rows.length + ' of ' + SAVED_ITEMS.length : SAVED_ITEMS.length + ' items';
  const plus = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const typed = savedFilter.trim();
  const newRow = `<button type="button" class="pick pick--new" data-new="1"><span class="pick__main"><span class="pick__name">${typed ? 'Add “' + escA(typed) + '” as a new item' : 'Add a new item'}</span><span class="pick__note">Not on the list? Add it here and it is saved for next time</span></span><span class="pick__add">${plus}</span></button>`;
  $('#savedList').innerHTML = (rows.length ? '' : `<div class="picker__empty">Nothing on your list matches “${escA(typed)}”.</div>`)
    + rows.map(({ it, i }) => {
      const n = linesFor(it.desc);
      return `<button type="button" class="pick${n ? ' is-added' : ''}" data-i="${i}">`
        + `<span class="pick__main"><span class="pick__name">${highlight(it.desc, q)}</span>`
        + (it.note ? `<span class="pick__note">${escA(it.note)}</span>` : '')
        + `<span class="pick__count">${n ? 'On invoice' + (n > 1 ? ' ×' + n : '') : ''}</span></span>`
        + `<span class="pick__price">${it.price ? '$' + it.price : '<em>no price</em>'}</span>`
        + `<span class="pick__add">${n ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : plus}</span></button>`;
    }).join('') + newRow;
}
/* Put an item on the invoice. The same item again raises its quantity
   rather than adding a duplicate line; the empty starter line is reused. */
function addLine(desc, price, qty, details) {
  const q = Number(qty) || 1;
  const same = state.items.find((x) => x.desc === desc && Number(x.price) === Number(price || 0));
  if (same) same.qty = (Number(same.qty) || 0) + q;
  else {
    // The price list description comes along as the line's printed details.
    const line = { desc, qty: q, price: Number(price) || 0 };
    if (details && String(details).trim()) line.details = String(details).trim();
    const blank = state.items.find((x) => !String(x.desc || '').trim() && !Number(x.price));
    if (blank) Object.assign(blank, line);
    else state.items.push(Object.assign({ id: uid() }, line));
  }
  pickAdded += 1;
  renderItems();
  renderTotals();
}
function openNewItem() {
  const typed = savedFilter.trim();
  $('#newName').value = typed ? typed.charAt(0).toUpperCase() + typed.slice(1) : '';
  $('#newPrice').value = ''; $('#newQty').value = '1'; $('#newDesc').value = '';
  $('#newRemember').checked = true;
  $('#pickView').hidden = true; $('#newView').hidden = false;
  $('#newBackBtn').hidden = false;
  $('#addSelectedBtn').textContent = 'Add to invoice';
  setTimeout(() => $(typed ? '#newPrice' : '#newName').focus(), 60);
}
async function addNewItem() {
  const name = $('#newName').value.trim();
  if (!name) { toast('Give the item a name', 'error'); $('#newName').focus(); return; }
  const priceRaw = $('#newPrice').value.trim();
  const price = priceRaw === '' ? null : Math.round(Number(priceRaw) * 100) / 100;
  const note = $('#newDesc').value.trim();
  addLine(name, price || 0, $('#newQty').value, note);
  savedFilter = ''; $('#savedFilter').value = '';
  showPickList(); renderSaved();
  if (!$('#newRemember').checked) { toast('Added to this invoice'); return; }
  const btn = $('#addSelectedBtn');
  try {
    btn.disabled = true;
    await saveToPriceList({ name, price, note });
    toast('Added, and saved to your price list', 'success');
  } catch (err) {
    console.error(err);
    toast('Added to the invoice, but it could not be saved to the price list', 'error');
  } finally { btn.disabled = false; }
}
/* Same table and upsert key the price list page uses, so the item shows up
   there too and editing it later updates this row. */
async function saveToPriceList({ name, price, note }) {
  let code = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
  if (SAVED_ITEMS.some((x) => x.code === code)) code += '-' + Date.now().toString(36);
  const res = await fetch(CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/products?on_conflict=code', {
    method: 'POST',
    headers: { apikey: CONFIG.SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ code, name, description: note || null, price, active: true }]),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  SAVED_ITEMS.push({ code, desc: name, price: price == null ? 0 : price, note });
  SAVED_ITEMS.sort((a, b) => String(a.desc).localeCompare(String(b.desc)));
  try { localStorage.setItem(PRODUCTS_CACHE, JSON.stringify(SAVED_ITEMS)); } catch (_) {}
}
$('#loadBtn').addEventListener('click', openDrafts);
$('#closeDraftsBtn').addEventListener('click', closeDrafts);
$('#addItemsBtn').addEventListener('click', openSaved);
$('#savedFilter').addEventListener('input', (e) => { savedFilter = e.target.value; renderSaved(); $('#savedList').scrollTop = 0; });
$('#savedFilter').addEventListener('keydown', (e) => {
  // Enter adds the top match, handy with a keyboard.
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const first = $('#savedList .pick[data-i]');
  if (first) first.click(); else openNewItem();
});
$('#savedList').addEventListener('click', (e) => {
  const row = e.target.closest('.pick');
  if (!row) return;
  if (row.dataset.new) return openNewItem();
  const it = SAVED_ITEMS[+row.dataset.i];
  if (!it) return;
  addLine(it.desc, it.price || 0, 1, it.note);
  const scroll = $('#savedList').scrollTop;
  renderSaved();
  $('#savedList').scrollTop = scroll;
  const again = $(`#savedList .pick[data-i="${row.dataset.i}"]`);
  if (again) { again.classList.add('flash'); }
  $('#addSelectedBtn').textContent = 'Done, ' + pickAdded + ' added';
});
$('#newBackBtn').addEventListener('click', () => { showPickList(); renderSaved(); });
$('#closeSavedBtn').addEventListener('click', closeOverlays);
$('#scrim').addEventListener('click', closeOverlays);
$('#addSelectedBtn').addEventListener('click', () => {
  if (!$('#newView').hidden) return addNewItem();
  closeOverlays();
  if (pickAdded) toast(pickAdded + (pickAdded > 1 ? ' items' : ' item') + ' added');
});

/* Save — writes the invoice to the records so it shows in the Invoices list.
   (A local draft is kept too, so an unsent invoice survives a page reload.) */
$('#saveBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.classList.contains('fab__btn--loading')) return;
  if (typeof pdfMake === 'undefined') { toast('Still loading, try again in a second', 'error'); return; }
  btn.classList.add('fab__btn--loading');
  saveDraft({ quiet: true });
  try {
    const docDef = buildInvoiceDoc(compute(), window.MMQLD_ASSETS);
    const b64 = await new Promise((res, rej) => {
      try { pdfMake.createPdf(docDef).getBase64(res); } catch (err) { rej(err); }
    });
    await saveInvoiceRecord(b64);
    bumpInvoiceCounter();
  } catch (err) {
    console.error(err);
    toast('Could not save: ' + String((err && err.message) || err).slice(0, 120), 'error');
  } finally {
    btn.classList.remove('fab__btn--loading');
  }
});

/* Open — shows the invoice PDF. Called synchronously so iOS does not treat the
   new tab as a blocked pop-up (pdfmake opens the window before it renders). */
$('#pdfBtn').addEventListener('click', () => {
  if (typeof pdfMake === 'undefined') { toast('PDF library still loading. Try again in a second.', 'error'); return; }
  try {
    pdfMake.createPdf(buildInvoiceDoc(compute(), window.MMQLD_ASSETS)).open();
  } catch (err) {
    console.error(err);
    toast('Could not open: ' + (err.message || err), 'error');
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

function saveDraft(opts) {
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
  if (!(opts && opts.quiet)) toast('Draft saved.', 'success');
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
    markClean();
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
    const isBiz = state.customer.billTo === 'business';
    const meta = {
      invoice_number: state.invoice.number || null,
      customer_name:  (isBiz ? (state.customer.business || state.customer.name) : state.customer.name) || null,
      business_name:  (isBiz ? state.customer.business : null) || null,
      customer_email: state.customer.email || PREFILL.email || null,
      vehicle_rego:   state.vehicle.rego || null,
      vehicle:        vehicle || null,
      odometer:       state.vehicle.odometer || null,
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
      // Full state so the invoice can be reopened and edited losslessly.
      state:          JSON.parse(JSON.stringify(state)),
    };
    const res = EDIT_ID
      ? await MMQLD_STORE.updateInvoice(EDIT_ID, meta, b64)
      : await MMQLD_STORE.saveInvoice(meta, b64);
    if (res && res.id) EDIT_ID = res.id;   // further saves update the same record
    if (res && !res.uploaded) {
      // The record is safe; only the PDF copy did not upload.
      toast('Invoice saved (PDF copy could not upload)', 'success');
    } else {
      toast('This invoice has been saved', 'success');
    }
    markClean();
    return true;
  } catch (err) {
    console.error(err);
    toast('Could not save: ' + String((err && err.message) || err).slice(0, 200), 'error');
    return false;
  }
}

/* The printed layout lives in invoice-pdf.js, which has no DOM access, so
   the same file can be rendered and checked outside the browser. */
function buildInvoiceDoc(t, A) {
  return window.MMQLD_INVOICE_PDF.build(state, t, { business: businessProfile(), assets: A });
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
  const phone   = get('phone');
  const suburb  = get('suburb');
  const address = get('address');
  const rego    = get('rego');
  const make    = get('make');
  const year    = get('year');

  // Keep the original inquiry values for sending and record linkage.
  PREFILL = { email, phone, rego, name, id: get('id') };

  if (name) setByPath(state, 'customer.name', name);
  if (email) setByPath(state, 'customer.email', email);
  // Prefer the full street address; fall back to suburb when not provided.
  if (address) setByPath(state, 'customer.address', address);
  else if (suburb) setByPath(state, 'customer.address', suburb);
  if (rego)   setByPath(state, 'vehicle.rego', rego);
  if (make)   setByPath(state, 'vehicle.makeModel', make);
  if (year)   setByPath(state, 'vehicle.year', year);
}

/* ────────────────────────────────────────────────────────────────────
   Send to client — emails the same PDF the Open button builds, threaded
   into the customer's Gmail conversation when one is found.
   ─────────────────────────────────────────────────────────────────── */
async function sendToClient(btn) {
  if (typeof pdfMake === 'undefined') {
    toast('PDF library still loading. Try again in a second.', 'error');
    return;
  }
  const email = state.customer.email || PREFILL.email;
  if (!email) {
    toast('Add the customer email above first', 'error');
    return;
  }

  const t = compute();
  const A = window.MMQLD_ASSETS;
  const docDef = buildInvoiceDoc(t, A);
  // Greet the contact person; fall back to the business name, then a neutral hello.
  const firstName = (state.customer.name || PREFILL.name || state.customer.business || '').split(/\s+/)[0] || 'there';
  const filename = 'invoice-' + (state.invoice.number || 'mmqld') + '.pdf';
  // Wording from Settings > Invoices, signed with the shared signature.
  const vars = { first_name: firstName, number: state.invoice.number || '' };
  const subject = MS ? MS.text('email_invoice_subject', vars) : 'Invoice from ' + CONFIG.BUSINESS_NAME;
  const bodyText = MS ? MS.text('email_invoice_body', vars) + MS.signature()
    : `Hi ${firstName},\n\nPlease find your invoice attached. Let me know if you have any questions.`;

  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('fab__btn--loading');

  // Sign in FIRST, while the tap is still fresh: Google opens a pop-up and
  // mobile browsers block one that appears long after the user's gesture.
  try {
    toast('Checking Google sign-in…');
    await MMQLD_GMAIL.getToken();
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), 'error');
    btn.disabled = false; btn.classList.remove('fab__btn--loading'); btn.innerHTML = original;
    return;
  }
  toast('Sending to client…');

  pdfMake.createPdf(docDef).getBase64(async (b64) => {
    try {
      const thread = await MMQLD_GMAIL.findThread(email, PREFILL.rego || state.vehicle.rego);
      await MMQLD_GMAIL.sendWithAttachment({
        to: email, subject, bodyText, filename, pdfBase64: b64, thread,
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

// Load an existing saved invoice into state for editing.
async function loadForEdit(id) {
  try {
    const url = CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/invoices?id=eq.' + encodeURIComponent(id) + '&select=*';
    const r = await fetch(url, { headers: { apikey: CONFIG.SUPABASE_KEY } });
    const rows = await r.json();
    const row = rows && rows[0];
    if (!row) { toast('Invoice not found'); return; }
    if (row.state && typeof row.state === 'object') {
      state = row.state;
    } else {
      // Older invoice saved before the full-state column existed: rebuild what
      // we can from the individual columns.
      state = blankState();
      state.customer.name = row.customer_name || '';
      state.customer.business = row.business_name || '';
      state.customer.billTo = row.business_name ? 'business' : 'person';
      state.vehicle.rego = row.vehicle_rego || '';
      state.vehicle.makeModel = row.vehicle || '';
      state.vehicle.odometer = row.odometer || '';
      state.invoice.number = row.invoice_number || state.invoice.number;
      state.invoice.date = row.issue_date || state.invoice.date;
      state.invoice.due = row.due_date || state.invoice.due;
      state.invoice.status = row.status || state.invoice.status;
      if (Array.isArray(row.items)) state.items = row.items;
      state.notes = row.notes || '';
    }
    if (!state.signature) state.signature = { name: '', dataUrl: '' };
    if (!state.customer) state.customer = { name: '', email: '', address: '', business: '', billTo: 'person' };
    // Make sure the email field is populated (state blob may predate the field).
    if (!state.customer.email && row.customer_email) state.customer.email = row.customer_email;
    EDIT_ID = id;
    PREFILL = { email: state.customer.email || row.customer_email || '', phone: '', rego: (state.vehicle && state.vehicle.rego) || '', name: (state.customer && state.customer.name) || '', id: row.submission_id || '' };
    const hero = document.querySelector('.hero h1'); if (hero) hero.textContent = 'Edit invoice';
  } catch (e) {
    toast('Could not load invoice for editing');
  }
}

/* ────────────────────────────────────────────────────────────────────
   Customer type-ahead — picking a past customer fills the whole invoice.
   ─────────────────────────────────────────────────────────────────── */
function fillFromCustomer(c, mode, picked) {
  const addr = MMQLD_CUSTOMERS.fullAddress(c);
  if (mode === 'business' || c.business) {
    // Chosen from the business field (or the record already has a business):
    // the picked label is the company, any separate person is the contact.
    state.customer.billTo = 'business';
    state.customer.business = c.business || picked || c.name || '';
    state.customer.name = (c.business && c.name) ? c.name : '';
  } else {
    state.customer.name = c.name || '';
  }
  if (c.email) state.customer.email = c.email;
  if (addr) state.customer.address = addr;
  if (c.rego) state.vehicle.rego = c.rego;
  if (c.make) state.vehicle.makeModel = c.make;
  if (c.year) state.vehicle.year = c.year;

  // Keep the send step + record link in sync with the picked customer.
  PREFILL = {
    email: c.email || '',
    phone: c.phone || '',
    rego: c.rego || '',
    name: c.name || '',
    id: c.submissionId || '',
  };
  if (state.signature && !state.signature.name) {
    state.signature.name = state.customer.name || '';
  }
  renderAll();
  toast('Filled from ' + (c.business || c.name), 'success');
}

function setupCustomerLookup() {
  if (!window.MMQLD_CUSTOMERS) return;
  MMQLD_CUSTOMERS.attach($('#custName'), { mode: 'person', onPick: fillFromCustomer });
  MMQLD_CUSTOMERS.attach($('#bizName'), { mode: 'business', onPick: fillFromCustomer });
}

function init() {
  if (!window.MMQLD_ASSETS) {
    // assets.js may load slightly after app.js — wait a tick.
    setTimeout(init, 30);
    return;
  }
  const editId = new URLSearchParams(location.search).get('edit');
  (async () => {
    if (editId) await loadForEdit(editId);
    else applyPrefill();
    // Default the "Signed by" name to the customer when not already set.
    if (state.signature && !state.signature.name) {
      state.signature.name = state.customer.name || PREFILL.name || '';
    }
    renderAll();
    setupSignature();
    setupCustomerLookup();
    markClean();
    // Ask before leaving with unsaved work (logo, phone back, closing the tab).
    if (window.MMQLD_LEAVE) {
      MMQLD_LEAVE.init({
        isDirty: () => JSON.stringify(state) !== CLEAN,
        saveDraft: () => { saveDraft({ quiet: true }); },
        backUrl: '../index.html',
      });
    }
  })();
}

init();

})();
