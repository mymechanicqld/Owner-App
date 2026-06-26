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
  loaded: false,
  inqRange: '48h',
  period: 'daily',
  search: '',
  activeId: null,
  replyTmpl: 'service',
  gtoken: null,
  gexp: 0,
};

/* --------------------------------------------------------------- helpers -- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svc = (slug) => SERVICES[slug] || { label: slug ? slug.replace(/-/g, ' ') : 'Enquiry', icon: 'mail' };
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
  render();
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
  $('.main').scrollTop = 0;
  render();
  icons();
}
function render() {
  if (STATE.view === 'dashboard') renderDashboard();
  else if (STATE.view === 'inquiries') renderInquiries();
  else if (STATE.view === 'search') renderSearch();
  else if (STATE.view === 'analytics') renderAnalytics();
  icons();
}

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
    ${field('car-front', 'Vehicle', [esc(carDesc(s)), s.vehicle_rego ? `<span class="rego">${esc(s.vehicle_rego)}</span>` : ''].filter(Boolean).join(' '))}
    ${field('wrench', 'Service', esc(sv.label))}
    ${field('calendar-days', 'Preferred date', s.preferred_date ? fmtDate(s.preferred_date) : '')}
    ${s.symptoms ? `<div class="field notes"><div class="fic"><i data-lucide="message-square"></i></div><div><div class="fl">Notes</div><div class="fv">${esc(s.symptoms)}</div></div></div>` : ''}
    ${field('clock', 'Submitted', fmtDateTime(s.created_at))}
    <div class="field"><div class="fic"><i data-lucide="flag"></i></div><div style="flex:1"><div class="fl">Status</div>
      <select id="status-sel" class="composer" style="min-height:auto;padding:10px 12px;margin-top:4px;font-weight:700">
        ${STATUSES.map((st) => `<option value="${st}" ${st === s.status ? 'selected' : ''}>${STATUS_LABEL[st]}</option>`).join('')}
      </select></div></div>
    <div class="actions">
      <button class="btn primary full" id="act-reply"><i data-lucide="send"></i>Reply by email</button>
      ${s.phone ? `<a class="btn ghost" href="tel:${esc(tel)}"><i data-lucide="phone"></i>Call</a>` : ''}
      ${s.phone ? `<a class="btn ghost" href="sms:${esc(tel)}"><i data-lucide="message-circle"></i>Text</a>` : '<a class="btn ghost full" href="mailto:'+esc(s.email)+'"><i data-lucide="mail"></i>Open in mail</a>'}
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

/* ------------------------------------------------------------ gmail (GIS) -- */
let tokenClient = null, tokenResolver = null;
function getToken() {
  return new Promise((resolve, reject) => {
    if (STATE.gtoken && Date.now() < STATE.gexp) return resolve(STATE.gtoken);
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
          tokenResolver && tokenResolver.resolve(STATE.gtoken);
        },
      });
    }
    tokenResolver = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: STATE.gtoken ? '' : 'consent' });
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
  const lines = ['To: ' + to, 'Subject: ' + subject, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"'];
  if (found && found.messageId) { lines.push('In-Reply-To: ' + found.messageId); lines.push('References: ' + found.messageId); }
  const raw = b64url(lines.join('\r\n') + '\r\n\r\n' + body);
  const payload = { raw };
  if (found && found.threadId) payload.threadId = found.threadId;
  return gFetch('/users/me/messages/send', { method: 'POST', body: JSON.stringify(payload) });
}

/* ------------------------------------------------------------------ wire -- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav button'); if (nav) return setView(nav.dataset.view);
  const row = e.target.closest('.row[data-id]'); if (row) return openDetail(row.dataset.id);
  const chip = e.target.closest('.chip[data-range]'); if (chip) { STATE.inqRange = chip.dataset.range; renderInquiries(); icons(); return; }
  const per = e.target.closest('.seg button[data-period]'); if (per) { STATE.period = per.dataset.period; renderAnalytics(); icons(); return; }
  if (e.target.closest('#see-all')) return setView('inquiries');
});
$('#scrim').addEventListener('click', closeSheet);
$('#sheet-close').addEventListener('click', closeSheet);
$('#btn-refresh').addEventListener('click', () => { loadData(false); toast('Refreshed'); });

/* gate (optional) + boot */
function boot() {
  icons();
  loadData();
  setInterval(() => loadData(false), 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (CONFIG.GATE_PIN) {
  const pin = prompt('Enter passcode');
  if (pin === CONFIG.GATE_PIN) boot();
  else document.body.innerHTML = '<div class="empty" style="padding-top:120px"><h3>Locked</h3><p>Wrong passcode. Refresh to try again.</p></div>';
} else {
  boot();
}
