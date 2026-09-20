/* ────────────────────────────────────────────────────────────────────
   Inspection report PDF: the pdfmake document definition.

   Kept apart from the form code on purpose. It takes plain data and
   returns a document, with no DOM access, so the same file renders in
   the browser and in a Node script when the layout is being tuned.

     MMQLD_REPORT.build(state, { business, sections, logo }) -> docDefinition

   Layout rules that matter:
   - A filled table cell that breaks across a page makes pdfmake paint its
     background over the wrong page. Every filled block here is therefore
     unbreakable, which is also what keeps a section in one piece.
   - Photos flow continuously in justified rows. Every photo in a row is
     the same height, so a portrait never towers over a landscape beside it,
     and nothing forces a page break between rows.
   ─────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  const PAGE_W = 595.28, PAGE_H = 841.89;
  const SIDE = 40;
  const CONTENT_W = PAGE_W - SIDE * 2;
  const BAND_H = 56, FOOT_H = 34;

  const C = {
    navy: '#1E3A8A', navyDeep: '#172554', navyBright: '#2563EB', navyTint: '#EEF2FB',
    gold: '#C9A227', goldDeep: '#A8841A', goldTint: '#FBF6E6',
    ink: '#0C0A09', muted: '#44403C', subtle: '#78716C', faint: '#A8A29E',
    hairline: '#E7E5E0', soft: '#F7F6F2', white: '#FFFFFF',
  };

  /* Subtle chips: tinted background, darker text of the same hue. */
  const GRADE = {
    Good: { bg: '#E6F4EA', fg: '#166534', bar: '#22A052', label: 'Good' },
    Fair: { bg: '#FDF3DC', fg: '#8A5A07', bar: '#E0A526', label: 'Fair' },
    Poor: { bg: '#FCE8E6', fg: '#B42318', bar: '#DC4B3E', label: 'Poor' },
    NA:   { bg: '#F1F0ED', fg: '#57534E', bar: '#C9C5BD', label: 'N/A' },
  };
  const ORDER = ['Good', 'Fair', 'Poor', 'NA'];

  /* Older reports used "Repair" for what is now "Poor". */
  const norm = (g) => (g === 'Repair' ? 'Poor' : (GRADE[g] ? g : 'Fair'));

  const fmtDate = (s) => {
    if (!s) return '';
    const d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s);
    return isNaN(d) ? String(s) : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const clean = (s) => String(s == null ? '' : s).trim();
  const has = (s) => clean(s) !== '' && clean(s) !== '—';

  /* Score to verdict, used when a score is given without a grade change. */
  function scoreGrade(score) {
    if (score == null) return null;
    return score >= 75 ? 'Good' : score >= 45 ? 'Fair' : 'Poor';
  }

  /* ─────────────────────────────────────────────────────── building blocks */

  const eyebrow = (text, color, extra) => Object.assign(
    { text: text.toUpperCase(), fontSize: 7.5, bold: true, characterSpacing: 1.6, color: color || C.goldDeep }, extra || {});

  function chip(grade, size) {
    const g = GRADE[norm(grade)];
    return {
      table: { widths: [size && size > 9 ? 44 : 32], body: [[{ text: g.label, fontSize: size || 8.5, bold: true, color: g.fg, fillColor: g.bg, margin: [0, 2, 0, 2], border: [false, false, false, false], alignment: 'center' }]] },
      layout: { defaultBorder: false, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    };
  }

  /* A card: tinted panel with an accent bar down its left edge. */
  function card(content, opts) {
    const o = opts || {};
    return {
      unbreakable: true,
      margin: o.margin || [0, 0, 0, 0],
      table: {
        widths: ['*'],
        body: [[{ stack: [].concat(content), fillColor: o.fill || C.soft, margin: o.pad || [14, 11, 14, 12], border: [false, false, false, false] }]],
      },
      layout: {
        defaultBorder: false,
        vLineWidth: (i) => (i === 0 && o.bar !== false ? 3 : 0),
        vLineColor: () => o.barColor || C.gold,
        hLineWidth: () => 0,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      },
    };
  }

  /* Stacked distribution bar drawn as rectangles. */
  function distBar(counts, width, height) {
    const total = ORDER.reduce((n, k) => n + (counts[k] || 0), 0) || 1;
    const rects = [{ type: 'rect', x: 0, y: 0, w: width, h: height, r: height / 2, color: '#EFEDE8' }];
    let x = 0;
    ORDER.forEach((k) => {
      const w = (counts[k] || 0) / total * width;
      if (w > 0) { rects.push({ type: 'rect', x, y: 0, w, h: height, color: GRADE[k].bar }); x += w; }
    });
    return { canvas: rects, width };
  }

  function kvRows(rows) {
    return rows.filter(([, v]) => has(v)).map(([k, v]) => ({
      columns: [
        { width: 78, text: k, fontSize: 8.5, color: C.subtle, margin: [0, 1, 0, 0] },
        { width: '*', text: clean(v), fontSize: 10, color: C.ink, bold: true },
      ],
      margin: [0, 0, 0, 5],
    }));
  }

  /* ───────────────────────────────────────────────────────────── the cover */

  /* The rego always appears. A blank or "NA" rego still gets the plate,
     greyed out and reading N/A, so it is plainly stated rather than missing. */
  const regoText = (rego) => {
    const t = clean(rego).toUpperCase();
    return !t || /^N\/?A$/.test(t) ? '' : t;
  };
  function plate(rego) {
    const real = regoText(rego);
    const text = real || 'N/A';
    const ink = real ? '#7A1F2B' : C.faint;
    return {
      width: 'auto',
      table: {
        body: [[{
          stack: [
            { text: 'REGO', fontSize: 5.5, bold: true, characterSpacing: 1.8, color: ink, alignment: 'center' },
            { text, fontSize: 19, bold: true, characterSpacing: 2.5, color: ink, alignment: 'center', margin: [0, 0, 0, 1] },
          ],
          margin: [12, 4, 12, 3],
        }]],
      },
      layout: {
        hLineWidth: () => 1.4, vLineWidth: () => 1.4,
        hLineColor: () => ink, vLineColor: () => ink,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      },
    };
  }

  function cover(state, stats, opts) {
    const v = state.inspection || {};
    const cl = state.client || {};
    const title = clean(v.makeModel) || 'Vehicle inspection';
    const sub = [clean(v.year), v.odometer ? Number(String(v.odometer).replace(/[^0-9.]/g, '')).toLocaleString('en-AU') + ' km' : ''].filter(Boolean).join('  ·  ');

    const out = [];
    const pl = plate(v.registration);
    out.push({
      columns: [
        {
          width: '*',
          stack: [
            eyebrow('Vehicle inspection report'),
            { text: title, fontSize: 26, bold: true, color: C.ink, characterSpacing: -0.4, margin: [0, 5, 0, 0], lineHeight: 1.05 },
            sub ? { text: sub, fontSize: 11, color: C.muted, margin: [0, 4, 0, 0] } : null,
          ].filter(Boolean),
        },
        Object.assign(pl, { margin: [12, 6, 0, 0] }),
      ],
    });

    // Report reference line.
    // Only a real time range: stray single characters were being printed.
    const okTime = (t) => /\d{1,2}(:\d{2})?\s*(am|pm)|\d{1,2}:\d{2}/i.test(clean(t));
    const appt = [state.appointmentStart, state.appointmentEnd].filter(okTime).map(clean).join(' to ');
    out.push({
      margin: [0, 10, 0, 0],
      text: [
        { text: 'Report  ', color: C.subtle }, { text: clean(state.reportNumber) || '', bold: true, color: C.ink },
        { text: '      Inspected  ', color: C.subtle }, { text: fmtDate(v.date || state.reportDate), bold: true, color: C.ink },
        appt ? { text: '      Appointment  ', color: C.subtle } : '', appt ? { text: appt, bold: true, color: C.ink } : '',
      ],
      fontSize: 8.5,
    });

    out.push({ margin: [0, 12, 0, 0], canvas: [{ type: 'rect', x: 0, y: 0, w: CONTENT_W, h: 2, color: C.gold }] });

    // Customer first, then the car, above the photo.
    const customer = card([
      eyebrow('Prepared for', C.navy, { margin: [0, 0, 0, 7] }),
      ...kvRows([['Name', cl.contact], ['Phone', cl.phone], ['Email', cl.email], ['Address', cl.address]]),
    ], { barColor: C.navy });
    const vehicle = card([
      eyebrow('Vehicle', C.navy, { margin: [0, 0, 0, 7] }),
      ...kvRows([
        ['Make & model', v.makeModel], ['Year', v.year],
        ['Rego', regoText(v.registration) || 'N/A'],
        ['Odometer', v.odometer ? Number(String(v.odometer).replace(/[^0-9.]/g, '')).toLocaleString('en-AU') + ' km' : ''],
        ['Inspected at', v.location],
      ]),
    ], { barColor: C.navy });
    const cell = (c) => ({ stack: c.table.body[0][0].stack, fillColor: C.soft, margin: [14, 11, 14, 8], border: [false, false, false, false] });
    out.push({
      unbreakable: true, margin: [0, 14, 0, 0],
      table: { widths: ['*', 12, '*'], body: [[cell(customer), { text: '', border: [false, false, false, false] }, cell(vehicle)]] },
      layout: {
        defaultBorder: false, hLineWidth: () => 0,
        vLineWidth: (i) => (i === 0 || i === 2 ? 3 : 0), vLineColor: () => C.navy,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      },
    });

    // Cover photo, never cropped: a fixed height with the width following the
    // photo's own proportions, centred. A very wide photo is capped at the
    // page width and loses a little height instead.
    const img = state.coverImage;
    if (img && img.dataUrl) {
      const ratio = (Number(img.width) || 4) / (Number(img.height) || 3);
      let h = 222, w = h * ratio;
      if (w > CONTENT_W) { w = CONTENT_W; h = w / ratio; }
      out.push({ margin: [0, 16, 0, 0], columns: [{ width: '*', text: '' }, { width: w, stack: [{ image: img.dataUrl, width: w, height: h }] }, { width: '*', text: '' }] });
    }

    out.push(glance(stats));
    return out;
  }

  /* Section by section: distribution, counts and what needs attention. */
  function glance(stats) {
    const head = (t, align) => ({ text: t, fontSize: 7, bold: true, characterSpacing: 1.2, color: C.subtle, alignment: align || 'left', margin: [0, 0, 0, 3] });
    const num = (n, k) => ({ text: n ? String(n) : '·', fontSize: 9.5, bold: !!n, color: n ? GRADE[k].fg : C.faint, alignment: 'center' });
    const body = [[head('SECTION'), head('RESULT'), head('GOOD', 'center'), head('FAIR', 'center'), head('POOR', 'center'), head('NEEDS ATTENTION')]];
    stats.sections.forEach((s) => {
      body.push([
        { text: s.title, fontSize: 9.5, bold: true, color: C.ink },
        { stack: [distBar(s.counts, 74, 6)], margin: [0, 3, 0, 0] },
        num(s.counts.Good, 'Good'), num(s.counts.Fair, 'Fair'), num(s.counts.Poor, 'Poor'),
        { text: s.poor.length ? s.poor.join(', ') : 'Nothing flagged', fontSize: 8.5, color: s.poor.length ? GRADE.Poor.fg : C.subtle, italics: !s.poor.length },
      ]);
    });
    // Not unbreakable: a car with many faults may run this onto page two,
    // and the column headings repeat there.
    return {
      margin: [0, 16, 0, 0],
      stack: [
        { columns: [eyebrow('At a glance', C.goldDeep), { width: 'auto', text: stats.checked + ' checks  ·  ' + stats.totals.Poor + ' need attention', fontSize: 8, color: C.subtle }], margin: [0, 0, 0, 6] },
        {
          table: { widths: [104, 78, 30, 30, 30, '*'], body, headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true },
          layout: {
            hLineWidth: (i, node) => (i === 1 || (i > 1 && i < node.table.body.length) ? 0.6 : 0),
            hLineColor: () => C.hairline, vLineWidth: () => 0,
            paddingTop: (i) => (i === 0 ? 0 : 5), paddingBottom: (i) => (i === 0 ? 2 : 5),
            paddingLeft: (i) => (i === 0 ? 0 : 4), paddingRight: () => 4,
          },
        },
      ],
    };
  }

  /* ──────────────────────────────────────────────────────── the sections */

  function sectionBlock(sec, sst, idx) {
    const grades = (sst.grades || []).map(norm);
    const counts = { Good: 0, Fair: 0, Poor: 0, NA: 0 };
    grades.forEach((g) => { counts[g]++; });
    const summary = ORDER.filter((k) => counts[k]).map((k) => ({ text: counts[k] + ' ' + GRADE[k].label, color: GRADE[k].fg, bold: true }));
    const sumLine = [];
    summary.forEach((t, i) => { if (i) sumLine.push({ text: '   ', color: C.faint }); sumLine.push(t); });

    // Two criteria per row: label on the left, chip on the right.
    const rows = [];
    for (let i = 0; i < sec.criteria.length; i += 2) {
      const cell = (j) => (j < sec.criteria.length
        ? [{ text: sec.criteria[j], fontSize: 9.5, color: C.ink, margin: [0, 3, 0, 0] }, Object.assign(chip(grades[j] || 'Fair', 8), { alignment: 'right' })]
        : [{ text: '' }, { text: '' }]);
      rows.push([...cell(i), { text: '' }, ...cell(i + 1)]);
    }
    /* The title is the table's header row: if the section runs over a page
       it repeats there, and it is never left stranded at the bottom. Rows
       carry only hairlines, no fills, so breaking between them is safe. */
    const head = {
      colSpan: 5,
      stack: [
        {
          columns: [
            // The number is centred across exactly the circle's 22pt width.
            { width: 22, stack: [{ canvas: [{ type: 'ellipse', x: 11, y: 11, r1: 11, r2: 11, color: C.navy }] }, { text: String(idx + 1), color: C.white, bold: true, fontSize: 10, alignment: 'center', relativePosition: { x: 0, y: -16.6 } }] },
            { width: '*', text: sec.title, fontSize: 15, bold: true, color: C.ink, margin: [7, 2, 0, 0] },
            { width: 'auto', text: sumLine, fontSize: 8.5, margin: [0, 6, 0, 0] },
          ],
        },
        { margin: [0, 8, 0, 4], stack: [distBar(counts, CONTENT_W, 3)] },
      ],
    };
    // Notes ride in the last row, so they can never be split from their
    // section. A row never breaks (dontBreakRows), so its fill stays put.
    const notes = clean(sst.comments) ? [[{
      colSpan: 5,
      margin: [0, 6, 0, 0],
      table: {
        widths: ['*'],
        body: [[{
          stack: [eyebrow('Inspector notes', C.goldDeep), { text: clean(sst.comments), fontSize: 9.5, color: C.muted, margin: [0, 4, 0, 0], lineHeight: 1.4 }],
          fillColor: C.goldTint, margin: [14, 10, 14, 11], border: [false, false, false, false],
        }]],
      },
      layout: { defaultBorder: false, hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => C.gold,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    }, {}, {}, {}, {}]] : [];
    return [{
      margin: [0, 0, 0, 22],
      table: { widths: ['*', 36, 18, '*', 36], headerRows: 1, keepWithHeaderRows: 3, dontBreakRows: true, body: [[head, {}, {}, {}, {}], ...rows, ...notes] },
      layout: {
        hLineWidth: (i, node) => (i > 1 && i < node.table.body.length - notes.length ? 0.5 : 0),
        hLineColor: () => C.hairline, vLineWidth: () => 0,
        paddingTop: (i) => (i === 0 ? 0 : 4), paddingBottom: () => 4, paddingLeft: () => 0, paddingRight: () => 0,
      },
    }];
  }

  /* ────────────────────────────────────────────────────────────── photos */

  /* Justified rows: grow a row until it overfills the width, then settle on
     whichever of "with" or "without" the last photo lands closest to the
     target height. Heights are capped so no row is taller than a normal
     landscape pair. */
  function photoRows(images, W, gap, H) {
    const aspect = (im) => {
      const a = (Number(im.width) || 4) / (Number(im.height) || 3);
      return Math.max(0.4, Math.min(a, 3));
    };
    const rows = [];
    let cur = [];
    const fitH = (list) => (W - gap * (list.length - 1)) / list.reduce((s, im) => s + aspect(im), 0);
    images.forEach((im) => {
      cur.push(im);
      if (fitH(cur) > H) return;             // still room at the target height
      const withH = fitH(cur);
      const without = cur.slice(0, -1);
      const withoutH = without.length ? fitH(without) : Infinity;
      if (without.length && withoutH <= H * 1.12 && (withoutH - H) < (H - withH)) {
        rows.push({ items: without, h: Math.min(withoutH, H * 1.12) });
        cur = [im];
      } else {
        rows.push({ items: cur, h: withH });
        cur = [];
      }
    });
    if (cur.length) rows.push({ items: cur, h: Math.min(H, fitH(cur)) });
    return rows.map((r) => ({ h: r.h, items: r.items.map((im) => ({ im, w: aspect(im) * r.h })) }));
  }

  function photosBlock(images) {
    const usable = (images || []).filter((im) => im && im.dataUrl);
    if (!usable.length) return [];
    const GAP = 7;
    const rows = photoRows(usable, CONTENT_W, GAP, 172);
    let n = 0;
    const body = rows.map((r) => {
      const withCaption = r.items.some((it) => clean(it.im.caption));
      return {
        unbreakable: true,
        margin: [0, 0, 0, GAP],
        columnGap: GAP,
        columns: r.items.map((it) => {
          n++;
          return {
            width: it.w,
            stack: [
              { image: it.im.dataUrl, width: it.w, height: r.h },
              withCaption ? { text: clean(it.im.caption) || ' ', fontSize: 7.5, color: C.muted, margin: [0, 3, 0, 0], italics: true } : null,
            ].filter(Boolean),
          };
        }),
      };
    });
    const heading = {
      margin: [0, 0, 0, 10],
      columns: [
        { width: '*', stack: [eyebrow('Photographs'), { text: 'Inspection photos', fontSize: 17, bold: true, color: C.ink, margin: [0, 3, 0, 0] }] },
        { width: 'auto', text: n + ' photos', fontSize: 8.5, color: C.subtle, margin: [0, 16, 0, 0] },
      ],
    };
    // Keep the heading with the first row of photos.
    return [{ unbreakable: true, stack: [heading, body[0]] }, ...body.slice(1)];
  }

  /* ──────────────────────────────────────────────────────── the verdict */

  /* Half-moon gauge as SVG: ten segments from red through amber to green,
     lit up to the score, with a needle. */
  function gaugeSvg(score) {
    const W = 300, H = 170, cx = 150, cy = 150, R = 118, T = 26;
    const cols = ['#D93A2B', '#E0512C', '#E86D2C', '#EE8A2A', '#F2A72A', '#E9B92C', '#C9BE2F', '#9DBA34', '#6CAF3A', '#3F9F44'];
    const pt = (deg, r) => { const a = Math.PI * (1 - deg / 180); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    let segs = '';
    for (let i = 0; i < 10; i++) {
      const a0 = i * 18 + 1.1, a1 = (i + 1) * 18 - 1.1;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, R - T), [x3, y3] = pt(a0, R - T);
      const lit = score != null && (i + 1) * 10 <= score;
      segs += `<path d="M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} A${R - T},${R - T} 0 0 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z" fill="${lit ? cols[i] : '#ECEAE4'}"/>`;
    }
    let ticks = '';
    [0, 50, 100].forEach((v) => {
      const [x, y] = pt(v * 1.8, R + 11);
      ticks += `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#78716C" text-anchor="middle">${v}</text>`;
    });
    let needle = '';
    if (score != null) {
      const [nx, ny] = pt(score * 1.8, R - T - 10);
      const [bx1, by1] = pt(score * 1.8 + 90, 6), [bx2, by2] = pt(score * 1.8 - 90, 6);
      needle = `<path d="M${bx1.toFixed(2)},${by1.toFixed(2)} L${nx.toFixed(2)},${ny.toFixed(2)} L${bx2.toFixed(2)},${by2.toFixed(2)} Z" fill="#1E3A8A"/>`
        + `<circle cx="${cx}" cy="${cy}" r="9" fill="#1E3A8A"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#FFFFFF"/>`;
    }
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${segs}${ticks}${needle}</svg>`;
  }

  function verdictBlock(state, stats) {
    const score = state.score == null || state.score === '' ? null : Math.max(0, Math.min(100, Math.round(Number(state.score) / 10) * 10));
    const grade = norm(state.overall || scoreGrade(score) || 'Fair');
    const g = GRADE[grade];
    const words = { Good: 'In good overall condition', Fair: 'In fair overall condition', Poor: 'In poor overall condition', NA: 'Not rated' };

    const left = score != null
      ? {
          width: 300,
          stack: [
            { svg: gaugeSvg(score), width: 300 },
            { text: [{ text: String(score), fontSize: 34, bold: true, color: C.ink }, { text: ' / 100', fontSize: 12, color: C.subtle }], alignment: 'center', margin: [0, 4, 0, 0] },
            { text: 'OVERALL SCORE', fontSize: 7, bold: true, characterSpacing: 1.6, color: C.subtle, alignment: 'center', margin: [0, 2, 0, 0] },
          ],
        }
      : null;

    const right = {
      width: '*',
      margin: left ? [18, 22, 0, 0] : [0, 0, 0, 0],
      stack: [
        eyebrow('Verdict', C.goldDeep),
        { text: words[grade], fontSize: 17, bold: true, color: C.ink, margin: [0, 4, 0, 8], lineHeight: 1.15 },
        { columns: [Object.assign(chip(grade, 10), { width: 'auto' }), { text: '' }] },
        clean(state.overallComments)
          ? { text: clean(state.overallComments), fontSize: 10, color: C.muted, lineHeight: 1.45, margin: [0, 12, 0, 0] }
          : null,
      ].filter(Boolean),
    };

    // The conclusion always opens a fresh page, so the verdict reads as the
    // report's final page rather than trailing the photos.
    return [{
      unbreakable: true,
      pageBreak: 'before',
      stack: [
        eyebrow('Conclusion'),
        { text: 'Overall assessment', fontSize: 20, bold: true, color: C.ink, margin: [0, 3, 0, 14] },
        card([{ columns: left ? [left, right] : [right] }], { fill: C.soft, bar: false, pad: [16, 16, 16, 16] }),
        score != null ? { text: 'The score reflects the inspector\'s overall judgement of the vehicle\'s condition on the day, taking every section of this report into account.', fontSize: 8, color: C.subtle, italics: true, margin: [0, 6, 0, 0] } : null,
      ].filter(Boolean),
    }, concerns(stats)];
  }

  /* Every Poor item in one place, grouped by section: the list a buyer
     actually takes to the seller. */
  function concerns(stats) {
    const groups = stats.sections.filter((s) => s.poor.length);
    if (!groups.length) {
      return { margin: [0, 18, 0, 0], stack: [eyebrow('Items needing attention', C.goldDeep), { text: 'Nothing was graded Poor in this inspection.', fontSize: 10, color: C.muted, margin: [0, 5, 0, 0] }] };
    }
    // One line per section, items run together: a long list of faults
    // stays short enough to share the page with the sign-off.
    const body = groups.map((s) => [
      { text: s.title, fontSize: 9, bold: true, color: C.ink },
      { text: s.poor.length, fontSize: 9, bold: true, color: GRADE.Poor.fg, alignment: 'center' },
      { text: s.poor.join('  \u00B7  '), fontSize: 9, color: C.muted, lineHeight: 1.35 },
    ]);
    return {
      margin: [0, 18, 0, 0],
      stack: [
        { columns: [eyebrow('Items needing attention', C.goldDeep), { width: 'auto', text: stats.totals.Poor + ' graded Poor', fontSize: 8, color: GRADE.Poor.fg, bold: true }], margin: [0, 0, 0, 4] },
        {
          table: { widths: [108, 18, '*'], body, dontBreakRows: true },
          layout: {
            hLineWidth: (i, node) => (i > 0 && i < node.table.body.length ? 0.5 : 0), hLineColor: () => C.hairline, vLineWidth: () => 0,
            paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 0, paddingRight: () => 6,
          },
        },
      ],
    };
  }

  function terms(state, business) {
    const t = state.terms || { disclaimer: [], notChecked: [] };
    return {
      pageBreak: 'before',
      stack: [
        eyebrow('The fine print'),
        { text: 'Terms and conditions', fontSize: 17, bold: true, color: C.ink, margin: [0, 3, 0, 12] },
        { text: 'Disclaimer', fontSize: 10, bold: true, color: C.navy, margin: [0, 0, 0, 5] },
        { ol: (t.disclaimer || []).map((x) => ({ text: x, margin: [0, 0, 0, 4] })), fontSize: 8.5, color: C.muted, lineHeight: 1.35 },
        { text: business.name + ' does not check the following', fontSize: 10, bold: true, color: C.navy, margin: [0, 14, 0, 5] },
        { columns: [0, 1].map((half) => {
            const list = t.notChecked || [];
            const mid = Math.ceil(list.length / 2);
            return { ul: (half ? list.slice(mid) : list.slice(0, mid)).map((x) => ({ text: x, margin: [0, 0, 0, 3] })), fontSize: 8.5, color: C.muted, markerColor: C.gold };
          }), columnGap: 16 },
      ],
    };
  }

  /* ───────────────────────────────────────────────────────── the document */

  function build(state, opts) {
    const business = opts.business;
    const SECTIONS = opts.sections;
    const logo = opts.logo;

    const stats = { sections: [], totals: { Good: 0, Fair: 0, Poor: 0, NA: 0 }, checked: 0 };
    SECTIONS.forEach((sec) => {
      const sst = (state.sections || {})[sec.id] || { grades: [] };
      const counts = { Good: 0, Fair: 0, Poor: 0, NA: 0 };
      const poor = [];
      sec.criteria.forEach((label, i) => {
        const g = norm((sst.grades || [])[i] || 'Fair');
        counts[g]++; stats.totals[g]++;
        if (g !== 'NA') stats.checked++;
        if (g === 'Poor') poor.push(label);
      });
      stats.sections.push({ title: sec.title, counts, poor });
    });

    const reportNo = clean(state.reportNumber);
    const footRego = regoText((state.inspection || {}).registration);

    return {
      pageSize: 'A4',
      pageMargins: [SIDE, BAND_H + 26, SIDE, FOOT_H + 16],
      defaultStyle: { font: 'Roboto', fontSize: 10, color: C.ink, lineHeight: 1.25 },
      info: { title: reportNo || 'Vehicle inspection report', author: business.name, subject: 'Vehicle inspection report' },

      background: function (page, size) {
        return {
          canvas: [
            { type: 'rect', x: 0, y: 0, w: size.width, h: BAND_H, color: C.navy },
            { type: 'rect', x: 0, y: BAND_H, w: size.width, h: 2.5, color: C.gold },
            { type: 'line', x1: SIDE, y1: size.height - FOOT_H - 10, x2: size.width - SIDE, y2: size.height - FOOT_H - 10, lineWidth: 0.6, lineColor: C.hairline },
          ],
        };
      },

      header: function () {
        return {
          margin: [SIDE, 13, SIDE, 0],
          columns: [
            logo ? { image: logo, width: 30, height: 30 } : { width: 0, text: '' },
            {
              width: '*', margin: [9, 3, 0, 0],
              stack: [
                { text: business.name, color: C.white, fontSize: 13, bold: true },
                { text: (business.tagline || '').toUpperCase(), color: '#C7D2F0', fontSize: 6.5, characterSpacing: 1.8, margin: [0, 1, 0, 0] },
              ],
            },
            {
              width: 'auto', alignment: 'right', margin: [0, 4, 0, 0],
              stack: [
                { text: business.phone + '   ' + business.website, color: C.white, fontSize: 8.5 },
                { text: [business.email, business.abn ? 'ABN ' + business.abn : ''].filter(Boolean).join('   '), color: '#C7D2F0', fontSize: 7.5, margin: [0, 2, 0, 0] },
              ],
            },
          ],
        };
      },

      footer: function (page, count) {
        return {
          margin: [SIDE, 16, SIDE, 0],
          columns: [
            { text: [{ text: business.name, bold: true, color: C.muted }, { text: '   Vehicle inspection report   Rego ' + (footRego || 'N/A'), color: C.subtle }], fontSize: 7.5 },
            { text: 'Page ' + page + ' of ' + count, fontSize: 7.5, color: C.subtle, alignment: 'right', width: 'auto' },
          ],
        };
      },

      content: [
        ...cover(state, stats, opts),
        { text: '', pageBreak: 'after' },
        { stack: [eyebrow('Findings'), { text: 'Inspection results', fontSize: 20, bold: true, color: C.ink, margin: [0, 3, 0, 4] },
          { text: 'Every item is graded Good, Fair or Poor. N/A marks something the vehicle does not have or that could not be checked.', fontSize: 9, color: C.subtle, margin: [0, 0, 0, 16] }] },
        ...SECTIONS.flatMap((sec, i) => sectionBlock(sec, (state.sections || {})[sec.id] || { grades: [] }, i)),
        ...photosBlock(state.images),
        ...verdictBlock(state, stats),
        terms(state, business),
      ],
    };
  }

  root.MMQLD_REPORT = { build, normGrade: norm, scoreGrade };
})(typeof window !== 'undefined' ? window : globalThis);
