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
  phone:   '0451 159 954',
  email:   'mymechanicqld@gmail.com',
  website: 'www.mymechanicqld.com.au',
  abn:     '85 829 529 258',
};

/* ────────────────────────────────────────────────────────────────────
   Inspection schema — sections and criteria from the reference PDF.
   Editing this block updates the form, completion tracking, and the
   PDF render in lockstep.
   ─────────────────────────────────────────────────────────────────── */
const GRADES = ['Good', 'Fair', 'Poor', 'NA'];

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
    assetFolder: uid(),
    reportNumber: autoReportNumber(),
    reportDate: today(),
    appointmentDate: today(),
    appointmentStart: '',
    appointmentEnd: '',
    client: { contact: '', address: '', phone: '', email: '' },
    inspection: {
      registration: '',
      makeModel: '',
      year: '',
      location: '',
      date: today(),
      odometer: '',
    },
    sections: blankSections(),
    images: [], // Stored as paths; new unsaved images temporarily include dataUrl fields.
    overall: 'Fair',
    score: null,          // 0 to 100 in tens, drawn as the gauge; null = not scored
    coverImage: null,     // one landscape photo of the whole car for the cover
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
  s.sections.exterior.grades[5] = 'Poor';
  s.sections.exterior.grades[6] = 'Poor';
  s.sections.exterior.grades[7] = 'Poor';
  s.sections.exterior.comments = 'Req. front shockies and bump stop kit. Control arm bushes have some minor cracks. Rear shockies and bump stop are on their way out.';
  s.sections.engine.grades[2] = 'Poor';
  s.sections.engine.comments = 'Signs of minor leaks from multiple seals and gaskets.';
  s.sections.tyres.grades[0] = 'Poor';
  s.sections.tyres.grades[1] = 'Poor';
  s.sections.tyres.grades[4] = 'Poor';
  s.sections.tyres.grades[5] = 'Poor';
  s.sections.tyres.grades[6] = 'NA';
  s.sections.tyres.grades[7] = 'NA';
  s.sections.tyres.grades[8] = 'NA';
  s.sections.tyres.comments = 'Noisy tyres. Rims have some minor gutter damage.';
  s.sections.roadtest.grades[2] = 'Poor';
  s.sections.roadtest.grades[4] = 'Poor';
  s.sections.roadtest.grades[6] = 'Poor';
  s.sections.roadtest.grades[7] = 'Poor';
  s.sections.roadtest.comments = 'Transmission is playing up here and there. Req. front pads and rotors all around soon. Steering and suspension needs attention. Jack is missing.';
  return s;
}

let state = newState();
/* The form as last loaded or saved; anything different is unsaved. Photo
   bodies are left out of the comparison: their ids already change. */
let CLEAN = '';
const snapshot = () => JSON.stringify(state, (k, v) => (k === 'dataUrl' || k === 'thumbDataUrl' ? undefined : v));
function markClean() { CLEAN = snapshot(); }

/* URL-param prefill — populated in init() from the query string. Kept
   separately so sending and inquiry linkage work with older saved state. */
let PREFILL = { email: '', phone: '', rego: '', name: '', id: '' };
/* When editing a saved report, its row id. Save then updates that record. */
let EDIT_ID = null;
let CURRENT_PDF_PATH = '';
let REMOVED_IMAGE_PATHS = [];
let imagePage = 0;
const IMAGE_PAGE_SIZE = 24;
const INSPECTION_BUCKET = () => CONFIG.STORAGE.inspections;

function publicImageUrl(path) {
  if (!path) return '';
  return window.MMQLD_STORE
    ? MMQLD_STORE.publicUrl(INSPECTION_BUCKET(), path)
    : CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/' + INSPECTION_BUCKET() + '/' + path;
}

function imagePreviewSrc(img) {
  return img.thumbDataUrl || (img.thumbPath && publicImageUrl(img.thumbPath)) || img.dataUrl || (img.path && publicImageUrl(img.path)) || '';
}

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
    <button type="button" class="grade" data-overall="${g}" data-grade="${g}" aria-pressed="${g === state.overall}">${g}</button>
  `).join('');
}

/* Score slider: 0 to 100 in tens. Untouched means not scored, and the PDF
   then shows the verdict without a gauge. */
function renderScore() {
  const box = $('#scoreBox');
  if (!box) return;
  const v = state.score;
  box.dataset.set = v == null ? 'false' : 'true';
  $('#scoreRange').value = v == null ? 60 : v;
  $('#scoreValue').textContent = v == null ? 'Not scored' : v;
  const g = v == null ? null : window.MMQLD_REPORT.scoreGrade(v);
  box.dataset.grade = g || '';
  const pct = (v == null ? 60 : v);
  $('#scoreRange').style.setProperty('--pct', pct + '%');
}

function renderCover() {
  const box = $('#coverBox');
  if (!box) return;
  const img = state.coverImage;
  const src = img ? (img.thumbDataUrl || img.dataUrl || (img.thumbPath && publicImageUrl(img.thumbPath)) || (img.path && publicImageUrl(img.path))) : '';
  box.dataset.has = src ? 'true' : 'false';
  $('#coverPreview').innerHTML = src ? `<img src="${escA(src)}" alt="Cover photo" />` : '';
}

function renderImages() {
  $('#imageCount').textContent = state.images.length;
  const pageCount = Math.max(1, Math.ceil(state.images.length / IMAGE_PAGE_SIZE));
  imagePage = Math.max(0, Math.min(imagePage, pageCount - 1));
  const start = imagePage * IMAGE_PAGE_SIZE;
  const shown = state.images.slice(start, start + IMAGE_PAGE_SIZE);
  $('#imageGrid').innerHTML = shown.map(img => `
    <div class="img-item" data-img="${img.id}">
      <img src="${escA(imagePreviewSrc(img))}" alt="Inspection image" loading="lazy" decoding="async" />
      <input class="img-item__caption" type="text" placeholder="Caption (optional)"
             value="${escA(img.caption)}" data-img-caption="${img.id}" />
      <button type="button" class="img-item__rm" data-img-rm="${img.id}" aria-label="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
  const pager = $('#imagePager');
  if (pager) {
    pager.hidden = state.images.length <= IMAGE_PAGE_SIZE;
    pager.innerHTML = `
      <button type="button" class="image-pager__btn" data-img-page="prev" ${imagePage === 0 ? 'disabled' : ''}>Previous</button>
      <span>Images ${state.images.length ? start + 1 : 0}-${Math.min(start + IMAGE_PAGE_SIZE, state.images.length)} of ${state.images.length}</span>
      <button type="button" class="image-pager__btn" data-img-page="next" ${imagePage >= pageCount - 1 ? 'disabled' : ''}>Next</button>`;
  }
}

/* Reports saved before "Poor" replaced "Repair", or before the score and
   cover photo existed, are brought up to date whenever one is opened. */
function normaliseState() {
  const fix = (g) => (g === 'Repair' ? 'Poor' : g);
  Object.values(state.sections || {}).forEach((sec) => { sec.grades = (sec.grades || []).map(fix); });
  state.overall = fix(state.overall || 'Fair');
  if (state.score === undefined || state.score === '') state.score = null;
  if (state.coverImage === undefined) state.coverImage = null;
}

function renderForm() {
  normaliseState();
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
  renderScore();
  renderCover();
  renderImages();
  updateProgress();
}

/* ─── Completion + progress tracking ─── */
function countFlags(secId) {
  return state.sections[secId].grades.filter(g => g === 'Poor' || g === 'NA').length;
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

  if (t.id === 'scoreRange') {
    state.score = Math.round(Number(t.value) / 10) * 10;
    // The score suggests the verdict; he can still tap a different one.
    state.overall = window.MMQLD_REPORT.scoreGrade(state.score);
    renderOverall();
    renderScore();
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

  if (e.target.closest('#scoreClear')) {
    state.score = null;
    renderScore();
    return;
  }

  if (e.target.closest('#coverRemove')) {
    const c = state.coverImage;
    if (c) REMOVED_IMAGE_PATHS.push(...[c.path, c.thumbPath].filter(Boolean));
    state.coverImage = null;
    renderCover();
    return;
  }

  // Image remove
  const rm = e.target.closest('[data-img-rm]');
  if (rm) {
    const removed = state.images.find(x => x.id === rm.dataset.imgRm);
    if (removed) REMOVED_IMAGE_PATHS.push(...[removed.path, removed.thumbPath].filter(Boolean));
    state.images = state.images.filter(x => x.id !== rm.dataset.imgRm);
    renderImages();
    updateProgress();
    return;
  }

  const page = e.target.closest('[data-img-page]');
  if (page) {
    imagePage += page.dataset.imgPage === 'next' ? 1 : -1;
    renderImages();
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
  if (e.target.id === 'coverInput' || e.target.id === 'coverInputGallery') {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      toast('Preparing cover photo...');
      const prepared = await prepareImage(f, 1600, 0.7);
      const old = state.coverImage;
      if (old) REMOVED_IMAGE_PATHS.push(...[old.path, old.thumbPath].filter(Boolean));
      state.coverImage = { id: uid(), caption: '', ...prepared };
      renderCover();
      if (prepared.height > prepared.width) toast('Tip: turn the phone sideways. Upright photos get cropped on the cover.');
    } catch (err) {
      console.error(err);
      toast('Could not load that photo', 'error');
    }
    return;
  }
  if (e.target.id !== 'imgInput' && e.target.id !== 'imgInputGallery') return;
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  toast(`Processing ${files.length} image${files.length > 1 ? 's' : ''}…`);
  for (const f of files) {
    try {
      const prepared = await prepareImage(f);
      state.images.push({ id: uid(), caption: '', ...prepared });
    } catch (err) {
      console.error(err);
      toast('Failed to load ' + f.name, 'error');
    }
  }
  e.target.value = '';
  renderImages();
  updateProgress();
});

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderCompressed(img, maxDim, quality) {
  let { width, height } = img;
  const ratio = Math.min(1, maxDim / Math.max(width, height));
  width = Math.max(1, Math.round(width * ratio));
  height = Math.max(1, Math.round(height * ratio));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = c.toDataURL('image/jpeg', quality);
  const bytes = Math.max(0, Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75));
  return { dataUrl, width, height, bytes };
}

async function prepareImage(file, maxDim, quality) {
  const source = await loadImageFile(file);
  const master = renderCompressed(source, maxDim || 1024, quality || 0.60);
  const thumb = renderCompressed(source, 320, 0.55);
  return {
    dataUrl: master.dataUrl,
    thumbDataUrl: thumb.dataUrl,
    width: master.width,
    height: master.height,
    bytes: master.bytes,
    mime: 'image/jpeg',
  };
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
  EDIT_ID = null;
  CURRENT_PDF_PATH = '';
  REMOVED_IMAGE_PATHS = [];
  imagePage = 0;
  renderForm();
  setupSignature();
  markClean();
  toast('New report started.');
});

/* Save — writes the report to the records so it shows in the Reports list. */
$('#saveBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.classList.contains('fab__btn--loading')) return;
  if (typeof pdfMake === 'undefined') { toast('Still loading, try again in a second', 'error'); return; }
  btn.classList.add('fab__btn--loading');
  try {
    await saveDraft({ quiet: true });
    await uploadPendingImages();
    await ensurePdfImages();
    const b64 = await reportPdfBase64();
    const saved = await saveInspectionRecord(b64);
    if (saved) bumpReportCounter();
  } catch (err) {
    console.error(err);
    toast('Could not save: ' + String((err && err.message) || err).slice(0, 120), 'error');
  } finally {
    btn.classList.remove('fab__btn--loading');
  }
});

/* Open a blank tab during the tap, then build the report after stored images load. */
$('#pdfBtn').addEventListener('click', async () => {
  if (typeof pdfMake === 'undefined') { toast('PDF library still loading. Try again in a second.', 'error'); return; }
  const win = window.open('', '_blank');
  if (!win) { toast('Allow pop-ups for this app, then tap Open again.', 'error'); return; }
  try { win.document.write('<title>Preparing report</title><p style="font:16px system-ui;padding:24px">Preparing inspection report...</p>'); } catch (_) {}
  try {
    await ensurePdfImages();
    pdfMake.createPdf(buildReportDoc()).open({}, win);
  } catch (err) {
    try { win.close(); } catch (_) {}
    console.error(err);
    toast('Could not open: ' + (err.message || err), 'error');
  }
});

function reportPdfBase64() {
  return new Promise((resolve, reject) => {
    try { pdfMake.createPdf(buildReportDoc()).getBase64(resolve); } catch (err) { reject(err); }
  });
}

function cleanStateForStorage() {
  const copy = JSON.parse(JSON.stringify(state));
  copy.images = (copy.images || []).map((img) => {
    delete img.dataUrl;
    delete img.thumbDataUrl;
    return img;
  });
  if (copy.coverImage) { delete copy.coverImage.dataUrl; delete copy.coverImage.thumbDataUrl; }
  return copy;
}

async function ensureThumbDataUrl(img) {
  if (img.thumbDataUrl) return img.thumbDataUrl;
  const sourceUrl = img.dataUrl || (img.path ? await MMQLD_STORE.fetchObjectDataUrl(INSPECTION_BUCKET(), img.path) : '');
  if (!sourceUrl) throw new Error('An image could not be prepared');
  const source = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = sourceUrl;
  });
  img.thumbDataUrl = renderCompressed(source, 320, 0.55).dataUrl;
  return img.thumbDataUrl;
}

async function uploadPendingImages() {
  if (!window.MMQLD_STORE) throw new Error('Storage helper not loaded. Refresh and try again.');
  if (!state.assetFolder) state.assetFolder = uid();
  // The cover photo is stored exactly like the others, just kept apart.
  const pending = [state.coverImage, ...state.images].filter((img) => img && !img.path && img.dataUrl);
  for (let i = 0; i < pending.length; i++) {
    const img = pending[i];
    const root = 'images/' + state.assetFolder + '/' + img.id;
    const masterPath = root + '.jpg';
    const thumbPath = root + '-thumb.jpg';
    if (pending.length > 2) toast('Saving image ' + (i + 1) + ' of ' + pending.length + '...');
    await MMQLD_STORE.uploadDataUrl(INSPECTION_BUCKET(), masterPath, img.dataUrl);
    try {
      await MMQLD_STORE.uploadDataUrl(INSPECTION_BUCKET(), thumbPath, await ensureThumbDataUrl(img));
    } catch (err) {
      await MMQLD_STORE.deleteObject(INSPECTION_BUCKET(), masterPath);
      throw err;
    }
    img.path = masterPath;
    img.thumbPath = thumbPath;
    img.mime = 'image/jpeg';
  }
}

async function ensurePdfImages() {
  const all = [state.coverImage, ...state.images].filter(Boolean);
  const missing = all.filter((img) => !img.dataUrl && img.path);
  let next = 0;
  async function worker() {
    while (next < missing.length) {
      const index = next++;
      const img = missing[index];
      img.dataUrl = await MMQLD_STORE.fetchObjectDataUrl(INSPECTION_BUCKET(), img.path);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
  // Photo rows are sized from each photo's proportions, so measure any
  // older photo saved without them rather than guess.
  await Promise.all(all.filter((img) => img.dataUrl && !(img.width && img.height)).map((img) => new Promise((resolve) => {
    const el = new Image();
    el.onload = () => { img.width = el.naturalWidth; img.height = el.naturalHeight; resolve(); };
    el.onerror = () => resolve();
    el.src = img.dataUrl;
  })));
  const unavailable = all.find((img) => !img.dataUrl);
  if (unavailable) throw new Error('One or more inspection images are unavailable');
}

/* ─── Drafts ─── */
const DRAFTS_KEY = 'mmqld_inspection_drafts_v2';
const DRAFT_DB = 'mmqld-owner';
const DRAFT_STORE = 'inspection-drafts';
let draftDbPromise = null;
function draftDb() {
  if (draftDbPromise) return draftDbPromise;
  draftDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DRAFT_STORE)) req.result.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Draft storage could not open'));
  });
  return draftDbPromise;
}
async function draftRequest(mode, action) {
  const db = await draftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, mode);
    const store = tx.objectStore(DRAFT_STORE);
    let req;
    try { req = action(store); } catch (e) { reject(e); return; }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Draft storage failed'));
  });
}
async function loadDrafts() {
  const rows = await draftRequest('readonly', (store) => store.getAll());
  return (rows || []).sort((a, b) => b.savedAt - a.savedAt);
}
async function migrateLegacyDrafts() {
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); } catch (_) {}
  for (const draft of legacy) await draftRequest('readwrite', (store) => store.put(draft));
  if (legacy.length) localStorage.removeItem(DRAFTS_KEY);
}
async function deleteDraft(id) {
  await draftRequest('readwrite', (store) => store.delete(id));
}
async function saveDraft(opts) {
  try {
    const id = state.reportNumber || uid();
    const draft = {
      id,
      name: state.inspection.makeModel || state.client.contact || 'Untitled',
      number: state.reportNumber,
      rego: state.inspection.registration,
      savedAt: Date.now(),
      state: JSON.parse(JSON.stringify(state)),
    };
    await draftRequest('readwrite', (store) => store.put(draft));
    const drafts = await loadDrafts();
    await Promise.all(drafts.slice(5).map((d) => deleteDraft(d.id)));
    localStorage.removeItem(DRAFTS_KEY);
    if (!(opts && opts.quiet)) toast('Draft saved.', 'success');
    return true;
  } catch (err) {
    toast('Could not save the draft on this device.', 'error');
    return false;
  }
}
async function renderDraftsList() {
  await migrateLegacyDrafts();
  const drafts = await loadDrafts();
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
$('#loadBtn').addEventListener('click', async () => {
  await renderDraftsList();
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
$('#draftsList').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    await deleteDraft(del.dataset.del);
    await renderDraftsList();
    return;
  }
  const ld = e.target.closest('[data-load]');
  if (ld) {
    const d = (await loadDrafts()).find(x => x.id === ld.dataset.load);
    if (!d) return;
    state = d.state;
    if (!state.assetFolder) state.assetFolder = uid();
    imagePage = 0;
    renderForm();
    setupSignature();
    $('#draftsPanel').hidden = true;
    $('#scrim').hidden = true;
    markClean();
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
      customer_email:  state.client.email || PREFILL.email || null,
      vehicle_rego:    v.registration || null,
      vehicle:         vehicle || null,
      odometer:        v.odometer || null,
      overall_rating:  state.overall || null,
      inspection_date: v.date || null,
      sections:        sections,
      comments:        state.overallComments || null,
      submission_id:   isUuid(PREFILL.id) ? PREFILL.id : null,
      // Full state so the report can be reopened and edited losslessly.
      state:           cleanStateForStorage(),
    };
    const res = EDIT_ID
      ? await MMQLD_STORE.updateInspection(EDIT_ID, meta, b64)
      : await MMQLD_STORE.saveInspection(meta, b64);
    if (res && res.id) EDIT_ID = res.id;   // further saves update the same record
    if (res && res.uploaded && res.path) {
      const oldPdf = CURRENT_PDF_PATH;
      CURRENT_PDF_PATH = res.path;
      if (oldPdf && oldPdf !== res.path) await MMQLD_STORE.deleteObject(INSPECTION_BUCKET(), oldPdf);
    }
    if (REMOVED_IMAGE_PATHS.length) {
      const paths = Array.from(new Set(REMOVED_IMAGE_PATHS));
      REMOVED_IMAGE_PATHS = [];
      await Promise.all(paths.map((path) => MMQLD_STORE.deleteObject(INSPECTION_BUCKET(), path)));
    }
    toast(res && !res.uploaded
      ? 'Report saved (PDF copy could not upload)'
      : 'This report has been saved', 'success');
    markClean();
    return true;
  } catch (err) {
    console.error(err);
    toast('Could not save: ' + String((err && err.message) || err).slice(0, 200), 'error');
    return false;
  }
}

/* The layout itself lives in report-pdf.js, which has no DOM access so the
   same file can be rendered and checked outside the browser. */
function buildReportDoc() {
  return window.MMQLD_REPORT.build(state, {
    business: BUSINESS,
    sections: SECTIONS,
    logo: window.MMQLD_ASSETS.logoPng,
  });
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
  const phone   = get('phone');
  const suburb  = get('suburb');
  const address = get('address');
  const rego    = get('rego');
  const make    = get('make');
  const year    = get('year');
  const id      = get('id');

  // Keep the original inquiry values for sending and record linkage.
  PREFILL = { email, phone, rego, name, id };

  if (name)   setByPath(state, 'client.contact', name);
  if (phone)  setByPath(state, 'client.phone', phone);
  if (email)  setByPath(state, 'client.email', email);
  // Prefer the full street address; fall back to suburb.
  if (address) setByPath(state, 'client.address', address);
  else if (suburb) setByPath(state, 'client.address', suburb);
  if (rego)   setByPath(state, 'inspection.registration', rego);
  if (make)   setByPath(state, 'inspection.makeModel', make);
  if (year)   setByPath(state, 'inspection.year', year);
  if (suburb) setByPath(state, 'inspection.location', suburb);
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
  const email = state.client.email || PREFILL.email;
  if (!email) {
    toast('Add the client email above first', 'error');
    return;
  }

  const firstName = (state.client.contact || PREFILL.name || '').split(/\s+/)[0] || 'there';
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

  try {
    await uploadPendingImages();
    await ensurePdfImages();
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), 'error');
    btn.disabled = false; btn.classList.remove('fab__btn--loading'); btn.innerHTML = original;
    return;
  }

  pdfMake.createPdf(buildReportDoc()).getBase64(async (b64) => {
    try {
      const thread = await MMQLD_GMAIL.findThread(email, PREFILL.rego || state.inspection.registration);
      await MMQLD_GMAIL.sendWithAttachment({
        to: email, subject, bodyText, filename, pdfBase64: b64, thread,
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

// Load an existing saved report into state for editing.
async function loadForEdit(id) {
  try {
    const url = CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/inspection_reports?id=eq.' + encodeURIComponent(id) + '&select=*';
    const r = await fetch(url, { headers: { apikey: CONFIG.SUPABASE_KEY } });
    const rows = await r.json();
    const row = rows && rows[0];
    if (!row) { toast('Report not found'); return; }
    if (row.state && typeof row.state === 'object') {
      state = row.state;
    } else {
      // Older report saved before the full-state column: rebuild what we can.
      state = newState();
      state.reportNumber = row.report_number || state.reportNumber;
      state.client.contact = row.customer_name || '';
      state.client.phone = row.customer_phone || '';
      state.inspection.registration = row.vehicle_rego || '';
      state.inspection.makeModel = row.vehicle || '';
      state.inspection.odometer = row.odometer || '';
      state.inspection.date = row.inspection_date || state.inspection.date;
      state.overall = row.overall_rating || state.overall;
      state.overallComments = row.comments || '';
      if (Array.isArray(row.sections)) {
        row.sections.forEach((sec) => {
          const tgt = state.sections[sec.id];
          if (tgt) {
            tgt.comments = sec.comments || '';
            (sec.criteria || []).forEach((c, idx) => { if (Array.isArray(tgt.grades) && idx < tgt.grades.length) tgt.grades[idx] = c.grade; });
          }
        });
      }
    }
    if (!state.signature) state.signature = { name: '', date: today(), dataUrl: '' };
    if (!state.images) state.images = [];
    if (!state.assetFolder) state.assetFolder = uid();
    state.images = state.images.map((img) => ({ id: img.id || uid(), caption: '', ...img }));
    if (!state.client) state.client = { contact: '', address: '', phone: '', email: '' };
    if (!state.client.email && row.customer_email) state.client.email = row.customer_email;
    EDIT_ID = id;
    CURRENT_PDF_PATH = row.pdf_path || '';
    REMOVED_IMAGE_PATHS = [];
    imagePage = 0;
    PREFILL = { email: state.client.email || row.customer_email || '', phone: state.client.phone || '', rego: state.inspection.registration || '', name: state.client.contact || '', id: row.submission_id || '' };
    const hero = document.querySelector('.hero h1'); if (hero) hero.textContent = 'Edit report';
  } catch (e) {
    toast('Could not load report for editing');
  }
}

/* ────────────────────────────────────────────────────────────────────
   Customer type-ahead — picking a past customer fills the client and
   vehicle details in one tap.
   ─────────────────────────────────────────────────────────────────── */
function fillFromCustomer(c) {
  const addr = MMQLD_CUSTOMERS.fullAddress(c);
  state.client.contact = c.name || c.business || '';
  if (c.phone) state.client.phone = c.phone;
  if (c.email) state.client.email = c.email;
  if (addr) state.client.address = addr;
  if (c.rego) state.inspection.registration = c.rego;
  if (c.make) state.inspection.makeModel = c.make;
  if (c.year) state.inspection.year = c.year;
  if (addr && !state.inspection.location) state.inspection.location = addr;

  PREFILL = {
    email: c.email || '',
    phone: c.phone || '',
    rego: c.rego || '',
    name: state.client.contact,
    id: c.submissionId || '',
  };
  renderForm();
  toast('Filled from ' + state.client.contact, 'success');
}

function setupCustomerLookup() {
  if (!window.MMQLD_CUSTOMERS) return;
  MMQLD_CUSTOMERS.attach($('[data-bind="client.contact"]'), { mode: 'person', onPick: fillFromCustomer });
}

function init() {
  if (!window.MMQLD_ASSETS) {
    setTimeout(init, 30);
    return;
  }
  const editId = new URLSearchParams(location.search).get('edit');
  (async () => {
    if (editId) await loadForEdit(editId);
    else applyPrefill();
    renderForm();
    setupSignature();
    setupCustomerLookup();
    markClean();
    // Ask before leaving with unsaved work (logo, phone back, closing the tab).
    if (window.MMQLD_LEAVE) {
      MMQLD_LEAVE.init({
        isDirty: () => snapshot() !== CLEAN,
        saveDraft: async () => { if (!(await saveDraft({ quiet: true }))) throw new Error('Could not save the draft.'); },
        backUrl: '../index.html',
      });
    }
  })();
}
init();

})();
