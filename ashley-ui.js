/* ============================================================================
   Ashley - the chat screen
   ----------------------------------------------------------------------------
   Built once and kept alive, so switching to the calendar and back does not
   wipe the conversation. The last conversation is also saved on the phone, so
   closing the app and reopening it picks up where it left off.

   Written for someone reading this one-handed on a phone, between jobs. Plain
   words everywhere: "Checking the calendar", never "calling list_bookings".
   ========================================================================== */
(function () {
  'use strict';

  const LOG_KEY = 'mmqld_ashley_log';
  const MAX_SAVED = 40;

  let built = false;
  let busy = false;
  let controller = null;
  let history = [];          // what the model sees next turn
  let log = [];              // what the owner sees: {who:'me'|'her'|'note', text}

  const el = (s) => document.querySelector(s);

  const STARTERS = [
    "What's on today?",
    'Any new enquiries?',
    'Who still owes me money?',
    "What's my week look like?",
  ];

  /* House style: no dashes standing in for punctuation, in the chat or in
     anything she writes for a customer. The model is told this too, but it
     slips, so the text is cleaned on the way in as well. */
  const deDash = (t) => String(t == null ? '' : t)
    .replace(/\s+[\u2014\u2013]\s+/g, ', ')
    .replace(/[\u2014\u2013]/g, '-');

  /* ------------------------------------------------------------ markdown -- */
  /* Ashley replies in light markdown. Escape first, then allow only bold,
     italic and bullets, so nothing she writes can inject markup. */
  function md(src) {
    const safe = esc(deDash(src));
    const lines = safe.split('\n');
    let out = '', list = false;
    const inline = (t) => t
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    lines.forEach((raw) => {
      const line = raw.trimEnd();
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      if (bullet) {
        if (!list) { out += '<ul>'; list = true; }
        out += '<li>' + inline(bullet[1]) + '</li>';
        return;
      }
      if (list) { out += '</ul>'; list = false; }
      if (line.trim()) out += '<p>' + inline(line) + '</p>';
    });
    if (list) out += '</ul>';
    return out || '<p>' + safe + '</p>';
  }

  /* --------------------------------------------------------------- build -- */

  function renderAshley() {
    const view = el('#view-ashley');
    if (!built) {
      view.innerHTML = `
        <div class="ash">
          <div class="ash__log" id="ash-log">
            <div class="ash__msgs" id="ash-msgs"></div>
            <div class="ash__tmp" id="ash-tmp"></div>
          </div>
          <form class="ash__bar" id="ash-form">
            <textarea id="ash-in" rows="1" placeholder="Ask Ashley anything" autocomplete="off"
                      autocapitalize="sentences" enterkeyhint="send"></textarea>
            <button type="submit" class="ash__send" id="ash-send" aria-label="Send"><i data-lucide="arrow-up"></i></button>
          </form>
        </div>`;
      built = true;
      wire();
      restore();
    }
    /* This also runs on the app's background refresh. Only follow the bottom
       if he was already there, so a repaint never yanks him away from
       something he is part way through reading. */
    const box = el('#ash-log');
    const stick = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    paint();
    if (stick) setTimeout(() => scrollDown(false), 30);
  }

  function wire() {
    const input = el('#ash-in');
    const form = el('#ash-form');

    /* Grow with the text, up to a sensible cap. */
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 132) + 'px'; };
    input.addEventListener('input', grow);

    /* On a phone the Enter key should send, because there is a visible send
       button for the rare multi-line message and a newline key is a nuisance. */
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return stop();
      const q = input.value.trim();
      if (!q) return;
      input.value = ''; grow();
      send(q);
    });

    el('#ash-log').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-starter]');
      if (chip) { send(chip.dataset.starter); return; }
      const screen = e.target.closest('[data-ash-screen]');
      if (screen) { setView(screen.dataset.ashScreen); return; }
      const clear = e.target.closest('#ash-clear');
      if (clear) { history = []; log = []; save(); paint(); return; }
    });
  }

  /* --------------------------------------------------------------- paint -- */

  function empty() {
    return `
      <div class="ash-hello">
        <div class="ash-face"><i data-lucide="sparkles"></i></div>
        <h3>Hi, I'm Ashley</h3>
        <p>Ask me about your day, your customers, your invoices or your inbox. I can book jobs in,
           chase up payments and send invoices out for you.</p>
        <div class="ash-starters">
          ${STARTERS.map((s) => `<button class="ash-starter" data-starter="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>`;
  }

  /* Only ever touches #ash-msgs. The thinking strip and any open confirmation
     card live in #ash-tmp, because the app refreshes its data in the
     background every minute and that re-renders the active view: rebuilding
     the whole log would delete a confirmation card out from under the owner
     mid-decision, and the agent would wait for an answer that can never come. */
  function paint() {
    const box = el('#ash-msgs');
    if (!box) return;
    if (!log.length) { box.innerHTML = empty(); icons(); return; }
    /* The reset button is hidden mid-answer, or it lands above the thinking
       strip and looks like part of the reply. */
    box.innerHTML = log.map(bubble).join('') + (busy ? ''
      : `<button class="ash-clear" id="ash-clear"><i data-lucide="eraser"></i>Start a new conversation</button>`);
    icons();
  }

  function bubble(m) {
    if (m.who === 'me') return `<div class="ash-msg me">${esc(m.text)}</div>`;
    if (m.who === 'err') return `<div class="ash-err"><i data-lucide="triangle-alert"></i><span>${esc(m.text)}</span></div>`;
    if (m.who === 'note') return `<div class="ash-note">${esc(m.text)}</div>`;
    if (m.who === 'link') return `<button class="ash-link" data-ash-screen="${esc(m.screen)}"><i data-lucide="arrow-right"></i>${esc(m.text)}</button>`;
    if (m.who === 'sms') return `<a class="ash-link" href="${esc(m.href)}"><i data-lucide="message-circle"></i>${esc(m.text)}</a>`;
    return `<div class="ash-msg her">${md(m.text)}</div>`;
  }

  /* Transient elements (thinking strip, confirm card) live outside `log` so
     they never end up in the saved conversation. */
  function transient(html) {
    const box = el('#ash-tmp');
    const d = document.createElement('div');
    d.className = 'ash-tmp';
    d.innerHTML = html;
    box.appendChild(d);
    icons();
    scrollDown(true);
    return d;
  }
  function clearTransient() { const b = el('#ash-tmp'); if (b) b.innerHTML = ''; }

  function scrollDown(smooth) {
    const box = el('#ash-log');
    if (!box) return;
    const go = () => box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    go();
    requestAnimationFrame(go);   // again once the new node has been laid out
  }

  function push(m) { log.push(m); if (log.length > MAX_SAVED) log = log.slice(-MAX_SAVED); paint(); scrollDown(true); save(); }

  function save() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify({ log, history })); } catch (_) {}
  }
  function restore() {
    try {
      const o = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
      if (o && Array.isArray(o.log)) { log = o.log; history = Array.isArray(o.history) ? o.history : []; }
    } catch (_) {}
  }

  /* ------------------------------------------------------------- confirm -- */

  function confirmCard(p) {
    return new Promise((resolve) => {
      const rows = (p.rows || []).map(([k, v]) =>
        `<div class="ash-conf__row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
      const node = transient(`
        <div class="ash-conf ${p.danger ? 'danger' : ''}">
          <div class="ash-conf__head"><i data-lucide="${esc(p.icon || 'circle-help')}"></i>${esc(p.title || 'Go ahead?')}</div>
          ${rows ? `<div class="ash-conf__rows">${rows}</div>` : ''}
          ${p.body ? `<div class="ash-conf__body">${esc(p.body)}</div>` : ''}
          <div class="ash-conf__acts">
            <button class="btn ghost" data-no>Not now</button>
            <button class="btn primary" data-yes>${esc(p.confirmLabel || 'Yes, do it')}</button>
          </div>
        </div>`);
      const done = (ok) => {
        node.remove();
        push({ who: 'note', text: ok ? 'You said yes' : 'You said no' });
        resolve(ok);
      };
      node.querySelector('[data-yes]').addEventListener('click', () => done(true));
      node.querySelector('[data-no]').addEventListener('click', () => done(false));
      scrollDown(true);
    });
  }

  /* ---------------------------------------------------------------- send -- */

  function setBusy(on) {
    busy = on;
    const b = el('#ash-send');
    if (!b) return;
    b.classList.toggle('stop', on);
    b.innerHTML = on ? '<i data-lucide="square"></i>' : '<i data-lucide="arrow-up"></i>';
    b.setAttribute('aria-label', on ? 'Stop' : 'Send');
    icons();
  }

  function stop() {
    if (controller) controller.abort();
    clearTransient();
    setBusy(false);
    push({ who: 'note', text: 'Stopped' });
  }

  async function send(question) {
    if (busy) return;
    setBusy(true);              // before the first paint, so the reset button stays hidden
    push({ who: 'me', text: question });
    controller = new AbortController();

    let strip = transient(`<div class="ash-think"><span class="ash-dots"><i></i><i></i><i></i></span><span class="ash-think__t">Thinking</span></div>`);

    /* Buttons a tool wants to offer are held back until she has actually
       answered, so a shortcut never appears above the reply it belongs to. */
    const waiting = [];
    const flush = () => {
      while (waiting.length) {
        const c = waiting.shift();
        if (c.type === 'screen') push({ who: 'link', screen: c.screen, text: c.label });
        else if (c.type === 'sms') push({ who: 'sms', href: c.href, text: c.label });
        else if (c.type === 'gmail') push({ who: 'link', screen: '__gmail', text: c.label || 'Connect Gmail' });
      }
    };

    try {
      history = await ASHLEY_AGENT.ask(question, history, {
        signal: controller.signal,
        onBusy: (lines) => {
          clearTransient();
          strip = transient(`<div class="ash-think">
            <span class="ash-dots"><i></i><i></i><i></i></span>
            <span class="ash-think__t">${lines.map(esc).join(' &middot; ')}</span></div>`);
        },
        onCard: (card) => waiting.push(card),
        onConfirm: (p) => { clearTransient(); return confirmCard(p); },
        onAnswer: (text) => { clearTransient(); push({ who: 'her', text: deDash(text) }); flush(); },
        onError: (text) => { clearTransient(); push({ who: 'err', text }); flush(); },
      });
    } catch (e) {
      clearTransient();
      const msg = String((e && e.message) || e);
      if (!/abort/i.test(msg)) push({ who: 'err', text: msg.slice(0, 200) });
    } finally {
      clearTransient();
      flush();
      setBusy(false);
      paint();
      controller = null;
      save();
    }
  }

  /* Connecting Gmail has to happen on a real tap, or the phone blocks Google's
     pop-up. The card above routes here. */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ash-screen="__gmail"]');
    if (!b) return;
    e.stopPropagation();
    b.disabled = true;
    try { await getToken(); toast('Gmail connected', 'ok'); b.remove(); }
    catch (err) { toast(String((err && err.message) || err).slice(0, 70), 'err'); b.disabled = false; }
  }, true);

  window.renderAshley = renderAshley;
})();
