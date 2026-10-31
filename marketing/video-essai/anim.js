/* Linkr — LinkedIn trial video. Every frame is a pure function of t (seconds):
 * window.renderFrame(t) sets every style, nothing is animated by the browser,
 * so a headless capture is deterministic frame by frame. */
'use strict';

const TL = window.TL;
const W = 1440, H = 1080;
const $ = (id) => document.getElementById(id);

// ---------- maths ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const E = {
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  outBounce: (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  },
};
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function css(el, o) {
  const s = el.style;
  if ('o' in o) s.opacity = o.o;
  if ('tf' in o) s.transform = o.tf;
  if ('f' in o) s.filter = o.f;
  if ('cp' in o) s.clipPath = o.cp;
}
/** Fade-up reveal used by every caption line: returns 0..1 progress. */
function rise(el, t, start, dur = 0.5, dist = 34, blur = 8) {
  const q = P(t, start, start + dur), e = E.outCubic(q);
  css(el, { o: e, tf: `translateY(${(1 - e) * dist}px)`, f: blur && q < 1 ? `blur(${(1 - e) * blur}px)` : 'none' });
  return q;
}
function splitInto(el, text, unit) {
  el.textContent = '';
  const parts = unit === 'word' ? text.split(/(\s+)/) : [...text];
  const spans = [];
  for (const p of parts) {
    const s = document.createElement('span');
    s.textContent = p;
    el.appendChild(s);
    if (p.trim()) spans.push(s);
  }
  return spans;
}

// ---------- scenes ----------
const SC = {};
for (const id of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']) SC[id] = $(id);
const VIS = {
  s1: [0, 6.8], s2: [7.0, 12.06], s3: [11.58, 18.08], s4: [17.7, 22.24], s5: [21.7, 26.24],
  s6: [25.7, 30.24], s7: [29.7, 34.24], s8: [33.7, 38.06], s9: [37.55, 44.12], s10: [43.82, 99],
};
// Whip pan: both scenes travel together (no gap), motion blur peaks mid-move.
function whip(el, t, tin, tout) {
  let tx = 0, blur = 0;
  if (tin != null && t < tin + 0.22) { const q = P(t, tin - 0.28, tin + 0.22); tx = W * (1 - E.inOutCubic(q)); blur = 30 * Math.sin(Math.PI * q); }
  if (tout != null && t > tout - 0.28) { const q = P(t, tout - 0.28, tout + 0.22); tx = -W * E.inOutCubic(q); blur = 30 * Math.sin(Math.PI * q); }
  css(el, { tf: tx ? `translateX(${tx}px)` : 'none', f: blur > 0.3 ? `blur(${blur}px)` : 'none' });
}

// ===== S1 · suspense =====
const s1 = (() => {
  const h1 = $('s1h1'), h2 = $('s1h2'), ctx = $('s1dust').getContext('2d');
  const letters = splitInto($('s1text'), 'Quelque chose arrive…', 'char');
  const r = rng(11), motes = [];
  for (let i = 0; i < 110; i++) motes.push({ x: r() * W, y: r() * H, vx: (r() - 0.5) * 14, vy: -4 - r() * 12, s: 0.6 + r() * 2.2, f: 0.5 + r() * 2, ph: r() * 6.28, b: 0.25 + r() * 0.6 });
  const cut = TL.s1cut;
  function intensity(t) {
    let I = 0.05 + 0.2 * Math.pow(P(t, 0, 6.8), 1.6);
    const n = TL.heartbeats.length;
    TL.heartbeats.forEach((b, i) => {
      const g = 0.35 + 0.75 * (i / (n - 1));
      for (const [off, k] of [[0, 1], [0.15, 0.55]]) {
        const dt = t - b - off;
        if (dt < 0) continue;
        I += g * k * (dt < 0.06 ? dt / 0.06 : Math.exp(-(dt - 0.06) / 0.3));
      }
    });
    return Math.min(I, 1.45);
  }
  return (t) => {
    const I = intensity(t);
    const shotB = t >= cut;
    const push = shotB ? 1.22 + 0.06 * P(t, cut, 6.8) : 1 + 0.07 * P(t, 0, cut);
    const yOff = shotB ? -6 : 0;
    css(h1, { o: clamp(I * 1.05), tf: `translate(-50%, ${-50 + yOff}%) scale(${(0.42 + 0.42 * I) * push})` });
    css(h2, { o: clamp(0.25 + 0.55 * I), tf: `translate(-50%, ${-50 + yOff}%) scale(${(0.75 + 0.25 * I) * push})` });
    ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      let x = (m.x + m.vx * t + Math.sin(t * m.f + m.ph) * 10 + W) % W, y = (m.y + m.vy * t + H * 4) % H;
      if (shotB) { x = W / 2 + (x - W / 2) * 1.3; y = H / 2 + (y - H / 2) * 1.3; }
      const a = m.b * (0.5 + 0.5 * Math.sin(t * m.f * 2 + m.ph)) * (0.25 + 0.75 * clamp(I));
      ctx.fillStyle = `rgba(248, 210, 205, ${a * 0.55})`;
      ctx.beginPath(); ctx.arc(x, y, m.s * (shotB ? 1.3 : 1), 0, 6.283); ctx.fill();
    }
    // the line: letter by letter in, dissolves out
    const out = P(t, 5.95, 6.45);
    $('s1text').style.letterSpacing = `${0.14 + 0.22 * E.inCubic(out)}em`;
    letters.forEach((s, i) => {
      const q = P(t, 4.05 + i * 0.045, 4.55 + i * 0.045), e = E.outCubic(q);
      const o = e * (1 - out);
      css(s, { o, tf: `translateY(${(1 - e) * 18 - out * 12}px)`, f: (1 - e) * 12 + out * 14 > 0.2 ? `blur(${(1 - e) * 12 + out * 14}px)` : 'none' });
    });
  };
})();

// ===== S2 · reveal =====
const s2 = (() => {
  const ctx = $('s2fx').getContext('2d'), cam = $('s2cam'), logo = $('s2logo'), flash = $('flash');
  const words = splitInto($('s2tag'), 'Le bon pro, juste à côté de chez toi.', 'word');
  const r = rng(7), parts = [], embers = [];
  const cols = ['248,242,234', '255,214,206', '217,130,142', '243,235,223'];
  for (let i = 0; i < 300; i++) {
    const u = r();
    parts.push({ a: r() * 6.283, v: lerp(260, 1600, u * u), k: lerp(1.5, 3.2, r()), s: 0.8 + r() * 3.4, life: lerp(1.0, 3.4, r()), c: cols[(r() * 4) | 0], tw: r() * 6 });
  }
  for (let i = 0; i < 70; i++) embers.push({ x: r() * W, y: r() * H, vy: -10 - r() * 30, s: 0.6 + r() * 1.8, ph: r() * 6.28 });
  const CX = 720, CY = 460;
  return (t) => {
    const lt = t - 7;
    // flash
    const fo = lt < 0 ? 0 : lt < 0.05 ? lt / 0.05 : Math.exp(-(lt - 0.05) / 0.14);
    flash.style.background = '#fff6ee';
    flash.style.opacity = t < 8 ? fo : 0;
    // camera: zoom-out settle + impact shake
    const s = 1.16 - 0.16 * E.outCubic(P(lt, 0, 2.6)) - 0.03 * P(lt, 2.6, 5) + 0.12 * E.inCubic(P(lt, 4.55, 5.05));
    const A = 16 * Math.exp(-lt / 0.18);
    css(cam, { tf: `translate(${A * Math.sin(lt * 95)}px, ${A * Math.cos(lt * 83)}px) scale(${s})` });
    // logo
    const q = P(lt, 0, 0.9);
    css(logo, { o: E.outCubic(P(lt, 0, 0.25)) * (1 - P(lt, 4.6, 5.0)), tf: `scale(${lerp(0.55, 1, E.outBack(q, 1.4))})`, f: lt < 0.5 ? `blur(${18 * (1 - E.outCubic(P(lt, 0, 0.5)))}px)` : 'none' });
    logo.style.textShadow = `0 0 ${60 + 120 * Math.exp(-lt / 0.4)}px rgba(255, 220, 210, ${0.35 + 0.5 * Math.exp(-lt / 0.4)})`;
    // tagline
    words.forEach((w, i) => {
      const st = 1.45 + i * 0.09, e = E.outCubic(P(lt, st, st + 0.55));
      css(w, { o: e * (1 - P(lt, 4.6, 5.0)), tf: `translateY(${(1 - e) * 46}px)`, f: e < 1 ? `blur(${(1 - e) * 10}px)` : 'none' });
    });
    // shockwaves + particles
    ctx.clearRect(0, 0, W, H);
    for (const k of [0, 0.13, 0.32]) {
      const qq = P(lt, k, k + 1.15);
      if (qq <= 0 || qq >= 1) continue;
      ctx.strokeStyle = `rgba(248, 236, 228, ${0.85 * Math.pow(1 - qq, 1.6)})`;
      ctx.lineWidth = 34 * (1 - qq) + 2;
      ctx.beginPath(); ctx.arc(CX, CY, 40 + 1250 * E.outCubic(qq), 0, 6.283); ctx.stroke();
    }
    if (lt < 0.5) {
      const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, 520);
      g.addColorStop(0, `rgba(255,240,232,${0.9 * (1 - lt / 0.5)})`); g.addColorStop(1, 'rgba(255,240,232,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    for (const p of parts) {
      if (lt < 0 || lt > p.life) continue;
      const d = (p.v / p.k) * (1 - Math.exp(-p.k * lt));
      const x = CX + Math.cos(p.a) * d, y = CY + Math.sin(p.a) * d + 18 * lt * lt;
      const a = Math.pow(1 - lt / p.life, 1.3) * (0.6 + 0.4 * Math.sin(lt * 14 + p.tw));
      ctx.fillStyle = `rgba(${p.c}, ${a})`;
      ctx.beginPath(); ctx.arc(x, y, p.s, 0, 6.283); ctx.fill();
    }
    const eo = P(lt, 0.6, 1.6) * (1 - P(lt, 4.6, 5));
    for (const e of embers) {
      const y = (e.y + e.vy * lt + H * 3) % H;
      ctx.fillStyle = `rgba(255, 220, 210, ${eo * 0.4 * (0.5 + 0.5 * Math.sin(lt * 3 + e.ph))})`;
      ctx.beginPath(); ctx.arc(e.x + Math.sin(lt + e.ph) * 12, y, e.s, 0, 6.283); ctx.fill();
    }
  };
})();

// ===== S3 · concept =====
const s3 = (() => {
  const row = $('s3row'), w1 = $('s3w1'), w2 = $('s3w2'), x = $('s3x'), cam = $('s3cam');
  const smalls = [...row.querySelectorAll('small')];
  const b1 = splitInto($('s3b1'), 'en version', 'char');
  const b2 = $('s3b2'), dot = $('s3dot'), r1 = $('s3r1'), r2 = $('s3r2');
  const ring = (el, q) => {
    const sz = 40 + 560 * E.outCubic(q);
    css(el, { o: q > 0 && q < 1 ? Math.pow(1 - q, 1.4) : 0 });
    Object.assign(el.style, { width: `${sz}px`, height: `${sz}px`, left: `${-sz / 2}px`, top: `${-sz / 2}px` });
  };
  return (t) => {
    const s = SC.s3;
    s.style.clipPath = t < 12.06 ? `circle(${1 + 1000 * E.inOutCubic(P(t, 11.6, 12.05))}px at 50% 46%)` : 'none';
    // shot A
    const a1 = P(t, 11.95, 12.45), a2 = P(t, 12.4, 12.85), a3 = P(t, 12.75, 13.25);
    css(w1, { o: a1 > 0 ? 1 : 0, tf: `translateX(${lerp(-900, 0, E.outExpo(a1))}px)`, f: a1 < 1 ? `blur(${20 * (1 - E.outCubic(a1))}px)` : 'none' });
    css(x, { o: E.outCubic(a2), tf: `scale(${E.outBack(a2, 2.2)}) rotate(${lerp(-120, 0, E.outCubic(a2))}deg)` });
    css(w2, { o: a3 > 0 ? 1 : 0, tf: `translateX(${lerp(900, 0, E.outExpo(a3))}px)`, f: a3 < 1 ? `blur(${20 * (1 - E.outCubic(a3))}px)` : 'none' });
    const sq = E.inOutCubic(P(t, 14.75, 15.2));
    smalls.forEach((el, i) => { const q = rise(el, t, 13.35 + i * 0.12, 0.5, 20, 6); el.style.opacity = E.outCubic(q) * (1 - P(t, 14.7, 14.9)); });
    const breathe = 1 + 0.025 * P(t, 13.2, 14.75);
    css(row, { tf: `translateY(${-118 * sq}px) scale(${breathe * lerp(1, 0.52, sq)})` });
    row.style.transformOrigin = '50% 0%';
    const col = `rgb(${Math.round(lerp(46, 85, sq))}, ${Math.round(lerp(33, 80, sq))}, ${Math.round(lerp(30, 77, sq))})`;
    w1.style.color = col; w2.style.color = col;
    // shot B
    b1.forEach((el, i) => {
      const st = 15.05 + i * 0.035, e = E.outCubic(P(t, st, st + 0.45));
      css(el, { o: e, tf: `translateY(${(1 - e) * 60}px)`, f: e < 1 ? `blur(${(1 - e) * 8}px)` : 'none' });
    });
    const hw = E.inOutCubic(P(t, 15.35, 16.0));
    css(b2, { o: hw > 0 ? 1 : 0, cp: `inset(-20% ${100 - hw * 100}% -20% 0)`, tf: `translateX(${(1 - hw) * -20}px) scale(${lerp(0.96, 1, hw)})` });
    // the client dot drops, then the camera dives into it
    const dq = P(t, 16.3, 16.75);
    css(dot, { o: dq > 0 ? 1 : 0, tf: `translateY(${lerp(-560, 0, E.outBounce(dq))}px)` });
    ring(r1, P(t, 16.6, 17.6)); ring(r2, P(t, 16.95, 17.95));
    const z = E.inCubic(P(t, 17.4, 18.05));
    cam.style.transformOrigin = '720px 860px';
    css(cam, { tf: `scale(${1 + 8 * z})`, o: 1 - P(t, 17.5, 17.78) });
  };
})();

// ===== S4 · proximity map =====
const s4 = (() => {
  const CX = 1000, CY = 660, MX = 1100, MY = 850;
  const map = $('s4map');
  map.style.left = `${CX - MX}px`; map.style.top = `${CY - MY}px`;
  const svg = $('s4svg'), NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  // style: apps/web/src/lib/map/linkr-light.style.json
  const defs = mk('defs', {});
  const pat = mk('pattern', { id: 'blk', width: 64, height: 64, patternUnits: 'userSpaceOnUse' }, defs);
  mk('rect', { width: 64, height: 64, fill: '#FBF7F1' }, pat);
  mk('rect', { x: 4, y: 4, width: 56, height: 56, rx: 3, fill: '#EFE6D8' }, pat);
  mk('rect', { width: 2200, height: 1700, fill: '#F3EBDF' });
  const grid = mk('g', { transform: `rotate(-28 ${MX} ${MY})` });
  mk('rect', { x: -900, y: -900, width: 4000, height: 3500, fill: 'url(#blk)' }, grid);
  for (let k = -6; k <= 7; k++) {
    for (const [w, c] of [[24, '#DCCDB8'], [16, '#FFFFFF']]) {
      mk('line', { x1: -900, y1: MY + k * 384 + 2, x2: 3100, y2: MY + k * 384 + 2, stroke: c, 'stroke-width': w }, grid);
      mk('line', { x1: MX + k * 384 + 2, y1: -900, x2: MX + k * 384 + 2, y2: 2600, stroke: c, 'stroke-width': w }, grid);
    }
  }
  mk('path', { d: 'M -200 -200 L 2400 1700', stroke: '#DCCDB8', 'stroke-width': 26 });
  mk('path', { d: 'M -200 -200 L 2400 1700', stroke: '#FFFFFF', 'stroke-width': 18 });
  mk('ellipse', { cx: 640, cy: 470, rx: 250, ry: 175, fill: '#DEDFCB', transform: `rotate(-20 640 470)` });
  mk('ellipse', { cx: 630, cy: 480, rx: 150, ry: 100, fill: '#E4E2CF', transform: `rotate(-20 640 470)` });
  mk('path', { d: 'M -200 1420 Q 1000 1080 2500 1330', stroke: '#CDD6D6', 'stroke-width': 250, fill: 'none' });
  mk('circle', { cx: 1530, cy: 520, r: 80, fill: '#DEDFCB' });
  const label = (x, y, txt, size, fill, italic) => {
    const e = mk('text', { x, y, 'font-family': 'Geist', 'font-size': size, 'font-weight': 600, fill, stroke: italic ? '#CDD6D6' : '#F3EBDF', 'stroke-width': 7, 'paint-order': 'stroke', 'text-anchor': 'middle', 'font-style': italic ? 'italic' : 'normal' });
    e.textContent = txt; e.classList.add('txt'); return e;
  };
  label(1320, 585, 'Rosemont', 26, '#2E211E');
  label(940, 1075, 'Plateau', 26, '#2E211E');
  label(1100, 1290, 'Fleuve Saint-Laurent', 24, '#46524F', true);
  // radius (stylised) + radar ripple
  const rFill = mk('circle', { cx: MX, cy: MY, r: 0, fill: 'rgba(110,30,43,0.06)', stroke: 'rgba(110,30,43,0.42)', 'stroke-width': 3, 'stroke-dasharray': '10 9' });
  const ripple = mk('circle', { cx: MX, cy: MY, r: 0, fill: 'none', stroke: 'rgba(110,30,43,0.5)', 'stroke-width': 3 });
  // pins (HTML, in map coordinates)
  const offs = [[-150, -110], [190, -170], [240, 120], [-60, 210], [110, 30, 2], [-250, 60], [20, -255], [285, -30]];
  const pins = offs.map(([dx, dy, n], i) => {
    const el = document.createElement('div');
    el.className = 'pin' + (n ? ' cluster' : '');
    el.style.left = `${MX + dx}px`; el.style.top = `${MY + dy}px`;
    el.innerHTML = `<div class="hring"></div><div class="dot">${n ? `<span class="txt">${n}</span>` : ''}</div>`;
    map.appendChild(el);
    return el;
  });
  const client = document.createElement('div');
  client.id = 's4client'; client.style.left = `${MX}px`; client.style.top = `${MY}px`;
  client.innerHTML = '<div class="core"></div><span class="lbl txt">Toi</span>';
  map.appendChild(client);
  const cap = [...$('s4cap').children], band = $('s4capband'), panel = $('s4panel');
  const cards = ['pc1', 'pc2', 'pc3'].map($);
  const panelBits = [...panel.children];
  return (t) => {
    whip(SC.s4, t, null, 22);
    SC.s4.style.opacity = E.outCubic(P(t, 17.7, 18.05));
    const zq = E.outExpo(P(t, 17.7, 18.75));
    const s = lerp(2.6, 1.0, zq) * (1 + 0.045 * P(t, 18.75, 22));
    css(map, { tf: `translate(${lerp(-280, 0, zq) - 14 * P(t, 18.75, 22)}px, ${lerp(200, 0, zq)}px) scale(${s})` });
    rFill.setAttribute('r', 300 * E.outCubic(P(t, 18.35, 19.4)));
    const ph = t > 19.4 ? ((t - 19.4) / 1.3) % 1 : 0;
    ripple.setAttribute('r', 300 * ph); ripple.setAttribute('opacity', t > 19.4 ? 0.9 * (1 - ph) : 0);
    pins.forEach((el, i) => {
      const q = P(t, TL.ticks[i], TL.ticks[i] + 0.35);
      css(el.querySelector('.dot'), { o: q > 0 ? 1 : 0, tf: `scale(${Math.max(0, E.outBack(q, 2.4))})` });
    });
    const hq = P(t, 20.4, 20.75);
    css(pins[0].querySelector('.hring'), { o: E.outCubic(hq) * (0.75 + 0.25 * Math.sin((t - 20.4) * 7)), tf: `scale(${lerp(0.5, 1.15, E.outBack(hq))})` });
    cards[0].style.borderColor = hq > 0 ? `rgba(110,30,43,${0.55 * E.outCubic(hq)})` : '';
    cards[0].style.boxShadow = hq > 0 ? `0 10px 30px -10px rgba(110,30,43,${0.35 * hq})` : '';
    css(client, { o: 1, tf: 'none' });
    css(client.querySelector('.lbl'), { o: E.outCubic(P(t, 18.5, 18.9)) });
    // caption + panel
    band.style.opacity = E.outCubic(P(t, 18.3, 18.7));
    cap.forEach((el, i) => rise(el, t, 18.45 + i * 0.11));
    const pq = E.outExpo(P(t, 18.8, 19.45));
    css(panel, { o: P(t, 18.8, 19.0), tf: `translateX(${lerp(-560, 0, pq)}px)` });
    panelBits.forEach((el, i) => rise(el, t, 19.0 + i * 0.1, 0.45, 24, 0));
  };
})();

// ===== S5 · regulated trades (soon) =====
const s5 = (() => {
  const cap = [...$('s5cap').children], card = $('s5card'), soon = $('s5soon'), badge = $('s5badge');
  const rows = [0, 1, 2].map((i) => $('lic' + i));
  const okSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const sts = rows.map((r) => {
    const st = r.querySelector('.st');
    st.innerHTML = `<span class="w"><span class="spin"></span><span style="color:var(--muted);font-weight:500;white-space:nowrap">En cours</span></span><span class="d" style="display:none;align-items:center;gap:10px;color:#1f7a4f;white-space:nowrap"><span class="ok">${okSvg}</span>Approuvée</span>`;
    return { w: st.querySelector('.w'), d: st.querySelector('.d'), spin: st.querySelector('.spin'), ok: st.querySelector('.ok') };
  });
  sts.forEach((x) => Object.assign(x.w.style, { display: 'inline-flex', alignItems: 'center', gap: '10px' }));
  const ctx = $('s5fx').getContext('2d');
  let bc = null;
  return (t) => {
    whip(SC.s5, t, 22, 26);
    { const r = badge.getBoundingClientRect(); bc = [r.left + r.width / 2, r.top + r.height / 2]; }
    cap.forEach((el, i) => rise(el, t, 21.88 + i * 0.1));
    const cq = E.outCubic(P(t, 21.95, 22.45));
    css(card, { o: cq, tf: `translateY(${(1 - cq) * 60}px) scale(${lerp(0.97, 1, cq)})` });
    rows.forEach((r, i) => {
      rise(r, t, 22.3 + i * 0.15, 0.4, 20, 0);
      const done = t >= TL.dings[i];
      sts[i].w.style.display = done ? 'none' : 'inline-flex';
      sts[i].d.style.display = done ? 'inline-flex' : 'none';
      sts[i].spin.style.transform = `rotate(${t * 560}deg)`;
      const q = P(t, TL.dings[i], TL.dings[i] + 0.35);
      css(sts[i].ok, { tf: `scale(${E.outBack(q, 2.6)})` });
    });
    const bq = P(t, TL.badge[0], TL.badge[0] + 0.45);
    css(badge, { o: bq > 0 ? 1 : 0, tf: `scale(${Math.max(0, E.outBack(bq, 2.2))})` });
    badge.style.boxShadow = bq > 0 ? `0 0 ${40 * (1 - P(t, 24.6, 25.6))}px rgba(110,30,43,${0.35 * (1 - P(t, 24.6, 25.6))})` : '';
    const wq = t - 24.9;
    css(soon, { tf: wq > 0 ? `rotate(${6 * Math.sin(wq * 26) * Math.exp(-wq * 4.5)}deg) scale(${1 + 0.18 * Math.exp(-wq * 6) * (wq < 2 ? 1 : 0)})` : 'none' });
    ctx.clearRect(0, 0, W, H);
    for (const k of [0, 0.12]) {
      const q = P(t, TL.badge[0] + k, TL.badge[0] + k + 0.8);
      if (q <= 0 || q >= 1) continue;
      ctx.strokeStyle = `rgba(110,30,43,${0.32 * Math.pow(1 - q, 1.5)})`;
      ctx.lineWidth = 10 * (1 - q) + 1;
      ctx.beginPath(); ctx.ellipse(bc[0], bc[1], 150 + 380 * E.outCubic(q), 40 + 140 * E.outCubic(q), 0, 0, 6.283); ctx.stroke();
    }
  };
})();

// ===== S6 · informal trades =====
const s6 = (() => {
  const cap = [...$('s6cap').children], cards = [0, 1, 2, 3].map((i) => $('tc' + i));
  const review = $('s6review'), stars = [...$('s6stars').children], c1 = $('s6c1'), c2 = $('s6c2');
  return (t) => {
    whip(SC.s6, t, 26, 30);
    cap.forEach((el, i) => rise(el, t, 25.88 + i * 0.1));
    cards.forEach((el, i) => {
      const q = E.outExpo(P(t, 26.0 + i * 0.1, 26.7 + i * 0.1));
      css(el, { o: P(t, 26.0 + i * 0.1, 26.2 + i * 0.1), tf: `translateX(${lerp(420, 0, q) - 22 * P(t, 26.9, 30) * (1 + i * 0.2)}px) rotate(${lerp(7, 0, q)}deg)` });
      el.querySelector('img').style.transform = `scale(${lerp(1.12, 1.0, P(t, 26.2, 30))})`;
    });
    const rq = E.outCubic(P(t, 27.35, 27.8));
    css(review, { o: rq, tf: `translateY(${(1 - rq) * 50}px)` });
    stars.forEach((s, j) => {
      const q = P(t, TL.stars[j], TL.stars[j] + 0.3);
      s.style.color = q > 0 ? 'var(--accent)' : 'rgba(110,30,43,0.18)';
      s.style.display = 'inline-block';
      s.style.transform = `scale(${q > 0 ? E.outBack(q, 3) : 1})`;
    });
    for (const [el, st] of [[c1, 28.2], [c2, 28.45]]) {
      const q = E.outExpo(P(t, st, st + 0.55));
      css(el, { o: P(t, st, st + 0.2), tf: `translateX(${(1 - q) * 160}px)` });
    }
  };
})();

// ===== S7 · two roles =====
const s7 = (() => {
  const cap = [...$('s7cap').children], L = $('s7l'), R = $('s7r'), tg = $('s7toggle'), th = $('s7thumb'), tc = $('s7tc'), tp = $('s7tp');
  return (t) => {
    whip(SC.s7, t, 30, 34);
    cap.forEach((el, i) => rise(el, t, 29.88 + i * 0.1));
    const g = E.outBack(P(t, 30.05, 30.45), 1.6);
    css(tg, { o: P(t, 30.05, 30.2), tf: `scale(${g})` });
    const sw = E.outBack(P(t, TL.toggle[0], TL.toggle[0] + 0.35), 1.3);
    th.style.transform = `translateX(${196 * sw}px)`;
    const onPro = sw > 0.5;
    tc.style.color = onPro ? 'var(--text)' : 'var(--on-accent)';
    tp.style.color = onPro ? 'var(--on-accent)' : 'var(--text)';
    const both = E.outCubic(P(t, 33.0, 33.4));
    const lE = onPro ? lerp(0.55, 1, both) : 1, rE = onPro ? 1 : 0.55;
    const lq = E.outExpo(P(t, 30.05, 30.6)), rq = E.outExpo(P(t, 30.3, 30.85));
    css(L, { o: P(t, 30.05, 30.25) * lE, tf: `translateX(${lerp(-460, 0, lq)}px) scale(${lE < 1 ? 0.97 : 1})` });
    css(R, { o: P(t, 30.3, 30.5) * rE, tf: `translateX(${lerp(460, 0, rq)}px) scale(${rE < 1 ? 0.97 : 1})` });
  };
})();

// ===== S8 · booking & payment =====
const s8 = (() => {
  const cap = [...$('s8cap').children], card = $('s8card'), st = $('s8status'), b1 = $('s8b1'), b2 = $('s8b2'), k1 = $('s8k1'), k2 = $('s8k2');
  const STATES = [[0, 'En attente', '#fef3c7', '#92400e'], [35.0, 'Acceptée', '#dbeafe', '#1e40af'], [36.0, 'Complétée', '#ede9fe', '#5b21b6'], [36.85, 'Payée', '#d1fae5', '#065f46']];
  return (t) => {
    whip(SC.s8, t, 34, null);
    SC.s8.style.clipPath = t > 37.55 ? `circle(${Math.max(0, 1100 * (1 - E.inCubic(P(t, 37.55, 38.05))))}px at 50% 58%)` : 'none';
    cap.forEach((el, i) => rise(el, t, 33.88 + i * 0.1));
    const cq = E.outCubic(P(t, 34.0, 34.5));
    css(card, { o: cq, tf: `translateY(${(1 - cq) * 60}px) scale(${lerp(0.97, 1, cq) * (1 + 0.025 * P(t, 34.75, 38))})` });
    let cur = STATES[0];
    for (const s of STATES) if (t >= s[0]) cur = s;
    st.textContent = cur[1]; st.style.background = cur[2]; st.style.color = cur[3];
    const pop = cur[0] > 0 ? P(t, cur[0], cur[0] + 0.3) : 1;
    st.style.transform = `scale(${E.outBack(pop, 3)})`;
    b1.style.width = `${100 * E.inOutCubic(P(t, 34.75, 35.3))}%`; b1.style.left = '0';
    b2.style.width = `${100 * E.inOutCubic(P(t, 35.9, 36.8))}%`; b2.style.left = '0';
    const q1 = P(t, TL.dings[3], TL.dings[3] + 0.3), q2 = P(t, TL.dings[4], TL.dings[4] + 0.3);
    css(k1, { o: q1 > 0 ? 1 : 0, tf: `scale(${E.outBack(q1, 3)})` });
    css(k2, { o: q2 > 0 ? 1 : 0, tf: `scale(${E.outBack(q2, 3)})` });
    k1.style.display = k2.style.display = 'inline-block';
  };
})();

// ===== S9 · glocal globe =====
const s9 = (() => {
  const ctx = $('s9globe').getContext('2d');
  const D = window.GLOBE;
  const rad = Math.PI / 180;
  const QC = [['Montréal', -73.57, 45.5], ['Québec', -71.21, 46.81], ['Laval', -73.75, 45.6], ['Gatineau', -75.7, 45.48], ['Sherbrooke', -71.89, 45.4],
    ['Trois-Rivières', -72.55, 46.34], ['Saguenay', -71.07, 48.43], ['Rimouski', -68.52, 48.45], ['Drummondville', -72.48, 45.88]];
  const WORLD = [['Toronto', -79.38, 43.65], ['New York', -74.0, 40.71], ['Paris', 2.35, 48.86], ['Bruxelles', 4.35, 50.85], ['Dakar', -17.47, 14.72],
    ['Casablanca', -7.59, 33.57], ['Abidjan', -4.01, 5.36], ['São Paulo', -46.63, -23.55], ['Mexico', -99.13, 19.43], ['Genève', 6.14, 46.2]];
  const eyebrow = $('s9cap').querySelector('.eyebrow'), title = $('s9t'), sub = $('s9sub');
  title.innerHTML = '<span id="s9l1"></span><br><span id="s9l2"></span>';
  const w1 = splitInto($('s9l1'), 'Né au Québec.', 'word'), w2 = splitInto($('s9l2'), 'Pensé pour le monde.', 'word');
  const toVec = (lng, lat) => [Math.cos(lat * rad) * Math.cos(lng * rad), Math.cos(lat * rad) * Math.sin(lng * rad), Math.sin(lat * rad)];
  function project(lng, lat, l0, p0, R, cx, cy) {
    const dl = (lng - l0) * rad, f = lat * rad, f0 = p0 * rad;
    const cosc = Math.sin(f0) * Math.sin(f) + Math.cos(f0) * Math.cos(f) * Math.cos(dl);
    return [cx + R * Math.cos(f) * Math.sin(dl), cy - R * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(dl)), cosc];
  }
  function glow(x, y, r, a, core) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,232,226,${a})`); g.addColorStop(0.25, `rgba(217,130,142,${a * 0.75})`); g.addColorStop(1, 'rgba(217,130,142,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = `rgba(255,248,244,${a})`; ctx.beginPath(); ctx.arc(x, y, core, 0, 6.283); ctx.fill();
  }
  return (t) => {
    const q = E.inOutCubic(P(t, 38.0, 41.3));
    let R = Math.exp(lerp(Math.log(5600), Math.log(350), q));
    R *= Math.exp(Math.log(9) * E.inCubic(P(t, 43.55, 44.1)));
    const l0 = -73.57 + 78 * E.inOutCubic(P(t, 40.6, 44.0)), p0 = lerp(45.5, 26, E.inOutCubic(P(t, 39.4, 43.0)));
    const cx = 720, cy = lerp(640, 690, q);
    ctx.clearRect(0, 0, W, H);
    if (R < 2400) {
      const a = 1 - clamp((R - 900) / 1500);
      const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
      g.addColorStop(0, `rgba(217,130,142,${0.22 * a})`); g.addColorStop(1, 'rgba(217,130,142,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(110,30,43,${0.22 * a})`; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.fill();
      ctx.strokeStyle = `rgba(217,130,142,${0.35 * a})`; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const aReg = clamp((R - 1300) / 1500), aW = 1 - clamp((R - 2200) / 2600);
    const draw = (pts, alpha, size) => {
      if (alpha <= 0.01) return;
      for (const [lng, lat] of pts) {
        const [x, y, c] = project(lng, lat, l0, p0, R, cx, cy);
        if (c <= 0 || x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
        ctx.fillStyle = `rgba(243,235,223,${alpha * (0.25 + 0.6 * c)})`;
        ctx.fillRect(x - size, y - size, size * 2, size * 2);
      }
    };
    draw(D.region, aReg * 0.85, clamp(R * 0.00095, 1, 5));
    draw(D.world, aW * 0.8, clamp(R * 0.0042, 1, 4));
    // arcs from Montréal
    const M = toVec(-73.57, 45.5);
    WORLD.forEach((c, j) => {
      const L = TL.lights[9 + j], d = E.outCubic(P(t, L - 0.55, L));
      if (d <= 0) return;
      const B = toVec(c[1], c[2]);
      const om = Math.acos(clamp(M[0] * B[0] + M[1] * B[1] + M[2] * B[2], -1, 1));
      ctx.strokeStyle = `rgba(217,130,142,${0.75 * (1 - P(t, 43.5, 43.9))})`; ctx.lineWidth = 2.2;
      ctx.beginPath();
      let started = false;
      for (let k = 0; k <= 48 * d; k++) {
        const s = k / 48, a1 = Math.sin((1 - s) * om) / Math.sin(om), a2 = Math.sin(s * om) / Math.sin(om);
        const v = [a1 * M[0] + a2 * B[0], a1 * M[1] + a2 * B[1], a1 * M[2] + a2 * B[2]];
        const lat = Math.asin(v[2]) / rad, lng = Math.atan2(v[1], v[0]) / rad;
        const [x, y, cc] = project(lng, lat, l0, p0, R * (1 + 0.16 * Math.sin(Math.PI * s)), cx, cy);
        if (cc < -0.15) { started = false; continue; }
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    const sc = clamp(R / 1400, 0.45, 1.4);
    QC.forEach((c, i) => {
      const L = TL.lights[i], lq = P(t, L, L + 0.4);
      if (lq <= 0) return;
      const [x, y, cc] = project(c[1], c[2], l0, p0, R, cx, cy);
      if (cc <= 0) return;
      const pulse = 0.8 + 0.2 * Math.sin((t - L) * 5 + i);
      glow(x, y, 46 * sc * E.outBack(lq, 2) * pulse, 0.9, 4 * sc + 1.5);
    });
    WORLD.forEach((c, j) => {
      const L = TL.lights[9 + j], lq = P(t, L, L + 0.4);
      if (lq <= 0) return;
      const [x, y, cc] = project(c[1], c[2], l0, p0, R, cx, cy);
      if (cc <= 0) return;
      glow(x, y, 26 * E.outBack(lq, 2) * (0.8 + 0.2 * Math.sin((t - L) * 5 + j)), 0.95, 3);
    });
    // Québec label at the start
    const la = E.outCubic(P(t, 38.45, 38.9)) * (1 - P(t, 39.8, 40.3));
    if (la > 0) {
      const [x, y] = project(-72.0, 49.4, l0, p0, R, cx, cy);
      ctx.font = '600 34px Geist'; ctx.textAlign = 'center'; ctx.fillStyle = `rgba(243,235,223,${la})`;
      ctx.fillText('Québec', clamp(x, 300, 1140), clamp(y, 420, 900));
    }
    rise(eyebrow, t, 38.2);
    w1.forEach((w, i) => rise(w, t, 38.45 + i * 0.1, 0.5, 40, 8));
    w2.forEach((w, i) => rise(w, t, 40.75 + i * 0.1, 0.5, 40, 8));
    rise(sub, t, 41.7);
    SC.s9.style.zIndex = t < 38.06 ? 1 : 3;
    SC.s9.style.opacity = 1 - P(t, 43.85, 44.05);
  };
})();

// ===== S10 · call to action =====
const s10 = (() => {
  const logo = $('s10logo'), open = splitInto($('s10open'), 'La version d’essai est ouverte à tous', 'word');
  const urlEl = $('s10url'), letters = splitInto(urlEl, 'linkrapp.com', 'char');
  const line = $('s10line'), glowEl = $('s10glow');
  const sub = [...splitInto($('s10sub1'), 'Deviens testeur : crée ton compte', 'word'), ...splitInto($('s10sub2'), 'et dis-moi ce que tu en penses.', 'word')];
  const note = $('s10note'), h1 = $('s10h1'), h2 = $('s10h2'), flash = $('flash');
  let measured = false;
  return (t) => {
    if (!measured) {
      // underline = exact width of the URL glyphs
      const a = letters[0].getBoundingClientRect(), b = letters[letters.length - 1].getBoundingClientRect();
      if (a.width) { line.style.left = `${a.left}px`; line.style.width = `${b.right - a.left}px`; measured = true; }
    }
    if (t >= 43.8 && t < 44.6) {
      const fo = t < 44.0 ? P(t, 43.8, 44.0) : 1 - E.outCubic(P(t, 44.0, 44.45));
      flash.style.background = '#f8f2ea'; flash.style.opacity = fo;
    } else if (t >= 44.6) flash.style.opacity = 0;
    const lq = P(t, 44.05, 44.6);
    css(logo, { o: E.outCubic(P(t, 44.05, 44.3)), tf: `scale(${lerp(0.82, 1, E.outBack(lq, 1.6))})`, f: lq < 1 ? `blur(${14 * (1 - E.outCubic(lq))}px)` : 'none' });
    open.forEach((w, i) => rise(w, t, 44.35 + i * 0.06, 0.45, 30, 6));
    letters.forEach((s, i) => {
      const st = TL.url[0] + i * 0.032, q = P(t, st, st + 0.42), e = E.outExpo(q);
      css(s, { o: P(t, st, st + 0.18), tf: `translateY(${(1 - e) * 70}px) scale(${lerp(1.25, 1, e)})`, f: q < 1 ? `blur(${12 * (1 - E.outCubic(q))}px)` : 'none' });
    });
    css(line, { tf: `scaleX(${E.outCubic(P(t, 45.25, 45.75))})` });
    const gq = P(t, 44.8, 45.6);
    css(glowEl, { o: E.outCubic(gq) * (t > 45.6 ? 0.85 + 0.15 * Math.sin(((t - 45.6) / 2.4) * 6.283) : 1) });
    sub.forEach((w, i) => rise(w, t, 45.55 + i * 0.045, 0.45, 26, 6));
    rise(note, t, 46.15, 0.6, 16, 0);
    css(h1, { tf: `translate(${30 * Math.sin(t * 0.6)}px, ${20 * Math.cos(t * 0.5)}px) scale(${1 + 0.06 * Math.sin(t * 0.8)})` });
    css(h2, { tf: `translate(${-30 * Math.sin(t * 0.5)}px, ${-20 * Math.cos(t * 0.7)}px) scale(${1 + 0.05 * Math.cos(t * 0.9)})` });
    SC.s10.style.zIndex = 4;
  };
})();

const UPD = { s1, s2, s3, s4, s5, s6, s7, s8, s9, s10 };

window.renderFrame = function renderFrame(t) {
  for (const id in SC) {
    const [a, b] = VIS[id];
    const on = t >= a && t < b;
    SC[id].style.display = on ? 'block' : 'none';
    if (on) UPD[id](t);
  }
  SC.s8.style.zIndex = 2;
  if (t < 7 || t >= 8) { if (!(t >= 43.8 && t < 44.6)) $('flash').style.opacity = 0; }
};
window.showSafe = (on) => { $('safe').style.display = on ? 'block' : 'none'; };
window.__ready = (async () => {
  await document.fonts.load('400 100px Parisienne');
  await document.fonts.load('600 40px Geist');
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  // decode webp photos used by scenes
  window.renderFrame(0);
  return true;
})();
