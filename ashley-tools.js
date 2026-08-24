/* ============================================================================
   Ashley - the tools she can use
   ----------------------------------------------------------------------------
   Every tool is declared here in OpenAI/OpenRouter function-calling format and
   executed here against the same two systems the rest of the app already uses:
   Supabase (enquiries, calendar, invoices, inspection reports) and Gmail
   (via the Google sign-in token in app.js).

   Design notes, because they matter for how fast Ashley feels:

   1. FEW, WIDE TOOLS. `get_overview` answers "how does my day look" in ONE
      call instead of four. `find_customer` returns a person's whole history,
      contact details, cars, bookings, invoices and reports together, because
      almost every follow-up question needs it ("send her the latest invoice"
      needs the invoice id AND the email address AND the rego for threading).
   2. COMPACT RESULTS. Rows are trimmed to the fields that matter and long text
      is cut. Tool output is the biggest cost driver in an agent loop.
   3. NO SURPRISES. Sending anything, deleting anything, or opening the
      messaging app requires the owner to press a button first. Reads and
      routine updates run straight away.

   Depends on globals from app.js: sb, CONFIG, SERVICES, svcKey, svcLabel,
   firstName, gFetch, findThread, sendAttachment, sendThreaded, fetchPdfBase64.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------- helpers -- */

  const p2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const clip = (s, n) => { const t = String(s == null ? '' : s).trim(); return t.length > n ? t.slice(0, n) + '...' : t; };
  const money = (v) => (v == null || v === '' ? null : Number(v));

  /* Local-day boundaries as ISO, so "today" means the owner's today. */
  function dayRange(from, to) {
    const a = new Date((from || ymd(new Date())) + 'T00:00:00');
    const b = new Date((to || from || ymd(new Date())) + 'T23:59:59.999');
    return [a.toISOString(), b.toISOString()];
  }
  const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

  const niceWhen = (iso) => !iso ? '' : new Date(iso).toLocaleString('en-AU',
    { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const niceDay = (iso) => !iso ? '' : new Date(iso).toLocaleDateString('en-AU',
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  /* PostgREST `or=` takes a comma-separated list, so a comma or bracket inside
     the search term would break the filter. Strip them rather than escape. */
  const safeTerm = (q) => String(q || '').replace(/[,()*%]/g, ' ').trim();

  const car = (r) => [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || r.vehicle || '';
  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const publicPdf = (bucket, path) => path
    ? CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/' + bucket + '/' + path
    : null;

  const TABLE = { booking: 'calendar_events', invoice: 'invoices', inspection: 'inspection_reports' };

  /* Compact row shapes. Everything Ashley needs, nothing she does not. */
  const slimInquiry = (r) => ({
    id: r.id, received: niceWhen(r.created_at), name: r.full_name, email: r.email, phone: r.phone,
    suburb: r.suburb, address: r.address, vehicle: car(r), rego: r.vehicle_rego,
    job: svcLabel(r.service_needed) || r.service_needed, status: r.status,
    what_they_said: clip(r.symptoms, 400), preferred_date: r.preferred_date || null,
  });
  const slimBooking = (r) => ({
    id: r.id, when: niceWhen(r.starts_at), starts_at: r.starts_at,
    finishes: r.ends_at ? niceWhen(r.ends_at) : null, title: r.title,
    job: svcLabel(r.service) || r.service || null, customer: r.customer_name, phone: r.customer_phone,
    rego: r.vehicle_rego, suburb: r.suburb, address: r.address, notes: clip(r.notes, 300), status: r.status,
  });
  const slimInvoice = (r) => ({
    id: r.id, number: r.invoice_number, date: niceDay(r.created_at), customer: r.customer_name,
    business: r.business_name || null, email: r.customer_email || null, rego: r.vehicle_rego,
    vehicle: r.vehicle, total: money(r.total), paid: money(r.paid), balance: money(r.balance),
    payment_status: r.status, has_pdf: !!r.pdf_path,
  });
  const slimInspection = (r) => ({
    id: r.id, number: r.report_number, date: niceDay(r.created_at), customer: r.customer_name,
    email: r.customer_email || null, phone: r.customer_phone || null, rego: r.vehicle_rego,
    vehicle: r.vehicle, rating: r.overall_rating, has_pdf: !!r.pdf_path,
  });

  async function grab(table, build) {
    const q = build(sb.from(table).select('*'));
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  /* ---------------------------------------------------------------- reads -- */

  async function get_overview() {
    const now = new Date();
    const [t0, t1] = dayRange(ymd(now));
    const [m0, m1] = dayRange(ymd(new Date(Date.now() + 86400000)));
    const weekEnd = dayRange(ymd(new Date(Date.now() + 7 * 86400000)))[1];

    const [today, tomorrow, week, inq, invoices] = await Promise.all([
      grab('calendar_events', (q) => q.gte('starts_at', t0).lte('starts_at', t1).order('starts_at')),
      grab('calendar_events', (q) => q.gte('starts_at', m0).lte('starts_at', m1).order('starts_at')),
      grab('calendar_events', (q) => q.gte('starts_at', t0).lte('starts_at', weekEnd)),
      grab('quote_submissions', (q) => q.gte('created_at', daysAgo(7)).order('created_at', { ascending: false })),
      grab('invoices', (q) => q.gte('created_at', daysAgo(60)).order('created_at', { ascending: false })),
    ]);

    const unpaid = invoices.filter((r) => r.status && r.status !== 'paid');
    const sum = (rows, f) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
    const last30 = invoices.filter((r) => new Date(r.created_at) >= new Date(daysAgo(30)));

    return {
      today: niceDay(now.toISOString()),
      bookings_today: today.map(slimBooking),
      bookings_tomorrow: tomorrow.map(slimBooking),
      bookings_next_7_days: week.length,
      new_enquiries_last_24h: inq.filter((r) => r.created_at >= hoursAgo(24)).length,
      new_enquiries_last_7_days: inq.length,
      enquiries_awaiting_first_contact: inq.filter((r) => r.status === 'new').length,
      unpaid_invoices: { count: unpaid.length, amount_owing: Math.round(sum(unpaid, 'balance') * 100) / 100 },
      invoiced_last_30_days: Math.round(sum(last30, 'total') * 100) / 100,
    };
  }

  async function find_customer(a) {
    const term = safeTerm(a.query);
    if (!term) return { error: 'Give me a name, business, rego, phone or email to search for.' };
    const like = '%' + term + '%';

    const [inq, bookings, invoices, inspections] = await Promise.all([
      grab('quote_submissions', (q) => q
        .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like},vehicle_rego.ilike.${like},suburb.ilike.${like}`)
        .order('created_at', { ascending: false }).limit(40)),
      grab('calendar_events', (q) => q
        .or(`customer_name.ilike.${like},customer_phone.ilike.${like},vehicle_rego.ilike.${like},title.ilike.${like}`)
        .order('starts_at', { ascending: false }).limit(40)),
      grab('invoices', (q) => q
        .or(`customer_name.ilike.${like},business_name.ilike.${like},customer_email.ilike.${like},vehicle_rego.ilike.${like},invoice_number.ilike.${like}`)
        .order('created_at', { ascending: false }).limit(40)),
      grab('inspection_reports', (q) => q
        .or(`customer_name.ilike.${like},customer_email.ilike.${like},customer_phone.ilike.${like},vehicle_rego.ilike.${like},report_number.ilike.${like}`)
        .order('created_at', { ascending: false }).limit(40)),
    ]);

    /* Merge everything about one person into a single card. Keyed on the name,
       falling back to the rego so a booking with no name still lands somewhere
       sensible. Contact details are backfilled from whichever record has them,
       newest first, which is how "send her the invoice" finds an email that
       was only ever typed into the original website enquiry. */
    const people = new Map();
    const slot = (name, rego) => {
      const key = normName(name) || ('rego:' + String(rego || '').toUpperCase()) || 'unknown';
      if (!people.has(key)) people.set(key, {
        name: name || null, business: null, email: null, phone: null, suburb: null, address: null,
        vehicles: [], enquiries: [], bookings: [], invoices: [], inspection_reports: [],
      });
      const p = people.get(key);
      if (!p.name && name) p.name = name;
      if (rego && !p.vehicles.includes(rego)) p.vehicles.push(rego);
      return p;
    };
    const fill = (p, o) => { for (const k in o) if (!p[k] && o[k]) p[k] = o[k]; };

    inq.forEach((r) => {
      const p = slot(r.full_name, r.vehicle_rego);
      fill(p, { email: r.email, phone: r.phone, suburb: r.suburb, address: r.address });
      p.enquiries.push(slimInquiry(r));
    });
    invoices.forEach((r) => {
      const p = slot(r.customer_name, r.vehicle_rego);
      fill(p, { email: r.customer_email, business: r.business_name });
      p.invoices.push(slimInvoice(r));
    });
    inspections.forEach((r) => {
      const p = slot(r.customer_name, r.vehicle_rego);
      fill(p, { email: r.customer_email, phone: r.customer_phone });
      p.inspection_reports.push(slimInspection(r));
    });
    bookings.forEach((r) => {
      const p = slot(r.customer_name, r.vehicle_rego);
      fill(p, { phone: r.customer_phone, suburb: r.suburb, address: r.address });
      p.bookings.push(slimBooking(r));
    });

    const matches = [...people.values()];
    if (!matches.length) return { query: a.query, matches: [], note: 'Nobody matched that. Try part of the name, the rego, or their phone number.' };
    return { query: a.query, matches: matches.slice(0, 6) };
  }

  async function list_inquiries(a) {
    const rows = await grab('quote_submissions', (q) => {
      let x = q.gte('created_at', hoursAgo(Math.min(Number(a.since_hours) || 48, 24 * 365)));
      if (a.status) x = x.eq('status', a.status);
      return x.order('created_at', { ascending: false }).limit(Math.min(Number(a.limit) || 25, 60));
    });
    const wanted = a.job_type ? svcKey(a.job_type) || a.job_type : null;
    const out = wanted ? rows.filter((r) => svcKey(r.service_needed) === wanted) : rows;
    return { count: out.length, enquiries: out.map(slimInquiry) };
  }

  async function list_bookings(a) {
    const from = a.from || ymd(new Date());
    const to = a.to || ymd(new Date(new Date(from + 'T00:00:00').getTime() + 6 * 86400000));
    const [s, e] = dayRange(from, to);
    const rows = await grab('calendar_events', (q) => q.gte('starts_at', s).lte('starts_at', e).order('starts_at'));
    return { from, to, count: rows.length, bookings: rows.map(slimBooking) };
  }

  async function list_documents(a) {
    const kind = a.kind === 'inspections' ? 'inspections' : 'invoices';
    const table = kind === 'invoices' ? 'invoices' : 'inspection_reports';
    let rows = await grab(table, (q) => {
      let x = q.gte('created_at', daysAgo(Math.min(Number(a.since_days) || 90, 1000)));
      if (kind === 'invoices' && a.payment_status) x = x.eq('status', a.payment_status);
      if (a.customer) x = x.ilike('customer_name', '%' + safeTerm(a.customer) + '%');
      return x.order('created_at', { ascending: false }).limit(Math.min(Number(a.limit) || 25, 60));
    });
    if (kind === 'invoices' && a.unpaid_only) rows = rows.filter((r) => r.status && r.status !== 'paid');
    return kind === 'invoices'
      ? { count: rows.length, invoices: rows.map(slimInvoice) }
      : { count: rows.length, inspection_reports: rows.map(slimInspection) };
  }

  async function get_document(a) {
    const isInv = a.kind !== 'inspections';
    const table = isInv ? 'invoices' : 'inspection_reports';
    const rows = await grab(table, (q) => q.eq('id', a.id).limit(1));
    const r = rows[0];
    if (!r) return { error: 'No ' + (isInv ? 'invoice' : 'report') + ' with that id.' };
    const base = isInv ? slimInvoice(r) : slimInspection(r);
    base.pdf_link = publicPdf(isInv ? CONFIG.STORAGE.invoices : CONFIG.STORAGE.inspections, r.pdf_path);
    if (isInv) {
      base.line_items = Array.isArray(r.items) ? r.items.map((i) => ({
        description: clip(i.desc || i.description, 120), qty: i.qty, price: i.price, amount: i.amount,
      })) : [];
      base.subtotal = money(r.subtotal); base.gst = money(r.gst);
      base.odometer = r.odometer; base.notes = clip(r.notes, 400);
    } else {
      base.comments = clip(r.comments, 600); base.odometer = r.odometer;
      /* Sections can be very large; report the shape, not every checkbox. */
      const s = r.sections;
      base.sections = s && typeof s === 'object'
        ? Object.keys(s).map((k) => ({ section: k, items: Array.isArray(s[k]) ? s[k].length : undefined }))
        : [];
    }
    return base;
  }

  /* ------------------------------------------------------------- gmail -- */

  function headerMap(payload) {
    const h = {};
    ((payload && payload.headers) || []).forEach((x) => (h[x.name.toLowerCase()] = x.value));
    return h;
  }
  /* Walk the MIME tree for the readable text. Prefer text/plain; fall back to
     stripping the HTML alternative when that is all a sender provided. */
  function bodyText(payload) {
    const dec = (d) => { try { return decodeURIComponent(escape(atob(String(d).replace(/-/g, '+').replace(/_/g, '/')))); } catch (_) { return ''; } };
    let plain = '', html = '';
    (function walk(p) {
      if (!p) return;
      const mime = p.mimeType || '';
      if (p.body && p.body.data) {
        if (mime === 'text/plain' && !plain) plain = dec(p.body.data);
        else if (mime === 'text/html' && !html) html = dec(p.body.data);
      }
      (p.parts || []).forEach(walk);
    })(payload);
    const text = plain || html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
    return text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  /* Google's sign-in opens a pop-up, and a phone only allows that immediately
     after a tap. A lookup happens seconds after the owner's message, far too
     late, so the read tools check for a live token first and hand back a
     button instead of silently failing. Sending is different: it already runs
     off the Confirm tap, so it can ask for the token itself. */
  function gmailConnected() {
    try { const o = JSON.parse(localStorage.getItem('mmqld_gtok') || 'null'); return !!(o && o.t && Date.now() < o.e); }
    catch (_) { return false; }
  }
  const NEEDS_GMAIL = {
    error: 'The inbox is not connected right now. Tell the owner to tap the Connect Gmail button below, then ask again.',
    card: { type: 'gmail', label: 'Connect Gmail' },
  };

  async function search_email(a) {
    if (!gmailConnected()) return NEEDS_GMAIL;
    const days = Math.min(Number(a.days) || 7, 365);
    const limit = Math.min(Number(a.limit) || 10, 25);
    const q = [a.query || '', 'newer_than:' + days + 'd'].filter(Boolean).join(' ');
    const list = await gFetch('/users/me/messages?maxResults=' + limit + '&q=' + encodeURIComponent(q));
    const ids = (list.messages || []).slice(0, limit);
    if (!ids.length) return { query: q, count: 0, emails: [], note: 'Nothing in the inbox matched that.' };
    const metas = await Promise.all(ids.map((m) => gFetch(
      '/users/me/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date')));
    return {
      query: q, count: metas.length,
      emails: metas.map((m) => {
        const h = headerMap(m.payload);
        return {
          message_id: m.id, from: h.from, to: h.to, subject: h.subject, date: h.date,
          preview: clip(m.snippet, 220), unread: (m.labelIds || []).includes('UNREAD'),
        };
      }),
    };
  }

  async function read_email(a) {
    if (!gmailConnected()) return NEEDS_GMAIL;
    if (!a.message_id) return { error: 'I need the message id from search_email first.' };
    const m = await gFetch('/users/me/messages/' + encodeURIComponent(a.message_id) + '?format=full');
    const h = headerMap(m.payload);
    return {
      message_id: m.id, from: h.from, to: h.to, subject: h.subject, date: h.date,
      body: clip(bodyText(m.payload), 6000),
    };
  }

  /* ------------------------------------------------------------- writes -- */

  async function save_booking(a) {
    const durMin = Math.max(15, Math.min(Number(a.duration_minutes) || 60, 600));
    const row = { updated_at: new Date().toISOString() };
    if (a.date && a.time) {
      const start = new Date(a.date + 'T' + (a.time.length === 5 ? a.time : a.time.slice(0, 5)));
      if (isNaN(start)) return { error: 'That date or time did not parse. Use YYYY-MM-DD and HH:MM.' };
      row.starts_at = start.toISOString();
      row.ends_at = new Date(start.getTime() + durMin * 60000).toISOString();
    }
    const set = (k, v) => { if (v !== undefined && v !== null && v !== '') row[k] = v; };
    set('title', a.title);
    set('service', a.job_type ? (svcKey(a.job_type) || a.job_type) : undefined);
    set('customer_name', a.customer_name); set('customer_phone', a.customer_phone);
    set('vehicle_rego', a.vehicle_rego); set('suburb', a.suburb);
    set('address', a.address); set('notes', a.notes);

    if (!a.id && !row.title) return { error: 'A new booking needs a title.' };
    if (!a.id && !row.starts_at) return { error: 'A new booking needs a date and a start time.' };

    const run = (r) => a.id
      ? sb.from('calendar_events').update(r).eq('id', a.id).select()
      : sb.from('calendar_events').insert(r).select();
    let { data, error } = await run(row);
    /* Same forward-compatible retry the booking sheet uses: drop `address` if
       the column has not been migrated in yet. */
    if (error && /address/i.test(error.message) && /column/i.test(error.message)) {
      delete row.address;
      ({ data, error } = await run(row));
    }
    if (error) return { error: error.message };
    if (typeof loadEvents === 'function') { try { await loadEvents(); if (STATE.view === 'calendar') render(); } catch (_) {} }
    const saved = (data && data[0]) || {};
    return { ok: true, action: a.id ? 'updated' : 'created', booking: slimBooking(saved) };
  }

  async function update_inquiry(a) {
    if (!a.id) return { error: 'I need the enquiry id.' };
    const patch = {};
    if (a.status) patch.status = a.status;
    if (a.notes != null) patch.notes = a.notes;
    if (!Object.keys(patch).length) return { error: 'Nothing to change.' };
    const { data, error } = await sb.from('quote_submissions').update(patch).eq('id', a.id).select();
    if (error) return { error: error.message };
    const row = STATE.rows.find((r) => r.id === a.id);
    if (row) Object.assign(row, patch);
    return { ok: true, enquiry: data && data[0] ? slimInquiry(data[0]) : null };
  }

  async function update_invoice(a) {
    if (!a.id) return { error: 'I need the invoice id.' };
    const patch = {};
    if (a.payment_status) patch.status = a.payment_status;
    if (a.paid != null && a.paid !== '') patch.paid = Number(a.paid);
    if (a.notes != null) patch.notes = a.notes;
    if (!Object.keys(patch).length) return { error: 'Nothing to change.' };

    /* Keep the balance honest: marking an invoice paid should zero what is
       owing, and a part payment should leave the right remainder. */
    const cur = (await grab('invoices', (q) => q.eq('id', a.id).limit(1)))[0];
    if (!cur) return { error: 'No invoice with that id.' };
    const total = Number(cur.total) || 0;
    if (patch.status === 'paid' && patch.paid == null) patch.paid = total;
    if (patch.paid != null) patch.balance = Math.round((total - patch.paid) * 100) / 100;

    const { data, error } = await sb.from('invoices').update(patch).eq('id', a.id).select();
    if (error) return { error: error.message };
    if (STATE.invoices) { const r = STATE.invoices.find((x) => x.id === a.id); if (r) Object.assign(r, patch); }
    return { ok: true, invoice: data && data[0] ? slimInvoice(data[0]) : null };
  }

  async function delete_record(a) {
    const table = TABLE[a.record_type];
    if (!table) return { error: 'record_type must be booking, invoice or inspection.' };
    if (!a.id) return { error: 'I need the id.' };
    const { error } = await sb.from(table).delete().eq('id', a.id);
    if (error) return { error: error.message };
    if (a.record_type === 'booking' && typeof loadEvents === 'function') { try { await loadEvents(); } catch (_) {} }
    if (a.record_type === 'invoice' && STATE.invoices) STATE.invoices = STATE.invoices.filter((r) => r.id !== a.id);
    if (a.record_type === 'inspection' && STATE.inspections) STATE.inspections = STATE.inspections.filter((r) => r.id !== a.id);
    return { ok: true, deleted: a.record_type };
  }

  /* The sign-off is written here, never by the model, so the business name and
     contact details are always exactly right and never have to be sent to the
     model in the first place. */
  function signature() {
    const ph = String(CONFIG.BUSINESS_PHONE || '').replace(/^\+?61/, '0').replace(/\s+/g, '');
    const pretty = ph.length === 10 ? ph.slice(0, 4) + ' ' + ph.slice(4, 7) + ' ' + ph.slice(7) : ph;
    return '\n\nThank you,\nAshley\n\n' + CONFIG.BUSINESS_NAME + '\nM: ' + pretty + '\nE: ' + CONFIG.BUSINESS_EMAIL;
  }
  /* The model is never told the business name, so left to itself it writes
     subjects like "Invoice from your mechanic". The subject is built here
     instead: fixed wording when a document is attached, and a substitution
     for the stand-in phrases the model reaches for otherwise. */
  function subjectFor(a) {
    if (a.attach_kind && a.attach_id) {
      return (a.attach_kind === 'inspections' ? 'Inspection report from ' : 'Invoice from ') + CONFIG.BUSINESS_NAME;
    }
    const given = String(a.subject || '').trim();
    if (!given) return 'Your enquiry with ' + CONFIG.BUSINESS_NAME;
    return given.replace(/\b(your|our|the)\s+(mechanic|workshop|business|garage)\b/gi, CONFIG.BUSINESS_NAME);
  }

  function fullEmailBody(body) {
    /* House style: no dash standing in for punctuation. Belt and braces, the
       model is told the same thing but occasionally slips. */
    const b = String(body || '').trim()
      .replace(/\s+[—–]\s+/g, ', ')
      .replace(/[—–]/g, '-');
    return b + signature();
  }

  async function send_email(a) {
    if (!a.to || !/@/.test(a.to)) return { error: 'That is not a valid email address.' };
    if (!a.body) return { error: 'The message body is empty.' };

    /* Ask for the Google token FIRST, before any network call. This runs off
       the owner's tap on Confirm, and a pop-up is only allowed while that tap
       is still fresh. Fetching the PDF first would spend that window. */
    try { await getToken(); }
    catch (e) { return { error: String((e && e.message) || e), card: { type: 'gmail', label: 'Connect Gmail' } }; }

    const text = fullEmailBody(a.body);

    let attachment = null;
    if (a.attach_kind && a.attach_id) {
      const isInv = a.attach_kind !== 'inspections';
      const table = isInv ? 'invoices' : 'inspection_reports';
      const rec = (await grab(table, (q) => q.eq('id', a.attach_id).limit(1)))[0];
      if (!rec) return { error: 'Could not find that document to attach.' };
      if (!rec.pdf_path) return { error: 'That one has no PDF saved against it, so there is nothing to attach. It can still be opened and re-saved from the Invoices screen.' };
      const bucket = isInv ? CONFIG.STORAGE.invoices : CONFIG.STORAGE.inspections;
      const num = String(rec.invoice_number || rec.report_number || 'mmqld').replace(/[^A-Za-z0-9_-]/g, '');
      attachment = {
        base64: await fetchPdfBase64(bucket, rec.pdf_path),
        filename: (isInv ? 'invoice-' : 'inspection-') + num + '.pdf',
        rego: rec.vehicle_rego,
      };
    }

    const subject = subjectFor(a);
    const thread = await findThread(a.to, attachment ? attachment.rego : a.vehicle_rego).catch(() => null);
    if (attachment) await sendAttachment(a.to, subject, text, attachment.filename, attachment.base64, thread);
    else await sendThreaded(a.to, text, thread);

    return {
      ok: true, sent_to: a.to,
      threaded: !!(thread && thread.threadId),
      attached: attachment ? attachment.filename : null,
    };
  }

  /* ------------------------------------------------------ tool registry -- */
  /* confirm: true  -> the owner presses a button before this runs.
     preview      -> builds the plain-English card he sees before deciding.
     busy         -> the line shown in the chat while the tool is running.   */

  const T = [
    {
      name: 'get_overview',
      description: 'The whole picture in one call: today\'s and tomorrow\'s bookings, how many bookings this week, new enquiries in the last 24 hours and 7 days, how many enquiries have not been contacted yet, unpaid invoices and the amount owing, and how much has been invoiced in the last 30 days. Call this FIRST for any general question about how the day, week or business is going.',
      parameters: { type: 'object', properties: {} },
      run: get_overview,
      busy: () => 'Getting the big picture',
    },
    {
      name: 'find_customer',
      description: 'Look up a person or company and get EVERYTHING about them in one call: contact details, their cars, past enquiries, bookings, invoices and inspection reports, each with its id. Search by any part of a name, business name, rego, phone or email. Use this before sending anything to a customer, because it returns both the email address and the document ids you will need.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Part of a name, business, rego, phone or email' } },
        required: ['query'],
      },
      run: find_customer,
      busy: (a) => 'Looking up ' + (a.query || 'a customer'),
    },
    {
      name: 'list_inquiries',
      description: 'Recent website enquiries, newest first. Use for questions about leads coming in.',
      parameters: {
        type: 'object',
        properties: {
          since_hours: { type: 'number', description: 'How far back to look, in hours. Default 48.' },
          status: { type: 'string', enum: ['new', 'contacted', 'quoted', 'booked', 'won', 'lost', 'archived'] },
          job_type: { type: 'string', description: 'Filter to one job type, e.g. brake-repair' },
          limit: { type: 'number' },
        },
      },
      run: list_inquiries,
      busy: (a) => 'Checking enquiries from the last ' + (a.since_hours ? a.since_hours + ' hours' : '48 hours'),
    },
    {
      name: 'list_bookings',
      description: 'Calendar bookings between two dates (YYYY-MM-DD). Defaults to the next seven days.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } },
      },
      run: list_bookings,
      busy: () => 'Checking the calendar',
    },
    {
      name: 'list_documents',
      description: 'List saved invoices or inspection reports, newest first. Use unpaid_only to find who still owes money.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['invoices', 'inspections'] },
          since_days: { type: 'number', description: 'How far back to look, in days. Default 90.' },
          payment_status: { type: 'string', enum: ['paid', 'partial', 'outstanding'], description: 'Invoices only' },
          unpaid_only: { type: 'boolean', description: 'Invoices only. Anything not fully paid.' },
          customer: { type: 'string', description: 'Filter by customer name' },
          limit: { type: 'number' },
        },
        required: ['kind'],
      },
      run: list_documents,
      busy: (a) => 'Going through the ' + (a.kind === 'inspections' ? 'inspection reports' : 'invoices'),
    },
    {
      name: 'get_document',
      description: 'Full detail of one invoice or inspection report, including line items and a link to the PDF.',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['invoices', 'inspections'] }, id: { type: 'string' } },
        required: ['kind', 'id'],
      },
      run: get_document,
      busy: (a) => 'Opening the ' + (a.kind === 'inspections' ? 'report' : 'invoice'),
    },
    {
      name: 'search_email',
      description: 'Search the business Gmail inbox. Supports normal Gmail search syntax such as from:, subject:, is:unread. Use for questions like how many booking confirmations came in this week, or what a particular customer emailed.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search terms' },
          days: { type: 'number', description: 'Only look at mail newer than this many days. Default 7.' },
          limit: { type: 'number', description: 'Max results, up to 25. Default 10.' },
        },
      },
      run: search_email,
      busy: () => 'Searching the inbox',
    },
    {
      name: 'read_email',
      description: 'Read one full email by its message_id, which comes from search_email.',
      parameters: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] },
      run: read_email,
      busy: () => 'Reading an email',
    },
    {
      name: 'save_booking',
      description: 'Add a booking to the calendar, or change an existing one by passing its id. Only include the fields you are changing. Duration defaults to one hour.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Only when changing an existing booking' },
          title: { type: 'string', description: 'Short label, e.g. Logbook service - Toyota Corolla' },
          job_type: { type: 'string', description: 'Slug such as brake-repair, logbook-servicing, pre-purchase-inspection' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM, 24 hour' },
          duration_minutes: { type: 'number' },
          customer_name: { type: 'string' }, customer_phone: { type: 'string' },
          vehicle_rego: { type: 'string' }, suburb: { type: 'string' },
          address: { type: 'string' }, notes: { type: 'string' },
        },
      },
      run: save_booking,
      busy: (a) => (a.id ? 'Updating the booking' : 'Adding it to the calendar'),
      preview: (a) => ({
        title: a.id ? 'Update this booking?' : 'Add this booking?',
        icon: 'calendar-plus',
        rows: [
          ['Job', a.title || svcLabel(a.job_type) || 'Booking'],
          a.customer_name ? ['Customer', a.customer_name] : null,
          a.date ? ['When', a.date + (a.time ? ' at ' + a.time : '')] : null,
          a.duration_minutes ? ['For', a.duration_minutes + ' minutes'] : null,
          a.address || a.suburb ? ['Where', a.address || a.suburb] : null,
        ].filter(Boolean),
        confirmLabel: a.id ? 'Update it' : 'Add it',
      }),
    },
    {
      name: 'update_inquiry',
      description: 'Change an enquiry\'s status or notes, for example marking a lead as booked or lost.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['new', 'contacted', 'quoted', 'booked', 'won', 'lost', 'archived'] },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
      run: update_inquiry,
      busy: () => 'Updating the enquiry',
    },
    {
      name: 'update_invoice',
      description: 'Mark an invoice paid, partly paid or outstanding, or record how much has been paid. Marking it paid fills in the full amount and clears the balance automatically.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          payment_status: { type: 'string', enum: ['paid', 'partial', 'outstanding'] },
          paid: { type: 'number', description: 'Amount received so far' },
          notes: { type: 'string' },
        },
        required: ['id'],
      },
      run: update_invoice,
      busy: () => 'Updating the invoice',
    },
    {
      name: 'send_email',
      description: 'Send an email to a customer, optionally with a saved invoice or inspection report attached as a PDF. It goes out in their existing Gmail conversation when there is one. Write ONLY the message itself: do not write a greeting sign-off, your name, the business name or contact details, because the signature is added automatically.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Customer email address' },
          subject: { type: 'string', description: 'Leave this out when attaching a document, it is filled in for you' },
          body: { type: 'string', description: 'The message, with no sign-off or signature' },
          attach_kind: { type: 'string', enum: ['invoices', 'inspections'] },
          attach_id: { type: 'string', description: 'Id of the invoice or report to attach' },
          vehicle_rego: { type: 'string', description: 'Helps find their existing email thread' },
        },
        required: ['to', 'body'],
      },
      run: send_email,
      confirm: true,
      busy: () => 'Sending the email',
      preview: (a) => ({
        title: a.attach_id ? 'Send this with the PDF attached?' : 'Send this email?',
        icon: 'mail',
        rows: [
          ['To', a.to],
          ['Subject', subjectFor(a)],
          a.attach_id ? ['Attached', (a.attach_kind === 'inspections' ? 'Inspection report' : 'Invoice') + ' PDF'] : null,
        ].filter(Boolean),
        body: fullEmailBody(a.body),
        confirmLabel: 'Send it',
      }),
    },
    {
      name: 'delete_record',
      description: 'Permanently delete a booking, invoice or inspection report. The owner has to confirm first.',
      parameters: {
        type: 'object',
        properties: {
          record_type: { type: 'string', enum: ['booking', 'invoice', 'inspection'] },
          id: { type: 'string' },
          what: { type: 'string', description: 'Short description of the thing, so the owner knows what he is deleting' },
        },
        required: ['record_type', 'id'],
      },
      run: delete_record,
      confirm: true,
      busy: () => 'Deleting it',
      preview: (a) => ({
        title: 'Delete this permanently?',
        icon: 'trash-2',
        danger: true,
        rows: [['Type', a.record_type], ['What', a.what || '(no description)']],
        body: 'This cannot be undone.',
        confirmLabel: 'Delete it',
      }),
    },
    {
      name: 'draft_sms',
      description: 'Prepare a text message to a customer. It opens the phone\'s messaging app with the message already typed, and the owner presses send there.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          message: { type: 'string' },
          customer_name: { type: 'string' },
        },
        required: ['phone', 'message'],
      },
      confirm: true,
      busy: () => 'Getting the message ready',
      preview: (a) => ({
        title: 'Open this text message?',
        icon: 'message-circle',
        rows: [['To', (a.customer_name ? a.customer_name + ' - ' : '') + a.phone]],
        body: a.message,
        confirmLabel: 'Open in Messages',
      }),
      run: async (a) => {
        const tel = String(a.phone).replace(/\s/g, '');
        return { ok: true, opened: true, card: { type: 'sms', href: 'sms:' + tel + '?&body=' + encodeURIComponent(a.message), label: 'Open in Messages' } };
      },
    },
    {
      name: 'open_screen',
      description: 'Offer the owner a shortcut button to one of the app screens. Use it when he would probably want to look at something himself after your answer. Do not use it instead of answering.',
      parameters: {
        type: 'object',
        properties: {
          screen: { type: 'string', enum: ['dashboard', 'inquiries', 'calendar', 'search', 'analytics', 'invoices', 'inspections'] },
          label: { type: 'string', description: 'Button text, e.g. Open the calendar' },
        },
        required: ['screen'],
      },
      busy: () => 'Adding a shortcut',
      run: async (a) => ({ ok: true, shown_to_owner: true, card: { type: 'screen', screen: a.screen, label: a.label || 'Open ' + a.screen } }),
    },
  ];

  const BY_NAME = {};
  T.forEach((t) => (BY_NAME[t.name] = t));

  /* What actually goes to the model: name, description, parameters. The run
     function, previews and busy lines stay in the browser. */
  const defs = T.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

  async function run(name, args) {
    const t = BY_NAME[name];
    if (!t) return { error: 'Unknown tool: ' + name };
    try {
      return await t.run(args || {});
    } catch (e) {
      return { error: String((e && e.message) || e).slice(0, 200) };
    }
  }

  window.ASHLEY_TOOLS = {
    defs,
    run,
    get: (n) => BY_NAME[n],
    /* save_booking is the one tool whose confirmation is the owner's choice
       (Settings > Ashley). Sending and deleting are never optional. */
    needsConfirm: (n) => {
      if (n === 'save_booking') return !!(window.MMQLD_SETTINGS && MMQLD_SETTINGS.bool('ashley_confirm_bookings'));
      return !!(BY_NAME[n] && BY_NAME[n].confirm);
    },
    preview: (n, a) => (BY_NAME[n] && BY_NAME[n].preview ? BY_NAME[n].preview(a || {}) : null),
    busy: (n, a) => { const t = BY_NAME[n]; return t && t.busy ? t.busy(a || {}) : 'Working on it'; },
    signature,
  };
})();
