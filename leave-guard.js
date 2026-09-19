/* ============================================================================
   Leave guard, shared by the invoice and inspection pages.

   An invoice or report can take a long time to fill in on a phone. A stray tap
   on the logo or a swipe back used to throw all of it away. Now, whenever the
   form holds unsaved work, leaving stops and asks:

     Keep editing           stay put (the safe default)
     Save draft and leave   keep a draft on this phone, then go back
     Discard and leave      throw the changes away and go back

   Covers the in-app back link, the phone's own back gesture or button (by
   holding one history entry in reserve), and closing or reloading the tab
   (the browser's own prompt; browsers do not allow a custom one there).

     MMQLD_LEAVE.init({ isDirty, saveDraft, backUrl })

   Each page's isDirty() compares the form with its last saved snapshot;
   this file only asks. Self-contained: brings its own
   styles and markup.
   ========================================================================== */
(function () {
  'use strict';

  let opts = null;
  let leaving = false;
  let open = false;

  const CSS = `
  .lg-scrim { position: fixed; inset: 0; z-index: 200; background: rgba(12,10,9,.48);
    display: grid; place-items: center; padding: 20px; animation: lg-fade .15s ease; }
  .lg-scrim[hidden] { display: none; }
  .lg-box { width: 100%; max-width: 360px; background: #fff; border-radius: 18px; padding: 22px 20px 16px;
    box-shadow: 0 24px 60px rgba(12,10,9,.28); animation: lg-pop .18s ease;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; color: #0C0A09; }
  .lg-icon { width: 44px; height: 44px; border-radius: 12px; background: #FEF3C7; color: #B45309;
    display: grid; place-items: center; margin-bottom: 12px; }
  .lg-title { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 6px; }
  .lg-text { font-size: 14px; line-height: 1.45; color: #57534E; margin: 0 0 18px; }
  .lg-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 48px;
    border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; margin-bottom: 8px;
    border: 1px solid transparent; font-family: inherit; -webkit-tap-highlight-color: transparent; }
  .lg-btn:disabled { opacity: .6; }
  .lg-btn--stay { background: #1E3A8A; color: #fff; }
  .lg-btn--save { background: #fff; color: #1E3A8A; border-color: #D6D3D1; }
  .lg-btn--discard { background: #fff; color: #B91C1C; border-color: transparent; margin-bottom: 0; font-weight: 600; }
  .lg-btn--stay:active { background: #1A2E6E; }
  .lg-btn--save:active, .lg-btn--discard:active { background: #F5F5F4; }
  @keyframes lg-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes lg-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }`;

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.className = 'lg-scrim';
    el.id = 'leaveGuard';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'lgTitle');
    el.innerHTML = `
      <div class="lg-box">
        <div class="lg-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <h2 class="lg-title" id="lgTitle">Leave without saving?</h2>
        <p class="lg-text" id="lgText">You have changes that are not saved yet. If you go back now they will be lost.</p>
        <button type="button" class="lg-btn lg-btn--stay" data-lg="stay">Keep editing</button>
        <button type="button" class="lg-btn lg-btn--save" data-lg="save">Save draft and leave</button>
        <button type="button" class="lg-btn lg-btn--discard" data-lg="discard">Discard and leave</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lg]');
      if (!b) { if (e.target === el) hide(); return; }   // tapping outside = keep editing
      const act = b.dataset.lg;
      if (act === 'stay') return hide();
      if (act === 'save') {
        b.disabled = true;
        b.textContent = 'Saving draft...';
        try { await opts.saveDraft(); } catch (err) {
          b.disabled = false;
          b.textContent = 'Save draft and leave';
          alert('The draft could not be saved, so you are still here. ' + ((err && err.message) || ''));
          return;
        }
      }
      go();
    });
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') hide(); });
  }

  function show() {
    open = true;
    const el = document.getElementById('leaveGuard');
    el.hidden = false;
    el.querySelectorAll('[data-lg]').forEach((b) => { b.disabled = false; });
    el.querySelector('[data-lg="save"]').textContent = 'Save draft and leave';
    el.querySelector('[data-lg="stay"]').focus();
  }
  function hide() {
    open = false;
    document.getElementById('leaveGuard').hidden = true;
  }
  function go() {
    leaving = true;
    hide();
    location.href = opts.backUrl;
  }

  function dirty() {
    try { return !leaving && !!(opts && opts.isDirty()); } catch (_) { return false; }
  }

  function init(o) {
    opts = o;
    build();

    // In-app back links: the logo and anything marked data-leave.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a.brand, [data-leave]');
      if (!a || !dirty()) return;
      e.preventDefault();
      show();
    }, true);

    // Phone back gesture or button: keep one entry in hand so a back press
    // lands here first. Clean form: carry on back. Dirty: put it back, ask.
    try {
      history.pushState({ mmqldGuard: true }, '');
      window.addEventListener('popstate', () => {
        if (leaving) return;
        if (dirty()) {
          history.pushState({ mmqldGuard: true }, '');
          show();
        } else {
          leaving = true;
          history.back();
        }
      });
    } catch (_) {}

    // Closing or reloading the tab: only the browser's own prompt is allowed.
    window.addEventListener('beforeunload', (e) => {
      if (!dirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  window.MMQLD_LEAVE = { init, show };
})();
