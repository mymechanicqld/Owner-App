/* ────────────────────────────────────────────────────────────────────
   Invoice PDF: the pdfmake document definition.

   Moved out of app.js so it takes plain data and touches no DOM: the same
   file renders in the browser and in a Node script while the layout is
   being tuned.

     MMQLD_INVOICE_PDF.build(state, totals, { business, assets }) -> docDefinition
   ─────────────────────────────────────────────────────────────────── */
(function (root) {
'use strict';

let state = null;
let BUSINESS = null;

const fmtMoney = (n) => '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
};

const COLOR = {
  navy:        '#1E3A8A',
  navyDeep:    '#1A2E6E',
  navyBright:  '#2563EB',
  navyTint:    '#E8EEFB',
  gold:        '#C9A227',   // the accent shared with the inspection reports
  goldDeep:    '#A8841A',
  goldTint:    '#FBF6E6',
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

function buildInvoiceDoc(t, A) {
  const statusMap = {
    paid:        { label: 'PAID IN FULL',    bg: COLOR.successBg, fg: COLOR.success },
    outstanding: { label: 'OUTSTANDING',     bg: COLOR.dangerBg,  fg: COLOR.danger  },
  };
  const status = statusMap[state.invoice.status] || statusMap.outstanding;

  // pdfmake document uses points (1 pt = 1/72 inch). A4 = 595 × 842 pt.
  const HEADER_H = 86;    // navy header band, with a gold rule beneath it
  const FOOTER_H = 30;    // navy footer strip

  return {
    pageSize: 'A4',
    pageMargins: [40, HEADER_H + 16, 40, FOOTER_H + 12],
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
            { type: 'rect', x: 0, y: HEADER_H, w: pageSize.width, h: 2.5, color: COLOR.gold },
          ],
        },
        // Footer strip. Pinned to the page corner: without absolutePosition
        // pdfmake stacks it under the header canvas and it lands off the page.
        {
          absolutePosition: { x: 0, y: 0 },
          canvas: [
            { type: 'rect', x: 0, y: pageSize.height - FOOTER_H,
              w: pageSize.width, h: FOOTER_H, color: COLOR.navyDeep },
            { type: 'rect', x: 0, y: pageSize.height - FOOTER_H - 2.5,
              w: pageSize.width, h: 2.5, color: COLOR.gold },
          ],
        },
      ];
    },

    /* The header column on every page: logo + contact info, sitting on
       top of the navy band. Tighter than the original to free up the
       page body. */
    header: function () {
      return {
        margin: [40, 16, 40, 0],
        columns: [
          // Logo + brand block
          {
            width: '*',
            columns: [
              {
                image: A.logoPng,
                width: 44,
                height: 44,
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
        margin: [40, 21, 40, 0],
        columns: [
          // The friendly sign-off lives in the last page's footer, where it
          // can never be pushed onto a page of its own.
          currentPage === pageCount && BUSINESS.signoff
            ? { text: BUSINESS.signoff, color: 'white', fontSize: 9.5, italics: true, alignment: 'left' }
            : { text: BUSINESS.website, color: 'white', fontSize: 10, alignment: 'left' },
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
              ...billToStack(),
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

      /* ─── How to pay (left) beside the totals (right). The bank card is a
             fixed small size, so sitting beside the totals is safe; long
             notes still get the full width below. ─── */
      {
        margin: [0, 12, 0, 0],
        unbreakable: true,
        columns: [
          { width: '*', stack: [paymentDetails(t)] },
          {
            width: 222,
            stack: totalsStack(t, status),
          },
        ],
        columnGap: 18,
      },

      /* ─── Notes flow at full width so long text can cross pages safely ─── */
      ...notesSection(),

      /* ─── Receipts table + subtle status pill (only when there are receipts) ─── */
      paymentSection(status, t),

      /* ─── Customer signature block (only when signed) ─── */
      ...signatureBlock(),


    ],

    styles: {
      eyebrow:      { fontSize: 8.5, bold: true, characterSpacing: 1.6, color: COLOR.goldDeep },
      customerName: { fontSize: 15, bold: true,  color: COLOR.ink },
      docTitle:     { fontSize: 22, bold: true,  characterSpacing: -0.3, color: COLOR.ink },
      metaKey:      { fontSize: 10.5, bold: true,  color: COLOR.ink },
      metaVal:      { fontSize: 10.5, color: COLOR.muted },
      th:           { fontSize: 8.5, bold: true, characterSpacing: 1.2, color: COLOR.navy },
      tdDesc:       { fontSize: 11, color: COLOR.ink, bold: false },
      tdNum:        { fontSize: 11, alignment: 'right', color: COLOR.ink },
      vehLabel:     { fontSize: 9, bold: true, characterSpacing: 1.4, color: COLOR.subtle },
      vehValue:     { fontSize: 12, bold: true, color: COLOR.ink },
    },
  };
}

// BILL TO name block — business name (with optional contact) or person name.
function billToStack() {
  const isBiz = state.customer.billTo === 'business';
  const name = isBiz ? (state.customer.business || '—') : (state.customer.name || '—');
  const out = [{ text: name, style: 'customerName', margin: [0, 3, 0, (isBiz && state.customer.name) ? 1 : 3] }];
  if (isBiz && state.customer.name) {
    out.push({ text: 'Attn: ' + state.customer.name, color: COLOR.muted, fontSize: 10.5, margin: [0, 0, 0, 3] });
  }
  return out;
}

// Format an odometer value with thousands separators when it is numeric.
function fmtOdo(v) {
  const digits = String(v).replace(/[^0-9]/g, '');
  return digits ? Number(digits).toLocaleString('en-AU') : String(v);
}

function vehicleBullets() {
  // Compact vehicle card under the customer address. A small navy "rego
  // plate" sits left, make/model + year + odometer stack right, all inside a
  // soft tinted background. Skipped entirely when no fields are filled.
  const v = state.vehicle || {};
  if (!v.rego && !v.makeModel && !v.year && !v.odometer) return [];

  // Build the right-hand stack
  const rightStack = [];
  if (v.makeModel) rightStack.push({
    text: v.makeModel, fontSize: 11.5, bold: true, color: COLOR.ink,
  });
  if (v.year) rightStack.push({
    text: 'Year  ' + v.year, fontSize: 10, color: COLOR.muted, margin: [0, 2, 0, 0],
  });
  if (v.odometer) rightStack.push({
    text: 'Odometer  ' + fmtOdo(v.odometer) + ' km', fontSize: 10, color: COLOR.muted, margin: [0, 2, 0, 0],
  });
  if (!v.makeModel && !v.year && !v.odometer) rightStack.push({
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
    { text: 'VEHICLE', style: 'eyebrow', margin: [0, 11, 0, 5] },
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

/* A line's details (from the price list, editable on the invoice) print as a
   full-width row under the line. Plain lines become the work done; a line
   ending in ":" starts a checklist whose items are laid out in columns with
   ticks. So the Standard Service reads as a proper record of the service. */
function detailsBlock(text) {
  const groups = [];
  let cur = { heading: '', lines: [] };
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/^[\s\-−–—•*]+/, '').trim();
    if (!line) return;
    if (/:$/.test(line)) {
      if (cur.heading || cur.lines.length) groups.push(cur);
      cur = { heading: line.replace(/:$/, ''), lines: [] };
    } else cur.lines.push(line.charAt(0).toUpperCase() + line.slice(1));
  });
  if (cur.heading || cur.lines.length) groups.push(cur);
  if (!groups.length) return null;

  // Drawn marks rather than glyphs: the PDF font has no tick character.
  const tick = () => ({ width: 8, svg: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M0.8 4.2 L3 6.4 L7.2 1.4" fill="none" stroke="#1E3A8A" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>', margin: [0, 2, 5, 0] });
  const dot = () => ({ width: 8, svg: '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="3" cy="4.2" r="2" fill="#C9A227"/></svg>', margin: [0, 2, 5, 0] });
  const entry = (mark, t) => ({ columns: [mark(), { width: '*', text: t, fontSize: 9, color: COLOR.muted, lineHeight: 1.2 }], columnGap: 3, margin: [0, 0, 0, 2.5] });
  // Column-major: read down the first column, then the next.
  const cols = (lines, n, mark) => {
    const per = Math.ceil(lines.length / n);
    return { columnGap: 12, columns: Array.from({ length: n }, (_, c) => ({ width: '*', stack: lines.slice(c * per, (c + 1) * per).map((t) => entry(mark, t)) })) };
  };
  const out = [];
  groups.forEach((g, gi) => {
    if (g.heading) {
      out.push({ text: g.heading, fontSize: 8, bold: true, characterSpacing: 0.8, color: COLOR.goldDeep, margin: [0, gi ? 6 : 0, 0, 4] });
      if (g.lines.length) out.push(cols(g.lines, g.lines.length > 8 ? 3 : g.lines.length > 3 ? 2 : 1, tick));
    } else if (g.lines.length) {
      out.push(g.lines.length > 6 ? cols(g.lines, 2, dot) : { stack: g.lines.map((t) => entry(dot, t)) });
    }
  });
  return out;
}

function itemsTable() {
  const headerRow = [
    { text: 'DESCRIPTION', style: 'th' },
    { text: 'QTY / HRS',   style: 'th', alignment: 'right' },
    { text: 'UNIT PRICE',  style: 'th', alignment: 'right' },
    { text: 'AMOUNT',      style: 'th', alignment: 'right' },
  ].map((c, i) => Object.assign(c, { fillColor: COLOR.navyTint, margin: [i === 0 ? 8 : 0, 6, i === 3 ? 8 : 0, 5] }));
  const body = [headerRow];
  const detailRows = new Set();   // rows that belong to the line above them
  if (state.items.length === 0) {
    body.push([
      { text: 'No items', italics: true, color: COLOR.subtle, colSpan: 4, alignment: 'center', margin: [0, 10, 0, 10] },
      {}, {}, {},
    ]);
  } else {
    state.items.forEach(it => {
      body.push([
        { text: it.desc || 'Untitled item', style: 'tdDesc', bold: !!it.details, margin: [8, 5, 0, 5] },
        { text: String(it.qty || 0), style: 'tdNum', margin: [0, 5, 0, 5] },
        { text: fmtMoney(it.price), style: 'tdNum', margin: [0, 5, 0, 5] },
        { text: fmtMoney((it.qty || 0) * (it.price || 0)), style: 'tdNum', bold: true, margin: [0, 5, 8, 5] },
      ]);
      const d = detailsBlock(it.details);
      if (d) {
        detailRows.add(body.length);
        body.push([{ colSpan: 4, stack: d, margin: [8, -1, 8, 9] }, {}, {}, {}]);
      }
    });
  }

  return {
    margin: [0, 14, 0, 0],
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: ['*', 60, 80, 86],
      body,
    },
    layout: {
      hLineWidth: (i, node) => {
        if (i <= 1) return 0;                        // the tinted header needs no rules
        if (detailRows.has(i)) return 0;             // details stay joined to their line
        if (i === node.table.body.length) return 1;
        return 0.5;
      },
      vLineWidth: () => 0,
      hLineColor: (i, node) => i === node.table.body.length ? COLOR.strong || '#D6D3CB' : COLOR.hairline,
      paddingTop: () => 0,
      paddingBottom: () => 0,
      paddingLeft: () => 0,
      paddingRight: (i, node) => i === node.table.widths.length - 1 ? 0 : 6,
    },
  };
}

function notesSection() {
  const notes = (state.notes || '').trim();
  if (!notes) return [];

  // pdfmake can let one very long text node resume inside the next page's
  // header. Keep each entered line small and unbreakable so page breaks happen
  // only between note blocks, where the normal page margins are respected.
  const chunks = [];
  let paragraphGap = false;
  notes.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) { paragraphGap = true; return; }
    const words = line.split(/\s+/);
    let chunk = '';
    words.forEach((word) => {
      const next = chunk ? chunk + ' ' + word : word;
      if (chunk && next.length > 240) {
        chunks.push({ text: chunk, gap: paragraphGap });
        chunk = word;
        paragraphGap = false;
      } else {
        chunk = next;
      }
    });
    if (chunk) chunks.push({ text: chunk, gap: paragraphGap });
    paragraphGap = false;
  });

  const first = chunks.shift();
  const out = [{
    margin: [0, 12, 0, 0],
    unbreakable: true,
    stack: [
      {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: COLOR.hairline },
        ],
      },
      { text: 'NOTES', style: 'eyebrow', margin: [0, 10, 0, 0] },
      { text: first.text, color: COLOR.muted, fontSize: 9.5, margin: [0, 5, 0, 0], lineHeight: 1.3 },
    ],
  }];

  chunks.forEach((part) => out.push({
    unbreakable: true,
    stack: [{
      text: part.text,
      color: COLOR.muted,
      fontSize: 9.5,
      margin: [0, part.gap ? 6 : 1, 0, 0],
      lineHeight: 1.3,
    }],
  }));
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
  // Total: a solid navy bar with a gold edge, the one number that matters.
  rows.push({
    margin: [0, 9, 0, 0],
    table: {
      widths: ['*', 'auto'],
      body: [[
        { text: 'TOTAL', bold: true, fontSize: 11, characterSpacing: 1.4, color: 'white', fillColor: COLOR.navy, margin: [12, 9, 0, 8] },
        { text: fmtMoney(t.total), bold: true, fontSize: 15, color: 'white', alignment: 'right', fillColor: COLOR.navy, margin: [0, 6, 12, 6] },
      ]],
    },
    layout: {
      defaultBorder: false, hLineWidth: () => 0,
      vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => COLOR.gold,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
  });
  const lastPay = state.receipts[state.receipts.length - 1];
  if (t.paid > 0 && t.outstanding <= 0.005 && lastPay) {
    rows.push({ text: 'Paid in full ' + fmtDate(lastPay.date) + (lastPay.method ? ' by ' + lastPay.method.toLowerCase() : '') + '. Thank you.',
      color: COLOR.success, fontSize: 9, alignment: 'right', margin: [0, 5, 0, 0] });
  } else if (t.paid > 0) {
    rows.push({ columns: [
      { text: 'Balance paid', color: COLOR.success, fontSize: 10.5 },
      { text: fmtMoney(t.paid), alignment: 'right', color: COLOR.success, fontSize: 10.5, bold: true },
    ], margin: [0, 6, 0, 0] });
  }
  if (t.outstanding > 0) {
    rows.push({ columns: [
      { text: 'OUTSTANDING', color: COLOR.danger, fontSize: 11.5, bold: true, characterSpacing: 0.5 },
      { text: fmtMoney(t.outstanding), alignment: 'right', color: COLOR.danger, fontSize: 12, bold: true },
    ], margin: [0, 6, 0, 0] });
    if (state.invoice.due) rows.push({ text: 'Please pay by ' + fmtDate(state.invoice.due), color: COLOR.muted, fontSize: 9, alignment: 'right', margin: [0, 2, 0, 0] });
  }
  return rows;
}

function paymentSection(status, t) {
  // If there are no receipts, the status pill rides inline with the
  // totals stack (handled in totalsStack). Nothing to render here.
  // One payment is summarised inside the payment panel; the table is only
  // worth its space when there are several.
  if (state.receipts.length <= 1) return { text: '' };

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
          { text: 'PAYMENT DATE',   style: 'th' },
          { text: 'PAYMENT METHOD', style: 'th' },
          { text: 'AMOUNT PAID',    style: 'th', alignment: 'right' },
        ],
        ...state.receipts.map(r => [
          { text: fmtDate(r.date),  fontSize: 10, margin: [0, 4, 0, 4] },
          { text: r.method || 'Not recorded',  fontSize: 10, color: COLOR.muted, margin: [0, 4, 0, 4] },
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

/* Bank details on every invoice. When money is still owing it says how much
   and by when; either way it asks for the invoice number as the reference so
   a transfer can be matched. */
/* Bank details on every invoice, paid or not, so a customer always knows
   where to pay, with the invoice number as the reference to match it. */
function paymentDetails(t) {
  const b = BUSINESS.bank;
  if (!b) return { text: '' };
  const row = (k, v) => ({
    columns: [
      { width: 82, text: k, fontSize: 8.5, color: COLOR.subtle, margin: [0, 1, 0, 0] },
      { width: '*', text: v, fontSize: 10, bold: true, color: COLOR.ink, characterSpacing: 0.3 },
    ],
    margin: [0, 0, 0, 4],
  });
  return {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: 'HOW TO PAY', style: 'eyebrow' },
          { text: 'Bank transfer', fontSize: 11.5, bold: true, color: COLOR.ink, margin: [0, 3, 0, 8] },
          row('Account name', b.name),
          row('BSB', b.bsb),
          row('Account number', b.account),
          row('Reference', state.invoice.number || 'Invoice number'),
        ],
        fillColor: COLOR.soft, margin: [14, 11, 12, 8], border: [false, false, false, false],
      }]],
    },
    layout: {
      defaultBorder: false, hLineWidth: () => 0,
      vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => COLOR.gold,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
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

root.MMQLD_INVOICE_PDF = {
  build(s, totals, opts) {
    state = s;
    BUSINESS = opts.business;
    return buildInvoiceDoc(totals, opts.assets);
  },
};
})(typeof window !== 'undefined' ? window : globalThis);
