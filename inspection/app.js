/* ────────────────────────────────────────────────────────────────────
   My Mechanic QLD — Vehicle Inspection Report Generator
   Mobile-first form, real PDFs via pdfmake.
   ─────────────────────────────────────────────────────────────────── */

(function () {
'use strict';

/* ────────────────────────────────────────────────────────────────────
   Business profile
   ─────────────────────────────────────────────────────────────────── */
const BUSINESS = {
  name:    'My Mechanic QLD',
  trading: 'Mobile Mechanics',
  tagline: 'WE COME TO YOU',
  phone:   '+61 0451 159 954',
  email:   'contact@mymechanicqld.com.au',
  website: 'www.mymechanicqld.com.au',
  abn:     '85 829 529 258',
};

/* ────────────────────────────────────────────────────────────────────
   Inspection schema — sections and criteria from the reference PDF.
   Editing this block updates the form, completion tracking, and the
   PDF render in lockstep.
   ─────────────────────────────────────────────────────────────────── */
const GRADES = ['Good', 'Fair', 'Repair', 'NA'];

const SECTIONS = [
  {
    id: 'interior', num: 2, title: 'Interior',
    criteria: [
      'Seats', 'Seat belts',
      'Other trims', 'Radio',
      'Rear window demister', 'Air conditioning',
      'Heater demister', 'Washers / wipers',
      'Horn', 'Doors, locks & hinges',
      'Window operation', 'Warning lights & dash',
      'All lights', 'Other',
    ],
  },
  {
    id: 'exterior', num: 3, title: 'Exterior',
    criteria: [
      'Rust', 'Body repairs',
      'Glass / mirrors', 'Sunroof / aerial / convertible',
      'Frames & members', 'Under-body parts',
      'Front suspension', 'Rear suspension',
      'Steering components', 'Auto / manual transmission',
      'Exhaust', 'Differential',
      'Drive shafts', 'Other',
    ],
  },
  {
    id: 'engine', num: 4, title: 'Engine Bay',
    criteria: [
      'Noise', 'Fluid level',
      'Fluid leaks', 'Mountings',
      'Hoses / pipes', 'Water pump / fan',
      'Ignition system', 'Fuel system',
      'Battery', 'Radiator / cap',
      'Drive belt / pulleys', 'Brake booster',
      'Master cylinder / ABS', 'Other',
    ],
  },
  {
    id: 'tyres', num: 5, title: 'Tyres, Wheels & Brakes',
    criteria: [
      'Tyres', 'Wheel rims',
      'Spare tyre / rim', 'Brake hoses / pipes',
      'Brake pads', 'Brake discs',
      'Brake linings', 'Wheel cylinders',
      'Brakes & drums', 'Park brake',
      'Wheel bearings', 'Other',
    ],
  },
  {
    id: 'roadtest', num: 6, title: 'Road Test',
    criteria: [
      'Ease of starting / idle', 'Engine noise',
      'Engine performance', 'Exhaust smoke / emissions',
      'Gearbox', 'Differential',
      'Steering / suspension', 'Brake operation',
      'Speedo', 'Cruise control',
      '4WD operation', 'Camshaft / drive belt',
      'Other',
    ],
  },
];

const DEFAULT_TERMS = {
  disclaimer: [
    'It is the responsibility of the buyer to check for any financial interest owing on the vehicle and for any write-off or stolen vehicle before purchasing the vehicle.',
    'The My Mechanic QLD inspection is not a guarantee or warranty and is valid only at the time of inspection.',
    'It is the responsibility of the buyer to conduct a visual inspection of the vehicle at the final point of sale as My Mechanic QLD can only advise on the condition of the vehicle at the time of inspection.',
    'Advice on the vehicle inspected is provided in context of the age and condition of the vehicle at the time inspected.',
    'The purchaser must take responsibility for the authenticity of the vehicle. VIN and engine numbers are recorded by our inspectors however authenticity cannot be guaranteed.',
    'The My Mechanic QLD inspection is VISUAL only. No removal of parts or components is undertaken during the inspection process.',
    'If there is a dispute about the content of this report, the purchaser must refer the vehicle back to My Mechanic QLD prior to proceeding with any repairs.',
    'This report serves to identify any visually detected problems however dismantling components may be subsequently required to provide a more accurate diagnosis.',
    'The inspection report is prepared for the person named on the report and not for use by any third party.',
  ],
  notChecked: [
    'Timing belts',
    'Fuel & oil consumption',
    'Trip meters / computers',
    'Alarm / security system',
    'Navigation equipment / GPS',
    'Operation of TV, cassette, CD or audio connections',
    'Automatic switching of wipers and lights',
    'Compression of engine',
    'Anti-lock braking system (ABS)',
  ],
};

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────────────────────────── */
const today = () => new Date().toISOString().slice(0, 10);
const uid   = () => crypto.randomUUID();
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const escA = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return isNaN(d) ? s : d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
};

const COUNTER_KEY = 'mmqld_report_counter';
function autoReportNumber() {
  const d = new Date();
  const ymd = d.getFullYear()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const next = (parseInt(localStorage.getItem(COUNTER_KEY) || '65', 10) + 1);
  return `RPT_${ymd}_${String(next).padStart(4, '0')}`;
}
function bumpReportCounter() {
  const next = (parseInt(localStorage.getItem(COUNTER_KEY) || '65', 10) + 1);
  localStorage.setItem(COUNTER_KEY, String(next));
}

/* ────────────────────────────────────────────────────────────────────
   State
   ─────────────────────────────────────────────────────────────────── */
function blankSections() {
  const out = {};
  SECTIONS.forEach(s => {
    out[s.id] = { grades: s.criteria.map(() => 'Fair'), comments: '', touched: false };
  });
  return out;
}

function newState() {
  return {
    reportNumber: autoReportNumber(),
    reportDate: today(),
    appointmentDate: today(),
    appointmentStart: '',
    appointmentEnd: '',
    client: { contact: '', address: '', phone: '' },
    inspection: {
      registration: '',
      makeModel: '',
      year: '',
      location: '',
      date: today(),
      odometer: '',
    },
    sections: blankSections(),
    images: [], // { id, dataUrl, caption }
    overall: 'Fair',
    overallComments: '',
    signature: { name: '', date: today(), dataUrl: '' },
    terms: JSON.parse(JSON.stringify(DEFAULT_TERMS)),
  };
}

function demoState() {
  const s = newState();
  s.appointmentStart = '1:00 PM';
  s.appointmentEnd = '2:00 PM';
  s.client = { contact: 'Thomas De Brito', address: '40 Steel Pl, Morningside QLD 4170', phone: '0403 808 757' };
  s.inspection = {
    registration: 'ABC123',
    makeModel: 'Volkswagen Golf GTI',
    year: '2015',
    location: '40 Steel Pl, Morningside QLD 4170',
    date: today(),
    odometer: '116000',
  };
  // Demo grades to mirror the sample PDF
  s.sections.interior.comments = 'Seats have some stains here and there.';
  s.sections.exterior.grades[5] = 'Repair';
  s.sections.exterior.grades[6] = 'Repair';
  s.sections.exterior.grades[7] = 'Repair';
  s.sections.exterior.comments = 'Req. front shockies and bump stop kit. Control arm bushes have some minor cracks. Rear shockies and bump stop are on their way out.';
  s.sections.engine.grades[2] = 'Repair';
  s.sections.engine.comments = 'Signs of minor leaks from multiple seals and gaskets.';
  s.sections.tyres.grades[0] = 'Repair';
  s.sections.tyres.grades[1] = 'Repair';
  s.sections.tyres.grades[4] = 'Repair';
  s.sections.tyres.grades[5] = 'Repair';
  s.sections.tyres.grades[6] = 'NA';
  s.sections.tyres.grades[7] = 'NA';
  s.sections.tyres.grades[8] = 'NA';
  s.sections.tyres.comments = 'Noisy tyres. Rims have some minor gutter damage.';
  s.sections.roadtest.grades[2] = 'Repair';
  s.sections.roadtest.grades[4] = 'Repair';
  s.sections.roadtest.grades[6] = 'Repair';
  s.sections.roadtest.grades[7] = 'Repair';
  s.sections.roadtest.comments = 'Transmission is playing up here and there. Req. front pads and rotors all around soon. Steering and suspension needs attention. Jack is missing.';
  return s;
}

let state = demoState();

/* URL-param prefill — populated in init() from the query string. email is
   kept here because it is not a form field but is needed for the send step. */
let PREFILL = { email: '', phone: '', rego: '', name: '', id: '' };

/* ────────────────────────────────────────────────────────────────────
   Render — inspection sections (built dynamically)
   ─────────────────────────────────────────────────────────────────── */
function buildSections() {
  const root = $('#inspectionSections');
  root.innerHTML = SECTIONS.map(sec => {
    const sst = state.sections[sec.id];
    return `
      <details class="sec" data-key="${sec.id}" data-touched="${sst.touched}">
        <summary class="sec__head">
          <span class="sec__num">${sec.num}</span>
          <span class="sec__title">
            ${sec.title}
            <span class="sec__title-count" data-flag-count="${sec.id}">${countFlags(sec.id)}</span>
          </span>
          <svg class="sec__chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="sec__body">
          <div class="bulk">
            <span class="bulk__label">Set all to</span>
            ${GRADES.map(g => `<button type="button" class="bulk__btn bulk__btn--${g.toLowerCase()}" data-bulk="${sec.id}" data-grade="${g}">${g}</button>`).join('')}
          </div>

          <div class="crits" data-section-crits="${sec.id}">
            ${sec.criteria.map((label, idx) => renderCriterion(sec.id, idx, label, sst.grades[idx])).join('')}
          </div>

          <label class="field">
            <span class="field__label">Comments</span>
            <textarea rows="3" data-bind="sections.${sec.id}.comments" placeholder="Notes for ${sec.title.toLowerCase()}…">${escA(sst.comments)}</textarea>
          </label>
        </div>
      </details>
    `;
  }).join('');
}

function renderCriterion(secId, idx, label, currentGrade) {
  return `
    <div class="crit" data-crit="${secId}-${idx}">
      <div class="crit__label">${escA(label)}</div>
      <div class="grades" role="radiogroup" aria-label="${escA(label)}">
        ${GRADES.map(g => `
          <button type="button" class="grade"
                  data-grade="${g}"
                  data-section="${secId}"
                  data-idx="${idx}"
                  aria-pressed="${g === currentGrade}">${g}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderOverall() {
  const root = $('#overallGrades');
  root.innerHTML = GRADES.map(g => `
    <button type="button" class="grade" data-overall="${g}" aria-pressed="${g === state.overall}">${g}</button>
  `).join('');
}

function renderImages() {
  $('#imageCount').textContent = state.images.length;
  $('#imageGrid').innerHTML = state.images.map(img => `
    <div class="img-item" data-img="${img.id}">
      <img src="${img.dataUrl}" alt="" />
      <input class="img-item__caption" type="text" placeholder="Caption (optional)"
             value="${escA(img.caption)}" data-img-caption="${img.id}" />
      <button type="button" class="img-item__rm" data-img-rm="${img.id}" aria-label="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
}

function renderForm() {
  $('#brandLogo').src = window.MMQLD_ASSETS.logoPng;

  // Bind all data-bind inputs
  $$('[data-bind]').forEach(el => {
    const path = el.dataset.bind;
    if (path === 'terms.disclaimer') {
      el.value = state.terms.disclaimer.join('\n');
    } else if (path === 'terms.notChecked') {
      el.value = state.terms.notChecked.join('\n');
    } else {
      el.value = getByPath(state, path) ?? '';
    }
  });

  buildSections();
  renderOverall();
  renderImages();
  updateProgress();
}

/* ─── Completion + progress tracking ─── */
function countFlags(secId) {
  return state.sections[secId].grades.filter(g => g === 'Repair' || g === 'NA').length;
}
function updateProgress() {
  // Progress = fraction of sections that have been touched
  const touched = SECTIONS.filter(s => state.sections[s.id].touched).length;
  const total = SECTIONS.length + 3; // sections + vehicle + signature + images (loose)
  let extras = 0;
  if (state.inspection.registration || state.inspection.makeModel) extras++;
  if (state.signature.dataUrl) extras++;
  if (state.images.length > 0) extras++;
  const pct = Math.min(100, Math.round(((touched + extras) / total) * 100));
  $('#progressBar').style.width = pct + '%';
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}
function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/* ────────────────────────────────────────────────────────────────────
   Event wiring — input + click delegation
   ─────────────────────────────────────────────────────────────────── */
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.bind) {
    if (t.dataset.bind === 'terms.disclaimer') {
      state.terms.disclaimer = t.value.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (t.dataset.bind === 'terms.notChecked') {
      state.terms.notChecked = t.value.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      setByPath(state, t.dataset.bind, t.value);
    }
    if (t.dataset.bind === 'inspection.registration' || t.dataset.bind === 'inspection.makeModel') {
      updateProgress();
    }
    return;
  }

  if (t.dataset.imgCaption) {
    const img = state.images.find(x => x.id === t.dataset.imgCaption);
    if (img) img.caption = t.value;
    return;
  }
});

document.addEventListener('click', (e) => {
  // Grade tap
  const g = e.target.closest('.grade[data-grade][data-section]');
  if (g) {
    const { section, idx, grade } = g.dataset;
    state.sections[section].grades[Number(idx)] = grade;
    state.sections[section].touched = true;
    // Repaint the row pills + section badge
    $$(`.grade[data-section="${section}"][data-idx="${idx}"]`).forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.grade === grade));
    });
    const flagEl = $(`[data-flag-count="${section}"]`);
    if (flagEl) {
      const n = countFlags(section);
      flagEl.textContent = n;
      flagEl.style.display = n > 0 ? '' : 'none';
    }
    const secEl = g.closest('.sec');
    if (secEl) secEl.dataset.touched = 'true';
    updateProgress();
    return;
  }

  // Bulk set
  const bulk = e.target.closest('[data-bulk]');
  if (bulk) {
    const { bulk: sec, grade } = bulk.dataset;
    state.sections[sec].grades = state.sections[sec].grades.map(() => grade);
    state.sections[sec].touched = true;
    // Re-render just this section's criteria
    const crit = $(`[data-section-crits="${sec}"]`);
    if (crit) {
      const secDef = SECTIONS.find(s => s.id === sec);
      crit.innerHTML = secDef.criteria.map((label, idx) =>
        renderCriterion(sec, idx, label, state.sections[sec].grades[idx])).join('');
    }
    const flagEl = $(`[data-flag-count="${sec}"]`);
    if (flagEl) flagEl.textContent = countFlags(sec);
    bulk.closest('.sec').dataset.touched = 'true';
    updateProgress();
    return;
  }

  // Overall grade
  const ov = e.target.closest('[data-overall]');
  if (ov) {
    state.overall = ov.dataset.overall;
    $$('[data-overall]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.overall === state.overall)));
    return;
  }

  // Image remove
  const rm = e.target.closest('[data-img-rm]');
  if (rm) {
    state.images = state.images.filter(x => x.id !== rm.dataset.imgRm);
    renderImages();
    updateProgress();
    return;
  }

  // Reset terms
  if (e.target.id === 'termsResetBtn') {
    state.terms = JSON.parse(JSON.stringify(DEFAULT_TERMS));
    $('[data-bind="terms.disclaimer"]').value = state.terms.disclaimer.join('\n');
    $('[data-bind="terms.notChecked"]').value = state.terms.notChecked.join('\n');
    toast('Terms reset to default.');
    return;
  }
});

/* ─── Image upload (with client-side compression) ─── */
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'imgInput') return;
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  toast(`Processing ${files.length} image${files.length > 1 ? 's' : ''}…`);
  for (const f of files) {
    try {
      const dataUrl = await compressImage(f, 1600, 0.72);
      state.images.push({ id: uid(), dataUrl, caption: '' });
    } catch (err) {
      console.error(err);
      toast('Failed to load ' + f.name, 'error');
    }
  }
  e.target.value = '';
  renderImages();
  updateProgress();
});

function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ─── Signature pad ─── */
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

  // Restore saved sig
  if (state.signature.dataUrl) {
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
    updateProgress();
  };

  canvas.addEventListener('mousedown', e => { const [x, y] = pt(e); start(x, y); });
  canvas.addEventListener('mousemove', e => { const [x, y] = pt(e); move(x, y); });
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); const [x, y] = pt(e); start(x, y); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); const [x, y] = pt(e); move(x, y); }, { passive: false });
  canvas.addEventListener('touchend', end);

  $('#sigClearBtn').addEventListener('click', () => {
    sigCtx.clearRect(0, 0, canvas.width, canvas.height);
    state.signature.dataUrl = '';
    updateProgress();
  });
}

/* ─── Toolbar ─── */
$('#newBtn').addEventListener('click', () => {
  if (!confirm('Start a new report? Unsaved changes will be lost.')) return;
  state = newState();
  renderForm();
  setupSignature();
  toast('New report started.');
});

$('#saveBtn').addEventListener('click', saveDraft);

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

/* ─── Drafts ─── */
const DRAFTS_KEY = 'mmqld_inspection_drafts_v2';
function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); }
  catch { return []; }
}
function saveDraft() {
  try {
    const drafts = loadDrafts();
    const id = state.reportNumber || uid();
    const draft = {
      id,
      name: state.inspection.makeModel || state.client.contact || 'Untitled',
      number: state.reportNumber,
      rego: state.inspection.registration,
      savedAt: Date.now(),
      state: JSON.parse(JSON.stringify(state)),
    };
    const i = drafts.findIndex(d => d.id === id);
    if (i >= 0) drafts[i] = draft;
    else drafts.unshift(draft);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 5)));
    toast('Draft saved.', 'success');
  } catch (err) {
    toast('Could not save (storage full — too many images). Export the PDF instead.', 'error');
  }
}
function renderDraftsList() {
  const drafts = loadDrafts();
  const list = $('#draftsList');
  if (drafts.length === 0) {
    list.innerHTML = '<div class="drafts__empty">No saved drafts yet.</div>';
    return;
  }
  list.innerHTML = drafts.map(d => `
    <div class="draft-item" data-load="${d.id}">
      <div class="draft-item__meta">
        <div class="draft-item__name">${escA(d.name)}${d.rego ? ' · ' + escA(d.rego) : ''}</div>
        <div class="draft-item__when">${escA(d.number)} · ${new Date(d.savedAt).toLocaleString('en-AU')}</div>
      </div>
      <button class="draft-item__del" data-del="${d.id}" aria-label="Delete">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
  `).join('');
}
$('#loadBtn').addEventListener('click', () => {
  renderDraftsList();
  $('#draftsPanel').hidden = false;
  $('#scrim').hidden = false;
});
$('#closeDraftsBtn').addEventListener('click', () => {
  $('#draftsPanel').hidden = true;
  $('#scrim').hidden = true;
});
$('#scrim').addEventListener('click', () => {
  $('#draftsPanel').hidden = true;
  $('#scrim').hidden = true;
});
$('#draftsList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    const drafts = loadDrafts().filter(d => d.id !== del.dataset.del);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    renderDraftsList();
    return;
  }
  const ld = e.target.closest('[data-load]');
  if (ld) {
    const d = loadDrafts().find(x => x.id === ld.dataset.load);
    if (!d) return;
    state = d.state;
    renderForm();
    setupSignature();
    $('#draftsPanel').hidden = true;
    $('#scrim').hidden = true;
    toast('Draft loaded.');
  }
});

/* ─── Toasts ─── */
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
  strong:      '#D6D3CB',
  white:       '#FFFFFF',
  goodBg:      '#D1FAE5',
  goodFg:      '#047857',
  fairBg:      '#FEF3C7',
  fairFg:      '#B45309',
  repairBg:    '#FEE2E2',
  repairFg:    '#B91C1C',
  naBg:        '#F3F4F6',
  naFg:        '#4B5563',
};

const GRADE_BG = { Good: COLOR.goodBg, Fair: COLOR.fairBg, Repair: COLOR.repairBg, NA: COLOR.naBg };
const GRADE_FG = { Good: COLOR.goodFg, Fair: COLOR.fairFg, Repair: COLOR.repairFg, NA: COLOR.naFg };

/* ─── Save record to Supabase (non-blocking) ─── */
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function saveInspectionRecord(b64) {
  if (!window.MMQLD_STORE) { toast('Records helper not loaded, please refresh the page'); return; }
  try {
    const v = state.inspection;
    const vehicle = [v.makeModel, v.year].filter(Boolean).join(' ').trim();
    const sections = SECTIONS.map(sec => {
      const sst = state.sections[sec.id];
      return {
        id: sec.id,
        title: sec.title,
        criteria: sec.criteria.map((label, idx) => ({ label, grade: sst.grades[idx] })),
        comments: sst.comments || '',
      };
    });
    const meta = {
      report_number:   state.reportNumber || null,
      customer_name:   state.client.contact || PREFILL.name || null,
      customer_phone:  state.client.phone || PREFILL.phone || null,
      vehicle_rego:    v.registration || null,
      vehicle:         vehicle || null,
      odometer:        v.odometer || null,
      overall_rating:  state.overall || null,
      inspection_date: v.date || null,
      sections:        sections,
      comments:        state.overallComments || null,
      submission_id:   isUuid(PREFILL.id) ? PREFILL.id : null,
    };
    await MMQLD_STORE.saveInspection(meta, b64);
    toast('Saved to records', 'success');
  } catch (err) {
    console.error(err);
    toast('Could not save: ' + String((err && err.message) || err).slice(0, 80));
  }
}

async function exportPdf() {
  if (typeof pdfMake === 'undefined') throw new Error('PDF library still loading');
  toast('Generating PDF…');
  const filename = (state.reportNumber || 'inspection') + '.pdf';
  const doc = buildReportDoc();
  await new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).download(filename, () => resolve());
    } catch (err) { reject(err); }
  });
  // Log the record to Supabase (non-blocking — must not break the download)
  pdfMake.createPdf(doc).getBase64(b64 => saveInspectionRecord(b64));
  bumpReportCounter();
  toast('PDF downloaded.', 'success');
}

function buildReportDoc() {
  const A = window.MMQLD_ASSETS;
  const PAGE_W = 595, PAGE_H = 842;
  const HEADER_H = 60, FOOTER_H = 28;

  // Aggregate stats for the cover snapshot
  let totalRepairs = 0, totalNa = 0, totalGood = 0;
  SECTIONS.forEach(s => {
    state.sections[s.id].grades.forEach(g => {
      if (g === 'Repair') totalRepairs++;
      else if (g === 'NA') totalNa++;
      else if (g === 'Good') totalGood++;
    });
  });

  return {
    pageSize: 'A4',
    pageMargins: [44, HEADER_H + 18, 44, FOOTER_H + 12],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: COLOR.ink, lineHeight: 1.3 },
    info: {
      title: state.reportNumber || 'Vehicle Inspection Report',
      author: BUSINESS.name,
      subject: 'Vehicle Inspection Report',
    },

    background: function (currentPage, pageSize) {
      return [
        // Top navy band — slimmer than the invoice, full bleed
        {
          canvas: [
            { type: 'rect', x: 0, y: 0, w: pageSize.width, h: HEADER_H, color: COLOR.navy },
            { type: 'rect', x: pageSize.width - 180, y: 0, w: 180, h: HEADER_H, color: COLOR.navyBright, fillOpacity: 0.18 },
          ],
        },
        // Footer strip
        {
          canvas: [
            { type: 'rect', x: 0, y: pageSize.height - FOOTER_H, w: pageSize.width, h: FOOTER_H, color: COLOR.navyDeep },
            { type: 'rect', x: 0, y: pageSize.height - FOOTER_H - 3, w: pageSize.width, h: 3, color: COLOR.navyBright },
          ],
        },
      ];
    },

    header: function (currentPage) {
      return {
        margin: [44, 16, 44, 0],
        columns: [
          // Logo + brand
          {
            width: '*',
            columns: [
              { image: A.logoPng, width: 30, height: 30 },
              {
                width: '*',
                margin: [8, 4, 0, 0],
                stack: [
                  { text: BUSINESS.name, color: 'white', fontSize: 13, bold: true, characterSpacing: -0.1 },
                  { text: BUSINESS.tagline, color: 'white', fontSize: 7.5, characterSpacing: 1.6, margin: [0, 1, 0, 0], opacity: 0.78 },
                ],
              },
            ],
          },
          // Right side — phone + website
          {
            width: 230,
            alignment: 'right',
            margin: [0, 6, 0, 0],
            stack: [
              { text: BUSINESS.phone + '  ·  ' + BUSINESS.website, color: 'white', fontSize: 9, opacity: 0.92 },
              { text: 'ABN ' + BUSINESS.abn, color: 'white', fontSize: 8.5, opacity: 0.7, margin: [0, 2, 0, 0] },
            ],
          },
        ],
      };
    },

    footer: function (currentPage, pageCount) {
      return {
        margin: [44, 8, 44, 0],
        columns: [
          { text: BUSINESS.website, color: 'white', fontSize: 9, alignment: 'left' },
          { text: 'Page ' + currentPage + ' of ' + pageCount, color: 'white', fontSize: 9, alignment: 'right', opacity: 0.7 },
        ],
      };
    },

    content: [

      /* ─── Cover (page 1) ─── */
      {
        margin: [0, 0, 0, 0],
        text: 'VEHICLE INSPECTION REPORT',
        fontSize: 10,
        bold: true,
        characterSpacing: 2.2,
        color: COLOR.subtle,
      },
      {
        margin: [0, 6, 0, 0],
        text: state.inspection.makeModel || 'Vehicle Inspection',
        fontSize: 26,
        bold: true,
        characterSpacing: -0.3,
        color: COLOR.ink,
      },
      // Rego badge + key facts row
      {
        margin: [0, 14, 0, 0],
        columns: [
          regoBadge(),
          {
            width: '*',
            margin: [16, 0, 0, 0],
            stack: keyFactsList(),
          },
        ],
      },

      // Snapshot tiles
      snapshotTiles(totalGood, totalRepairs, totalNa),

      // Client + report metadata
      detailsBlock(),

      // Each inspection section
      ...SECTIONS.map(sec => sectionPage(sec)),

      // Images
      ...imagesPages(A),

      // Overall rating + comments
      overallPage(),

      // Sign-off
      signaturePage(),

      // Terms
      termsPage(),
    ],

    styles: {
      eyebrow:    { fontSize: 9, bold: true, characterSpacing: 1.6, color: COLOR.subtle },
      sectionTag: { fontSize: 9, bold: true, characterSpacing: 1.8, color: COLOR.navy },
      sectionTitle: { fontSize: 20, bold: true, color: COLOR.ink, characterSpacing: -0.2 },
      kvKey:      { fontSize: 8.5, bold: true, characterSpacing: 1.2, color: COLOR.subtle },
      kvVal:      { fontSize: 11, color: COLOR.ink, bold: true },
    },
  };
}

function regoBadge() {
  const rego = (state.inspection.registration || '—').toUpperCase();
  return {
    width: 'auto',
    table: {
      widths: ['auto'],
      body: [[
        {
          stack: [
            { text: 'REGO', fontSize: 8, bold: true, color: 'white', characterSpacing: 2, opacity: 0.75 },
            { text: rego, fontSize: 22, bold: true, color: 'white', characterSpacing: 2, margin: [0, 4, 0, 0] },
          ],
          fillColor: COLOR.navy,
          border: [false, false, false, false],
          margin: [16, 12, 16, 12],
        },
      ]],
    },
    layout: 'noBorders',
  };
}

function keyFactsList() {
  const v = state.inspection;
  const lines = [];
  if (v.makeModel) lines.push({ text: [{ text: 'Make/Model  ', style: 'kvKey' }, { text: v.makeModel, style: 'kvVal' }], margin: [0, 0, 0, 4] });
  if (v.year)      lines.push({ text: [{ text: 'Year  ',       style: 'kvKey' }, { text: v.year, style: 'kvVal' }], margin: [0, 0, 0, 4] });
  if (v.odometer)  lines.push({ text: [{ text: 'Odometer  ',   style: 'kvKey' }, { text: Number(v.odometer).toLocaleString('en-AU') + ' km', style: 'kvVal' }], margin: [0, 0, 0, 4] });
  if (v.location)  lines.push({ text: [{ text: 'Inspected at  ', style: 'kvKey' }, { text: v.location, style: 'kvVal', fontSize: 10 }], margin: [0, 0, 0, 4] });
  if (v.date)      lines.push({ text: [{ text: 'Inspection date  ', style: 'kvKey' }, { text: fmtDate(v.date), style: 'kvVal' }], margin: [0, 0, 0, 0] });
  return lines;
}

function snapshotTiles(good, repair, na) {
  return {
    margin: [0, 18, 0, 0],
    columns: [
      tile('GOOD',    String(good),   COLOR.goodBg,   COLOR.goodFg),
      tile('REPAIRS', String(repair), COLOR.repairBg, COLOR.repairFg),
      tile('N / A',   String(na),     COLOR.naBg,     COLOR.naFg),
      tile('RATING',  state.overall.toUpperCase(), GRADE_BG[state.overall], GRADE_FG[state.overall]),
    ],
    columnGap: 8,
  };
}
function tile(label, value, bg, fg) {
  return {
    width: '*',
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [
            { text: label, fontSize: 8.5, bold: true, characterSpacing: 1.6, color: fg, opacity: 0.7 },
            { text: value, fontSize: 18, bold: true, color: fg, margin: [0, 4, 0, 0] },
          ],
          fillColor: bg,
          border: [false, false, false, false],
          margin: [12, 10, 12, 10],
        },
      ]],
    },
    layout: 'noBorders',
  };
}

function detailsBlock() {
  // Client details + report metadata, side by side
  const rd = [
    ['Report no.', state.reportNumber],
    ['Report date', fmtDate(state.reportDate)],
    ['Appointment', fmtDate(state.appointmentDate) + (state.appointmentStart ? '  ' + state.appointmentStart : '') + (state.appointmentEnd ? ' – ' + state.appointmentEnd : '')],
  ];
  const cd = [
    ['Contact', state.client.contact || '—'],
    ['Phone',   state.client.phone   || '—'],
    ['Address', state.client.address || '—'],
  ];
  return {
    margin: [0, 22, 0, 0],
    columns: [
      kvCard('REPORT', rd),
      kvCard('CLIENT', cd),
    ],
    columnGap: 14,
  };
}
function kvCard(label, rows) {
  return {
    width: '*',
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [
            { text: label, style: 'sectionTag', margin: [0, 0, 0, 6] },
            ...rows.map(([k, v]) => ({
              margin: [0, 0, 0, 3],
              text: [
                { text: k + '  ', style: 'kvKey' },
                { text: v || '—', fontSize: 10, color: COLOR.ink },
              ],
            })),
          ],
          fillColor: COLOR.soft,
          border: [true, false, false, false],
          borderColor: [COLOR.navy, COLOR.navy, COLOR.navy, COLOR.navy],
          margin: [14, 12, 14, 12],
        },
      ]],
    },
    layout: {
      defaultBorder: false,
      vLineWidth: (i) => i === 0 ? 3 : 0,
      vLineColor: () => COLOR.navy,
    },
  };
}

function sectionPage(sec) {
  const sst = state.sections[sec.id];
  return {
    pageBreak: 'before',
    stack: [
      { text: 'SECTION ' + sec.num, style: 'sectionTag' },
      { text: sec.title, style: 'sectionTitle', margin: [0, 4, 0, 0] },
      sectionHeadline(sst, sec),
      criteriaTable(sec, sst),
      sst.comments.trim() ? commentsCard(sst.comments) : { text: '' },
    ],
  };
}
function sectionHeadline(sst, sec) {
  const flags = sst.grades.filter(g => g === 'Repair').length;
  if (flags === 0) {
    return { text: 'All criteria look good or are within fair range.', fontSize: 10.5, color: COLOR.muted, italics: true, margin: [0, 8, 0, 12] };
  }
  return {
    margin: [0, 8, 0, 12],
    columns: [
      {
        width: 'auto',
        table: { body: [[{ text: flags + ' to repair', color: COLOR.repairFg, fillColor: COLOR.repairBg, bold: true, fontSize: 10, margin: [10, 5, 10, 5], border: [false, false, false, false] }]] },
        layout: 'noBorders',
      },
      { text: '', width: '*' },
    ],
  };
}

function criteriaTable(sec, sst) {
  // 2-column grid of criteria. Each cell: label on top, grade chip below.
  const rows = [];
  for (let i = 0; i < sec.criteria.length; i += 2) {
    const leftIdx = i;
    const rightIdx = i + 1;
    rows.push([
      critCell(sec.criteria[leftIdx], sst.grades[leftIdx]),
      rightIdx < sec.criteria.length ? critCell(sec.criteria[rightIdx], sst.grades[rightIdx]) : { text: '', border: [false, false, false, false] },
    ]);
  }
  return {
    margin: [0, 0, 0, 14],
    table: {
      widths: ['*', '*'],
      body: rows,
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i) => i === 1 ? 0 : 0,
      paddingTop: () => 4,
      paddingBottom: () => 4,
      paddingLeft: (i) => i === 0 ? 0 : 6,
      paddingRight: (i) => i === 1 ? 0 : 6,
    },
  };
}
function critCell(label, grade) {
  return {
    border: [false, false, false, false],
    stack: [
      {
        table: {
          widths: ['*'],
          body: [[
            {
              stack: [
                { text: label, fontSize: 10, bold: true, color: COLOR.ink },
                {
                  margin: [0, 5, 0, 0],
                  columns: [
                    {
                      width: 'auto',
                      table: { body: [[{ text: grade, color: GRADE_FG[grade], fillColor: GRADE_BG[grade], fontSize: 9, bold: true, characterSpacing: 0.6, margin: [8, 3, 8, 3], border: [false, false, false, false] }]] },
                      layout: 'noBorders',
                    },
                    { text: '', width: '*' },
                  ],
                },
              ],
              fillColor: COLOR.soft,
              border: [false, false, false, false],
              margin: [12, 10, 12, 10],
            },
          ]],
        },
        layout: 'noBorders',
      },
    ],
  };
}

function commentsCard(text) {
  return {
    margin: [0, 4, 0, 0],
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [
            { text: 'COMMENTS', style: 'sectionTag' },
            { text: text, color: COLOR.muted, fontSize: 10.5, margin: [0, 4, 0, 0], lineHeight: 1.45 },
          ],
          fillColor: COLOR.navyTint,
          border: [true, false, false, false],
          margin: [14, 10, 14, 12],
        },
      ]],
    },
    layout: {
      defaultBorder: false,
      vLineWidth: (i) => i === 0 ? 3 : 0,
      vLineColor: () => COLOR.navy,
    },
  };
}

function imagesPages(A) {
  if (state.images.length === 0) return [];
  // 6 images per page (3 rows × 2 cols)
  const perPage = 6;
  const pages = [];
  for (let i = 0; i < state.images.length; i += perPage) {
    pages.push(state.images.slice(i, i + perPage));
  }
  return pages.map((batch, pi) => ({
    pageBreak: 'before',
    stack: [
      ...(pi === 0 ? [
        { text: 'APPENDIX', style: 'sectionTag' },
        { text: 'Inspection images', style: 'sectionTitle', margin: [0, 4, 0, 0] }
      ] : []),
      ...buildImageGrid(batch),
    ],
  }));
}
function buildImageGrid(batch) {
  // Build rows of 2 images each.
  const rows = [];
  for (let i = 0; i < batch.length; i += 2) {
    const left = batch[i];
    const right = batch[i + 1];
    rows.push({
      margin: [0, 0, 0, 14],
      columns: [
        imageCell(left),
        right ? imageCell(right) : { text: '', width: '*' },
      ],
      columnGap: 14,
    });
  }
  return rows;
}
function imageCell(img) {
  if (!img) return { text: '', width: '*' };
  const cell = {
    width: '*',
    stack: [
      { image: img.dataUrl, width: 246, alignment: 'left' },
    ],
  };
  if (img.caption && img.caption.trim()) {
    cell.stack.push({
      text: img.caption,
      fontSize: 9,
      color: COLOR.muted,
      margin: [0, 5, 0, 0],
      italics: true,
    });
  }
  return cell;
}

function overallPage() {
  return {
    pageBreak: 'before',
    stack: [
      { text: 'SECTION 7', style: 'sectionTag' },
      { text: 'Overall rating', style: 'sectionTitle', margin: [0, 4, 0, 16] },
      {
        columns: [
          {
            width: 'auto',
            table: {
              body: [[{
                stack: [
                  { text: 'OVERALL', fontSize: 8.5, bold: true, characterSpacing: 1.6, color: GRADE_FG[state.overall], opacity: 0.8 },
                  { text: state.overall, fontSize: 28, bold: true, color: GRADE_FG[state.overall], margin: [0, 6, 0, 0] },
                ],
                fillColor: GRADE_BG[state.overall],
                border: [false, false, false, false],
                margin: [22, 16, 22, 16],
              }]],
            },
            layout: 'noBorders',
          },
          { width: '*', text: '' },
        ],
      },
      ...(state.overallComments.trim() ? [{
        margin: [0, 18, 0, 0],
        stack: [
          { text: 'GENERAL COMMENTS', style: 'sectionTag' },
          { text: state.overallComments, color: COLOR.muted, fontSize: 11, margin: [0, 6, 0, 0], lineHeight: 1.55 },
        ],
      }] : []),
    ],
  };
}

function signaturePage() {
  return {
    pageBreak: 'before',
    stack: [
      { text: 'SECTION 8', style: 'sectionTag' },
      { text: 'Sign-off', style: 'sectionTitle', margin: [0, 4, 0, 16] },
      {
        margin: [0, 0, 0, 22],
        table: {
          widths: ['*'],
          body: [[
            {
              stack: [
                { text: 'STATEMENT', style: 'sectionTag' },
                { text: 'I confirm I have inspected and road-tested the above vehicle as per the findings of this report.',
                  fontSize: 11, color: COLOR.ink, margin: [0, 6, 0, 0], lineHeight: 1.5 },
              ],
              fillColor: COLOR.soft,
              border: [true, false, false, false],
              margin: [14, 12, 14, 14],
            },
          ]],
        },
        layout: {
          defaultBorder: false,
          vLineWidth: (i) => i === 0 ? 3 : 0,
          vLineColor: () => COLOR.navy,
        },
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'NAME', style: 'kvKey' },
              { text: state.signature.name || ' ', fontSize: 13, color: COLOR.ink, bold: true, margin: [0, 6, 0, 6] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.6, lineColor: COLOR.ink }] },
            ],
          },
          {
            width: '*',
            stack: [
              { text: 'DATE', style: 'kvKey' },
              { text: fmtDate(state.signature.date) || ' ', fontSize: 13, color: COLOR.ink, bold: true, margin: [0, 6, 0, 6] },
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.6, lineColor: COLOR.ink }] },
            ],
          },
        ],
      },
      {
        margin: [0, 22, 0, 0],
        stack: [
          { text: 'SIGNATURE', style: 'kvKey' },
          state.signature.dataUrl
            ? { image: state.signature.dataUrl, fit: [260, 90], margin: [0, 8, 0, 6] }
            : { text: '(not signed)', italics: true, color: COLOR.subtle, margin: [0, 12, 0, 8] },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 460, y2: 0, lineWidth: 0.6, lineColor: COLOR.ink }] },
        ],
      },
    ],
  };
}

function termsPage() {
  return {
    pageBreak: 'before',
    stack: [
      { text: 'SECTION 9', style: 'sectionTag' },
      { text: 'Terms and conditions', style: 'sectionTitle', margin: [0, 4, 0, 12] },
      { text: 'DISCLAIMER', style: 'sectionTag', margin: [0, 6, 0, 4] },
      { ul: state.terms.disclaimer.map(t => ({ text: t, fontSize: 9.5, color: COLOR.ink, margin: [0, 0, 0, 3] })), color: COLOR.navy },
      { text: BUSINESS.name + ' does not check the following items', style: 'sectionTag', margin: [0, 14, 0, 4] },
      { ul: state.terms.notChecked.map(t => ({ text: t, fontSize: 9.5, color: COLOR.ink, margin: [0, 0, 0, 2] })), color: COLOR.navy },
    ],
  };
}

/* ────────────────────────────────────────────────────────────────────
   Bootstrap — wait for assets, render the form, set up the sig pad.
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
  const id     = get('id');

  // Stash for the send step (email is not a form field)
  PREFILL = { email, phone, rego, name, id };

  if (name)   setByPath(state, 'client.contact', name);
  if (phone)  setByPath(state, 'client.phone', phone);
  if (suburb) setByPath(state, 'client.address', suburb);
  if (rego)   setByPath(state, 'inspection.registration', rego);
  if (make)   setByPath(state, 'inspection.makeModel', make);
  if (year)   setByPath(state, 'inspection.year', year);
  if (suburb) setByPath(state, 'inspection.location', suburb);
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

  const docDef = buildReportDoc();
  const firstName = (PREFILL.name || '').split(/\s+/)[0] || 'there';
  const rego = state.inspection.registration || PREFILL.rego || '';
  const filename = 'inspection-' + (rego || 'mmqld') + '.pdf';
  const subject = 'Your vehicle inspection report';
  const bodyText =
`Hi ${firstName},

Please find your vehicle inspection report attached. Happy to talk through anything in it.

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
      await saveInspectionRecord(b64);
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

function init() {
  if (!window.MMQLD_ASSETS) {
    setTimeout(init, 30);
    return;
  }
  applyPrefill();
  renderForm();
  setupSignature();
}
init();

})();
