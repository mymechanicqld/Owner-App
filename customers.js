/* ============================================================================
   Customer lookup + autocomplete, shared by the invoice and inspection
   generators and the main app's booking sheet.

   Pulls the people the business has already dealt with (website inquiries,
   previously issued invoices and calendar bookings), de-duplicates them, and offers them as a
   type-ahead dropdown ordered by recency. Picking one fills the whole form, so
   the owner never retypes a customer he already has on file.

   Self-contained: injects its own styles (using the design tokens both
   generator stylesheets define) so it drops into either page unchanged.
   Relies on config.js (CONFIG.SUPABASE_URL / SUPABASE_KEY).
   ========================================================================== */
(function () {
  'use strict';

  const rest = () => CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
  const headers = () => ({ apikey: CONFIG.SUPABASE_KEY });

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const plate = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let cache = null;      // deduped customers, newest first
  let inflight = null;   // shared promise while loading

  async function getJson(path) {
    try {
      const r = await fetch(rest() + path, { headers: headers() });
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : [];
    } catch (_) { return []; }
  }

  /* Load inquiries + past invoices, newest first, de-duplicated per
     person/business + vehicle. Cached for the life of the page. */
  async function load(force) {
    if (cache && !force) return cache;
    if (inflight) return inflight;
    inflight = (async () => {
      // select=* on bookings so an older table without customer_email still loads.
      const [subs, invs, bks] = await Promise.all([
        getJson('quote_submissions?select=id,full_name,email,phone,suburb,address,vehicle_rego,vehicle_make,vehicle_model,vehicle_year,created_at&order=created_at.desc&limit=400'),
        // The address only lives inside the saved invoice state, so pull just that key.
        getJson('invoices?select=customer_name,business_name,customer_email,vehicle_rego,vehicle,created_at,addr:state->customer->>address&order=created_at.desc&limit=200'),
        getJson('calendar_events?select=*&order=starts_at.desc&limit=200'),
      ]);

      const all = [];
      subs.forEach((s) => all.push({
        name: (s.full_name || '').trim(),
        business: '',
        email: (s.email || '').trim(),
        phone: (s.phone || '').trim(),
        address: (s.address || '').trim(),
        suburb: (s.suburb || '').trim(),
        rego: (s.vehicle_rego || '').trim(),
        make: [s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ').trim(),
        year: s.vehicle_year ? String(s.vehicle_year) : '',
        submissionId: s.id || '',
        when: s.created_at || '',
        src: 'inquiry',
        refs: s.id ? [{ t: 'quote_submissions', id: s.id }] : [],
      }));
      invs.forEach((v) => all.push({
        name: (v.customer_name || '').trim(),
        business: (v.business_name || '').trim(),
        email: (v.customer_email || '').trim(),
        phone: '', address: (v.addr || '').trim(), suburb: '',
        rego: (v.vehicle_rego || '').trim(),
        make: (v.vehicle || '').trim(),
        year: '',
        submissionId: '',
        when: v.created_at || '',
        src: 'invoice',
        refs: [],
      }));

      bks.forEach((b) => all.push({
        name: (b.customer_name || '').trim(),
        business: '',
        email: (b.customer_email || '').trim(),
        phone: (b.customer_phone || '').trim(),
        address: (b.address || '').trim(),
        suburb: (b.suburb || '').trim(),
        rego: (b.vehicle_rego || '').trim(),
        make: '', year: '',
        submissionId: b.submission_id || '',
        when: b.updated_at || b.created_at || '',
        src: 'booking',
        refs: b.id ? [{ t: 'calendar_events', id: b.id }] : [],
      }));
      // Newest first, then keep the first sighting of each person+vehicle and
      // backfill any blanks from their older records.
      all.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
      const seen = new Map();
      const list = [];
      const FILL = ['name', 'business', 'email', 'phone', 'address', 'suburb', 'rego', 'make', 'year', 'submissionId'];
      all.forEach((c) => {
        if (!c.name && !c.business) return;
        const key = norm(c.business || c.name) + '|' + plate(c.rego);
        const prev = seen.get(key);
        if (prev) {
          FILL.forEach((k) => { if (!prev[k] && c[k]) prev[k] = c[k]; });
          prev.refs = prev.refs.concat(c.refs);   // every record this customer was built from
          return;
        }
        seen.set(key, c);
        list.push(c);
      });

      cache = list;
      return list;
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  // What the row shows as its heading, per field being typed into.
  const label = (c, mode) => (mode === 'business' ? (c.business || c.name) : (c.name || c.business)) || '';

  /* Rank matches: name starts-with, then name contains, then the other name
     field, then rego. Input order is already newest-first and Array#sort is
     stable, so recency breaks ties. */
  function search(q, mode, limit) {
    const list = cache || [];
    const max = limit || 8;
    const needle = norm(q);
    if (!needle) return list.slice(0, max);
    const needlePlate = plate(q);
    const hits = [];
    list.forEach((c) => {
      const main = norm(label(c, mode));
      const other = norm(mode === 'business' ? c.name : c.business);
      const rego = plate(c.rego);
      let rank = -1;
      if (main.startsWith(needle)) rank = 0;
      else if (main.includes(needle)) rank = 1;
      else if (other && other.includes(needle)) rank = 2;
      else if (rego && needlePlate.length >= 2 && rego.includes(needlePlate)) rank = 3;
      if (rank >= 0) hits.push({ c, rank });
    });
    hits.sort((a, b) => a.rank - b.rank);
    return hits.slice(0, max).map((h) => h.c);
  }

  const shortDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };

  function rowHtml(c, mode, i, activeIdx) {
    const sub = [c.make, c.suburb, shortDate(c.when)].filter(Boolean).join(' · ');
    const alt = mode === 'business' ? '' : (c.business || '');
    return `<div class="ac-item${i === activeIdx ? ' is-active' : ''}" data-i="${i}" role="option">
      <div class="ac-item__main">
        <div class="ac-item__name">${esc(label(c, mode))}${alt ? ` <span class="ac-item__alt">${esc(alt)}</span>` : ''}</div>
        ${sub ? `<div class="ac-item__sub">${esc(sub)}</div>` : ''}
      </div>
      ${c.rego ? `<span class="ac-item__rego">${esc(c.rego.toUpperCase())}</span>` : ''}
    </div>`;
  }

  /* Attach the type-ahead to an input.
     opts: { mode: 'person' | 'business', onPick(customer) } */
  function attach(input, opts) {
    if (!input || input.dataset.acBound) return;
    input.dataset.acBound = '1';
    const mode = (opts && opts.mode) || 'person';
    const onPick = (opts && opts.onPick) || function () {};

    const wrap = input.closest('.field') || input.parentElement;
    if (!wrap) return;
    wrap.classList.add('ac-wrap');

    const menu = document.createElement('div');
    menu.className = 'ac-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    wrap.appendChild(menu);

    input.setAttribute('autocomplete', 'off');

    let rows = [];
    let active = -1;

    function close() { menu.hidden = true; active = -1; }

    function open() {
      rows = search(input.value, mode, 8);
      if (!rows.length) { close(); return; }
      menu.innerHTML = rows.map((c, i) => rowHtml(c, mode, i, active)).join('')
        + `<div class="ac-foot">Tap a customer to fill the form</div>`;
      menu.hidden = false;
    }

    function choose(i) {
      const c = rows[i];
      if (!c) return;
      close();
      // Pass the field being typed into: a company is often recorded in the
      // plain name field, so the caller needs to know where to put the label.
      onPick(c, mode, label(c, mode));
    }

    // Load in the background so the first focus already has data.
    load().catch(() => {});

    input.addEventListener('focus', () => { load().then(open).catch(() => {}); });
    input.addEventListener('input', () => { if (cache) open(); else load().then(open).catch(() => {}); });
    input.addEventListener('blur', () => { setTimeout(close, 120); });
    input.addEventListener('keydown', (e) => {
      if (menu.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = e.key === 'ArrowDown'
          ? Math.min(active + 1, rows.length - 1)
          : Math.max(active - 1, 0);
        menu.innerHTML = rows.map((c, i) => rowHtml(c, mode, i, active)).join('')
          + `<div class="ac-foot">Tap a customer to fill the form</div>`;
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        choose(active);
      } else if (e.key === 'Escape') {
        close();
      }
    });

    // pointerdown fires before blur, so the pick is not lost to the input
    // losing focus (and preventDefault stops the label refocusing the input).
    menu.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.ac-item');
      if (!row) return;
      e.preventDefault();
      choose(Number(row.dataset.i));
    });
  }

  /* ------------------------------------------------------------------
     Save back. When an invoice or report is saved, any detail the
     customer's own records were missing (email, address, rego, phone,
     car) is filled in from what was just typed. Gaps only: a value that
     is already on file is never overwritten, and only that customer's
     own records are touched:
       - the records the picked suggestion was built from
       - the inquiry and booking the page was opened from
       - when the name was typed without picking, records with exactly
         the same name and rego
     Returns [{ table, fields }] for each record that changed.
     ------------------------------------------------------------------ */
  const MAP = {
    quote_submissions: { name: 'full_name', email: 'email', phone: 'phone', address: 'address', rego: 'vehicle_rego', year: 'vehicle_year' },
    calendar_events: { name: 'customer_name', email: 'customer_email', phone: 'customer_phone', address: 'address', rego: 'vehicle_rego' },
  };
  const LABEL = { name: 'name', email: 'email', phone: 'phone', address: 'address', rego: 'rego', make: 'car', year: 'year' };
  const blank = (v) => v == null || String(v).trim() === '';

  function clean(d) {
    const out = {};
    const t = (v) => String(v == null ? '' : v).trim();
    if (t(d.name)) out.name = t(d.name);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t(d.email))) out.email = t(d.email);
    if (t(d.phone).replace(/\D/g, '').length >= 8) out.phone = t(d.phone);
    if (t(d.address).length >= 4) out.address = t(d.address);
    if (plate(d.rego).length >= 2) out.rego = t(d.rego).toUpperCase();
    if (t(d.make)) out.make = t(d.make);
    if (/^(19|20)\d{2}$/.test(t(d.year))) out.year = t(d.year);
    return out;
  }

  async function targetsFor(d, ctx) {
    const seen = new Set(), out = [];
    const add = (t, id) => { if (!id || !MAP[t]) return; const k = t + ':' + id; if (!seen.has(k)) { seen.add(k); out.push({ t, id }); } };
    (ctx.refs || []).forEach((r) => add(r.t, r.id));
    add('quote_submissions', ctx.submissionId);
    add('calendar_events', ctx.bookingId);
    if (!out.length && d.name && d.rego) {
      // Typed by hand: only an exact name and rego match counts as the same customer.
      const list = await load(true);
      list.filter((c) => norm(c.business || c.name) === norm(d.name) || norm(c.name) === norm(d.name))
        .filter((c) => plate(c.rego) && plate(c.rego) === plate(d.rego))
        .forEach((c) => (c.refs || []).forEach((r) => add(r.t, r.id)));
    }
    return out;
  }

  async function saveBack(details, ctx) {
    const d = clean(details || {});
    if (!Object.keys(d).length) return [];
    const targets = await targetsFor(d, ctx || {});
    const changed = [];
    for (const { t, id } of targets) {
      try {
        const cols = Object.values(MAP[t]).concat(t === 'quote_submissions' ? ['vehicle_make', 'vehicle_model'] : []);
        const rows = await getJson(t + '?id=eq.' + encodeURIComponent(id) + '&select=' + cols.join(','));
        const row = rows[0];
        if (!row) continue;
        const patch = {}, fields = [];
        Object.keys(MAP[t]).forEach((k) => {
          const col = MAP[t][k];
          if (d[k] && blank(row[col])) { patch[col] = d[k]; fields.push(LABEL[k]); }
        });
        // The inquiry keeps make and model apart; only fill when both are empty.
        if (t === 'quote_submissions' && d.make && blank(row.vehicle_make) && blank(row.vehicle_model)) {
          patch.vehicle_make = d.make; fields.push(LABEL.make);
        }
        if (!fields.length) continue;
        const r = await fetch(rest() + t + '?id=eq.' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { ...headers(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        if (r.ok) changed.push({ table: t, fields });
        else console.warn('[customers] save back failed', t, r.status);
      } catch (e) { console.warn('[customers] save back failed', t, e); }
    }
    if (changed.length) cache = null;   // next lookup sees the new details
    return changed;
  }

  /* "Saved the customer's email and address to their booking." */
  function describe(changed) {
    if (!changed || !changed.length) return '';
    const fields = [...new Set(changed.flatMap((c) => c.fields))];
    const where = [...new Set(changed.map((c) => (c.table === 'calendar_events' ? 'booking' : 'enquiry')))];
    const list = fields.length > 1 ? fields.slice(0, -1).join(', ') + ' and ' + fields[fields.length - 1] : fields[0];
    const place = where.length > 1 ? 'enquiry and booking' : where[0] + (changed.length > 1 ? 's' : '');
    return 'Added the customer\'s ' + list + ' to their ' + place;
  }

  /* Merge a street address with its suburb without repeating it. */
  function fullAddress(c) {
    let a = (c.address || '').trim();
    const s = (c.suburb || '').trim();
    if (a && s && !norm(a).includes(norm(s))) a = a + ', ' + s;
    return a || s;
  }

  // Injected once; uses tokens both generator stylesheets define.
  const CSS = `
  .ac-wrap { position: relative; }
  .ac-menu {
    position: absolute; z-index: 60; top: 100%; left: 0; right: 0; margin-top: 4px;
    background: var(--surface); border: 1px solid var(--strong); border-radius: 12px;
    box-shadow: 0 12px 28px rgba(12,10,9,0.14); overflow: hidden; max-height: 320px; overflow-y: auto;
  }
  .ac-item {
    display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer;
    border-bottom: 1px solid var(--hairline);
  }
  .ac-item:last-of-type { border-bottom: 0; }
  .ac-item:hover, .ac-item.is-active { background: var(--navy-tint); }
  .ac-item__main { flex: 1; min-width: 0; }
  .ac-item__name {
    font-weight: 700; font-size: 14px; color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ac-item__alt { font-weight: 500; color: var(--subtle); }
  .ac-item__sub {
    font-size: 12px; color: var(--subtle); margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ac-item__rego {
    flex: none; font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em;
    background: var(--soft); border: 1px solid var(--hairline); color: var(--ink);
    padding: 2px 7px; border-radius: 5px;
  }
  .ac-foot {
    padding: 7px 12px; font-size: 11.5px; color: var(--subtle);
    background: var(--soft); border-top: 1px solid var(--hairline);
  }`;

  function injectCss() {
    if (document.getElementById('mmqld-ac-css')) return;
    const s = document.createElement('style');
    s.id = 'mmqld-ac-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  injectCss();

  window.MMQLD_CUSTOMERS = { load, search, attach, fullAddress, saveBack, describe };
})();
