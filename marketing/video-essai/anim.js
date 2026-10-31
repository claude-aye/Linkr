/* Linkr — LinkedIn trial video, v2 (dynamic cut).
 * Every frame is a pure function of t (seconds): window.renderFrame(t) sets every
 * style; nothing is animated by the browser, so the capture is deterministic. */
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
const blur = (v) => (v > 0.25 ? `blur(${v}px)` : 'none');
function rise(el, t, start, dur = 0.42, dist = 30, bl = 8) {
  const q = P(t, start, start + dur), e = E.outCubic(q);
  css(el, { o: e, tf: `translateY(${(1 - e) * dist}px)`, f: bl ? blur((1 - e) * bl) : 'none' });
  return q;
}
/** Kinetic word slam: big → normal, blurred → sharp. */
function slam(el, t, st, dur = 0.38, from = 1.55) {
  const q = P(t, st, st + dur), e = E.outExpo(q);
  css(el, { o: P(t, st, st + 0.1), tf: `translateY(${(1 - e) * 22}px) scale(${lerp(from, 1, e)})`, f: blur((1 - E.outCubic(q)) * 12) });
}
function pop(el, t, st, dur = 0.35, s = 2.2) {
  const q = P(t, st, st + dur);
  css(el, { o: q > 0 ? 1 : 0, tf: `scale(${Math.max(0, E.outBack(q, s))})` });
  return q;
}
function splitInto(el, text, unit, cls = 'w') {
  el.textContent = '';
  const parts = unit === 'word' ? text.split(/(\s+)/) : [...text];
  const spans = [];
  for (const p of parts) {
    const s = document.createElement('span');
    s.textContent = p; s.className = cls;
    el.appendChild(s);
    if (p.trim()) spans.push(s);
  }
  return spans;
}
const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
/** Press feedback on a button at time t0. */
function press(el, t, t0) {
  const b = Math.exp(-Math.pow((t - t0) / 0.07, 2));
  el.style.transform = `scale(${1 - 0.08 * b})`;
  el.style.filter = b > 0.05 ? `brightness(${1 + 0.25 * b})` : 'none';
}
/** Touch indicator: approaches, taps, ripples out. Positioned on the target's centre. */
function tap(dot, t, t0, target) {
  if (t < t0 - 0.25 || t > t0 + 0.45) { dot.style.opacity = 0; return; }
  const [x, y] = center(target);
  const sc = dot.offsetParent ? dot.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
  dot.style.left = `${x - sc.left}px`; dot.style.top = `${y - sc.top}px`;
  if (t < t0) { const q = P(t, t0 - 0.25, t0); css(dot, { o: 0.95 * q, tf: `scale(${lerp(1.5, 0.9, E.outCubic(q))})` }); }
  else { const q = P(t, t0, t0 + 0.45); css(dot, { o: 0.95 * (1 - q), tf: `scale(${lerp(0.9, 2.1, E.outCubic(q))})` }); }
}
/** Caption block: eyebrow rises, title words slam, sub rises. */
function caption(box, t, t0) {
  const kids = [...box.children];
  let k = 0;
  for (const el of kids) {
    if (el.classList.contains('title')) {
      const words = el._words || (el._words = splitInto(el, el.textContent, 'word'));
      words.forEach((w, i) => slam(w, t, t0 + 0.08 + i * 0.06));
      k = words.length;
    } else if (el.classList.contains('sub')) rise(el, t, t0 + 0.2 + k * 0.05, 0.45, 24, 6);
    else rise(el, t, t0, 0.35, 20, 0);
  }
}

// ---------- transitions ----------
function trans(type, dir, t, T) {
  const q = P(t, T - 0.27, T + 0.2), e = E.inOutCubic(q), b = 28 * Math.sin(Math.PI * q);
  const r = { tx: 0, ty: 0, s: 1, o: 1, b: 0 };
  if (q <= 0 || q >= 1) { if (dir === 'in' && q <= 0 && type === 'zoom') r.o = 0; return r; }
  r.b = b;
  if (type === 'whipL') r.tx = dir === 'in' ? W * (1 - e) : -W * e;
  if (type === 'whipR') r.tx = dir === 'in' ? -W * (1 - e) : W * e;
  if (type === 'whipU') r.ty = dir === 'in' ? H * (1 - e) : -H * e;
  if (type === 'zoom') {
    // incoming fades in over the outgoing one, which keeps covering the frame (never a black edge)
    if (dir === 'in') { r.s = lerp(1.15, 1, E.outCubic(q)); r.o = E.outCubic(P(t, T - 0.27, T + 0.05)); }
    else { r.s = lerp(1, 1.7, E.inCubic(q)); }
  }
  return r;
}
const SCN = [
  // id, visible from, to, in-transition, out-transition
  ['op', 0, 3.02], ['lg', 3.0, 7.02], ['cc', 7.0, 10.1], ['f1', 9.6, 13.2],
  ['f2', 12.85, 15.75, null, ['whipL', 15.5]], ['f3', 15.2, 18.25, ['whipL', 15.5], ['whipU', 18.0]],
  ['f4', 17.72, 20.74, ['whipU', 18.0]], ['f5', 20.7, 23.75, null, ['whipL', 23.5]],
  ['f6', 23.22, 26.3, ['whipL', 23.5]], ['f7', 26.02, 28.75, null, ['whipR', 28.5]],
  ['f8', 28.22, 31.25, ['whipR', 28.5], ['zoom', 31.0]], ['f9', 30.72, 33.25, ['zoom', 31.0], ['whipU', 33.0]],
  ['f10', 32.72, 35.25, ['whipU', 33.0], ['whipL', 35.0]], ['f11', 34.72, 37.75, ['whipL', 35.0], ['zoom', 37.5]],
  ['f12', 37.22, 40.1, ['zoom', 37.5]], ['gl', 39.5, 44.15], ['ct', 43.82, 99],
];
function applyTrans(el, t, tin, tout) {
  let r = { tx: 0, ty: 0, s: 1, o: 1, b: 0 };
  if (tin && t < tin[1] + 0.2) r = trans(tin[0], 'in', t, tin[1]);
  else if (tout && t > tout[1] - 0.27) r = trans(tout[0], 'out', t, tout[1]);
  css(el, { tf: r.tx || r.ty || r.s !== 1 ? `translate(${r.tx}px, ${r.ty}px) scale(${r.s})` : 'none', f: blur(r.b), o: r.o });
}
function wipe(t, T) {
  const el = $('wipe');
  const q = P(t, T - 0.3, T + 0.3);
  if (q <= 0 || q >= 1) return false;
  el.style.transform = `translateX(${lerp(2500, -2600, E.inOutCubic(q))}px) rotate(-14deg)`;
  return true;
}

// ===== OPENING · dark → light =====
const op = (() => {
  const bg = $('opbg'), h1 = $('oph1'), h2 = $('oph2'), rays = $('oprays'), vig = $('opvig'), bloom = $('bloom');
  const ctx = $('opdust').getContext('2d');
  const r = rng(11), motes = [];
  for (let i = 0; i < 120; i++) motes.push({ x: r() * W, y: r() * H, vx: (r() - 0.5) * 18, vy: -6 - r() * 16, s: 0.6 + r() * 2.4, f: 0.6 + r() * 2, ph: r() * 6.28, b: 0.25 + r() * 0.6 });
  const KEYS = [ // t, centre colour, edge colour
    [0.0, [16, 7, 9], [0, 0, 0]], [1.0, [52, 14, 22], [10, 4, 6]], [1.8, [110, 30, 43], [38, 10, 16]],
    [2.35, [182, 93, 104], [110, 30, 43]], [2.75, [240, 214, 206], [217, 179, 171]], [3.0, [255, 246, 238], [243, 235, 223]],
  ];
  const col = (t, k) => {
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1], x = E.inOutCubic(P(t, a[0], b[0]));
    return `rgb(${a[k].map((v, j) => Math.round(lerp(v, b[k][j], x))).join(',')})`;
  };
  function intensity(t) {
    let I = 0.08 + 0.4 * Math.pow(P(t, 0, 3), 1.8);
    TL.heartbeats.forEach((b, i) => {
      const g = 0.4 + 0.7 * (i / (TL.heartbeats.length - 1));
      for (const [off, k] of [[0, 1], [0.14, 0.5]]) {
        const dt = t - b - off;
        if (dt >= 0) I += g * k * (dt < 0.05 ? dt / 0.05 : Math.exp(-(dt - 0.05) / 0.26));
      }
    });
    return Math.min(I, 1.6);
  }
  return (t) => {
    bg.style.background = `radial-gradient(circle at 50% 48%, ${col(t, 1)} 0%, ${col(t, 2)} 75%)`;
    const I = intensity(t), grow = 1 + 1.6 * E.inExpo(P(t, 2.2, 3.0));
    css(h1, { o: clamp(I), tf: `translate(-50%, -50%) scale(${(0.4 + 0.45 * I) * grow})` });
    css(h2, { o: clamp(0.3 + 0.5 * I), tf: `translate(-50%, -50%) scale(${(0.7 + 0.3 * I) * grow})` });
    css(rays, { o: 0.9 * P(t, 1.1, 2.3) * (1 - P(t, 2.7, 3.0)), tf: `rotate(${t * 14}deg) scale(${0.7 + 0.5 * P(t, 1.1, 3)})` });
    vig.style.opacity = 1 - P(t, 1.8, 2.8);
    bloom.style.opacity = E.inCubic(P(t, 2.45, 3.0));
    ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      const x = (m.x + m.vx * t + Math.sin(t * m.f + m.ph) * 10 + W) % W, y = (m.y + m.vy * t + H * 4) % H;
      const a = m.b * (0.5 + 0.5 * Math.sin(t * m.f * 2 + m.ph)) * (0.3 + 0.7 * clamp(I));
      ctx.fillStyle = `rgba(255, 226, 220, ${a * 0.6})`;
      ctx.beginPath(); ctx.arc(x, y, m.s, 0, 6.283); ctx.fill();
    }
  };
})();

// ===== LOGO =====
const lg = (() => {
  const ctx = $('lgfx').getContext('2d'), cam = $('lgcam'), logo = $('lglogo'), flash = $('flash');
  const words = splitInto($('lgtag'), 'Le bon pro, juste à côté de chez toi.', 'word');
  words.slice(3).forEach((w) => w.classList.add('hl'));
  const uline = document.createElement('div');
  Object.assign(uline.style, { position: 'absolute', height: '7px', borderRadius: '4px', background: 'var(--accent)', transformOrigin: 'left center', transform: 'scaleX(0)' });
  $('lgtag').appendChild(uline);
  const r = rng(7), parts = [];
  const cols = ['110,30,43', '217,130,142', '184,150,120', '46,33,30'];
  for (let i = 0; i < 320; i++) {
    const u = r();
    parts.push({ a: r() * 6.283, v: lerp(260, 1700, u * u), k: lerp(1.5, 3.2, r()), s: 0.8 + r() * 3.6, life: lerp(0.9, 3.0, r()), c: cols[(r() * 4) | 0], tw: r() * 6 });
  }
  const CX = 720, CY = 440;
  return (t) => {
    const lt = t - 3;
    flash.style.background = '#fff8f1';
    if (t < 3.8) flash.style.opacity = lt < 0 ? 0 : Math.exp(-lt / 0.2);
    const s = 1.14 - 0.14 * E.outCubic(P(lt, 0, 1.6)) + 0.06 * E.inOutCubic(P(lt, 1.6, 4.0));
    const A = 18 * Math.exp(-lt / 0.16);
    css(cam, { tf: `translate(${A * Math.sin(lt * 95)}px, ${A * Math.cos(lt * 83)}px) scale(${s})` });
    const q = P(lt, 0, 0.8);
    css(logo, { o: E.outCubic(P(lt, 0, 0.2)), tf: `scale(${lerp(0.5, 1, E.outBack(q, 1.5))})`, f: blur(18 * (1 - E.outCubic(P(lt, 0, 0.45)))) });
    logo.style.textShadow = `0 0 ${40 + 100 * Math.exp(-lt / 0.4)}px rgba(217, 130, 142, ${0.25 + 0.5 * Math.exp(-lt / 0.4)})`;
    words.forEach((w, i) => slam(w, t, 3.95 + i * 0.07, 0.4, 1.7));
    // underline sweeps under « juste à côté de chez toi. »
    const hl = words.slice(3), f0 = hl[0], f1 = hl[hl.length - 1];
    css(uline, { tf: `scaleX(${E.outCubic(P(t, 4.75, 5.25))})` });
    Object.assign(uline.style, { left: `${f0.offsetLeft}px`, width: `${f1.offsetLeft + f1.offsetWidth - f0.offsetLeft}px`, top: `${f0.offsetTop + f0.offsetHeight + 2}px` });
    ctx.clearRect(0, 0, W, H);
    // proximity pins pop around the logo
    TL.logopins.forEach((p0, i) => {
      const q = P(t, p0, p0 + 0.35);
      if (q <= 0) return;
      const [x, y] = [[260, 330], [470, 170], [980, 160], [1190, 330], [1150, 590], [290, 600], [720, 880]][i];
      const s2 = Math.max(0, E.outBack(q, 2.6)), ring = ((t - p0) / 1.1) % 1;
      ctx.strokeStyle = `rgba(110,30,43,${0.4 * (1 - ring)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 14 + 46 * ring, 0, 6.283); ctx.stroke();
      ctx.fillStyle = '#6e1e2b'; ctx.beginPath(); ctx.arc(x, y, 16 * s2, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#f8f2ea'; ctx.lineWidth = 4 * s2; ctx.stroke();
    });
    for (const k of [0, 0.12, 0.3]) {
      const qq = P(lt, k, k + 1.1);
      if (qq <= 0 || qq >= 1) continue;
      ctx.strokeStyle = `rgba(110, 30, 43, ${0.7 * Math.pow(1 - qq, 1.6)})`;
      ctx.lineWidth = 30 * (1 - qq) + 2;
      ctx.beginPath(); ctx.arc(CX, CY, 40 + 1250 * E.outCubic(qq), 0, 6.283); ctx.stroke();
    }
    for (const p of parts) {
      if (lt < 0 || lt > p.life) continue;
      const d = (p.v / p.k) * (1 - Math.exp(-p.k * lt));
      const x = CX + Math.cos(p.a) * d, y = CY + Math.sin(p.a) * d + 22 * lt * lt;
      ctx.fillStyle = `rgba(${p.c}, ${Math.pow(1 - lt / p.life, 1.3) * (0.6 + 0.4 * Math.sin(lt * 14 + p.tw))})`;
      ctx.beginPath(); ctx.arc(x, y, p.s, 0, 6.283); ctx.fill();
    }
  };
})();

// ===== CONCEPT =====
const cc = (() => {
  const row = $('ccrow'), w1 = $('ccw1'), w2 = $('ccw2'), x = $('ccx'), cam = $('cccam');
  const smalls = [...row.querySelectorAll('small')];
  const b1 = splitInto($('ccb1'), 'en version', 'char');
  const b2 = $('ccb2'), dot = $('ccdot'), r1 = $('ccr1'), r2 = $('ccr2');
  const ring = (el, q) => {
    const sz = 40 + 600 * E.outCubic(q);
    css(el, { o: q > 0 && q < 1 ? Math.pow(1 - q, 1.4) : 0 });
    Object.assign(el.style, { width: `${sz}px`, height: `${sz}px`, left: `${-sz / 2}px`, top: `${-sz / 2}px` });
  };
  return (t) => {
    const a1 = P(t, 7.0, 7.35), a2 = P(t, 7.25, 7.6), a3 = P(t, 7.45, 7.8);
    css(w1, { o: a1 > 0 ? 1 : 0, tf: `translateX(${lerp(-1000, 0, E.outExpo(a1))}px)`, f: blur(22 * (1 - E.outCubic(a1))) });
    css(x, { o: E.outCubic(a2), tf: `scale(${E.outBack(a2, 2.4)}) rotate(${lerp(-180, 0, E.outCubic(a2))}deg)` });
    css(w2, { o: a3 > 0 ? 1 : 0, tf: `translateX(${lerp(1000, 0, E.outExpo(a3))}px)`, f: blur(22 * (1 - E.outCubic(a3))) });
    smalls.forEach((el, i) => { const q = rise(el, t, 7.75 + i * 0.1, 0.35, 18, 6); el.style.opacity = E.outCubic(q) * (1 - P(t, 8.3, 8.45)); });
    const sq = E.inOutCubic(P(t, 8.35, 8.7));
    css(row, { tf: `translateY(${-130 * sq}px) scale(${(1 + 0.03 * P(t, 7.8, 8.35)) * lerp(1, 0.5, sq)})` });
    const c = `rgb(${Math.round(lerp(46, 85, sq))}, ${Math.round(lerp(33, 80, sq))}, ${Math.round(lerp(30, 77, sq))})`;
    w1.style.color = c; w2.style.color = c;
    b1.forEach((el, i) => { const st = 8.5 + i * 0.03, e = E.outCubic(P(t, st, st + 0.35)); css(el, { o: e, tf: `translateY(${(1 - e) * 60}px)`, f: blur((1 - e) * 8) }); });
    const hw = E.inOutCubic(P(t, 8.75, 9.2));
    css(b2, { o: hw > 0 ? 1 : 0, cp: `inset(-20% ${100 - hw * 100}% -20% 0)`, tf: `translateX(${(1 - hw) * -20}px) scale(${lerp(0.95, 1, hw)})` });
    const dq = P(t, 9.1, 9.45);
    css(dot, { o: dq > 0 ? 1 : 0, tf: `translateY(${lerp(-600, 0, E.outBounce(dq))}px)` });
    ring(r1, P(t, 9.25, 10.0)); ring(r2, P(t, 9.45, 10.1));
    const z = E.inCubic(P(t, 9.5, 10.05));
    cam.style.transformOrigin = '720px 880px';
    css(cam, { tf: `scale(${1 + 9 * z})`, o: 1 - P(t, 9.62, 9.86) });
  };
})();

// ===== F1 · search + map (styled on lib/map/linkr-light.style.json) =====
const f1 = (() => {
  const CX = 1000, CY = 660, MX = 1100, MY = 850;
  const map = $('map');
  map.style.left = `${CX - MX}px`; map.style.top = `${CY - MY}px`;
  const svg = $('mapsvg'), NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const defs = mk('defs', {});
  const pat = mk('pattern', { id: 'blk', width: 64, height: 64, patternUnits: 'userSpaceOnUse' }, defs);
  mk('rect', { width: 64, height: 64, fill: '#FBF7F1' }, pat);
  mk('rect', { x: 4, y: 4, width: 56, height: 56, rx: 3, fill: '#EFE6D8' }, pat);
  mk('rect', { width: 2200, height: 1700, fill: '#F3EBDF' });
  const grid = mk('g', { transform: `rotate(-28 ${MX} ${MY})` });
  mk('rect', { x: -900, y: -900, width: 4000, height: 3500, fill: 'url(#blk)' }, grid);
  for (let k = -6; k <= 7; k++) for (const [w, c] of [[24, '#DCCDB8'], [16, '#FFFFFF']]) {
    mk('line', { x1: -900, y1: MY + k * 384 + 2, x2: 3100, y2: MY + k * 384 + 2, stroke: c, 'stroke-width': w }, grid);
    mk('line', { x1: MX + k * 384 + 2, y1: -900, x2: MX + k * 384 + 2, y2: 2600, stroke: c, 'stroke-width': w }, grid);
  }
  mk('path', { d: 'M -200 -200 L 2400 1700', stroke: '#DCCDB8', 'stroke-width': 26 });
  mk('path', { d: 'M -200 -200 L 2400 1700', stroke: '#FFFFFF', 'stroke-width': 18 });
  mk('ellipse', { cx: 640, cy: 470, rx: 250, ry: 175, fill: '#DEDFCB', transform: 'rotate(-20 640 470)' });
  mk('path', { d: 'M -200 1420 Q 1000 1080 2500 1330', stroke: '#CDD6D6', 'stroke-width': 250, fill: 'none' });
  mk('circle', { cx: 1530, cy: 520, r: 80, fill: '#DEDFCB' });
  const label = (x, y, txt, size, fill, water) => {
    const e = mk('text', { x, y, 'font-family': 'Geist', 'font-size': size, 'font-weight': 600, fill, stroke: water ? '#CDD6D6' : '#F3EBDF', 'stroke-width': 7, 'paint-order': 'stroke', 'text-anchor': 'middle', 'font-style': water ? 'italic' : 'normal' });
    e.textContent = txt; return e;
  };
  label(1320, 585, 'Rosemont', 26, '#2E211E'); label(940, 1075, 'Plateau', 26, '#2E211E'); label(1100, 1290, 'Fleuve Saint-Laurent', 24, '#46524F', true);
  const rFill = mk('circle', { cx: MX, cy: MY, r: 0, fill: 'rgba(110,30,43,0.07)', stroke: 'rgba(110,30,43,0.45)', 'stroke-width': 3, 'stroke-dasharray': '10 9' });
  const ripple = mk('circle', { cx: MX, cy: MY, r: 0, fill: 'none', stroke: 'rgba(110,30,43,0.5)', 'stroke-width': 3 });
  const offs = [[-150, -110], [190, -170], [240, 120], [-60, 210], [110, 30, 2], [-250, 60], [20, -255], [285, -30]];
  const pins = offs.map(([dx, dy, n]) => {
    const el = document.createElement('div');
    el.className = 'pin' + (n ? ' cluster' : '');
    el.style.left = `${MX + dx}px`; el.style.top = `${MY + dy}px`;
    el.innerHTML = `<div class="hring"></div><div class="dot">${n ? `<span class="txt">${n}</span>` : ''}</div>`;
    map.appendChild(el); return el;
  });
  const client = document.createElement('div');
  client.id = 'client'; client.style.left = `${MX}px`; client.style.top = `${MY}px`;
  client.innerHTML = '<div class="core"></div><span class="lb txt">Toi</span>';
  map.appendChild(client);
  const capEl = $('f1cap'), band = $('f1band'), panel = $('f1panel'), bits = [...panel.children], near = $('f1near'), td = $('f1tap');
  const cards = ['pc1', 'pc2', 'pc3'].map($);
  let morph = [350, 520];
  window.__morphFrom = () => morph;
  return (t) => {
    const scene = $('f1');
    const zq = E.outExpo(P(t, 9.62, 10.6));
    const s = lerp(2.8, 1.0, zq) * (1 + 0.05 * P(t, 10.6, 13));
    css(map, { tf: `translate(${lerp(-280, 0, zq) - 16 * P(t, 10.6, 13)}px, ${lerp(220, 0, zq)}px) scale(${s})` });
    rFill.setAttribute('r', 300 * E.outCubic(P(t, 10.55, 11.25)));
    const ph = t > 11.25 ? ((t - 11.25) / 1.0) % 1 : 0;
    ripple.setAttribute('r', 300 * ph); ripple.setAttribute('opacity', t > 11.25 ? 0.9 * (1 - ph) : 0);
    pins.forEach((el, i) => { const q = P(t, TL.ticks[i], TL.ticks[i] + 0.3); css(el.querySelector('.dot'), { o: q > 0 ? 1 : 0, tf: `scale(${Math.max(0, E.outBack(q, 2.6))})` }); });
    const hq = P(t, TL.ticks[8], TL.ticks[8] + 0.3);
    css(pins[0].querySelector('.hring'), { o: E.outCubic(hq) * (0.75 + 0.25 * Math.sin((t - 12.1) * 9)), tf: `scale(${lerp(0.5, 1.15, E.outBack(hq))})` });
    cards[0].style.borderColor = hq > 0 ? `rgba(110,30,43,${0.6 * E.outCubic(hq)})` : '';
    cards[0].style.boxShadow = hq > 0 ? `0 12px 30px -10px rgba(110,30,43,${0.4 * hq})` : '';
    css(client.querySelector('.lb'), { o: E.outCubic(P(t, 10.3, 10.6)) });
    band.style.opacity = E.outCubic(P(t, 10.0, 10.3));
    caption(capEl, t, 10.12);
    const pq = E.outExpo(P(t, 10.18, 10.65));
    css(panel, { o: P(t, 10.18, 10.35), tf: `translateX(${lerp(-560, 0, pq)}px)` });
    bits.forEach((el, i) => { if (i > 1) rise(el, t, 10.85 + (i - 2) * 0.09, 0.35, 22, 0); });
    press(near, t, TL.taps[0]); tap(td, t, TL.taps[0], near);
    // morph out: dive into the highlighted card
    if (t < 12.7) morph = center(cards[0]);
    const mz = E.inCubic(P(t, 12.72, 13.12));
    scene.style.transformOrigin = `${morph[0]}px ${morph[1]}px`;
    css(scene, { tf: mz ? `scale(${1 + 1.8 * mz})` : 'none', o: 1 - P(t, 12.92, 13.12), f: blur(14 * mz) });
    scene.style.opacity = Math.min(E.outCubic(P(t, 9.62, 9.95)), 1 - P(t, 12.92, 13.12));
  };
})();

// ===== F2 · profile =====
const f2 = (() => {
  const capEl = $('f2cap'), card = $('f2card'), av = $('f2av'), rows = ['sv0', 'sv1', 'sv2'].map($), req = $('f2req'), td = $('f2tap');
  return (t) => {
    const scene = $('f2');
    const [mx, my] = window.__morphFrom();
    const q = E.outExpo(P(t, 12.85, 13.35));
    if (t < 13.4) {
      css(scene, { tf: 'none', f: 'none', o: E.outCubic(P(t, 12.85, 13.08)) });
      card.style.transform = 'none';
      const [fx, fy] = center(card);
      css(card, { o: P(t, 12.85, 12.95), tf: `translate(${(mx - fx) * (1 - q)}px, ${(my - fy) * (1 - q)}px) scale(${lerp(0.42, 1, q)})`, f: blur(8 * (1 - q)) });
    } else { applyTrans(scene, t, null, ['whipL', 15.5]); css(card, { o: 1, tf: 'none', f: 'none' }); }
    caption(capEl, t, 13.05);
    pop(av, t, 13.2, 0.4, 2.4);
    rows.forEach((r, i) => { const e = E.outExpo(P(t, 13.35 + i * 0.1, 13.8 + i * 0.1)); css(r, { o: P(t, 13.35 + i * 0.1, 13.5 + i * 0.1), tf: `translateX(${(1 - e) * 260}px)` }); });
    press(req, t, TL.taps[1]); tap(td, t, TL.taps[1], req);
    rows[0].style.background = t > TL.taps[1] ? `rgba(110,30,43,${0.07 * P(t, TL.taps[1], TL.taps[1] + 0.2)})` : '';
    rows[0].style.borderRadius = '18px';
  };
})();

// ===== F3 · portfolio strips =====
const f3 = (() => {
  const capEl = $('f3cap'), s1 = $('f3s1'), s2 = $('f3s2'), cnt = $('f3count');
  const A = ['coiffure-480', 'decoration-480', 'pro-640', 'esthetique-480', 'petits-travaux-480', 'hero-paysage-1280'];
  const B = ['esthetique-480', 'hero-paysage-1280', 'petits-travaux-480', 'coiffure-480', 'pro-640', 'decoration-480'];
  const fill = (el, list, size) => { for (const n of [...list, ...list]) { const d = document.createElement('div'); d.className = 'ph'; d.style.width = d.style.height = `${size}px`; d.innerHTML = `<img src="../../apps/web/public/images/accueil/${n}.webp">`; el.appendChild(d); } return [...el.children]; };
  const t1 = fill(s1, A, 340), t2 = fill(s2, B, 240);
  return (t) => {
    applyTrans($('f3'), t, ['whipL', 15.5], ['whipU', 18.0]);
    caption(capEl, t, 15.55);
    const lt = t - 15.2;
    s1.style.transform = `translateX(${120 - 330 * lt}px)`;
    s2.style.transform = `translateX(${-1500 + 260 * lt}px)`;
    t1.forEach((d, i) => { const e = E.outBack(P(t, 15.4 + i * 0.05, 15.75 + i * 0.05), 1.8); d.style.transform = `scale(${lerp(0.7, 1, e)})`; d.style.opacity = P(t, 15.4 + i * 0.05, 15.55 + i * 0.05); });
    t2.forEach((d, i) => { const e = E.outBack(P(t, 15.55 + i * 0.05, 15.9 + i * 0.05), 1.8); d.style.transform = `scale(${lerp(0.7, 1, e)})`; d.style.opacity = P(t, 15.55 + i * 0.05, 15.7 + i * 0.05); });
    // lift one photo like the viewer opens it, with its counter
    const L = P(t, 16.55, 16.9) * (1 - P(t, 17.55, 17.8));
    const hero = t1[3];
    hero.style.transform += ` scale(${1 + 0.12 * E.outCubic(L)})`;
    hero.style.zIndex = 3; hero.style.boxShadow = `0 ${20 + 30 * L}px ${40 + 40 * L}px -18px rgba(46,33,30,${0.45 + 0.25 * L})`;
    const [hx, hy] = center(hero), rr = $('f3').getBoundingClientRect();
    cnt.style.left = `${hx - rr.left - 54}px`; cnt.style.top = `${hy - rr.top + 150}px`;
    pop(cnt, t, 16.6, 0.3, 2.4); if (t > 17.6) cnt.style.opacity = 1 - P(t, 17.6, 17.75);
  };
})();

// ===== F4 · booking form =====
const f4 = (() => {
  const capEl = $('f4cap'), ph = $('f4ph'), addr = $('f4addr'), loc = $('f4loc'), send = $('f4send'), ok = $('f4ok'), okc = $('f4okc'), td = $('f4tap');
  const TXT = '1234, rue Saint-Denis';
  let sendC = [990, 860];
  window.__sendC = () => sendC;
  return (t) => {
    applyTrans($('f4'), t, ['whipU', 18.0]);
    caption(capEl, t, 18.05);
    const pq = E.outExpo(P(t, 18.0, 18.5));
    css(ph, { tf: `translateY(${(1 - pq) * 120}px) rotate(${(1 - pq) * 4}deg)` });
    let n = 0; TL.typing.forEach((k, i) => { if (t >= k && i < TXT.length) n = i + 1; });
    const caret = t < 19.4 && Math.floor(t * 3) % 2 === 0 ? '|' : '';
    addr.textContent = TXT.slice(0, n) + caret;
    css(loc, { o: E.outCubic(P(t, TL.dings[0], TL.dings[0] + 0.25)), tf: `translateY(${(1 - E.outCubic(P(t, TL.dings[0], TL.dings[0] + 0.25))) * 10}px)` });
    press(send, t, TL.taps[2]); tap(td, t, TL.taps[2], send);
    if (t < 19.9) sendC = center(send);
    const oq = P(t, 19.85, 20.15);
    const rr = ph.getBoundingClientRect();
    css(ok, { o: oq > 0 ? 1 : 0, cp: `circle(${700 * E.outCubic(oq)}px at ${sendC[0] - rr.left - 13}px ${sendC[1] - rr.top - 109}px)` });
    pop(okc, t, TL.dings[1], 0.4, 2.8);
    const circ = $('f4circ'), cr = 1900 * E.inOutCubic(P(t, 20.25, 20.72));
    Object.assign(circ.style, { width: `${2 * cr}px`, height: `${2 * cr}px`, left: `${sendC[0] - cr}px`, top: `${sendC[1] - cr}px`, display: cr > 0 ? 'block' : 'none' });
  };
})();

// ===== F5 · tender & quotes =====
const f5 = (() => {
  const capEl = $('f5cap'), proj = $('f5proj'), cnt = $('f5cnt'), segw = $('f5segwrap'), segi = $('f5segi'), sa = $('f5sa'), sp = $('f5sp');
  const qs = ['q0', 'q1', 'q2'].map($), modal = $('f5modal'), acc = $('f5acc'), td = $('f5tap');
  const arrive = [20.95, 21.12, 21.29];
  const slotA = [0, 1, 2], slotP = [2, 0, 1];
  const Y0 = 430, DY = 124;
  return (t) => {
    const scene = $('f5');
    applyTrans(scene, t, null, ['whipL', 23.5]);
    caption(capEl, t, 20.72);
    rise(proj, t, 20.75, 0.45, 50, 0);
    rise(segw, t, 20.85, 0.35, 20, 0);
    let k = 0; arrive.forEach((a) => { if (t >= a) k++; });
    cnt.textContent = `${Math.max(k, 0)} devis`;
    const ro = E.inOutCubic(P(t, TL.taps[3] + 0.05, TL.taps[3] + 0.5));
    qs.forEach((el, i) => {
      const a = P(t, arrive[i], arrive[i] + 0.4);
      const y = Y0 + DY * lerp(slotA[i], slotP[i], ro);
      const arc = Math.sin(Math.PI * ro) * (i === 0 ? 60 : -24);
      css(el, { o: P(t, arrive[i], arrive[i] + 0.12) * (t > 22.95 && i !== 1 ? 1 - 0.45 * P(t, 22.95, 23.15) : 1), tf: `translate(${arc + (1 - E.outExpo(a)) * 300}px, ${(1 - E.outBack(a, 1.6)) * -40}px)` });
      el.style.top = `${y}px`;
    });
    const best = qs[1];
    const bq = P(t, 22.55, 22.8);
    best.style.borderColor = bq > 0 ? `rgba(110,30,43,${0.65 * bq})` : '';
    best.style.boxShadow = bq > 0 ? `0 14px 36px -12px rgba(110,30,43,${0.45 * bq})` : '';
    // segmented control: indicator slides to « Prix croissant »
    const segR = sa.parentElement.getBoundingClientRect(), A = sa.getBoundingClientRect(), B = sp.getBoundingClientRect();
    const sw = E.outBack(P(t, TL.taps[3], TL.taps[3] + 0.3), 1.4);
    segi.style.left = `${lerp(A.left, B.left, sw) - segR.left}px`; segi.style.width = `${lerp(A.width, B.width, clamp(sw))}px`;
    sa.style.color = sw > 0.5 ? 'var(--text)' : 'var(--on-accent)'; sp.style.color = sw > 0.5 ? 'var(--on-accent)' : 'var(--text)';
    tap(td, t, TL.taps[3], sp);
    rise(modal, t, 22.45, 0.35, 40, 0);
    press(acc, t, TL.taps[4]); if (t >= TL.taps[4]) tap(td, t, TL.taps[4], acc);
    acc.textContent = t > 22.9 ? '✓ Devis retenu' : 'Accepter ce devis';
  };
})();

// ===== F6 · payment =====
const f6 = (() => {
  const capEl = $('f6cap'), card = $('f6card'), st = $('f6st'), b1 = $('f6b1'), b2 = $('f6b2'), k1 = $('f6k1'), k2 = $('f6k2'), conf = $('f6conf'), td = $('f6tap');
  const STATES = [[0, 'Acceptée', '#dbeafe', '#1e40af'], [24.6, 'Complétée', '#ede9fe', '#5b21b6'], [25.3, 'Payée', '#d1fae5', '#065f46']];
  return (t) => {
    applyTrans($('f6'), t, ['whipL', 23.5]);
    caption(capEl, t, 23.55);
    const cq = E.outCubic(P(t, 23.55, 24.0));
    css(card, { o: cq, tf: `translateY(${(1 - cq) * 60}px) scale(${lerp(0.96, 1, cq)})` });
    let cur = STATES[0]; for (const s of STATES) if (t >= s[0]) cur = s;
    st.textContent = cur[1]; st.style.background = cur[2]; st.style.color = cur[3];
    st.style.transform = `scale(${cur[0] ? E.outBack(P(t, cur[0], cur[0] + 0.3), 3) : 1})`;
    b1.style.width = `${100 * E.inOutCubic(P(t, 23.95, 24.35))}%`;
    b2.style.width = `${100 * E.inOutCubic(P(t, 24.95, 25.25))}%`;
    pop(k1, t, TL.dings[2], 0.3, 3); pop(k2, t, TL.dings[3], 0.3, 3);
    press(conf, t, TL.taps[5]); tap(td, t, TL.taps[5], conf);
    conf.textContent = t > 25.25 ? '✓ Versement effectué' : 'Confirmer la fin des travaux';
    conf.style.background = t > 25.25 ? 'var(--ok)' : '';
  };
})();

// ===== F7 · pro space =====
const f7 = (() => {
  const capEl = $('f7cap'), toast = $('f7toast'), dash = $('f7dash'), tabs = [...$('f7tabs').children], job = $('f7job'), st = $('f7st'), btn = $('f7btn'), td = $('f7tap');
  const S = [[0, 'Ouverte', '#fef3c7', '#92400e', 'Accepter'], [TL.taps[6] + 0.15, 'Assignée', '#dbeafe', '#1e40af', 'Démarrer'], [TL.taps[7] + 0.1, 'En cours', '#fef3c7', '#92400e', 'Compléter'], [TL.taps[8] + 0.1, 'Complétée', '#ede9fe', '#5b21b6', '']];
  return (t) => {
    applyTrans($('f7'), t, null, ['whipR', 28.5]);
    caption(capEl, t, 26.1);
    const tq = E.outExpo(P(t, TL.notifs[0], TL.notifs[0] + 0.45));
    css(toast, { o: P(t, TL.notifs[0], TL.notifs[0] + 0.1) * (1 - P(t, 27.4, 27.6)), tf: `translateX(${(1 - tq) * 560}px)` });
    rise(dash, t, 26.05, 0.45, 80, 0);
    const onJobs = t > TL.taps[6] + 0.45;
    tabs.forEach((el, i) => { el.classList.toggle('on', onJobs ? i === 2 : i === 0); });
    tabs[0].querySelector('b').textContent = onJobs ? '0' : '1';
    tabs[2].querySelector('b').textContent = onJobs ? '4' : '3';
    let cur = S[0]; for (const s of S) if (t >= s[0]) cur = s;
    st.textContent = cur[1]; st.style.background = cur[2]; st.style.color = cur[3];
    st.style.transform = `scale(${cur[0] ? E.outBack(P(t, cur[0], cur[0] + 0.3), 3) : 1})`;
    btn.textContent = cur[4]; btn.style.display = cur[4] ? 'inline-flex' : 'none';
    // the job card hops to « Mes jobs » after « Accepter »
    const hop = P(t, TL.taps[6] + 0.05, TL.taps[6] + 0.45);
    css(job, { o: hop > 0 && hop < 1 ? 1 - Math.sin(Math.PI * hop) * 0.6 : 1, tf: `translateY(${-Math.sin(Math.PI * hop) * 30}px) scale(${1 - Math.sin(Math.PI * hop) * 0.04})` });
    for (const k of [6, 7, 8]) if (Math.abs(t - TL.taps[k]) < 0.5) { press(btn, t, TL.taps[k]); tap(td, t, TL.taps[k], btn); }
    if (t < TL.taps[6] - 0.5) td.style.opacity = 0;
    const flash = Math.exp(-Math.pow((t - TL.taps[8] - 0.15) / 0.12, 2));
    job.style.boxShadow = `0 0 0 ${4 * flash}px rgba(110,30,43,${0.5 * flash})`;
  };
})();

// ===== F8 · reviews =====
const f8 = (() => {
  const capEl = $('f8cap'), num = $('f8num'), stars = [...$('f8stars').children], rev = $('f8rev'), resp = $('f8resp'), note = $('f8note'), big = $('f8big');
  const fmt = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (t) => {
    applyTrans($('f8'), t, ['whipR', 28.5], ['zoom', 31.0]);
    caption(capEl, t, 28.55);
    rise(big, t, 28.6, 0.4, 40, 0);
    num.textContent = fmt.format(4.33 * E.outCubic(P(t, TL.counter[0], TL.counter[1])));
    stars.forEach((s, j) => { const q = P(t, TL.stars[j], TL.stars[j] + 0.3); s.style.color = q > 0 ? 'var(--accent)' : 'rgba(110,30,43,0.16)'; s.style.transform = `scale(${q > 0 ? E.outBack(q, 3) : 1})`; });
    const rq = E.outExpo(P(t, 29.3, 29.75));
    css(rev, { o: P(t, 29.3, 29.45), tf: `translateX(${(1 - rq) * 300}px) rotate(${(1 - rq) * 3}deg)` });
    const pq = E.outExpo(P(t, 29.9, 30.3));
    css(resp, { o: P(t, 29.9, 30.05), tf: `translateY(${(1 - pq) * 60}px)` });
    rise(note, t, 30.1, 0.4, 16, 0);
  };
})();

// ===== F9 · licences (coming soon) =====
const f9 = (() => {
  const capEl = $('f9cap'), lics = ['l0', 'l1', 'l2'].map($), badge = $('f9b'), ctx = $('f9fx').getContext('2d');
  return (t) => {
    const scene = $('f9');
    applyTrans(scene, t, ['zoom', 31.0], ['whipU', 33.0]);
    caption(capEl, t, 30.88);
    lics.forEach((el, i) => {
      const q = P(t, 30.95 + i * 0.1, 31.3 + i * 0.1);
      css(el, { o: P(t, 30.95 + i * 0.1, 31.05 + i * 0.1), tf: `translateY(${(1 - E.outBack(q, 1.6)) * -90}px) rotate(${(1 - E.outCubic(q)) * (i - 1) * 8}deg)` });
      pop(el.querySelector('.okc'), t, TL.dings[4 + i], 0.3, 3);
      el.style.borderColor = t > TL.dings[4 + i] ? 'rgba(31,122,79,0.45)' : '';
    });
    const sq = P(t, TL.stamp[0] - 0.12, TL.stamp[0] + 0.25);
    const sc = t < TL.stamp[0] ? lerp(2.4, 1, E.inExpo(P(t, TL.stamp[0] - 0.12, TL.stamp[0]))) : 1 + 0.06 * Math.exp(-(t - TL.stamp[0]) * 8) * Math.cos((t - TL.stamp[0]) * 30);
    css(badge, { o: P(t, TL.stamp[0] - 0.12, TL.stamp[0] - 0.05), tf: `scale(${sc}) rotate(${lerp(-10, -2, clamp(sq))}deg)` });
    const shake = 9 * Math.exp(-Math.max(0, t - TL.stamp[0]) / 0.1) * (t > TL.stamp[0] ? 1 : 0);
    if (t > 31.25 && t < 32.9) scene.style.transform = `translate(${shake * Math.sin(t * 90)}px, ${shake * Math.cos(t * 70)}px)`;
    ctx.clearRect(0, 0, W, H);
    const [bx, by] = center(badge), rr = scene.getBoundingClientRect();
    for (const k of [0, 0.1]) {
      const q = P(t, TL.stamp[0] + k, TL.stamp[0] + k + 0.7);
      if (q <= 0 || q >= 1) continue;
      ctx.strokeStyle = `rgba(110,30,43,${0.4 * Math.pow(1 - q, 1.5)})`; ctx.lineWidth = 10 * (1 - q) + 1;
      ctx.beginPath(); ctx.ellipse(bx - rr.left, by - rr.top, 220 + 420 * E.outCubic(q), 50 + 150 * E.outCubic(q), 0, 0, 6.283); ctx.stroke();
    }
  };
})();

// ===== F10 · trades =====
const f10 = (() => {
  const capEl = $('f10cap'), tiles = [...$('f10grid').children], grid = $('f10grid');
  return (t) => {
    applyTrans($('f10'), t, ['whipU', 33.0], ['whipL', 35.0]);
    caption(capEl, t, 33.05);
    tiles.forEach((el, i) => {
      const st = 33.15 + i * 0.07, q = P(t, st, st + 0.45);
      css(el, { o: P(t, st, st + 0.1), tf: `rotateY(${(1 - E.outBack(q, 1.5)) * 90}deg) scale(${lerp(0.85, 1, E.outCubic(q))})` });
      el.querySelector('img').style.transform = `scale(${lerp(1.15, 1, P(t, st, 35.2))})`;
    });
    grid.style.transform = `scale(${1 + 0.03 * P(t, 33.6, 35.2)})`;
  };
})();

// ===== F11 · email notifications =====
const f11 = (() => {
  const capEl = $('f11cap'), list = $('f11list'), ph = $('f11ph');
  const MAILS = [
    ['Linkr — vous avez reçu un devis', 'Pinceau & Fils · 540,00 $'],
    ['Linkr — votre demande a été acceptée', 'Atelier Camille · sam. 8 nov.'],
    ['Linkr — votre prestataire a terminé le travail', 'Confirmez ou signalez un problème.'],
  ];
  const els = MAILS.map(([s, p]) => {
    const d = document.createElement('div'); d.className = 'mail';
    d.innerHTML = `<div class="ic">L</div><div><div class="s txt">${s}</div><div class="p txt">${p}</div></div>`;
    list.appendChild(d); return d;
  });
  const T = TL.notifs.slice(1);
  return (t) => {
    applyTrans($('f11'), t, ['whipL', 35.0], ['zoom', 37.5]);
    caption(capEl, t, 35.1);
    const pq = E.outExpo(P(t, 35.0, 35.45));
    css(ph, { tf: `translateY(${(1 - pq) * 80}px) rotate(${(1 - pq) * -4}deg)` });
    els.forEach((el, i) => {
      let y = 0;
      for (let j = i + 1; j < els.length; j++) y += 132 * E.outBack(P(t, T[j], T[j] + 0.35), 1.4);
      const a = P(t, T[i], T[i] + 0.35);
      css(el, { o: P(t, T[i], T[i] + 0.1), tf: `translateY(${y + (1 - E.outBack(a, 1.8)) * -110}px) scale(${lerp(0.9, 1, E.outCubic(a))})` });
      el.style.top = '10px'; el.style.zIndex = 10 + i;
    });
  };
})();

// ===== F12 · two roles (flip) =====
const f12 = (() => {
  const capEl = $('f12cap'), card = $('f12card'), wrap = $('f12wrap'), segi = $('f12segi'), a = $('f12a'), b = $('f12b'), seg = $('f12seg');
  return (t) => {
    const scene = $('f12');
    applyTrans(scene, t, ['zoom', 37.5]);
    scene.style.clipPath = t > 39.55 ? `circle(${Math.max(0, 1150 * (1 - E.inCubic(P(t, 39.55, 40.05))))}px at 50% 58%)` : 'none';
    caption(capEl, t, 37.38);
    rise(wrap, t, 37.42, 0.45, 60, 0);
    rise(seg, t, 37.5, 0.35, 20, 0);
    const fq = P(t, TL.flip[0], TL.flip[0] + 0.55);
    card.style.transform = `rotateY(${180 * E.outBack(fq, 1.2)}deg)`;
    const segR = a.parentElement.getBoundingClientRect(), A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
    const sw = E.outBack(P(t, TL.taps[9], TL.taps[9] + 0.3), 1.4);
    segi.style.left = `${lerp(A.left, B.left, sw) - segR.left}px`; segi.style.width = `${A.width}px`;
    a.style.color = sw > 0.5 ? 'var(--text)' : 'var(--on-accent)'; b.style.color = sw > 0.5 ? 'var(--on-accent)' : 'var(--text)';
  };
})();

// ===== GLOBE =====
const gl = (() => {
  const ctx = $('glc').getContext('2d');
  const D = window.GLOBE, rad = Math.PI / 180;
  const QC = [['Montréal', -73.57, 45.5], ['Québec', -71.21, 46.81], ['Laval', -73.75, 45.6], ['Gatineau', -75.7, 45.48], ['Sherbrooke', -71.89, 45.4],
    ['Trois-Rivières', -72.55, 46.34], ['Saguenay', -71.07, 48.43], ['Rimouski', -68.52, 48.45], ['Drummondville', -72.48, 45.88]];
  const WORLD = [['Toronto', -79.38, 43.65], ['New York', -74.0, 40.71], ['Paris', 2.35, 48.86], ['Bruxelles', 4.35, 50.85], ['Dakar', -17.47, 14.72],
    ['Casablanca', -7.59, 33.57], ['Abidjan', -4.01, 5.36], ['São Paulo', -46.63, -23.55], ['Mexico', -99.13, 19.43], ['Genève', 6.14, 46.2]];
  const eye = $('gleye'), sub = $('glsub');
  const w1 = splitInto($('gll1'), 'Né au Québec.', 'word'), w2 = splitInto($('gll2'), 'Pensé pour le monde.', 'word');
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
    const scene = $('gl');
    scene.style.zIndex = t < 40.06 ? 1 : 40;
    scene.style.opacity = 1 - P(t, 43.85, 44.05);
    const q = E.inOutCubic(P(t, 39.9, 42.4));
    let R = Math.exp(lerp(Math.log(5600), Math.log(350), q));
    R *= Math.exp(Math.log(9) * E.inCubic(P(t, 43.55, 44.1)));
    const l0 = -73.57 + 80 * E.inOutCubic(P(t, 41.6, 44.0)), p0 = lerp(45.5, 26, E.inOutCubic(P(t, 41.0, 43.5)));
    const cx = 720, cy = lerp(640, 690, q);
    ctx.clearRect(0, 0, W, H);
    if (R < 2400) {
      const a = 1 - clamp((R - 900) / 1500);
      const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
      g.addColorStop(0, `rgba(217,130,142,${0.24 * a})`); g.addColorStop(1, 'rgba(217,130,142,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(110,30,43,${0.24 * a})`; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.fill();
      ctx.strokeStyle = `rgba(217,130,142,${0.4 * a})`; ctx.lineWidth = 1.5; ctx.stroke();
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
    draw(D.region, aReg * 0.8, clamp(R * 0.00095, 1, 5));
    draw(D.world, aW * 0.85, clamp(R * 0.0042, 1, 4));
    const M = toVec(-73.57, 45.5);
    WORLD.forEach((c, j) => {
      const L = TL.lights[9 + j], d = E.outCubic(P(t, L - 0.5, L));
      if (d <= 0) return;
      const B = toVec(c[1], c[2]), om = Math.acos(clamp(M[0] * B[0] + M[1] * B[1] + M[2] * B[2], -1, 1));
      ctx.strokeStyle = `rgba(217,130,142,${0.8 * (1 - P(t, 43.5, 43.9))})`; ctx.lineWidth = 2.4;
      ctx.beginPath(); let started = false;
      for (let k = 0; k <= 48 * d; k++) {
        const s = k / 48, a1 = Math.sin((1 - s) * om) / Math.sin(om), a2 = Math.sin(s * om) / Math.sin(om);
        const v = [a1 * M[0] + a2 * B[0], a1 * M[1] + a2 * B[1], a1 * M[2] + a2 * B[2]];
        const [x, y, cc] = project(Math.atan2(v[1], v[0]) / rad, Math.asin(v[2]) / rad, l0, p0, R * (1 + 0.16 * Math.sin(Math.PI * s)), cx, cy);
        if (cc < -0.15) { started = false; continue; }
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    const sc = clamp(R / 1400, 0.45, 1.4);
    QC.forEach((c, i) => {
      const L = TL.lights[i], lq = P(t, L, L + 0.35);
      if (lq <= 0) return;
      const [x, y, cc] = project(c[1], c[2], l0, p0, R, cx, cy);
      if (cc > 0) glow(x, y, 46 * sc * E.outBack(lq, 2) * (0.8 + 0.2 * Math.sin((t - L) * 5 + i)), 0.9, 4 * sc + 1.5);
    });
    WORLD.forEach((c, j) => {
      const L = TL.lights[9 + j], lq = P(t, L, L + 0.35);
      if (lq <= 0) return;
      const [x, y, cc] = project(c[1], c[2], l0, p0, R, cx, cy);
      if (cc > 0) glow(x, y, 26 * E.outBack(lq, 2) * (0.8 + 0.2 * Math.sin((t - L) * 5 + j)), 0.95, 3);
    });
    const la = E.outCubic(P(t, 40.35, 40.7)) * (1 - P(t, 41.4, 41.8));
    if (la > 0) {
      const [x, y] = project(-72.0, 49.4, l0, p0, R, cx, cy);
      ctx.font = '650 34px Geist'; ctx.textAlign = 'center'; ctx.fillStyle = `rgba(243,235,223,${la})`;
      ctx.fillText('Québec', clamp(x, 300, 1140), clamp(y, 480, 880));
    }
    rise(eye, t, 40.1, 0.35, 20, 0);
    w1.forEach((w, i) => slam(w, t, 40.25 + i * 0.08));
    w2.forEach((w, i) => slam(w, t, 41.7 + i * 0.08));
    rise(sub, t, 42.4);
  };
})();

// ===== CALL TO ACTION =====
const ct = (() => {
  const logo = $('ctlogo'), open = splitInto($('ctopen'), 'La version d’essai est ouverte à tous', 'word');
  const letters = splitInto($('cturl'), 'linkrapp.com', 'char');
  const line = $('ctline'), glowEl = $('ctglow');
  const sub = [...splitInto($('ctsub1'), 'Deviens testeur : crée ton compte', 'word'), ...splitInto($('ctsub2'), 'et dis-moi ce que tu en penses.', 'word')];
  const note = $('ctnote'), h1 = $('cth1'), h2 = $('cth2'), flash = $('flash'), ctx = $('ctfx').getContext('2d');
  const r = rng(99), sparks = [];
  for (let i = 0; i < 90; i++) sparks.push({ x: 360 + r() * 720, v: 80 + r() * 260, d: (r() - 0.5) * 120, s: 1 + r() * 3, life: 0.8 + r() * 1.4, c: r() < 0.6 ? '110,30,43' : '217,130,142' });
  let measured = false;
  return (t) => {
    $('ct').style.zIndex = 50;
    if (!measured) {
      const a = letters[0].getBoundingClientRect(), b = letters[letters.length - 1].getBoundingClientRect();
      if (a.width) { line.style.left = `${a.left}px`; line.style.width = `${b.right - a.left}px`; measured = true; }
    }
    if (t >= 43.8 && t < 44.6) { flash.style.background = '#f8f2ea'; flash.style.opacity = t < 44.0 ? P(t, 43.8, 44.0) : 1 - E.outCubic(P(t, 44.0, 44.45)); }
    const lq = P(t, 44.05, 44.6);
    css(logo, { o: E.outCubic(P(t, 44.05, 44.3)), tf: `scale(${lerp(0.8, 1, E.outBack(lq, 1.6))})`, f: blur(14 * (1 - E.outCubic(lq))) });
    open.forEach((w, i) => slam(w, t, 44.3 + i * 0.05, 0.35, 1.4));
    letters.forEach((s, i) => {
      const st = TL.url[0] + i * 0.035, q = P(t, st, st + 0.42), e = E.outBack(q, 2.2);
      css(s, { o: P(t, st, st + 0.12), tf: `translateY(${(1 - e) * 90}px) scale(${lerp(1.4, 1, E.outExpo(q))})`, f: blur(12 * (1 - E.outCubic(q))) });
    });
    css(line, { tf: `scaleX(${E.outCubic(P(t, 45.25, 45.7))})` });
    const gq = P(t, 44.8, 45.6);
    css(glowEl, { o: E.outCubic(gq) * (t > 45.6 ? 0.85 + 0.15 * Math.sin(((t - 45.6) / 2.4) * 6.283) : 1) });
    sub.forEach((w, i) => rise(w, t, 45.5 + i * 0.045, 0.4, 26, 6));
    rise(note, t, 46.1, 0.5, 16, 0);
    css(h1, { tf: `translate(${30 * Math.sin(t * 0.6)}px, ${20 * Math.cos(t * 0.5)}px) scale(${1 + 0.06 * Math.sin(t * 0.8)})` });
    css(h2, { tf: `translate(${-30 * Math.sin(t * 0.5)}px, ${-20 * Math.cos(t * 0.7)}px) scale(${1 + 0.05 * Math.cos(t * 0.9)})` });
    ctx.clearRect(0, 0, W, H);
    for (const p of sparks) {
      const dt = t - 45.3;
      if (dt < 0 || dt > p.life) continue;
      ctx.fillStyle = `rgba(${p.c},${0.7 * (1 - dt / p.life)})`;
      ctx.beginPath(); ctx.arc(p.x + p.d * dt, 700 - p.v * dt + 40 * dt * dt, p.s, 0, 6.283); ctx.fill();
    }
  };
})();

const UPD = { op, lg, cc, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, gl, ct };
const AUTO = new Set(['f3', 'f4', 'f6', 'f8', 'f9', 'f10', 'f11', 'f12']); // handle their own transitions

window.renderFrame = function renderFrame(t) {
  $('flash').style.opacity = 0;
  SCN.forEach(([id, a, b, tin, tout], i) => {
    const el = $(id), on = t >= a && t < b;
    el.style.display = on ? 'block' : 'none';
    if (!on) return;
    el.style.zIndex = i + 1;
    if (!AUTO.has(id) && id !== 'f1' && id !== 'f2' && (tin || tout)) applyTrans(el, t, tin, tout);
    UPD[id](t);
  });
  const w = $('wipe');
  w.style.display = wipe(t, 7.0) || wipe(t, 26.0) ? 'block' : 'none';
  const chip = $('chip');
  const cq = P(t, 10.25, 10.6), cout = P(t, 39.45, 39.7);
  chip.style.display = t > 10.2 && t < 39.75 ? 'flex' : 'none';
  css(chip, { o: cq * (1 - cout), tf: `translateY(${(1 - E.outCubic(cq)) * 30}px)` });
};
window.showSafe = (on) => { $('safe').style.display = on ? 'block' : 'none'; };
window.__ready = (async () => {
  await document.fonts.load('400 100px Parisienne');
  await document.fonts.load('600 40px Geist');
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.renderFrame(0);
  return true;
})();
