/* Linkr — LinkedIn trial video, v3.
 * Every frame is a pure function of t (seconds): window.renderFrame(t) sets every style.
 * Nothing is animated by the browser, so the capture is deterministic. */
'use strict';

/* ======================================================================================
 * CONFIG — every timing and easing of the video lives HERE (seconds unless noted).
 * Easing names, in words:
 *   enter = 'outCubic'   « démarre vite, finit doucement »   (entries)
 *   exit  = 'inCubic'    « démarre doucement, accélère »      (exits)
 *   move  = 'inOutCubic' « démarre et finit doucement »       (moves inside a scene)
 *   pop   = 'outBack'    « démarre vite, dépasse un peu, se pose » (badges, zones, buttons)
 * Only the seamless loops (halo, zones, underline) are sine waves; nothing is linear.
 * ==================================================================================== */
/* CONFIG-START */
const CONFIG = {
  bpm: 100,                 // 1 beat = 0.6 s; every cut lands on a beat
  total: 45.0,
  scenes: {                 // [start, end]
    opening: [0.0, 4.8], needs: [4.8, 8.4], proximity: [8.4, 12.6], trust: [12.6, 16.8], price: [16.8, 20.4],
    quotes: [20.4, 25.8], payment: [25.8, 31.2], pros: [31.2, 36.0], soon: [36.0, 39.0], cta: [39.0, 45.0],
  },
  dur: { enter: 0.5, exit: 0.45, micro: 0.3, press: 0.2, morph: 0.5, stagger: 0.08, letters: 0.06, groupStagger: 0.1 },
  push: 0.35,               // push transition distance, fraction of the frame width
  loop: 2.4,                // period of every seamless loop (one bar)
  ease: { enter: 'outCubic', exit: 'inCubic', move: 'inOutCubic', pop: 'outBack' },
  at: {
    // 1 · opening (logo + hook visible from frame 0)
    hookSettle: 0.0, hookDim: 3.0, tagline: 3.0, taglineUnderline: 3.4, openingExit: 4.05, taglineToHeader: 4.5,
    // 3 · needs
    needsIn: 4.75, tradeChanges: [5.8, 6.6, 7.4], chipsIn: 5.0, openIn: 5.3,
    // 4 · proximity
    cap4: 8.5, meLabel: 8.9, zones: 9.0, zoneHighlight: 10.6, labelIn: 10.75,
    // 5 · trust (card evolves)
    cap5: 12.6, morph: 12.4, photos: 13.0, review: 13.5, stars: 13.8,
    // 6 · price (card evolves)
    cap6: 16.8, services: 16.85, priceFocus: 17.8, request: 18.6, slot: 18.9,
    // 7 · quotes
    cap7: 20.45, project: 20.5, seg: 20.7, quotes: [21.1, 21.2, 21.3], sortTap: 22.6, reorder: 22.7, best: 23.3, bar: 23.5, acceptTap: 24.4,
    // 8 · payment
    cap8: 25.85, head: 26.0, nodes: 26.1, checks: [26.7, 28.0, 29.3], fills: [[27.0, 27.8], [28.3, 29.1]], note: 29.5,
    // 9 · pros
    cap9: 31.25, panel: 31.4, toast: 32.0, toastOut: 33.6, acceptPro: 33.0, toJobs: 33.5, feeFocus: 33.9,
    // 10 · soon
    soonTitle: 36.1, soonTrades: 36.5, licences: 36.8, pics: 37.1,
    // 11 · call to action
    ctaLogo: 39.0, ctaOpen: 39.2, url: 39.45, urlUnderline: 40.4, ctaSub: 40.5, testBox: 40.9, quebec: 41.2,
    cursorIn: 41.2, clicks: [42.0, 44.4],
    // link chip shown during the explanations
    chip: [5.0, 38.6],
  },
  motif: [0.0, 39.6],       // the 4-note signature (logo, then linkrapp.com), on the beat
};
/* CONFIG-END */
window.CONFIG = CONFIG;

const W = 1440, H = 1080, A = CONFIG.at, D = CONFIG.dur, SC = CONFIG.scenes;
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const EASE = {
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x) => { const s = 1.6; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); },
};
const eIn = EASE[CONFIG.ease.enter], eOut = EASE[CONFIG.ease.exit], eMove = EASE[CONFIG.ease.move], ePop = EASE[CONFIG.ease.pop];
const loopSin = (t, phase = 0) => Math.sin((2 * Math.PI * t) / CONFIG.loop + phase);

function css(el, o) {
  const s = el.style;
  if ('o' in o) s.opacity = o.o;
  if ('tf' in o) s.transform = o.tf;
  if ('f' in o) s.filter = o.f;
}
const blurF = (v) => (v > 0.25 ? `blur(${v}px)` : 'none');
/** Entry: fades and rises in over D.enter, « démarre vite, finit doucement ». Returns 0..1. */
function enter(el, t, t0, dy = 26, dur = D.enter, bl = 0) {
  const q = P(t, t0, t0 + dur), e = eIn(q);
  css(el, { o: e, tf: `translateY(${(1 - e) * dy}px)`, f: bl ? blurF((1 - e) * bl) : 'none' });
  return e;
}
/** Exit factor (1 → 0) over D.exit, « démarre doucement, accélère ». */
const exitK = (t, t0, dur = D.exit) => 1 - eOut(P(t, t0, t0 + dur));
function pop(el, t, t0, dur = D.micro) {
  const q = P(t, t0, t0 + dur);
  css(el, { o: q > 0 ? 1 : 0, tf: `scale(${Math.max(0, ePop(q))})` });
  return q;
}
function splitWords(el, text) {
  el.textContent = '';
  const out = [];
  text.split(/(\s+)/).forEach((p) => { const s = document.createElement('span'); s.className = 'w'; s.textContent = p; el.appendChild(s); if (p.trim()) out.push(s); });
  return out;
}
/** Caption: eyebrow, then title words (stagger D.stagger), then sub. k = whole-block opacity. */
function caption(box, t, t0, k = 1) {
  let n = 0;
  for (const el of [...box.children]) {
    if (el.classList.contains('title')) {
      const words = el._w || (el._w = splitWords(el, el.textContent));
      words.forEach((w, i) => { const s = t0 + 0.06 + i * D.stagger, e = eIn(P(t, s, s + D.enter)); css(w, { o: e, tf: `translateY(${(1 - e) * 28}px)` }); });
      n = words.length;
    } else if (el.classList.contains('sub')) enter(el, t, t0 + 0.12 + n * D.stagger, 20);
    else enter(el, t, t0, 16);
  }
  box.style.opacity = k;
}
const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
function press(el, t, t0) {
  const b = Math.exp(-Math.pow((t - t0) / (D.press / 2.5), 2));
  el.style.transform = `scale(${1 - 0.07 * b})`;
}
/** Touch indicator: approaches (0.25 s), taps, ripples out (0.4 s). */
function tap(dot, t, t0, target) {
  if (t < t0 - 0.25 || t > t0 + 0.4) { dot.style.opacity = 0; return; }
  const [x, y] = center(target), pr = dot.parentElement.getBoundingClientRect();
  dot.style.left = `${x - pr.left}px`; dot.style.top = `${y - pr.top}px`;
  if (t < t0) { const q = eIn(P(t, t0 - 0.25, t0)); css(dot, { o: 0.95 * q, tf: `scale(${lerp(1.4, 0.9, q)})` }); }
  else { const q = eIn(P(t, t0, t0 + 0.4)); css(dot, { o: 0.95 * (1 - q), tf: `scale(${lerp(0.9, 1.9, q)})` }); }
}
/** Push between scenes: out « démarre doucement, accélère », in « démarre vite, finit doucement ». */
function push(el, t, tin, tout) {
  let tx = 0, o = 1;
  if (tin != null && t < tin + 0.4) { const e = eIn(P(t, tin - 0.15, tin + 0.35)); tx = W * CONFIG.push * (1 - e); o = e; }
  if (tout != null && t > tout - D.exit) { const e = eOut(P(t, tout - D.exit, tout)); tx = -W * CONFIG.push * e; o = 1 - e; }
  css(el, { tf: tx ? `translateX(${tx}px)` : 'none', o });
}

/* ===== 1 · opening ===== */
const S1 = (() => {
  const halo = $('o-halo'), logo = $('o-logo'), hook = $('o-hook');
  const h1 = splitWords($('o-h1'), 'Vous avez un besoin ?'), h2 = splitWords($('o-h2'), 'Ils ont du talent à revendre.');
  return (t) => {
    const out = exitK(t, A.openingExit);
    css(halo, { o: (0.85 + 0.15 * loopSin(t)) * out, tf: `scale(${1 + 0.05 * loopSin(t)})` });
    const ls = eIn(P(t, 0, 0.6));
    css(logo, { o: out, tf: `translateY(${-40 * (1 - out)}px) scale(${lerp(0.985, 1, ls)})` });
    // words are fully visible at frame 0 (LinkedIn thumbnail); they only settle into place
    [...h1, ...h2].forEach((w, i) => { const s = A.hookSettle + i * D.stagger, e = eIn(P(t, s, s + D.enter)); css(w, { tf: `translateY(${(1 - e) * 14}px)` }); });
    const dim = lerp(1, 0.5, eMove(P(t, A.hookDim, A.hookDim + D.micro)));
    css(hook, { o: dim * out, tf: `translateY(${-40 * (1 - out)}px)` });
  };
})();

/* shared tagline: appears in scene 1, becomes the header of scene 3 */
const TAG = (() => {
  const el = $('tagline'), ul = $('tg-ul');
  const words = splitWords($('tg'), 'Le bon pro, juste à côté de chez vous.');
  let placed = false;
  return (t) => {
    if (!placed) {
      const a = words[0], b = words[words.length - 1];
      Object.assign(ul.style, { left: `${a.offsetLeft}px`, width: `${b.offsetLeft + b.offsetWidth - a.offsetLeft}px`, top: `${a.offsetTop + a.offsetHeight + 4}px` });
      placed = true;
    }
    words.forEach((w, i) => { const s = A.tagline + i * D.stagger, e = eIn(P(t, s, s + D.enter)); css(w, { o: e, tf: `translateY(${(1 - e) * 26}px)` }); });
    css(ul, { tf: `scaleX(${eIn(P(t, A.taglineUnderline, A.taglineUnderline + 0.45))})` });
    const m = eMove(P(t, A.taglineToHeader, A.taglineToHeader + D.morph));
    let tx = 0, o = 1;
    const outT = SC.needs[1];
    if (t > outT - D.exit) { const e = eOut(P(t, outT - D.exit, outT)); tx = -W * CONFIG.push * e; o = 1 - e; }
    css(el, { o, tf: `translate(${tx}px, ${lerp(0, -652, m)}px)` });
  };
})();

/* ===== 3 · needs ===== */
const S3 = (() => {
  const imgs = [...$('n-card').querySelectorAll('img')], name = $('n-name'), card = $('n-card');
  const chips = [...$('n-chips').children], open = $('n-open');
  const NAMES = ['Coiffure', 'Esthétique', 'Décoration', 'Petits travaux'];
  return (t) => {
    push($('L3'), t, null, SC.needs[1]);
    const e = eIn(P(t, A.needsIn, A.needsIn + D.enter));
    css(card, { o: e, tf: `translateY(${(1 - e) * 40}px) scale(${lerp(0.96, 1, e)})` });
    const ch = [SC.needs[0], ...A.tradeChanges];
    let k = 0; ch.forEach((c, i) => { if (t >= c) k = i; });
    imgs.forEach((im, i) => {
      im.style.opacity = i === 0 ? 1 : eMove(P(t, ch[i], ch[i] + D.micro));
      im.style.zIndex = i;
      im.style.transform = `scale(${lerp(1.07, 1, eMove(P(t, ch[i], ch[i] + 1.2)))})`;
    });
    const ein = eIn(P(t, ch[k], ch[k] + 0.35));
    name.textContent = NAMES[k];
    css(name, { o: k === 0 ? e : ein, tf: `translateY(${(1 - (k === 0 ? 1 : ein)) * 30}px)` });
    chips.forEach((c, i) => { enter(c, t, A.chipsIn + i * D.stagger, 18); c.classList.toggle('on', i === k); });
    enter(open, t, A.openIn, 16);
  };
})();

/* ===== 4-6 · one card that evolves ===== */
const S4 = (() => {
  const card = $('stagecard'), mapwrap = $('mapwrap'), map = $('map'), prof = $('prof'), phdr = $('phdr');
  const photos = [...$('photos').children], review = $('review'), stars = [...$('rstars').children];
  const svcs = [...$('svcs').children], slot = $('slot'), req = $('b-req'), zl = $('zlabel'), tapEl = $('tap6');
  const cap4 = $('cap4'), cap5 = $('cap5'), cap6 = $('cap6');
  // map, styled on apps/web/src/lib/map/linkr-light.style.json
  const CXL = 545, CYL = 300, MX = 1100, MY = 850;
  map.style.left = `${CXL - MX}px`; map.style.top = `${CYL - MY}px`; map.style.transformOrigin = `${MX}px ${MY}px`;
  const svg = $('mapsvg'), NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, at, p = svg) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); p.appendChild(e); return e; };
  const pat = mk('pattern', { id: 'blk', width: 64, height: 64, patternUnits: 'userSpaceOnUse' }, mk('defs', {}));
  mk('rect', { width: 64, height: 64, fill: '#FBF7F1' }, pat); mk('rect', { x: 4, y: 4, width: 56, height: 56, rx: 3, fill: '#EFE6D8' }, pat);
  mk('rect', { width: 2200, height: 1700, fill: '#F3EBDF' });
  const grid = mk('g', { transform: `rotate(-28 ${MX} ${MY})` });
  mk('rect', { x: -900, y: -900, width: 4000, height: 3500, fill: 'url(#blk)' }, grid);
  for (let k = -6; k <= 7; k++) for (const [w, c] of [[24, '#DCCDB8'], [16, '#FFFFFF']]) {
    mk('line', { x1: -900, y1: MY + k * 384 + 2, x2: 3100, y2: MY + k * 384 + 2, stroke: c, 'stroke-width': w }, grid);
    mk('line', { x1: MX + k * 384 + 2, y1: -900, x2: MX + k * 384 + 2, y2: 2600, stroke: c, 'stroke-width': w }, grid);
  }
  mk('ellipse', { cx: 760, cy: 640, rx: 230, ry: 160, fill: '#DEDFCB', transform: 'rotate(-20 760 640)' });
  mk('path', { d: 'M -200 1240 Q 1100 980 2500 1150', stroke: '#CDD6D6', 'stroke-width': 200, fill: 'none' });
  const label = (x, y, s) => { const e = mk('text', { x, y, 'font-family': 'Geist', 'font-size': 26, 'font-weight': 650, fill: '#2E211E', stroke: '#F3EBDF', 'stroke-width': 7, 'paint-order': 'stroke', 'text-anchor': 'middle' }); e.textContent = s; };
  label(1485, 655, 'Rosemont'); label(905, 1000, 'Plateau');
  // zones (~550 m wide: 1 km = 262 px on this map) instead of pins on an address
  const ZO = [[170, -120], [-240, 70], [90, 150], [-110, -170], [330, 60], [-360, -60]];
  const zones = ZO.map(([dx, dy]) => { const d = document.createElement('div'); d.className = 'zone'; d.style.left = `${MX + dx}px`; d.style.top = `${MY + dy}px`; d.innerHTML = '<i></i>'; map.appendChild(d); return d.firstChild; });
  const me = document.createElement('div'); me.id = 'me'; me.style.left = `${MX}px`; me.style.top = `${MY}px`;
  me.innerHTML = '<div class="dot"></div><span class="lb">Vous</span>'; map.appendChild(me);
  const meL = me.querySelector('.lb');
  // label next to the highlighted zone (page coordinates)
  const ZX = 175 + CXL + ZO[0][0], ZY = 330 + CYL + ZO[0][1];
  zl.style.left = `${ZX + 92}px`; zl.style.top = `${ZY - 52}px`;
  return (t) => {
    push($('L4'), t, SC.proximity[0], SC.price[1]);
    // captions: one at a time
    caption(cap4, t, A.cap4, exitK(t, SC.proximity[1] - D.exit));
    caption(cap5, t, A.cap5, t < SC.trust[0] ? 0 : exitK(t, SC.trust[1] - D.exit));
    caption(cap6, t, A.cap6, t < SC.price[0] ? 0 : 1);
    // map (scene 4)
    mapwrap.style.opacity = exitK(t, A.morph, 0.35);
    css(map, { tf: `scale(${lerp(1.06, 1, eIn(P(t, SC.proximity[0], SC.proximity[1])))})` });
    css(meL, { o: eIn(P(t, A.meLabel, A.meLabel + D.micro)) });
    zones.forEach((z, i) => {
      const q = P(t, A.zones + i * D.stagger, A.zones + i * D.stagger + D.micro);
      const hi = i === 0 ? eIn(P(t, A.zoneHighlight, A.zoneHighlight + D.micro)) : 0;
      z.style.opacity = q > 0 ? 1 : 0;
      z.style.transform = `scale(${Math.max(0, ePop(q)) * (1 + 0.04 * loopSin(t, i * 1.1)) * (1 + 0.08 * hi)})`;
      z.style.borderColor = hi ? `rgba(110,30,43,${0.32 + 0.55 * hi})` : '';
      z.style.borderWidth = hi ? `${2 + 2 * hi}px` : '';
    });
    // label: enters, then travels to the profile header (the card evolves)
    const li = eIn(P(t, A.labelIn, A.labelIn + 0.4));
    const mv = eMove(P(t, A.morph, A.morph + D.morph));
    let dx = 0, dy = 0;
    if (mv > 0) { const r = phdr.querySelector('.nm').getBoundingClientRect(); dx = (r.left - (ZX + 92 + 20)) * mv; dy = (r.top - (ZY - 52 + 14)) * mv; }
    css(zl, { o: li * (1 - P(t, A.morph + 0.4, A.morph + 0.6)), tf: `translate(${dx}px, ${dy + (1 - li) * 16}px)` });
    // profile (scene 5) then services (scene 6)
    prof.style.opacity = eIn(P(t, A.morph + 0.4, A.morph + 0.4 + D.enter));
    photos.forEach((p, i) => { const k = exitK(t, SC.trust[1] - D.exit + i * 0.03); const e = enter(p, t, A.photos + i * D.stagger, 24); p.style.opacity = e * k; });
    { const e = enter(review, t, A.review, 24); review.style.opacity = e * exitK(t, SC.trust[1] - D.exit); }
    stars.forEach((s, i) => { const q = P(t, A.stars + i * D.stagger, A.stars + i * D.stagger + 0.25); s.style.color = q > 0 ? '#6e1e2b' : ''; s.style.transform = `scale(${q > 0 ? ePop(q) : 1})`; });
    svcs.forEach((r, i) => { enter(r, t, A.services + i * D.stagger, 26); r.style.display = t < A.services ? 'none' : 'flex'; });
    const pf = Math.exp(-Math.pow((t - A.priceFocus - 0.4) / 0.35, 2));
    svcs[0].style.background = pf > 0.02 ? `rgba(243,235,223,${pf})` : '';
    svcs[0].style.borderRadius = '16px';
    press(req, t, A.request); tap(tapEl, t, A.request, req);
    enter(slot, t, A.slot, 20);
    card.style.opacity = 1;
  };
})();

/* ===== 7 · quotes ===== */
const S7 = (() => {
  const qs = ['q0', 'q1', 'q2'].map($), proj = $('q-proj'), count = $('q-count'), seg = $('q-seg'), segi = $('q-segi'), sa = $('q-sa'), sp = $('q-sp');
  const bar = $('q-bar'), acc = $('q-acc'), tapEl = $('tap7');
  const slotA = [0, 1, 2], slotP = [2, 0, 1], Y0 = 410, DY = 120;
  return (t) => {
    push($('L7'), t, SC.quotes[0], SC.quotes[1]);
    caption($('cap7'), t, A.cap7);
    enter(proj, t, A.project, 30);
    enter(seg, t, A.seg, 16);
    let n = 0; A.quotes.forEach((q) => { if (t >= q + 0.2) n++; });
    count.textContent = `${n} devis`;
    const ro = eMove(P(t, A.reorder, A.reorder + D.morph));
    qs.forEach((el, i) => {
      const e = eIn(P(t, A.quotes[i], A.quotes[i] + 0.45));
      const dim = t > A.acceptTap + 0.2 && i !== 1 ? lerp(1, 0.45, eMove(P(t, A.acceptTap + 0.2, A.acceptTap + 0.5))) : 1;
      css(el, { o: e * dim, tf: `translateX(${(1 - e) * 80}px)` });
      el.style.top = `${Y0 + DY * lerp(slotA[i], slotP[i], ro)}px`;
    });
    const hb = eIn(P(t, A.best, A.best + D.micro));
    qs[1].style.borderColor = hb ? `rgba(110,30,43,${0.7 * hb})` : '';
    qs[1].style.borderWidth = hb ? '2.5px' : '';
    const sr = seg.getBoundingClientRect(), ra = sa.getBoundingClientRect(), rb = sp.getBoundingClientRect();
    const sw = ePop(P(t, A.sortTap, A.sortTap + D.micro));
    segi.style.left = `${lerp(ra.left, rb.left, sw) - sr.left}px`; segi.style.width = `${lerp(ra.width, rb.width, clamp(sw))}px`;
    sa.style.color = sw > 0.5 ? '#2e211e' : '#f8f2ea'; sp.style.color = sw > 0.5 ? '#f8f2ea' : '#2e211e';
    enter(bar, t, A.bar, 30);
    press(acc, t, A.acceptTap);
    if (Math.abs(t - A.sortTap) < 0.45) tap(tapEl, t, A.sortTap, sp); else tap(tapEl, t, A.acceptTap, acc);
    acc.textContent = t > A.acceptTap + 0.2 ? 'Devis retenu' : 'Accepter ce devis';
  };
})();

/* ===== 8 · payment ===== */
const S8 = (() => {
  const nodes = ['n0', 'n1', 'n2'].map($), fill = $('p-fill'), head = $('p-head'), note = $('p-note'), line = $('p-line');
  return (t) => {
    push($('L8'), t, SC.payment[0], SC.payment[1]);
    caption($('cap8'), t, A.cap8);
    enter(head, t, A.head, 20);
    line.style.opacity = eIn(P(t, A.nodes, A.nodes + D.enter));
    nodes.forEach((n, i) => {
      const s = A.nodes + i * D.groupStagger;
      enter(n.querySelector('.t'), t, s, 16);
      const c = n.querySelector('.c'), q = P(t, A.checks[i], A.checks[i] + D.micro);
      css(c, { o: eIn(P(t, s, s + D.enter)), tf: `scale(${q > 0 ? 0.92 + 0.08 * ePop(q) : 1})` });
      c.style.background = q > 0 ? '#6e1e2b' : '#ffffff'; c.style.borderColor = q > 0 ? '#6e1e2b' : '';
      c.querySelector('svg').style.opacity = eIn(q);
      enter(n.querySelector('.v'), t, A.checks[i] + 0.1, 14);
    });
    const f = 0.5 * eMove(P(t, A.fills[0][0], A.fills[0][1])) + 0.5 * eMove(P(t, A.fills[1][0], A.fills[1][1]));
    fill.style.width = `${100 * f}%`;
    enter(note, t, A.note, 14);
  };
})();

/* ===== 9 · pros ===== */
const S9 = (() => {
  const panel = $('pro'), toast = $('toast'), tabs = [...$('ptabs').children], st = $('jst'), btn = $('jbtn'), tapEl = $('tap9'), job = $('job');
  const sub = $('cap9').querySelector('.sub');
  return (t) => {
    push($('L9'), t, SC.pros[0], SC.pros[1]);
    caption($('cap9'), t, A.cap9);
    const pe = enter(panel, t, A.panel, 40);
    const te = eIn(P(t, A.toast, A.toast + 0.45)), tx = exitK(t, A.toastOut, 0.4);
    css(toast, { o: te * tx, tf: `translateX(${(1 - te) * 120}px)` });
    const accepted = t >= A.acceptPro + 0.2, jobs = t >= A.toJobs;
    st.textContent = accepted ? 'Assignée' : 'Ouverte';
    st.style.background = accepted ? '#dbeafe' : '#fef3c7'; st.style.color = accepted ? '#1e40af' : '#92400e';
    st.style.transform = `scale(${accepted ? ePop(P(t, A.acceptPro + 0.2, A.acceptPro + 0.5)) : 1})`;
    btn.textContent = accepted ? 'Démarrer' : 'Accepter';
    press(btn, t, A.acceptPro); tap(tapEl, t, A.acceptPro, btn);
    tabs.forEach((el, i) => el.classList.toggle('on', jobs ? i === 2 : i === 0));
    tabs[0].querySelector('b').textContent = jobs ? '0' : '1';
    tabs[2].querySelector('b').textContent = jobs ? '4' : '3';
    const hop = P(t, A.acceptPro + 0.1, A.acceptPro + 0.5);
    css(job, { tf: `translateY(${-Math.sin(Math.PI * hop) * 18}px)` });
    // focus moves to the fee line once the demo is done
    const ff = eIn(P(t, A.feeFocus, A.feeFocus + D.micro));
    panel.style.opacity = pe * lerp(1, 0.55, ff);
    sub.style.color = ff > 0 ? `rgb(${Math.round(lerp(85, 46, ff))},${Math.round(lerp(80, 33, ff))},${Math.round(lerp(77, 30, ff))})` : '';
  };
})();

/* ===== 10 · soon ===== */
const S10 = (() => {
  const tt = $('s-tt'), tr = $('s-trades'), lic = ['s-l0', 's-l1', 's-l2', 's-l3'].map($), pics = [...$('s-pics').children];
  const words = splitWords(tt, tt.textContent);
  return (t) => {
    push($('L10'), t, SC.soon[0], SC.soon[1]);
    words.forEach((w, i) => { const s = A.soonTitle + i * D.stagger, e = eIn(P(t, s, s + D.enter)); css(w, { o: e, tf: `translateY(${(1 - e) * 28}px)` }); });
    enter(tr, t, A.soonTrades, 18);
    lic.forEach((el, i) => { if (i === 0) enter(el, t, A.licences, 14); else pop(el, t, A.licences + i * D.groupStagger); });
    pics.forEach((p, i) => enter(p, t, A.pics + i * D.groupStagger, 30));
  };
})();

/* ===== 11 · call to action ===== */
const S11 = (() => {
  const logo = $('c-logo'), open = splitWords($('c-open'), 'La version d’essai est ouverte à tous');
  const urlEl = $('c-url'), ul = $('c-ul'), ring = $('c-ring'), cursor = $('cursor');
  const letters = (() => { urlEl.textContent = ''; return [...'linkrapp.com'].map((c) => { const s = document.createElement('span'); s.textContent = c; urlEl.appendChild(s); return s; }); })();
  const s1 = $('c-s1'), s2 = $('c-s2'), box = $('c-tbox'), qc = $('c-qc');
  s1.textContent = 'Devenez testeur : créez votre compte'; s2.textContent = 'et donnez-nous votre avis.';
  let geo = null;
  return (t) => {
    push($('L11'), t, SC.cta[0], null);
    if (!geo) {
      const a = letters[0], b = letters[letters.length - 1];
      geo = { left: a.offsetLeft + urlEl.offsetLeft, right: b.offsetLeft + b.offsetWidth + urlEl.offsetLeft, top: urlEl.offsetTop, h: urlEl.offsetHeight };
      Object.assign(ul.style, { left: `${geo.left}px`, width: `${geo.right - geo.left}px` });
    }
    const le = eIn(P(t, A.ctaLogo, A.ctaLogo + D.enter));
    css(logo, { o: le, tf: `scale(${lerp(0.96, 1, le)})` });
    open.forEach((w, i) => { const s = A.ctaOpen + i * D.stagger, e = eIn(P(t, s, s + D.enter)); css(w, { o: e, tf: `translateY(${(1 - e) * 24}px)` }); });
    letters.forEach((s, i) => { const st = A.url + i * D.letters, e = eIn(P(t, st, st + 0.45)); css(s, { o: e, tf: `translateY(${(1 - e) * 60}px)`, f: blurF((1 - e) * 10) }); });
    // underline: draws in, thickens on hover, then breathes (seamless loop); the text itself never moves
    const ue = eIn(P(t, A.urlUnderline, A.urlUnderline + 0.45));
    const hover = eIn(P(t, A.cursorIn + 0.55, A.cursorIn + 0.75));
    const breathe = t > A.clicks[0] ? 0.5 + 0.5 * loopSin(t - A.clicks[0] - CONFIG.loop / 4) : 0.5;
    css(ul, { tf: `scaleX(${ue}) scaleY(${1 + 0.35 * hover + 0.25 * hover * breathe})`, o: 0.85 + 0.15 * breathe });
    enter(s1, t, A.ctaSub, 18); enter(s2, t, A.ctaSub + D.groupStagger, 18);
    enter(box, t, A.testBox, 18);
    enter(qc, t, A.quebec, 12);
    // cursor glides onto the link and clicks; the ring repeats once per loop
    const ce = eIn(P(t, A.cursorIn, A.cursorIn + 0.55));
    // the cursor tip rests on the underline, never over the letters
    const ulTop = ul.offsetTop + ul.offsetHeight / 2, tx = geo.right - 70, ty = ulTop;
    const cx = lerp(1310, tx, ce), cy = lerp(990, ty, ce);
    let ps = 1; for (const c of A.clicks) ps -= 0.12 * Math.exp(-Math.pow((t - c) / 0.08, 2));
    css(cursor, { o: t >= A.cursorIn ? 1 : 0, tf: `translate(${cx}px, ${cy}px) scale(${ps})` });
    let ro = 0, rs = 0.4;
    for (const c of A.clicks) { const q = P(t, c, c + 0.45); if (q > 0 && q < 1) { ro = 0.8 * (1 - q); rs = lerp(0.4, 1.4, eIn(q)); } }
    ring.style.left = `${tx + 2}px`; ring.style.top = `${ty + 2}px`;
    css(ring, { o: ro, tf: `scale(${rs})` });
  };
})();

const LAYERS = [
  ['L1', 0, SC.opening[1] + 0.05, S1], ['L3', SC.needs[0] - 0.25, SC.needs[1], S3], ['L4', SC.proximity[0] - 0.15, SC.price[1], S4],
  ['L7', SC.quotes[0] - 0.15, SC.quotes[1], S7], ['L8', SC.payment[0] - 0.15, SC.payment[1], S8], ['L9', SC.pros[0] - 0.15, SC.pros[1], S9],
  ['L10', SC.soon[0] - 0.15, SC.soon[1], S10], ['L11', SC.cta[0] - 0.15, 99, S11],
];

window.renderFrame = function renderFrame(t) {
  for (const [id, a, b, fn] of LAYERS) {
    const el = $(id), on = t >= a && t < b;
    el.style.display = on ? 'block' : 'none';
    if (on) fn(t);
  }
  const tg = $('tagline');
  tg.style.display = t < SC.needs[1] ? 'block' : 'none';
  if (t < SC.needs[1]) TAG(t);
  const chip = $('chip'), ci = eIn(P(t, A.chip[0], A.chip[0] + D.enter)), co = exitK(t, A.chip[1]);
  chip.style.display = t > A.chip[0] && t < A.chip[1] + D.exit ? 'block' : 'none';
  css(chip, { o: ci * co, tf: `translateY(${(1 - ci) * 20}px)` });
};
window.showSafe = (on) => { $('safe').style.display = on ? 'block' : 'none'; };
window.__ready = (async () => {
  await document.fonts.load('400 100px Parisienne');
  await document.fonts.load('600 40px Geist');
  await document.fonts.load('600 40px "Geist Mono"');
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.renderFrame(0);
  return true;
})();
