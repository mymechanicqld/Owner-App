/* ============================================================================
   My Mechanic QLD - Owner app
   Vanilla JS. Reads Supabase (publishable key), sends threaded Gmail replies
   from the browser via Google Identity Services. No backend.
   ========================================================================== */

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: false },
});

const STATUSES = ['new', 'contacted', 'quoted', 'booked', 'won', 'lost', 'archived'];
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', booked: 'Booked', won: 'Won', lost: 'Lost', archived: 'Archived' };
const STATUS_COLOR = { new: '#2563EB', contacted: '#B45309', quoted: '#7C3AED', booked: '#047857', won: '#065F46', lost: '#BE123C', archived: '#78716C' };

const STATE = {
  view: 'dashboard',
  rows: [],
  events: [],
  loaded: false,
  inqRange: '48h',
  period: 'daily',
  search: '',
  activeId: null,
  replyTmpl: 'service',
  msgTmpl: 'website',
  calView: 'week',
  calRef: null,
  editEventId: null,
  invoices: null,
  inspections: null,
  invSearch: '',
  inspSearch: '',
  gtoken: null,
  gexp: 0,
  _calErr: null,
};

/* --------------------------------------------------------------- helpers -- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svc = (slug) => SERVICES[slug] || { label: slug ? slug.replace(/-/g, ' ') : 'Enquiry', icon: 'mail' };

/* Colour per job type for the calendar, keyed by service slug. Lets the owner
   see at a glance what kind of work each booking is. */
const JOB_COLORS = {
  'brake-repair': '#DC2626',
  'alternator-starter': '#D97706',
  'alternator-starter-motor': '#D97706',
  'radiator-water-pump': '#0891B2',
  'logbook-servicing': '#2563EB',
  'pre-purchase-inspection': '#7C3AED',
  'battery-replacement': '#059669',
  'warning-light-diagnostics': '#EA580C',
  'steering-suspension': '#0D9488',
  'emergency-breakdown': '#BE123C',
  'not-sure': '#64748B',
  'general-enquiry': '#64748B',
};
const JOB_COLOR_DEFAULT = '#64748B';
/* The service value stored on an event can be a slug or an older human label;
   resolve either to a slug so colour + label stay consistent. */
function svcKey(v) {
  if (!v) return '';
  if (SERVICES[v]) return v;
  const low = String(v).toLowerCase();
  return Object.keys(SERVICES).find((k) => SERVICES[k].label.toLowerCase() === low) || '';
}
function svcColor(v) { return JOB_COLORS[svcKey(v)] || JOB_COLOR_DEFAULT; }
function svcLabel(v) { const k = svcKey(v); return k ? SERVICES[k].label : (v || ''); }
/* De-duplicated [slug,label] list for the job-type picker (some labels share). */
function jobTypeOptions() {
  const seen = new Set(); const out = [];
  Object.keys(SERVICES).forEach((k) => { const l = SERVICES[k].label; if (!seen.has(l)) { seen.add(l); out.push([k, l]); } });
  return out;
}
const carDesc = (s) => [s.vehicle_year, s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ') || s.vehicle_make || '';
const firstName = (n) => (n || '').trim().split(/\s+/)[0] || 'there';

function icons() { if (window.lucide) lucide.createIcons(); }

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';
}
function relTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '-'; }
function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

/* ------------------------------------------------------------------ data -- */
async function loadData(spinner = true) {
  if (spinner && !STATE.loaded) renderInquiries(true);
  const { data, error } = await sb
    .from('quote_submissions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3000);
  if (error) { toast('Could not load data', 'err'); console.error(error); return; }
  STATE.rows = data || [];
  STATE.loaded = true;
  await loadEvents();
  render();
}

async function loadEvents() {
  try {
    const { data, error } = await sb.from('calendar_events').select('*').order('starts_at', { ascending: true });
    if (error) throw error;
    STATE.events = data || [];
    STATE._calErr = null;
  } catch (e) {
    STATE.events = [];
    STATE._calErr = e.message || 'calendar unavailable';
  }
}

const rangeMs = { '48h': 1.728e8, 'week': 6.048e8, 'month': 2.592e9, 'year': 3.1536e10 };
function withinRange(iso, key) {
  const ms = rangeMs[key];
  if (!ms) return true;
  return Date.now() - new Date(iso).getTime() <= ms;
}

/* --------------------------------------------------------------- routing -- */
function setView(v) {
  STATE.view = v;
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('#sidebar-nav button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  closeSidebar();
  $('.main').scrollTop = 0;
  render();
  icons();
}
function render() {
  if (STATE.view === 'dashboard') renderDashboard();
  else if (STATE.view === 'inquiries') renderInquiries();
  else if (STATE.view === 'calendar') renderCalendar();
  else if (STATE.view === 'search') renderSearch();
  else if (STATE.view === 'analytics') renderAnalytics();
  else if (STATE.view === 'invoices') renderInvoices();
  else if (STATE.view === 'inspections') renderInspections();
  icons();
}
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#side-scrim').classList.remove('open'); }
function openSidebar() { $('#sidebar').classList.add('open'); $('#side-scrim').classList.add('open'); }

/* ----------------------------------------------------------- row builder -- */
function rowHtml(s) {
  const sv = svc(s.service_needed);
  const rego = s.vehicle_rego ? `<span class="rego">${esc(s.vehicle_rego)}</span>` : '';
  const bits = [esc(s.suburb || ''), carDesc(s) ? esc(carDesc(s)) : ''].filter(Boolean).join(' · ');
  return `
  <div class="row" data-id="${s.id}">
    <div class="ic"><i data-lucide="${sv.icon}"></i></div>
    <div class="body">
      <div class="name"><span class="dot" style="background:${STATUS_COLOR[s.status] || '#2563EB'}"></span>${esc(s.full_name || 'Unknown')}</div>
      <div class="line">${rego} ${bits}</div>
    </div>
    <div class="when">${relTime(s.created_at)}<br><span style="color:var(--accent)">${esc(sv.label)}</span></div>
  </div>`;
}

/* ------------------------------------------------------------- dashboard -- */
function renderDashboard() {
  const rows = STATE.rows;
  const newCount = rows.filter((r) => r.status === 'new').length;
  const last48 = rows.filter((r) => withinRange(r.created_at, '48h')).length;
  const week = rows.filter((r) => withinRange(r.created_at, 'week')).length;
  // top job type this week
  const wk = rows.filter((r) => withinRange(r.created_at, 'week'));
  const counts = {};
  wk.forEach((r) => { const l = svc(r.service_needed).label; counts[l] = (counts[l] || 0) + 1; });
  const topJob = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const recent = rows.slice(0, 5);

  $('#view-dashboard').innerHTML = `
    <div class="view-head"><div><h2>${greeting().replace(',', '')}</h2><div class="meta">${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div></div>
    <div class="stats">
      <div class="stat accent"><div class="k"><i data-lucide="inbox"></i>New</div><div class="v">${newCount}</div><div class="s">Awaiting first contact</div></div>
      <div class="stat"><div class="k"><i data-lucide="clock"></i>Last 48h</div><div class="v">${last48}</div><div class="s">New enquiries</div></div>
      <div class="stat"><div class="k"><i data-lucide="calendar-days"></i>This week</div><div class="v">${week}</div><div class="s">Enquiries in 7 days</div></div>
      <div class="stat"><div class="k"><i data-lucide="wrench"></i>Top job</div><div class="v" style="font-size:18px;line-height:1.2;margin-top:8px">${topJob ? esc(topJob[0]) : '-'}</div><div class="s">${topJob ? topJob[1] + ' this week' : 'No data'}</div></div>
    </div>
    <div class="section-title">Recent inquiries</div>
    <div class="list" id="dash-recent">${recent.length ? recent.map(rowHtml).join('') : emptyHtml('inbox', 'No inquiries yet', 'New leads will show up here.')}</div>
    ${recent.length ? `<button class="btn ghost full" id="see-all" style="margin-top:14px"><i data-lucide="arrow-right"></i>See all inquiries</button>` : ''}
  `;
}

/* ------------------------------------------------------------- inquiries -- */
function renderInquiries(skeleton = false) {
  const el = $('#view-inquiries');
  if (skeleton) {
    el.innerHTML = `<div class="view-head"><h2>Inquiries</h2></div><div class="list">${'<div class="skeleton" style="height:70px"></div>'.repeat(5)}</div>`;
    return;
  }
  const ranges = [['48h', 'Last 48h'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']];
  const filtered = STATE.rows.filter((r) => r.status !== 'archived' && withinRange(r.created_at, STATE.inqRange));
  el.innerHTML = `
    <div class="view-head"><h2>Inquiries</h2><div class="meta">${filtered.length} shown</div></div>
    <div class="toolbar">${ranges.map(([k, l]) => `<button class="chip ${STATE.inqRange === k ? 'active' : ''}" data-range="${k}">${l}</button>`).join('')}</div>
    <div class="list">${filtered.length ? filtered.map(rowHtml).join('') : emptyHtml('inbox', 'Nothing here', 'No inquiries in this window.')}</div>
  `;
}

/* ---------------------------------------------------------------- search -- */
function renderSearch() {
  const q = STATE.search.trim().toLowerCase();
  let results = [];
  if (q) {
    results = STATE.rows.filter((r) =>
      [r.full_name, r.email, r.phone, r.suburb, r.vehicle_rego, r.vehicle_make, r.vehicle_model, svc(r.service_needed).label]
        .some((v) => (v || '').toString().toLowerCase().includes(q))
    );
  }
  $('#view-search').innerHTML = `
    <div class="view-head"><h2>Search</h2></div>
    <div class="search-bar"><i data-lucide="search"></i><input id="search-input" type="search" placeholder="Name, rego, suburb or phone" value="${esc(STATE.search)}" autocomplete="off" /></div>
    ${!q ? emptyHtml('search', 'Find a customer', 'Search by name, rego, suburb, phone or email.')
      : results.length ? `<div class="meta" style="margin:2px 2px 12px;color:var(--subtle)">${results.length} match${results.length === 1 ? '' : 'es'}</div><div class="list">${results.map(rowHtml).join('')}</div>`
      : emptyHtml('search-x', 'No matches', 'Try a different name, rego or suburb.')}
  `;
  const input = $('#search-input');
  if (input) {
    input.addEventListener('input', (e) => { STATE.search = e.target.value; renderSearch(); icons(); });
    if (document.activeElement !== input && q) { input.focus(); input.setSelectionRange(q.length, q.length); }
  }
}

/* ------------------------------------------------------------- analytics -- */
function buckets(period) {
  // returns {trend:[{label,count}], windowDays}
  const now = new Date();
  const out = [];
  if (period === 'daily') {
    for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); out.push({ key: d.toDateString(), label: d.getDate(), count: 0 }); }
    STATE.rows.forEach((r) => { const k = new Date(r.created_at).toDateString(); const b = out.find((x) => x.key === k); if (b) b.count++; });
    return { trend: out, windowDays: 14 };
  }
  if (period === 'weekly') {
    for (let i = 11; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i * 7); const wk = weekStart(d); out.push({ key: wk.toDateString(), label: (wk.getDate() + '/' + (wk.getMonth() + 1)), count: 0 }); }
    STATE.rows.forEach((r) => { const k = weekStart(new Date(r.created_at)).toDateString(); const b = out.find((x) => x.key === k); if (b) b.count++; });
    return { trend: out, windowDays: 84 };
  }
  // monthly
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push({ key: d.getFullYear() + '-' + d.getMonth(), label: d.toLocaleDateString('en-AU', { month: 'short' }), count: 0 }); }
  STATE.rows.forEach((r) => { const d = new Date(r.created_at); const k = d.getFullYear() + '-' + d.getMonth(); const b = out.find((x) => x.key === k); if (b) b.count++; });
  return { trend: out, windowDays: 365 };
}
function weekStart(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }

function vbars(trend) {
  const max = Math.max(1, ...trend.map((t) => t.count));
  return `<div class="bars">${trend.map((t) => {
    const h = Math.round((t.count / max) * 100);
    return `<div class="b"><div class="val">${t.count || ''}</div><div class="bar ${t.count === max && max > 0 ? 'peak' : ''}" style="height:${t.count ? Math.max(h, 6) : 2}%"></div><div class="lab">${t.label}</div></div>`;
  }).join('')}</div>`;
}
function hbars(pairs, withIcon) {
  if (!pairs.length) return `<div class="empty" style="padding:24px"><p>No data in this window.</p></div>`;
  const max = Math.max(...pairs.map((p) => p[1]));
  return `<div class="hbars">${pairs.map(([label, count, icon]) => `
    <div class="hbar"><div class="top"><span class="l">${withIcon && icon ? `<i data-lucide="${icon}"></i>` : ''}${esc(label)}</span><span class="c">${count}</span></div>
    <div class="track"><div class="fill" style="width:${Math.round((count / max) * 100)}%"></div></div></div>`).join('')}</div>`;
}
function renderAnalytics() {
  const { trend, windowDays } = buckets(STATE.period);
  const winMs = windowDays * 86400000;
  const inWin = STATE.rows.filter((r) => Date.now() - new Date(r.created_at).getTime() <= winMs);

  // busiest day of week
  const dow = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  inWin.forEach((r) => { const idx = (new Date(r.created_at).getDay() + 6) % 7; dow[idx]++; });
  const dowNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowTrend = dow.map((c, i) => ({ label: dowNames[i], count: c }));

  // job types
  const jc = {};
  inWin.forEach((r) => { const sv = svc(r.service_needed); jc[sv.label] = jc[sv.label] || { c: 0, icon: sv.icon }; jc[sv.label].c++; });
  const jobs = Object.entries(jc).map(([l, o]) => [l, o.c, o.icon]).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // suburbs
  const sc = {};
  inWin.forEach((r) => { const s = (r.suburb || 'Unknown').trim(); sc[s] = (sc[s] || 0) + 1; });
  const subs = Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const periods = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
  const winLabel = STATE.period === 'daily' ? 'last 14 days' : STATE.period === 'weekly' ? 'last 12 weeks' : 'last 12 months';

  $('#view-analytics').innerHTML = `
    <div class="view-head"><h2>Analytics</h2><div class="meta">${inWin.length} in ${winLabel}</div></div>
    <div class="seg">${periods.map(([k, l]) => `<button class="${STATE.period === k ? 'active' : ''}" data-period="${k}">${l}</button>`).join('')}</div>
    <div class="chart-card"><h3>Inquiries over time</h3><div class="cap">${winLabel}</div>${vbars(trend)}</div>
    <div class="chart-card"><h3>Busiest day of week</h3><div class="cap">${winLabel}</div>${vbars(dowTrend)}</div>
    <div class="chart-card"><h3>Most common job type</h3><div class="cap">${winLabel}</div>${hbars(jobs, true)}</div>
    <div class="chart-card"><h3>Top suburbs</h3><div class="cap">${winLabel}</div>${hbars(subs, false)}</div>
  `;
}

function emptyHtml(icon, h, p) {
  return `<div class="empty"><i data-lucide="${icon === 'search-x' ? 'search-x' : icon}"></i><h3>${h}</h3><p>${p}</p></div>`;
}

/* ----------------------------------------------------------- detail sheet -- */
function openSheet() { $('#scrim').classList.add('open'); $('#sheet').classList.add('open'); }
function closeSheet() { $('#scrim').classList.remove('open'); $('#sheet').classList.remove('open'); STATE.activeId = null; }

function openDetail(id) {
  const s = STATE.rows.find((r) => r.id === id);
  if (!s) return;
  STATE.activeId = id;
  const sv = svc(s.service_needed);
  $('#sheet-title').textContent = s.full_name || 'Customer';
  $('#sheet-sub').innerHTML = `<span class="pill ${s.status}">${STATUS_LABEL[s.status] || s.status}</span> &nbsp; ${esc(sv.label)}`;
  const field = (icon, label, val) => val ? `<div class="field"><div class="fic"><i data-lucide="${icon}"></i></div><div><div class="fl">${label}</div><div class="fv">${val}</div></div></div>` : '';
  const tel = s.phone ? s.phone.replace(/\s/g, '') : '';
  $('#sheet-body').innerHTML = `
    ${field('phone', 'Phone', s.phone ? `<a href="tel:${esc(tel)}">${esc(s.phone)}</a>` : '')}
    ${field('mail', 'Email', s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '')}
    ${field('map-pin', 'Suburb', esc(s.suburb))}
    ${field('home', 'Address', esc(s.address))}
    ${field('car-front', 'Vehicle', [esc(carDesc(s)), s.vehicle_rego ? `<span class="rego">${esc(s.vehicle_rego)}</span>` : ''].filter(Boolean).join(' '))}
    ${field('wrench', 'Service', esc(sv.label))}
    <div class="field"><div class="fic"><i data-lucide="calendar-days"></i></div>
      <div style="flex:1"><div class="fl">Preferred date</div><div class="fv">${s.preferred_date ? fmtDate(s.preferred_date) : 'Not specified'}</div></div>
      <button class="addcal" id="act-addcal"><i data-lucide="calendar-plus"></i>Add</button>
    </div>
    ${s.symptoms ? `<div class="field notes"><div class="fic"><i data-lucide="message-square"></i></div><div><div class="fl">Notes</div><div class="fv">${esc(s.symptoms)}</div></div></div>` : ''}
    ${field('clock', 'Submitted', fmtDateTime(s.created_at))}
    <div class="field"><div class="fic"><i data-lucide="flag"></i></div><div style="flex:1"><div class="fl">Status</div>
      <select id="status-sel" class="composer" style="min-height:auto;padding:10px 12px;margin-top:4px;font-weight:700">
        ${STATUSES.map((st) => `<option value="${st}" ${st === s.status ? 'selected' : ''}>${STATUS_LABEL[st]}</option>`).join('')}
      </select></div></div>
    <div class="actions">
      <button class="btn primary full" id="act-reply"><i data-lucide="send"></i>Reply by email</button>
      ${s.phone ? `<a class="btn ghost" href="tel:${esc(tel)}"><i data-lucide="phone"></i>Call</a>` : ''}
      ${s.phone ? `<button class="btn ghost" id="act-message"><i data-lucide="message-circle"></i>Message</button>` : '<a class="btn ghost" href="mailto:'+esc(s.email)+'"><i data-lucide="mail"></i>Mail</a>'}
      <button class="btn ghost" id="act-invoice"><i data-lucide="file-text"></i>Invoice</button>
      <button class="btn ghost" id="act-inspection"><i data-lucide="clipboard-check"></i>Inspection</button>
    </div>
  `;
  openSheet();
  icons();
  $('#status-sel').addEventListener('change', async (e) => {
    const ns = e.target.value;
    const { error } = await sb.from('quote_submissions').update({ status: ns }).eq('id', id);
    if (error) return toast('Update failed', 'err');
    s.status = ns; toast('Marked ' + STATUS_LABEL[ns], 'ok'); render();
  });
  $('#act-reply').addEventListener('click', () => openReply(id));
  const genParams = () => new URLSearchParams({
    id: s.id || '',
    name: s.full_name || '',
    email: s.email || '',
    phone: s.phone || '',
    suburb: s.suburb || '',
    address: s.address || '',
    rego: s.vehicle_rego || '',
    make: carDesc(s) || s.vehicle_make || '',
    year: s.vehicle_year || '',
  }).toString();
  $('#act-invoice').addEventListener('click', () => { location.href = 'invoice/index.html?' + genParams(); });
  $('#act-inspection').addEventListener('click', () => { location.href = 'inspection/index.html?' + genParams(); });
  const mBtn = $('#act-message'); if (mBtn) mBtn.addEventListener('click', () => openMessage(id));
  const cBtn = $('#act-addcal'); if (cBtn) cBtn.addEventListener('click', () => openEvent(eventFromSubmission(s)));
}

/* -------------------------------------------------------- reply composer -- */
function buildReplyText(tmpl, s, price) {
  const g = greeting();
  if (tmpl === 'custom') return TEMPLATES.custom.build(g);
  return TEMPLATES[tmpl].build(g, price || TEMPLATES[tmpl].price);
}
function openReply(id) {
  const s = STATE.rows.find((r) => r.id === id);
  if (!s) return;
  STATE.activeId = id;
  STATE.replyTmpl = 'service';
  $('#sheet-title').textContent = 'Reply to ' + firstName(s.full_name);
  $('#sheet-sub').innerHTML = `Sends a threaded reply via Gmail`;
  const tmplKeys = ['service', 'diagnostic', 'custom'];
  $('#sheet-body').innerHTML = `
    <button class="btn ghost" id="reply-back" style="margin-bottom:14px;width:auto;display:inline-flex"><i data-lucide="chevron-left"></i>Back</button>
    <div class="reply-to">To <b>${esc(s.email || 'no email on file')}</b></div>
    <div class="tmpl-seg" id="tmpl-seg">${tmplKeys.map((k) => `<button data-tmpl="${k}" class="${k === 'service' ? 'active' : ''}">${TEMPLATES[k].label}</button>`).join('')}</div>
    <div class="price-row" id="price-row"><label>Price</label><div class="pin"><span>$</span><input id="price-in" type="number" inputmode="numeric" value="${TEMPLATES.service.price}" /></div></div>
    <textarea class="composer" id="composer">${esc(buildReplyText('service', s, TEMPLATES.service.price))}</textarea>
    <div class="actions"><button class="btn primary full" id="send-reply"><i data-lucide="send"></i>Send reply</button></div>
    <p style="font-size:12px;color:var(--subtle);margin-top:10px;text-align:center">Sent in the customer's existing email thread, so the whole conversation stays together in Gmail.</p>
  `;
  icons();

  const refresh = () => {
    const price = $('#price-in') ? $('#price-in').value : '';
    $('#composer').value = buildReplyText(STATE.replyTmpl, s, price);
  };
  $('#tmpl-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tmpl]'); if (!b) return;
    STATE.replyTmpl = b.dataset.tmpl;
    document.querySelectorAll('#tmpl-seg button').forEach((x) => x.classList.toggle('active', x === b));
    $('#price-row').style.display = STATE.replyTmpl === 'custom' ? 'none' : 'flex';
    if ($('#price-in')) $('#price-in').value = TEMPLATES[STATE.replyTmpl].price || '';
    refresh();
  });
  if ($('#price-in')) $('#price-in').addEventListener('input', refresh);
  $('#reply-back').addEventListener('click', () => openDetail(id));
  $('#send-reply').addEventListener('click', () => sendReplyNow(id));
}

async function sendReplyNow(id) {
  const s = STATE.rows.find((r) => r.id === id);
  if (!s) return;
  if (!s.email) return toast('No email address on file', 'err');
  const body = $('#composer').value.trim();
  if (!body) return toast('Message is empty', 'err');
  const btn = $('#send-reply');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Sending...';
  try {
    const found = await findThread(s.email, s.vehicle_rego);
    await sendThreaded(s.email, body, found);
    // advance status: a priced quote -> quoted, custom -> contacted
    const ns = STATE.replyTmpl === 'custom' ? 'contacted' : 'quoted';
    await sb.from('quote_submissions').update({ status: ns }).eq('id', id);
    s.status = ns;
    toast(found && found.threadId ? 'Reply sent in thread' : 'Reply sent', 'ok');
    closeSheet();
    render();
  } catch (err) {
    console.error(err);
    toast(String(err.message || err).slice(0, 80), 'err');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send"></i>Send reply'; icons();
  }
}

/* --------------------------------------------------------------- calendar -- */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function weekStartM(d) { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''; }
function toLocalInput(d) { const x = new Date(d); const p = (n) => String(n).padStart(2, '0'); return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + 'T' + p(x.getHours()) + ':' + p(x.getMinutes()); }

function renderCalendar() {
  if (!STATE.calRef) STATE.calRef = new Date();
  const ref = STATE.calRef;
  const days = STATE.calView === 'day' ? [startOfDay(ref)] : Array.from({ length: 7 }, (_, i) => addDays(weekStartM(ref), i));
  const title = STATE.calView === 'day'
    ? ref.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    : days[0].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' - ' + days[6].toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const evByDay = (d) => STATE.events.filter((e) => sameDay(e.starts_at, d)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const dayBlock = (d) => {
    const evs = evByDay(d);
    return `
    <div class="cal-day ${sameDay(d, new Date()) ? 'today' : ''}">
      <div class="cal-day__h"><span class="dn">${d.toLocaleDateString('en-AU', { weekday: 'long' })}</span><span class="dd">${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span></div>
      ${evs.length ? evs.map((e, i) => eventChip(e, i, evs.length)).join('') : '<div class="cal-empty">No bookings</div>'}
    </div>`;
  };
  // Legend of the job types visible in the current range.
  const visibleTypes = [...new Set(days.flatMap(evByDay).map((e) => svcKey(e.service)).filter(Boolean))];
  const legend = visibleTypes.length
    ? `<div class="cal-legend">${visibleTypes.map((k) => `<span class="lg"><span class="edot" style="background:${JOB_COLORS[k] || JOB_COLOR_DEFAULT}"></span>${esc(SERVICES[k].label)}</span>`).join('')}</div>`
    : '';
  $('#view-calendar').innerHTML = `
    <div class="cal-head"><h2>${esc(title)}</h2>
      <div class="cal-nav">
        <button id="cal-prev" aria-label="Previous"><i data-lucide="chevron-left"></i></button>
        <button class="cal-today" id="cal-today">Today</button>
        <button id="cal-next" aria-label="Next"><i data-lucide="chevron-right"></i></button>
      </div>
    </div>
    <div class="seg" id="cal-seg"><button data-cv="day" class="${STATE.calView === 'day' ? 'active' : ''}">Day</button><button data-cv="week" class="${STATE.calView === 'week' ? 'active' : ''}">Week</button></div>
    ${legend}
    ${STATE._calErr ? `<div class="cal-empty" style="color:var(--rose)">Calendar not set up yet. Run owner-app-schema.sql in Supabase.</div>` : ''}
    ${days.map(dayBlock).join('')}
    <button class="fab-new" id="cal-add" aria-label="New booking"><i data-lucide="plus"></i></button>
  `;
}
function eventChip(e, i, n) {
  const color = svcColor(e.service);
  const t = e.all_day ? 'All day' : fmtTime(e.starts_at) + (e.ends_at ? ' - ' + fmtTime(e.ends_at) : '');
  const type = svcLabel(e.service);
  const meta = [e.customer_name, e.vehicle_rego, e.suburb].filter(Boolean).join(' · ');
  // Up/down controls to reorder the day (swap time slots with the neighbour).
  const moves = (n > 1) ? `<div class="emove">
      <button class="emv" data-move-up="${e.id}" ${i > 0 ? '' : 'disabled'} aria-label="Move earlier"><i data-lucide="chevron-up"></i></button>
      <button class="emv" data-move-down="${e.id}" ${i < n - 1 ? '' : 'disabled'} aria-label="Move later"><i data-lucide="chevron-down"></i></button>
    </div>` : '';
  return `<div class="event" data-ev="${e.id}" style="border-left-color:${color}">
    <div class="et">${esc(t)}</div>
    <div class="eb">
      <div class="etitle">${esc(e.title)}</div>
      ${type ? `<div class="etype"><span class="edot" style="background:${color}"></span>${esc(type)}</div>` : ''}
      ${meta ? `<div class="emeta">${esc(meta)}</div>` : ''}
    </div>
    ${moves}
  </div>`;
}

function openEvent(ev) {
  const isEdit = ev && ev.id;
  STATE.editEventId = isEdit ? ev.id : null;
  const start = ev && ev.starts_at ? new Date(ev.starts_at) : (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; })();
  $('#sheet-title').textContent = isEdit ? 'Edit booking' : 'New booking';
  $('#sheet-sub').textContent = isEdit ? 'Update or delete this booking' : 'Check the details, then add it';
  const fld = (label, id, type, val, ph) => `<label class="form-field"><span>${label}</span><input id="${id}" type="${type}" value="${esc(val || '')}" placeholder="${ph || ''}" /></label>`;
  // Date + start time + duration (no end picker; end = start + duration, 1hr default).
  const p2 = (n) => String(n).padStart(2, '0');
  const dateVal = start.getFullYear() + '-' + p2(start.getMonth() + 1) + '-' + p2(start.getDate());
  const timeVal = p2(start.getHours()) + ':' + p2(start.getMinutes());
  const durMin = (ev && ev.starts_at && ev.ends_at) ? Math.max(15, Math.round((new Date(ev.ends_at) - new Date(ev.starts_at)) / 60000)) : 60;
  const DURS = [[30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [150, '2.5 hours'], [180, '3 hours'], [240, '4 hours'], [300, '5 hours'], [360, '6 hours'], [480, 'Full day (8h)']];
  const durOpts = DURS.map(([v, l]) => `<option value="${v}" ${v === durMin ? 'selected' : ''}>${l}</option>`).join('')
    + (DURS.some(([v]) => v === durMin) ? '' : `<option value="${durMin}" selected>${durMin} min</option>`);
  const curType = svcKey(ev && ev.service);
  const typeOpts = `<option value="">Select job type</option>` + jobTypeOptions().map(([k, l]) => `<option value="${k}" ${k === curType ? 'selected' : ''}>${esc(l)}</option>`).join('');
  $('#sheet-body').innerHTML = `
    <label class="form-field"><span>Title</span><input id="ev-title" type="text" value="${esc((ev && ev.title) || '')}" placeholder="e.g. Logbook service - Toyota" /></label>
    <label class="form-field"><span>Job type</span><select id="ev-type" class="form-sel">${typeOpts}</select></label>
    <div class="row-2">${fld('Date', 'ev-date', 'date', dateVal)}${fld('Start time', 'ev-time', 'time', timeVal)}</div>
    <label class="form-field"><span>Duration</span><select id="ev-dur" class="form-sel">${durOpts}</select></label>
    <div class="row-2">${fld('Customer', 'ev-cust', 'text', ev && ev.customer_name)}${fld('Phone', 'ev-phone', 'tel', ev && ev.customer_phone)}</div>
    <div class="row-2">${fld('Rego', 'ev-rego', 'text', ev && ev.vehicle_rego)}${fld('Suburb', 'ev-suburb', 'text', ev && ev.suburb)}</div>
    <label class="form-field"><span>Address</span><input id="ev-address" type="text" value="${esc((ev && ev.address) || '')}" placeholder="12 Smith St, Sunnybank" /></label>
    <label class="form-field"><span>Notes</span><textarea id="ev-notes" rows="2">${esc((ev && ev.notes) || '')}</textarea></label>
    ${isEdit && (ev.customer_phone || ev.customer_name || ev.vehicle_rego) ? `
    <div style="font-size:12px;font-weight:600;color:var(--subtle);margin:8px 2px 2px">Quick actions for this customer</div>
    <div class="actions">
      ${ev.customer_phone ? `<a class="btn ghost" href="tel:${esc((ev.customer_phone || '').replace(/\s/g, ''))}"><i data-lucide="phone"></i>Call</a>` : ''}
      ${ev.customer_phone ? `<button type="button" class="btn ghost" id="ev-msg"><i data-lucide="message-circle"></i>Message</button>` : ''}
      <button type="button" class="btn ghost" id="ev-invoice"><i data-lucide="file-text"></i>Invoice</button>
      <button type="button" class="btn ghost" id="ev-inspection"><i data-lucide="clipboard-check"></i>Inspection</button>
    </div>` : ''}
    <div class="actions">
      <button class="btn primary full" id="ev-save"><i data-lucide="check"></i>${isEdit ? 'Save changes' : 'Add to calendar'}</button>
      ${isEdit ? `<button class="btn ghost full danger-text" id="ev-del"><i data-lucide="trash-2"></i>Delete booking</button>` : ''}
    </div>
  `;
  openSheet(); icons();
  // Selecting a job type fills an empty title with that type's label.
  $('#ev-type').addEventListener('change', (e) => {
    const t = $('#ev-title');
    if (!t.value.trim() && e.target.value) t.value = svcLabel(e.target.value);
  });
  $('#ev-save').addEventListener('click', saveEvent);
  if (isEdit) {
    $('#ev-del').addEventListener('click', () => deleteEvent(ev.id));
    // Quick actions reuse the booking's own customer data.
    const evParams = () => new URLSearchParams({ name: ev.customer_name || '', phone: ev.customer_phone || '', suburb: ev.suburb || '', address: ev.address || '', rego: ev.vehicle_rego || '' }).toString();
    const eMsg = $('#ev-msg'); if (eMsg) eMsg.addEventListener('click', () => openMessageFor(ev.customer_name, ev.customer_phone, () => openEvent(ev)));
    const eInv = $('#ev-invoice'); if (eInv) eInv.addEventListener('click', () => { location.href = 'invoice/index.html?' + evParams(); });
    const eIns = $('#ev-inspection'); if (eIns) eIns.addEventListener('click', () => { location.href = 'inspection/index.html?' + evParams(); });
  }
}
async function saveEvent() {
  const title = $('#ev-title').value.trim();
  if (!title) return toast('Add a title', 'err');
  const date = $('#ev-date').value, time = $('#ev-time').value;
  if (!date || !time) return toast('Pick a date and start time', 'err');
  const start = new Date(date + 'T' + time);
  const durMin = parseInt($('#ev-dur').value, 10) || 60;
  const row = {
    title,
    service: $('#ev-type').value || null,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + durMin * 60000).toISOString(),
    customer_name: $('#ev-cust').value.trim() || null,
    customer_phone: $('#ev-phone').value.trim() || null,
    vehicle_rego: $('#ev-rego').value.trim() || null,
    suburb: $('#ev-suburb').value.trim() || null,
    address: $('#ev-address').value.trim() || null,
    notes: $('#ev-notes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const btn = $('#ev-save'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Saving...';
  try {
    const save = (r) => STATE.editEventId
      ? sb.from('calendar_events').update(r).eq('id', STATE.editEventId)
      : sb.from('calendar_events').insert(r);
    let { error } = await save(row);
    // Forward-compatible: drop the address column and retry if it is not in the
    // DB yet (before the schema migration is applied).
    if (error && /address/i.test(error.message) && /column/i.test(error.message)) {
      delete row.address;
      ({ error } = await save(row));
    }
    if (error) throw error;
    await loadEvents(); toast('Booking saved', 'ok'); closeSheet(); STATE.view = 'calendar'; setView('calendar');
  } catch (e) { toast('Save failed: ' + String(e.message || e).slice(0, 50), 'err'); btn.disabled = false; btn.innerHTML = 'Save'; icons(); }
}
async function deleteEvent(id) {
  if (!confirm('Delete this booking?')) return;
  try { const { error } = await sb.from('calendar_events').delete().eq('id', id); if (error) throw error; await loadEvents(); toast('Booking deleted', 'ok'); closeSheet(); renderCalendar(); icons(); }
  catch (e) { toast('Delete failed', 'err'); }
}
/* Reorder within a day: swap this booking's time slot with its neighbour
   (dir -1 = earlier, +1 = later), keeping each booking's own duration. Lets the
   owner shuffle a job to the morning without retyping any times. */
async function moveEvent(id, dir) {
  const ev = STATE.events.find((x) => x.id === id);
  if (!ev) return;
  const day = STATE.events
    .filter((x) => sameDay(x.starts_at, ev.starts_at))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const idx = day.findIndex((x) => x.id === id);
  const swap = day[idx + dir];
  if (!swap) return;
  const durA = ev.ends_at ? (new Date(ev.ends_at) - new Date(ev.starts_at)) : 3600000;
  const durB = swap.ends_at ? (new Date(swap.ends_at) - new Date(swap.starts_at)) : 3600000;
  const startA = new Date(swap.starts_at); // ev takes the neighbour's start
  const startB = new Date(ev.starts_at);   // neighbour takes ev's start
  const now = new Date().toISOString();
  const rowA = { starts_at: startA.toISOString(), ends_at: new Date(startA.getTime() + durA).toISOString(), updated_at: now };
  const rowB = { starts_at: startB.toISOString(), ends_at: new Date(startB.getTime() + durB).toISOString(), updated_at: now };
  Object.assign(ev, rowA); Object.assign(swap, rowB); // optimistic
  renderCalendar(); icons();
  try {
    const r1 = await sb.from('calendar_events').update(rowA).eq('id', ev.id);
    const r2 = await sb.from('calendar_events').update(rowB).eq('id', swap.id);
    if (r1.error || r2.error) throw (r1.error || r2.error);
  } catch (err) { toast('Could not reorder', 'err'); await loadEvents(); renderCalendar(); icons(); }
}
function eventFromSubmission(s) {
  const start = s.preferred_date ? new Date(s.preferred_date + 'T09:00:00') : (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; })();
  const sv = svc(s.service_needed);
  return {
    title: sv.label + ' - ' + (s.full_name || 'Customer'),
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600000).toISOString(),
    customer_name: s.full_name, customer_phone: s.phone, vehicle_rego: s.vehicle_rego, suburb: s.suburb,
    address: s.address || null,
    service: s.service_needed || null, notes: s.symptoms || '',
  };
}

/* ----------------------------------------------------------- message sheet -- */
function openMessage(id) {
  const s = STATE.rows.find((r) => r.id === id);
  if (!s) return;
  STATE.activeId = id;
  openMessageFor(s.full_name, s.phone, () => openDetail(id));
}
// Generic SMS-template sheet, reusable from an inquiry or a calendar booking.
function openMessageFor(fullName, phone, back) {
  if (!phone) return toast('No phone number on file', 'err');
  STATE.msgTmpl = 'website';
  const first = firstName(fullName);
  const tel = phone.replace(/\s/g, '');
  $('#sheet-title').textContent = 'Message ' + first;
  $('#sheet-sub').textContent = 'Opens your messaging app, pre-filled';
  const keys = Object.keys(MSG_TEMPLATES);
  const buildMsg = (tmpl, price) => MSG_TEMPLATES[tmpl].build(first, price || MSG_TEMPLATES[tmpl].price);
  $('#sheet-body').innerHTML = `
    <button class="btn ghost" id="msg-back" style="margin-bottom:14px;width:auto;display:inline-flex"><i data-lucide="chevron-left"></i>Back</button>
    <div class="reply-to">To <b>${esc(phone)}</b></div>
    <div class="tmpl-seg" id="msg-seg">${keys.map((k) => `<button data-mt="${k}" class="${k === 'website' ? 'active' : ''}">${MSG_TEMPLATES[k].label}</button>`).join('')}</div>
    <div class="price-row" id="msg-price-row" style="display:none"><label>Price</label><div class="pin"><span>$</span><input id="msg-price" type="number" inputmode="numeric" value="${CONFIG.DEFAULT_SERVICE_PRICE}" /></div></div>
    <textarea class="composer" id="msg-body">${esc(buildMsg('website', ''))}</textarea>
    <div class="actions"><a class="btn primary full" id="msg-send"><i data-lucide="send"></i>Open in Messages</a></div>
    <p style="font-size:12px;color:var(--subtle);margin-top:10px;text-align:center">The website-link message takes the customer to our form, so their details land straight in the system.</p>
  `;
  openSheet(); icons();
  const updateHref = () => { $('#msg-send').setAttribute('href', `sms:${tel}?&body=${encodeURIComponent($('#msg-body').value)}`); };
  const refreshBody = () => { $('#msg-body').value = buildMsg(STATE.msgTmpl, $('#msg-price') ? $('#msg-price').value : ''); updateHref(); };
  updateHref();
  $('#msg-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mt]'); if (!b) return;
    STATE.msgTmpl = b.dataset.mt;
    document.querySelectorAll('#msg-seg button').forEach((x) => x.classList.toggle('active', x === b));
    const needsPrice = STATE.msgTmpl === 'service' || STATE.msgTmpl === 'diagnostic';
    $('#msg-price-row').style.display = needsPrice ? 'flex' : 'none';
    if (needsPrice) $('#msg-price').value = MSG_TEMPLATES[STATE.msgTmpl].price;
    refreshBody();
  });
  $('#msg-price').addEventListener('input', refreshBody);
  $('#msg-body').addEventListener('input', updateHref);
  $('#msg-back').addEventListener('click', back);
}

/* --------------------------------------------------- invoice/inspection log -- */
function pdfUrl(bucket, path) { if (!path) return ''; return CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/' + bucket + '/' + path; }
function monthKey(iso) { const d = new Date(iso); return d.getFullYear() + '-' + d.getMonth(); }
function monthLabel(iso) { return new Date(iso).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }); }
function groupByMonth(rows) {
  const groups = [], map = {};
  rows.forEach((r) => { const k = monthKey(r.created_at); if (!map[k]) { map[k] = { label: monthLabel(r.created_at), items: [] }; groups.push(map[k]); } map[k].items.push(r); });
  return groups;
}
function searchBar(id, value, ph) {
  return `<div class="search-bar"><i data-lucide="search"></i><input id="${id}" type="search" placeholder="${ph}" value="${esc(value)}" autocomplete="off" /></div>`;
}
const SKEL = '<div class="list">' + '<div class="skeleton" style="height:66px;margin-bottom:10px"></div>'.repeat(4) + '</div>';

async function renderInvoices() {
  const el = $('#view-invoices');
  el.innerHTML = `<div class="view-head"><h2>Invoices</h2><div class="meta" id="inv-meta"></div></div>${searchBar('inv-search', STATE.invSearch, 'Search name, rego or number')}<div id="inv-list">${SKEL}</div>`;
  icons();
  $('#inv-search').addEventListener('input', (e) => { STATE.invSearch = e.target.value; drawInvList(); });
  try {
    const { data, error } = await sb.from('invoices').select('*').order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    STATE.invoices = data || [];
    drawInvList();
  } catch (e) {
    STATE.invoices = null;
    $('#inv-list').innerHTML = emptyHtml('file-text', 'Not set up yet', 'Run owner-app-schema.sql in Supabase, then saved invoices appear here.');
    icons();
  }
}
function drawInvList() {
  const q = (STATE.invSearch || '').toLowerCase();
  let rows = STATE.invoices || [];
  if (q) rows = rows.filter((r) => [r.customer_name, r.vehicle_rego, r.invoice_number, r.vehicle].some((v) => (v || '').toString().toLowerCase().includes(q)));
  $('#inv-meta').textContent = rows.length + (rows.length === 1 ? ' invoice' : ' invoices');
  const cont = $('#inv-list');
  if (!rows.length) { cont.innerHTML = emptyHtml('file-text', q ? 'No matches' : 'No invoices yet', q ? 'Try a different search.' : 'Create one from a customer and it is logged here.'); icons(); return; }
  cont.innerHTML = groupByMonth(rows).map((g) => `<div class="log-month">${esc(g.label)}</div><div class="list">${g.items.map(invRow).join('')}</div>`).join('');
  icons();
}
function payPill(s) {
  if (!s) return '';
  const cls = s === 'paid' ? 'pp-paid' : s === 'partial' ? 'pp-partial' : 'pp-out';
  return `<span class="paypill ${cls}">${esc(s.charAt(0).toUpperCase() + s.slice(1))}</span>`;
}
function invRow(r) {
  const view = pdfUrl(CONFIG.STORAGE.invoices, r.pdf_path);
  return `<div class="logrow">
    <div class="logrow__main">
      <div class="name">${esc(r.customer_name || 'Customer')}${r.total != null ? ' · $' + esc(r.total) : ''}</div>
      <div class="line">${r.vehicle_rego ? `<span class="rego">${esc(r.vehicle_rego)}</span> ` : ''}${payPill(r.status)}</div>
    </div>
    <div class="logrow__acts">
      <button class="logbtn" data-inv-view="${esc(view)}" aria-label="View"><i data-lucide="eye"></i></button>
      <button class="logbtn" data-inv-edit="${r.id}" aria-label="Edit"><i data-lucide="pencil"></i></button>
      <button class="logbtn" data-inv-send="${r.id}" aria-label="Send"><i data-lucide="send"></i></button>
      <button class="logbtn danger" data-inv-del="${r.id}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
    </div>
  </div>`;
}

async function renderInspections() {
  const el = $('#view-inspections');
  el.innerHTML = `<div class="view-head"><h2>Inspection reports</h2><div class="meta" id="insp-meta"></div></div>${searchBar('insp-search', STATE.inspSearch, 'Search name, rego or number')}<div id="insp-list">${SKEL}</div>`;
  icons();
  $('#insp-search').addEventListener('input', (e) => { STATE.inspSearch = e.target.value; drawInspList(); });
  try {
    const { data, error } = await sb.from('inspection_reports').select('*').order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    STATE.inspections = data || [];
    drawInspList();
  } catch (e) {
    STATE.inspections = null;
    $('#insp-list').innerHTML = emptyHtml('clipboard-check', 'Not set up yet', 'Run owner-app-schema.sql in Supabase, then saved reports appear here.');
    icons();
  }
}
function drawInspList() {
  const q = (STATE.inspSearch || '').toLowerCase();
  let rows = STATE.inspections || [];
  if (q) rows = rows.filter((r) => [r.customer_name, r.vehicle_rego, r.report_number, r.vehicle].some((v) => (v || '').toString().toLowerCase().includes(q)));
  $('#insp-meta').textContent = rows.length + (rows.length === 1 ? ' report' : ' reports');
  const cont = $('#insp-list');
  if (!rows.length) { cont.innerHTML = emptyHtml('clipboard-check', q ? 'No matches' : 'No reports yet', q ? 'Try a different search.' : 'Create one from a customer and it is logged here.'); icons(); return; }
  cont.innerHTML = groupByMonth(rows).map((g) => `<div class="log-month">${esc(g.label)}</div><div class="list">${g.items.map(inspRow).join('')}</div>`).join('');
  icons();
}
function inspRow(r) {
  const view = pdfUrl(CONFIG.STORAGE.inspections, r.pdf_path);
  return `<div class="logrow">
    <div class="logrow__main">
      <div class="name">${esc(r.customer_name || 'Customer')}${r.overall_rating ? ' · ' + esc(r.overall_rating) : ''}</div>
      <div class="line">${r.vehicle_rego ? `<span class="rego">${esc(r.vehicle_rego)}</span> ` : ''}${esc(r.vehicle || '')}</div>
    </div>
    <div class="logrow__acts">
      <button class="logbtn" data-insp-view="${esc(view)}" aria-label="View"><i data-lucide="eye"></i></button>
      <button class="logbtn" data-insp-edit="${r.id}" aria-label="Edit"><i data-lucide="pencil"></i></button>
      <button class="logbtn" data-insp-send="${r.id}" aria-label="Send"><i data-lucide="send"></i></button>
      <button class="logbtn danger" data-insp-del="${r.id}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
    </div>
  </div>`;
}

async function deleteLog(kind, table, bucket, id) {
  if (!confirm('Delete this permanently? This cannot be undone.')) return;
  const arr = kind === 'invoices' ? STATE.invoices : STATE.inspections;
  const rec = (arr || []).find((r) => r.id === id);
  try {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
    if (rec && rec.pdf_path) {
      // best effort; needs the storage delete policy to actually remove the file
      try {
        await fetch(CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(rec.pdf_path),
          { method: 'DELETE', headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: 'Bearer ' + CONFIG.SUPABASE_KEY } });
      } catch (_) {}
    }
    if (kind === 'invoices') { STATE.invoices = (STATE.invoices || []).filter((r) => r.id !== id); drawInvList(); }
    else { STATE.inspections = (STATE.inspections || []).filter((r) => r.id !== id); drawInspList(); }
    toast('Deleted', 'ok');
  } catch (e) {
    toast('Delete failed: ' + String((e && e.message) || e).slice(0, 50), 'err');
  }
}

/* ------------------------------------------------------------ gmail (GIS) -- */
let tokenClient = null, tokenResolver = null;
// Shared token cache (same key as gmail-send.js) so a consent granted on a
// generator page is reused here and vice-versa, for the token's lifetime.
const TOK_KEY = 'mmqld_gtok';
function cachedGToken() { try { const o = JSON.parse(sessionStorage.getItem(TOK_KEY) || 'null'); if (o && o.t && Date.now() < o.e) return o; } catch (_) {} return null; }
function getToken() {
  return new Promise((resolve, reject) => {
    if (STATE.gtoken && Date.now() < STATE.gexp) return resolve(STATE.gtoken);
    const c = cachedGToken(); if (c) { STATE.gtoken = c.t; STATE.gexp = c.e; return resolve(STATE.gtoken); }
    if (!window.google || !google.accounts || !google.accounts.oauth2) return reject(new Error('Google sign-in still loading, try again'));
    if (CONFIG.GOOGLE_CLIENT_ID.startsWith('PASTE_')) return reject(new Error('Set GOOGLE_CLIENT_ID in config.js'));
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
        callback: (resp) => {
          if (resp.error) return tokenResolver && tokenResolver.reject(new Error(resp.error));
          STATE.gtoken = resp.access_token;
          STATE.gexp = Date.now() + ((resp.expires_in || 3600) - 60) * 1000;
          try { sessionStorage.setItem(TOK_KEY, JSON.stringify({ t: STATE.gtoken, e: STATE.gexp })); } catch (_) {}
          tokenResolver && tokenResolver.resolve(STATE.gtoken);
        },
      });
    }
    tokenResolver = { resolve, reject };
    // Empty prompt: consent screen only if not already granted, then silent.
    tokenClient.requestAccessToken({ prompt: '' });
  });
}
async function gFetch(path, opts = {}) {
  const t = await getToken();
  const r = await fetch('https://gmail.googleapis.com/gmail/v1' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('Gmail ' + r.status);
  return r.json();
}
function b64url(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function u8b64(str) { return btoa(unescape(encodeURIComponent(str))); }
// Email headers must be ASCII; encode non-ASCII (e.g. em-dash, middot) per RFC 2047.
function encHeader(str) { return /[^\x00-\x7F]/.test(str) ? '=?UTF-8?B?' + u8b64(str) + '?=' : str; }

async function findThread(email, rego) {
  const tryQ = async (q) => (await gFetch('/users/me/messages?maxResults=10&q=' + encodeURIComponent(q))).messages || [];
  let msgs = email ? await tryQ('"' + email + '"') : [];
  if (!msgs.length && rego) msgs = await tryQ('"' + rego + '"');
  if (!msgs.length) return null;
  let best = null;
  for (const m of msgs) {
    const meta = await gFetch('/users/me/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID');
    const h = {}; (meta.payload.headers || []).forEach((x) => (h[x.name.toLowerCase()] = x.value));
    const rec = { threadId: meta.threadId, messageId: h['message-id'], subject: h['subject'] || '' };
    if (/new booking|quote request|booking request/i.test(rec.subject)) { best = rec; break; }
    if (!best) best = rec;
  }
  return best;
}
async function sendThreaded(to, body, found) {
  let subject = found && found.subject ? found.subject : 'Your enquiry with ' + CONFIG.BUSINESS_NAME;
  if (!/^re:/i.test(subject)) subject = 'Re: ' + subject;
  const lines = ['To: ' + to, 'Subject: ' + encHeader(subject), 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'];
  if (found && found.messageId) { lines.push('In-Reply-To: ' + found.messageId); lines.push('References: ' + found.messageId); }
  const raw = b64url(lines.join('\r\n') + '\r\n\r\n' + u8b64(body));
  const payload = { raw };
  if (found && found.threadId) payload.threadId = found.threadId;
  return gFetch('/users/me/messages/send', { method: 'POST', body: JSON.stringify(payload) });
}

// Fetch a stored PDF from the public bucket and return it as base64.
async function fetchPdfBase64(bucket, path) {
  const url = CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/' + bucket + '/' + path + '?t=' + Date.now();
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('PDF fetch ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}
// Send an already-stored PDF (invoice/report) to the customer as an attachment,
// threaded into their Gmail conversation when one is found.
async function sendAttachment(to, subject, bodyText, filename, pdfBase64, found) {
  const boundary = 'mmqld_' + Math.random().toString(36).slice(2);
  let subj = found && found.subject ? (/^re:/i.test(found.subject) ? found.subject : 'Re: ' + found.subject) : subject;
  const head = ['To: ' + to, 'Subject: ' + encHeader(subj), 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"'];
  if (found && found.messageId) { head.push('In-Reply-To: ' + found.messageId); head.push('References: ' + found.messageId); }
  const body = [
    '--' + boundary, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', u8b64(bodyText), '',
    '--' + boundary, 'Content-Type: application/pdf; name="' + filename + '"', 'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="' + filename + '"', '', pdfBase64, '', '--' + boundary + '--', '',
  ];
  const raw = b64url(head.join('\r\n') + '\r\n\r\n' + body.join('\r\n'));
  const payload = { raw };
  if (found && found.threadId) payload.threadId = found.threadId;
  return gFetch('/users/me/messages/send', { method: 'POST', body: JSON.stringify(payload) });
}
async function sendStoredDoc(kind, r) {
  const isInv = kind === 'invoices';
  const email = r.customer_email;
  if (!email) return toast('No email on file. Open Edit to add one, then send.', 'err');
  if (!r.pdf_path) return toast('No PDF stored for this one', 'err');
  if (!confirm('Send this ' + (isInv ? 'invoice' : 'report') + ' to ' + email + '?')) return;
  toast('Sending to client...');
  try {
    const bucket = isInv ? CONFIG.STORAGE.invoices : CONFIG.STORAGE.inspections;
    const b64 = await fetchPdfBase64(bucket, r.pdf_path);
    const first = firstName(r.customer_name) || 'there';
    const subject = (isInv ? 'Invoice from ' : 'Inspection report from ') + CONFIG.BUSINESS_NAME;
    const num = (r.invoice_number || r.report_number || 'mmqld').toString().replace(/[^A-Za-z0-9_-]/g, '');
    const filename = (isInv ? 'invoice-' : 'inspection-') + num + '.pdf';
    const bodyText = `Hi ${first},\n\nPlease find your ${isInv ? 'invoice' : 'inspection report'} attached. Let me know if you have any questions.\n\nThank you,\nAshley\n${CONFIG.BUSINESS_NAME}\n${CONFIG.BUSINESS_PHONE}`;
    const found = await findThread(email, r.vehicle_rego);
    await sendAttachment(email, subject, bodyText, filename, b64, found);
    toast('Sent to client', 'ok');
  } catch (e) { toast(String((e && e.message) || e).slice(0, 60), 'err'); }
}

/* ------------------------------------------------------------------ wire -- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav button'); if (nav) return setView(nav.dataset.view);
  const side = e.target.closest('#sidebar-nav button[data-view]'); if (side) return setView(side.dataset.view);
  // Invoice log actions
  const invView = e.target.closest('[data-inv-view]'); if (invView) { const u = invView.dataset.invView; u ? window.open(u, '_blank') : toast('PDF not available'); return; }
  const invEdit = e.target.closest('[data-inv-edit]'); if (invEdit) { location.href = 'invoice/index.html?edit=' + encodeURIComponent(invEdit.dataset.invEdit); return; }
  const invSend = e.target.closest('[data-inv-send]'); if (invSend) { const r = (STATE.invoices || []).find((x) => x.id === invSend.dataset.invSend); if (r) sendStoredDoc('invoices', r); return; }
  const invDel = e.target.closest('[data-inv-del]'); if (invDel) { deleteLog('invoices', 'invoices', CONFIG.STORAGE.invoices, invDel.dataset.invDel); return; }
  // Inspection log actions
  const inspView = e.target.closest('[data-insp-view]'); if (inspView) { const u = inspView.dataset.inspView; u ? window.open(u, '_blank') : toast('PDF not available'); return; }
  const inspEdit = e.target.closest('[data-insp-edit]'); if (inspEdit) { location.href = 'inspection/index.html?edit=' + encodeURIComponent(inspEdit.dataset.inspEdit); return; }
  const inspSend = e.target.closest('[data-insp-send]'); if (inspSend) { const r = (STATE.inspections || []).find((x) => x.id === inspSend.dataset.inspSend); if (r) sendStoredDoc('inspections', r); return; }
  const inspDel = e.target.closest('[data-insp-del]'); if (inspDel) { deleteLog('inspections', 'inspection_reports', CONFIG.STORAGE.inspections, inspDel.dataset.inspDel); return; }
  const row = e.target.closest('.row[data-id]'); if (row) return openDetail(row.dataset.id);
  const mvUp = e.target.closest('[data-move-up]'); if (mvUp) { e.stopPropagation(); moveEvent(mvUp.dataset.moveUp, -1); return; }
  const mvDn = e.target.closest('[data-move-down]'); if (mvDn) { e.stopPropagation(); moveEvent(mvDn.dataset.moveDown, 1); return; }
  const evEl = e.target.closest('.event[data-ev]'); if (evEl) { const ev = STATE.events.find((x) => x.id === evEl.dataset.ev); if (ev) openEvent(ev); return; }
  const chip = e.target.closest('.chip[data-range]'); if (chip) { STATE.inqRange = chip.dataset.range; renderInquiries(); icons(); return; }
  const per = e.target.closest('.seg button[data-period]'); if (per) { STATE.period = per.dataset.period; renderAnalytics(); icons(); return; }
  const cv = e.target.closest('#cal-seg button[data-cv]'); if (cv) { STATE.calView = cv.dataset.cv; renderCalendar(); icons(); return; }
  if (e.target.closest('#cal-prev')) { STATE.calRef = addDays(STATE.calRef || new Date(), STATE.calView === 'day' ? -1 : -7); renderCalendar(); icons(); return; }
  if (e.target.closest('#cal-next')) { STATE.calRef = addDays(STATE.calRef || new Date(), STATE.calView === 'day' ? 1 : 7); renderCalendar(); icons(); return; }
  if (e.target.closest('#cal-today')) { STATE.calRef = new Date(); renderCalendar(); icons(); return; }
  if (e.target.closest('#cal-add')) return openEvent(null);
  if (e.target.closest('#see-all')) return setView('inquiries');
});
$('#scrim').addEventListener('click', closeSheet);
$('#sheet-close').addEventListener('click', closeSheet);
$('#side-scrim').addEventListener('click', closeSidebar);
$('#btn-menu').addEventListener('click', openSidebar);
$('#btn-refresh').addEventListener('click', () => { loadData(false); toast('Refreshed'); });

/* gate (optional) + boot */
function boot() {
  icons();
  loadData();
  setInterval(() => loadData(false), 60000);
  // NOTE: we deliberately do NOT register a service worker. A controlling SW
  // triggers an iOS WebKit bug where cross-origin POSTs (PDF uploads) fail with
  // "Load failed". The kill-switch in each page's <head> removes any old one.
}
if (CONFIG.GATE_PIN) {
  const pin = prompt('Enter passcode');
  if (pin === CONFIG.GATE_PIN) boot();
  else document.body.innerHTML = '<div class="empty" style="padding-top:120px"><h3>Locked</h3><p>Wrong passcode. Refresh to try again.</p></div>';
} else {
  boot();
}
