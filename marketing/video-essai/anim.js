/* Linkr — LinkedIn trial video, v4 (dynamic, white, the fade is back).
 * Every frame is a pure function of t (seconds): window.renderFrame(t) sets every style.
 * Nothing is animated by the browser, so the capture is deterministic. */
'use strict';

/* ======================================================================================
 * CONFIG — every timing and easing of the video lives HERE (seconds unless noted).
 * Easing names, in words:
 *   enter = 'outCubic'   « démarre vite, finit doucement »            (entries)
 *   exit  = 'inCubic'    « démarre doucement, accélère »               (exits)
 *   move  = 'inOutCubic' « démarre et finit doucement »                (moves, whip pans)
 *   pop   = 'outBack'    « démarre vite, dépasse un peu, se pose »     (badges, zones, buttons)
 *   slam  = 'outExpo'    « arrive très vite, se pose net »             (kinetic words)
 * Only the seamless loops (halo, zones, sonar, strip, glow) are sine/linear repeats.
 * ==================================================================================== */
/* CONFIG-START */
const CONFIG = {
  bpm: 120,                 // 1 beat = 0.5 s; every cut lands on a beat
  total: 45.0,
  loop: 2.0,                // seamless loops last one bar
  scenes: {
    opening: [0.0, 4.5], needs: [4.5, 7.5], proximity: [7.5, 11.0], trust: [11.0, 14.0], price: [14.0, 17.0],
    quotes: [17.0, 21.5], payment: [21.5, 25.5], pros: [25.5, 29.5], notify: [29.5, 32.5], roles: [32.5, 35.5],
    soon: [35.5, 38.0], cta: [38.0, 45.0],
  },
  // transition at each cut: whipL / whipU = whip pan with motion blur, zoom = push through, wipe = bordeaux sweep
  cuts: { 7.5: 'whipL', 17.0: 'zoom', 21.5: 'whipL', 25.5: 'wipe', 29.5: 'whipU', 32.5: 'whipL', 35.5: 'zoom', 38.0: 'zoom' },
  dur: { enter: 0.5, exit: 0.45, slam: 0.4, micro: 0.3, press: 0.2, morph: 0.5, trans: 0.47, stagger: 0.07, letters: 0.05, group: 0.1 },
  ease: { enter: 'outCubic', exit: 'inCubic', move: 'inOutCubic', pop: 'outBack', slam: 'outExpo' },
  at: {
    // 1 · opening: dark → light (bloom), logo + hook legible from frame 0
    heartbeats: [0.25, 0.8, 1.25, 1.6], bloom: 2.0, tagline: 2.9, taglineUnderline: 3.3, hookDim: 2.9,
    logoZones: [3.2, 3.3, 3.4, 3.5, 3.6, 3.7], openingExit: 3.75, taglineToHeader: 4.1,
    // 3 · needs
    cards: 4.45, beats: [5.0, 5.5, 6.0, 6.5], openLine: 6.9, wave: 7.0,
    // 4 · proximity
    cap4: 7.55, dive: [7.5, 8.3], meLabel: 7.9, zones: 8.2, sonar: 8.4, zoneHighlight: 9.8, labelIn: 9.95,
    // 5 · trust
    morph: 10.65, cap5: 11.0, strip: 11.25, counter: [11.5, 12.2], stars: 11.6, review: 12.3,
    // 6 · price
    cap6: 14.0, services: 14.0, priceFocus: 14.8, request: 15.5, sent: 15.75,
    // 7 · quotes
    cap7: 16.85, project: 16.95, seg: 17.2, quotes: [17.6, 17.75, 17.9], sortTap: 18.9, reorder: 19.0, best: 19.6, bar: 19.8, acceptTap: 20.6,
    // 8 · payment
    cap8: 21.55, head: 21.65, nodes: 21.75, checks: [22.3, 23.3, 24.3], fills: [[22.45, 23.15], [23.45, 24.15]], paid: 24.6, note: 24.65,
    // 9 · pros
    cap9: 25.55, fee: [25.95, 26.35], panel: 25.6, toast: 25.9, toastOut: 27.2, proTaps: [26.5, 27.4, 27.9], toJobs: 26.9, feePulse: 28.4,
    // 10 · notifications
    phone: 29.55, cap10: 29.6, mails: [29.95, 30.4, 30.85],
    // 11 · roles
    cap11: 32.55, roleCard: 32.6, roleTap: 33.45, flip: 33.55,
    // 12 · soon
    soonTitle: 35.38, soonTrades: 35.8, licences: 36.05, stamps: [36.15, 36.3, 36.45], pics: 36.6,
    // 13 · call to action
    ctaLogo: 37.82, ctaOpen: 38.1, url: 38.45, urlUnderline: 39.2, sparks: 39.3, ctaSub: 39.4, testBox: 39.8, quebec: 40.1,
    cursorIn: 40.1, clicks: [40.8, 42.8],
    chip: [4.8, 37.6],
  },
  motif: [2.0, 38.5],       // the 4-note signature: on the bloom (logo) and on linkrapp.com
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
  outBack: (x) => { const s = 1.7; return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); },
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
};
const eIn = EASE[CONFIG.ease.enter], eOut = EASE[CONFIG.ease.exit], eMove = EASE[CONFIG.ease.move], ePop = EASE[CONFIG.ease.pop], eSlam = EASE[CONFIG.ease.slam];
const loopSin = (t, ph = 0) => Math.sin((2 * Math.PI * t) / CONFIG.loop + ph);
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const mix3 = (a, b, x) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], x))).join(',')})`;

function css(el, o) { const s = el.style; if ('o' in o) s.opacity = o.o; if ('tf' in o) s.transform = o.tf; if ('f' in o) s.filter = o.f; }
const blurF = (v) => (v > 0.25 ? `blur(${v}px)` : 'none');
function enter(el, t, t0, dy = 26, dur = D.enter) { const e = eIn(P(t, t0, t0 + dur)); css(el, { o: e, tf: `translateY(${(1 - e) * dy}px)` }); return e; }
const exitK = (t, t0, dur = D.exit) => 1 - eOut(P(t, t0, t0 + dur));
function slam(el, t, t0, from = 1.55) { const q = P(t, t0, t0 + D.slam), e = eSlam(q); css(el, { o: P(t, t0, t0 + 0.1), tf: `translateY(${(1 - e) * 22}px) scale(${lerp(from, 1, e)})`, f: blurF((1 - eIn(q)) * 12) }); }
function pop(el, t, t0, dur = D.micro) { const q = P(t, t0, t0 + dur); css(el, { o: q > 0 ? 1 : 0, tf: `scale(${Math.max(0, ePop(q))})` }); return q; }
function splitWords(el, text) { el.textContent = ''; const out = []; text.split(/(\s+)/).forEach((p) => { const s = document.createElement('span'); s.className = 'w'; s.textContent = p; el.appendChild(s); if (p.trim()) out.push(s); }); return out; }
/** Caption: eyebrow rises, title words slam (stagger D.stagger), sub rises. k = block opacity. */
function caption(box, t, t0, k = 1) {
  let n = 0;
  for (const el of [...box.children]) {
    if (el.classList.contains('title')) { const ws = el._w || (el._w = splitWords(el, el.textContent)); ws.forEach((w, i) => slam(w, t, t0 + 0.06 + i * D.stagger)); n = ws.length; }
    else if (el.classList.contains('sub')) enter(el, t, t0 + 0.15 + n * D.stagger, 20);
    else enter(el, t, t0, 16);
  }
  box.style.opacity = k;
}
const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
function press(el, t, t0) { const b = Math.exp(-Math.pow((t - t0) / (D.press / 2.5), 2)); el.style.transform = `scale(${1 - 0.08 * b})`; el.style.filter = b > 0.05 ? `brightness(${1 + 0.2 * b})` : 'none'; }
function tap(dot, t, t0, target) {
  if (t < t0 - 0.25 || t > t0 + 0.4) { dot.style.opacity = 0; return; }
  const [x, y] = center(target), pr = dot.parentElement.getBoundingClientRect();
  dot.style.left = `${x - pr.left}px`; dot.style.top = `${y - pr.top}px`;
  if (t < t0) { const q = eIn(P(t, t0 - 0.25, t0)); css(dot, { o: 0.95 * q, tf: `scale(${lerp(1.4, 0.9, q)})` }); }
  else { const q = eIn(P(t, t0, t0 + 0.4)); css(dot, { o: 0.95 * (1 - q), tf: `scale(${lerp(0.9, 1.9, q)})` }); }
}
const fr = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- transitions between layers ---------- */
function trans(type, dir, t, T) {
  const q = P(t, T - 0.27, T + 0.2), e = eMove(q), b = 26 * Math.sin(Math.PI * q);
  const r = { tx: 0, ty: 0, s: 1, o: 1, b: 0 };
  if (q <= 0 || q >= 1) { if ((dir === 'in' && q <= 0) || (dir === 'out' && q >= 1 && type !== 'wipe')) r.o = 0; return r; }
  r.b = b;
  if (type === 'whipL') r.tx = dir === 'in' ? W * (1 - e) : -W * e;
  if (type === 'whipU') r.ty = dir === 'in' ? H * (1 - e) : -H * e;
  if (type === 'zoom') { if (dir === 'in') { r.s = lerp(1.15, 1, eIn(q)); r.o = eIn(P(t, T - 0.27, T + 0.05)); } else r.s = lerp(1, 1.6, eOut(q)); }
  if (type === 'wipe') r.b = 0;
  return r;
}
function layerTrans(el, t, start, end) {
  let r = { tx: 0, ty: 0, s: 1, o: 1, b: 0 };
  const tin = CONFIG.cuts[start], tout = CONFIG.cuts[end];
  if (tin && t < start + 0.2) r = trans(tin, 'in', t, start);
  else if (tout && t > end - 0.27) r = trans(tout, 'out', t, end);
  css(el, { tf: r.tx || r.ty || r.s !== 1 ? `translate(${r.tx}px, ${r.ty}px) scale(${r.s})` : 'none', f: blurF(r.b), o: r.o });
  return r;
}
function wipe(t) {
  const el = $('wipe');
  for (const [T, type] of Object.entries(CONFIG.cuts)) {
    if (type !== 'wipe') continue;
    const q = P(t, Number(T) - 0.3, Number(T) + 0.3);
    if (q > 0 && q < 1) { el.style.display = 'block'; el.style.transform = `translateX(${lerp(2500, -2600, eMove(q))}px) rotate(-14deg)`; return; }
  }
  el.style.display = 'none';
}

/* ===== 1 · opening ===== */
const S1 = (() => {
  const bg = $('o-bg'), h1 = $('o-h1'), h2 = $('o-h2'), rays = $('o-rays'), logo = $('o-logo'), hook = $('o-hook'), bloom = $('bloom');
  const ctx = $('o-fx').getContext('2d');
  const ws = [...splitWords($('o-k1'), 'Vous avez un besoin ?'), ...splitWords($('o-k2'), 'Ils ont du talent à revendre.')];
  const KEYS = [[0.0, [26, 19, 21], [8, 5, 6]], [0.9, [58, 17, 25], [18, 7, 9]], [1.5, [110, 30, 43], [42, 11, 17]], [1.85, [217, 162, 167], [142, 74, 85]], [2.0, [255, 255, 255], [255, 255, 255]]];
  const col = (t, k) => { let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++; const a = KEYS[i], b = KEYS[i + 1]; return mix3(a[k], b[k], eMove(P(t, a[0], b[0]))); };
  const r = rng(11), motes = [], parts = [];
  for (let i = 0; i < 110; i++) motes.push({ x: r() * W, y: r() * H, vx: (r() - 0.5) * 18, vy: -8 - r() * 16, s: 0.6 + r() * 2.3, f: 0.6 + r() * 2, ph: r() * 6.28, b: 0.3 + r() * 0.6 });
  const cols = ['110,30,43', '217,130,142', '184,150,120'];
  for (let i = 0; i < 260; i++) { const u = r(); parts.push({ a: r() * 6.283, v: lerp(260, 1500, u * u), k: lerp(1.6, 3.2, r()), s: 1 + r() * 3.2, life: lerp(0.8, 2.2, r()), c: cols[(r() * 3) | 0] }); }
  const ZP = [[230, 330], [470, 150], [980, 150], [1210, 330], [1150, 640], [290, 650]];
  function beat(t) {
    let I = 0.1 + 0.4 * Math.pow(P(t, 0, 2), 1.6);
    A.heartbeats.forEach((b, i) => { const g = 0.5 + 0.6 * i / 3; for (const [o, k] of [[0, 1], [0.13, 0.5]]) { const d = t - b - o; if (d >= 0) I += g * k * (d < 0.05 ? d / 0.05 : Math.exp(-(d - 0.05) / 0.22)); } });
    return Math.min(I, 1.6);
  }
  return (t) => {
    const B = A.bloom, dark = t < B;
    bg.style.background = `radial-gradient(circle at 50% 30%, ${col(t, 1)} 0%, ${col(t, 2)} 78%)`;
    const I = beat(t), grow = 1 + 1.8 * EASE.inExpo(P(t, 1.5, B));
    css(h1, { o: dark ? clamp(I) : 0, tf: `scale(${(0.4 + 0.45 * I) * grow})` });
    css(h2, { o: dark ? clamp(0.3 + 0.5 * I) : 0, tf: `scale(${(0.7 + 0.3 * I) * grow})` });
    css(rays, { o: dark ? 0.7 * P(t, 0.6, 1.4) : 0, tf: `rotate(${t * 16}deg) scale(${0.7 + 0.5 * P(t, 0.6, 2)})` });
    const flash = t < B ? EASE.inCubic(P(t, 1.6, B)) * 0.92 : 0.92 * Math.exp(-(t - B) / 0.2);
    bloom.style.opacity = flash;
    // text: light on dark, dark on white (switched under the bloom)
    const sw = eMove(P(t, 1.85, B + 0.05));
    logo.style.color = mix3([243, 235, 223], [110, 30, 43], sw);
    logo.style.textShadow = `0 0 ${50 * (1 - sw)}px rgba(217,130,142,${0.7 * (1 - sw)})`;
    const out = exitK(t, A.openingExit);
    const punch = t > B ? 0.08 * Math.exp(-(t - B) / 0.18) : 0;
    css(logo, { o: out, tf: `translateY(${-50 * (1 - out)}px) scale(${lerp(0.985, 1, eIn(P(t, 0, 0.6))) + punch})` });
    ws.forEach((w, i) => { const s = i * D.stagger, e = eIn(P(t, s, s + D.enter)); css(w, { tf: `translateY(${(1 - e) * 14}px)` }); });
    hook.style.color = mix3([243, 235, 223], [46, 33, 30], sw);
    css(hook, { o: lerp(1, 0.45, eMove(P(t, A.hookDim, A.hookDim + D.micro))) * out, tf: `translateY(${-50 * (1 - out)}px)` });
    // canvas: dust before the bloom, shockwave + particles after it, then soft zones around the logo
    ctx.clearRect(0, 0, W, H);
    if (dark) for (const m of motes) {
      const x = (m.x + m.vx * t + Math.sin(t * m.f + m.ph) * 10 + W) % W, y = (m.y + m.vy * t + H * 4) % H;
      ctx.fillStyle = `rgba(255,226,220,${m.b * (0.5 + 0.5 * Math.sin(t * m.f * 2 + m.ph)) * (0.3 + 0.7 * clamp(I)) * 0.6})`;
      ctx.beginPath(); ctx.arc(x, y, m.s, 0, 6.283); ctx.fill();
    }
    const lt = t - B;
    if (lt >= 0) {
      for (const k of [0, 0.12, 0.28]) { const q = P(lt, k, k + 1.0); if (q <= 0 || q >= 1) continue; ctx.strokeStyle = `rgba(110,30,43,${0.55 * Math.pow(1 - q, 1.6)})`; ctx.lineWidth = 26 * (1 - q) + 2; ctx.beginPath(); ctx.arc(720, 280, 40 + 1200 * eIn(q), 0, 6.283); ctx.stroke(); }
      for (const p of parts) { if (lt > p.life) continue; const d = (p.v / p.k) * (1 - Math.exp(-p.k * lt)); ctx.fillStyle = `rgba(${p.c},${Math.pow(1 - lt / p.life, 1.3) * out})`; ctx.beginPath(); ctx.arc(720 + Math.cos(p.a) * d, 280 + Math.sin(p.a) * d * 0.8 + 20 * lt * lt, p.s, 0, 6.283); ctx.fill(); }
      A.logoZones.forEach((z0, i) => {
        const q = P(t, z0, z0 + D.micro); if (q <= 0) return;
        const [x, y] = ZP[i], s = Math.max(0, ePop(q)) * (1 + 0.05 * loopSin(t, i)), rr = ((t - z0) / CONFIG.loop * 2) % 1;
        ctx.fillStyle = `rgba(110,30,43,${0.16 * out})`; ctx.beginPath(); ctx.arc(x, y, 34 * s, 0, 6.283); ctx.fill();
        ctx.strokeStyle = `rgba(110,30,43,${0.35 * out})`; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = `rgba(110,30,43,${0.3 * (1 - rr) * out})`; ctx.beginPath(); ctx.arc(x, y, 34 + 40 * rr, 0, 6.283); ctx.stroke();
      });
    }
  };
})();

/* shared tagline: appears in the opening, becomes the header of « needs » */
const TAG = (() => {
  const el = $('tagline'), ul = $('tg-ul'), ws = splitWords($('tg'), 'Le bon pro, juste à côté de chez vous.');
  let placed = false;
  return (t) => {
    if (!placed) { const a = ws[0], b = ws[ws.length - 1]; Object.assign(ul.style, { left: `${a.offsetLeft}px`, width: `${b.offsetLeft + b.offsetWidth - a.offsetLeft}px`, top: `${a.offsetTop + a.offsetHeight + 4}px` }); placed = true; }
    ws.forEach((w, i) => slam(w, t, A.tagline + i * D.stagger, 1.6));
    css(ul, { tf: `scaleX(${eIn(P(t, A.taglineUnderline, A.taglineUnderline + 0.45))})` });
    const m = eMove(P(t, A.taglineToHeader, A.taglineToHeader + D.morph));
    const r = trans('whipL', 'out', t, SC.needs[1]);
    css(el, { tf: `translate(${r.tx}px, ${lerp(0, -672, m)}px)`, f: blurF(r.b) });
  };
})();

/* ===== 3 · needs ===== */
const S3 = (() => {
  const cards = [...document.querySelectorAll('#L3 .tc')], word = $('n-word'), open = $('n-open');
  const NAMES = ['Coiffure', 'Esthétique', 'Décoration', 'Petits travaux'];
  return (t) => {
    layerTrans($('L3'), t, SC.needs[0], SC.needs[1]);
    let k = -1; A.beats.forEach((b, i) => { if (t >= b) k = i; });
    cards.forEach((c, i) => {
      const s = A.cards + i * D.stagger, q = P(t, s, s + D.enter), e = eIn(q);
      const act = i === k ? eSlam(P(t, A.beats[i], A.beats[i] + 0.3)) * (1 - eMove(P(t, A.beats[i] + 0.5, A.beats[i] + 0.8))) : 0;
      const wave = Math.max(0, Math.sin(Math.PI * P(t, A.wave + i * 0.06, A.wave + i * 0.06 + 0.4)));
      css(c, { o: P(t, s, s + 0.15), tf: `translateY(${(1 - e) * 140 - 22 * act - 14 * wave}px) rotate(${(1 - e) * (i - 1.5) * 9}deg) scale(${Math.max(0.6, ePop(q)) * (1 + 0.07 * act)})` });
      c.style.boxShadow = act > 0.05 ? `0 0 0 ${4 * act}px #6e1e2b, 0 30px 60px -24px rgba(110,30,43,0.6)` : '';
      c.style.zIndex = i === k ? 3 : 1;
    });
    if (k >= 0) { word.textContent = NAMES[k]; slam(word, t, A.beats[k], 1.7); } else word.style.opacity = 0;
    enter(open, t, A.openLine, 16);
  };
})();

/* ===== 4-6 · one card that evolves (proximity → trust → price) ===== */
const S4 = (() => {
  const card = $('stagecard'), mapwrap = $('mapwrap'), map = $('map'), prof = $('prof'), phdr = $('phdr'), rt = $('rtnum');
  const review = $('review'), stars = [...$('rstars').children], svcs = [...$('svcs').children], req = $('b-req'), sent = $('sent'), sentOk = $('sent-ok');
  const zl = $('zlabel'), tapEl = $('tap6'), strip = $('strip');
  const caps = [$('cap4'), $('cap5'), $('cap6')];
  const CXL = 545, CYL = 290, MX = 1100, MY = 850;
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
  // zones ~550 m wide (1 km = 262 px here): a provider is never pinned on an address
  const ZO = [[170, -120], [-240, 70], [90, 150], [-110, -170], [330, 60], [-360, -60]];
  const zones = ZO.map(([dx, dy]) => { const d = document.createElement('div'); d.className = 'zone'; d.style.left = `${MX + dx}px`; d.style.top = `${MY + dy}px`; d.innerHTML = '<i></i>'; map.appendChild(d); return d.firstChild; });
  const me = document.createElement('div'); me.id = 'me'; me.style.left = `${MX}px`; me.style.top = `${MY}px`;
  me.innerHTML = '<div class="sonar"></div><div class="dot"></div><span class="lb">Vous</span>'; map.appendChild(me);
  const meL = me.querySelector('.lb'), sonar = me.querySelector('.sonar');
  const ZX = 175 + CXL + ZO[0][0], ZY = 336 + CYL + ZO[0][1];
  zl.style.left = `${ZX + 92}px`; zl.style.top = `${ZY - 52}px`;
  // portfolio strip (seamless loop: the list is laid out twice)
  const PH = ['coiffure-480', 'esthetique-480', 'decoration-480', 'pro-640', 'petits-travaux-480', 'hero-paysage-1280'];
  for (const n of [...PH, ...PH]) { const d = document.createElement('div'); d.innerHTML = `<img src="../../apps/web/public/images/accueil/${n}.webp">`; strip.appendChild(d); }
  const STEP = 280 * PH.length;
  return (t) => {
    layerTrans($('L4'), t, SC.proximity[0], SC.price[1]);
    caption(caps[0], t, A.cap4, exitK(t, SC.proximity[1] - D.exit));
    caption(caps[1], t, A.cap5, t < SC.trust[0] ? 0 : exitK(t, SC.trust[1] - D.exit));
    caption(caps[2], t, A.cap6, t < SC.price[0] ? 0 : 1);
    // map: dives in, zones pop on the beat, sonar loops from « Vous »
    mapwrap.style.opacity = exitK(t, A.morph, 0.35);
    css(map, { tf: `scale(${lerp(2.1, 1, eIn(P(t, A.dive[0], A.dive[1]))) * (1 + 0.03 * P(t, A.dive[1], SC.proximity[1]))})` });
    css(meL, { o: eIn(P(t, A.meLabel, A.meLabel + D.micro)) });
    const sp = t > A.sonar ? ((t - A.sonar) / (CONFIG.loop / 2)) % 1 : 0, sz = 40 + 420 * eIn(sp);
    Object.assign(sonar.style, { width: `${sz}px`, height: `${sz}px`, left: `${-sz / 2}px`, top: `${-sz / 2}px`, opacity: t > A.sonar ? 0.9 * (1 - sp) : 0 });
    zones.forEach((z, i) => {
      const q = P(t, A.zones + i * D.group, A.zones + i * D.group + D.micro);
      const hi = i === 0 ? eIn(P(t, A.zoneHighlight, A.zoneHighlight + D.micro)) : 0;
      z.style.opacity = q > 0 ? 1 : 0;
      z.style.transform = `scale(${Math.max(0, ePop(q)) * (1 + 0.05 * loopSin(t, i * 1.1)) * (1 + 0.1 * hi)})`;
      z.style.borderColor = hi ? `rgba(110,30,43,${0.35 + 0.55 * hi})` : ''; z.style.borderWidth = hi ? `${2 + 2.5 * hi}px` : '';
    });
    // label pops, then travels to the profile header
    const li = ePop(P(t, A.labelIn, A.labelIn + D.micro)), mv = eMove(P(t, A.morph, A.morph + D.morph));
    let dx = 0, dy = 0;
    if (mv > 0) { const r = phdr.querySelector('.nm').getBoundingClientRect(); dx = (r.left - (ZX + 92 + 20)) * mv; dy = (r.top - (ZY - 52 + 14)) * mv; }
    css(zl, { o: (t >= A.labelIn ? 1 : 0) * (1 - P(t, A.morph + 0.25, A.morph + 0.45)), tf: `translate(${dx}px, ${dy}px) scale(${Math.max(0, li)})` });
    // profile: portfolio strip, rating counter, stars, review
    prof.style.opacity = eIn(P(t, A.morph + 0.22, A.morph + 0.67));
    const se = enter(strip, t, A.strip, 30), sk = exitK(t, SC.trust[1] - D.exit);
    strip.style.opacity = se * sk;
    strip.style.transform = `translate(${-(((t - A.strip) * 150) % STEP + STEP) % STEP}px, ${(1 - se) * 30}px)`;
    rt.textContent = fr.format(4.33 * eIn(P(t, A.counter[0], A.counter[1])));
    enter($('prt'), t, A.counter[0] - 0.1, 14, D.micro);
    stars.forEach((s, i) => { const q = P(t, A.stars + i * D.stagger, A.stars + i * D.stagger + 0.25); s.style.color = q > 0 ? '#6e1e2b' : ''; s.style.transform = `scale(${q > 0 ? ePop(q) : 1})`; });
    const rq = eIn(P(t, A.review, A.review + D.enter));
    css(review, { o: P(t, A.review, A.review + 0.15) * sk, tf: `translateX(${(1 - rq) * 220}px)` });
    // services, then the request is sent (white circle grows from the button)
    svcs.forEach((r, i) => { const e = eIn(P(t, A.services + i * D.stagger, A.services + i * D.stagger + D.enter)); css(r, { o: e, tf: `translateX(${(1 - e) * 200}px)` }); r.style.display = t < A.services ? 'none' : 'flex'; });
    const pf = Math.exp(-Math.pow((t - A.priceFocus - 0.3) / 0.3, 2));
    svcs.forEach((r, i) => { const p = r.querySelector('.p'); p.style.transform = `scale(${1 + 0.12 * pf * (i === 0 ? 1 : 0.6)})`; p.style.color = pf > 0.1 ? `rgb(${Math.round(lerp(46, 110, pf))},${Math.round(lerp(33, 30, pf))},${Math.round(lerp(30, 43, pf))})` : ''; });
    press(req, t, A.request); tap(tapEl, t, A.request, req);
    const sq = eIn(P(t, A.sent, A.sent + 0.45));
    if (sq > 0) { const [bx, by] = center(req), cr = card.getBoundingClientRect(); sent.style.clipPath = `circle(${1300 * sq}px at ${bx - cr.left}px ${by - cr.top - 160}px)`; }
    sent.style.display = sq > 0 ? 'flex' : 'none';
    pop(sentOk, t, A.sent + 0.2, 0.35);
  };
})();

/* ===== 7 · quotes ===== */
const S7 = (() => {
  const qs = ['q0', 'q1', 'q2'].map($), proj = $('q-proj'), count = $('q-count'), seg = $('q-seg'), segi = $('q-segi'), sa = $('q-sa'), sp = $('q-sp'), bar = $('q-bar'), acc = $('q-acc'), tapEl = $('tap7');
  const slotA = [0, 1, 2], slotP = [2, 0, 1], Y0 = 418, DY = 122;
  return (t) => {
    layerTrans($('L7'), t, SC.quotes[0], SC.quotes[1]);
    caption($('cap7'), t, A.cap7);
    const pe = eIn(P(t, A.project, A.project + D.enter)); css(proj, { o: pe, tf: `translateX(${(1 - pe) * -160}px)` });
    enter(seg, t, A.seg, 16);
    let n = 0; A.quotes.forEach((q) => { if (t >= q + 0.15) n++; });
    count.textContent = `${n} devis`;
    const cb = Math.max(...A.quotes.map((q) => Math.exp(-Math.pow((t - q - 0.2) / 0.08, 2))));
    count.style.transform = `scale(${1 + 0.18 * cb})`; count.style.transformOrigin = 'left center';
    const ro = eMove(P(t, A.reorder, A.reorder + D.morph));
    qs.forEach((el, i) => {
      const q = P(t, A.quotes[i], A.quotes[i] + 0.45), e = ePop(q);
      const arc = Math.sin(Math.PI * ro) * (i === 0 ? -34 : 22);
      const dim = t > A.acceptTap + 0.2 && i !== 1 ? lerp(1, 0.4, eMove(P(t, A.acceptTap + 0.2, A.acceptTap + 0.5))) : 1;
      css(el, { o: P(t, A.quotes[i], A.quotes[i] + 0.12) * dim, tf: `translateX(${(1 - eIn(q)) * 420 + arc}px) rotate(${(1 - eIn(q)) * 6}deg) scale(${lerp(0.85, 1, Math.min(1.05, e))})` });
      el.style.top = `${Y0 + DY * lerp(slotA[i], slotP[i], ro)}px`; el.style.zIndex = i === 0 ? 1 : 2;
    });
    const hb = eIn(P(t, A.best, A.best + D.micro));
    qs[1].style.borderColor = hb ? `rgba(110,30,43,${0.75 * hb})` : ''; qs[1].style.borderWidth = hb ? '3px' : '';
    const sr = seg.getBoundingClientRect(), ra = sa.getBoundingClientRect(), rb = sp.getBoundingClientRect();
    const sw = ePop(P(t, A.sortTap, A.sortTap + D.micro));
    segi.style.left = `${lerp(ra.left, rb.left, sw) - sr.left}px`; segi.style.width = `${lerp(ra.width, rb.width, clamp(sw))}px`;
    sa.style.color = sw > 0.5 ? '#2e211e' : '#f8f2ea'; sp.style.color = sw > 0.5 ? '#f8f2ea' : '#2e211e';
    const be = eIn(P(t, A.bar, A.bar + D.enter)); css(bar, { o: be, tf: `translateY(${(1 - be) * 60}px)` });
    press(acc, t, A.acceptTap);
    if (Math.abs(t - A.sortTap) < 0.45) tap(tapEl, t, A.sortTap, sp); else tap(tapEl, t, A.acceptTap, acc);
    acc.textContent = t > A.acceptTap + 0.2 ? 'Devis retenu' : 'Accepter ce devis';
  };
})();

/* ===== 8 · payment ===== */
const S8 = (() => {
  const nodes = ['n0', 'n1', 'n2'].map($), fill = $('p-fill'), head = $('p-head'), note = $('p-note'), line = $('p-line'), paid = $('p-paid'), v0 = $('v0'), v2 = $('v2');
  return (t) => {
    layerTrans($('L8'), t, SC.payment[0], SC.payment[1]);
    caption($('cap8'), t, A.cap8);
    enter(head, t, A.head, 20);
    pop(paid, t, A.paid, 0.35);
    line.style.opacity = eIn(P(t, A.nodes, A.nodes + D.enter));
    nodes.forEach((n, i) => {
      const s = A.nodes + i * D.group;
      enter(n.querySelector('.t'), t, s, 18);
      const c = n.querySelector('.c'), q = P(t, A.checks[i], A.checks[i] + D.micro);
      css(c, { o: eIn(P(t, s, s + D.enter)), tf: `scale(${q > 0 ? 0.85 + 0.15 * ePop(q) : eIn(P(t, s, s + D.enter))})` });
      c.style.background = q > 0 ? '#6e1e2b' : '#ffffff'; c.style.borderColor = q > 0 ? '#6e1e2b' : '';
      c.querySelector('svg').style.opacity = eIn(q);
      enter(n.querySelector('.v'), t, A.checks[i] + 0.05, 16);
    });
    v0.textContent = `${fr.format(108 * eIn(P(t, A.checks[0] + 0.05, A.checks[0] + 0.45)))} $`;
    v2.textContent = `${fr.format(432 * eIn(P(t, A.checks[2] + 0.05, A.checks[2] + 0.45)))} $`;
    fill.style.width = `${100 * (0.5 * eMove(P(t, A.fills[0][0], A.fills[0][1])) + 0.5 * eMove(P(t, A.fills[1][0], A.fills[1][1])))}%`;
    enter(note, t, A.note, 14);
  };
})();

/* ===== 9 · pros ===== */
const S9 = (() => {
  const panel = $('pro'), toast = $('toast'), tabs = [...$('ptabs').children], st = $('jst'), btn = $('jbtn'), tapEl = $('tap9'), job = $('job'), fee = $('fee');
  const STATES = [['Ouverte', '#fef3c7', '#92400e', 'Accepter'], ['Assignée', '#dbeafe', '#1e40af', 'Démarrer'], ['En cours', '#fef3c7', '#92400e', 'Compléter'], ['Complétée', '#ede9fe', '#5b21b6', '']];
  return (t) => {
    layerTrans($('L9'), t, SC.pros[0], SC.pros[1]);
    caption($('cap9'), t, A.cap9);
    fee.textContent = `${Math.round(10 * eIn(P(t, A.fee[0], A.fee[1])))} %`;
    const fp = Math.exp(-Math.pow((t - A.feePulse - 0.12) / 0.12, 2));
    fee.style.display = 'inline-block'; fee.style.transform = `scale(${1 + 0.3 * fp})`; fee.style.transformOrigin = 'left 70%';
    const pe = enter(panel, t, A.panel, 60);
    panel.style.opacity = pe * lerp(1, 0.72, eIn(P(t, A.feePulse - 0.2, A.feePulse + 0.1)));
    const te = eIn(P(t, A.toast, A.toast + 0.45)), tk = exitK(t, A.toastOut, 0.4);
    css(toast, { o: P(t, A.toast, A.toast + 0.1) * tk, tf: `translateX(${(1 - te) * 520}px)` });
    let k = 0; A.proTaps.forEach((p) => { if (t >= p + 0.15) k++; });
    const [lab, bgc, txc, b] = STATES[k];
    st.textContent = lab; st.style.background = bgc; st.style.color = txc;
    st.style.transform = `scale(${k ? ePop(P(t, A.proTaps[k - 1] + 0.15, A.proTaps[k - 1] + 0.45)) : 1})`;
    btn.textContent = b; btn.style.display = b ? 'inline-flex' : 'none';
    let done = false;
    A.proTaps.forEach((p) => { if (!done && Math.abs(t - p) < 0.45) { press(btn, t, p); tap(tapEl, t, p, btn); done = true; } });
    if (!done) tapEl.style.opacity = 0;
    const jobs = t >= A.toJobs;
    tabs.forEach((el, i) => el.classList.toggle('on', jobs ? i === 2 : i === 0));
    tabs[0].querySelector('b').textContent = jobs ? '0' : '1'; tabs[2].querySelector('b').textContent = jobs ? '4' : '3';
    const hop = P(t, A.proTaps[0] + 0.1, A.proTaps[0] + 0.5);
    css(job, { tf: `translateY(${-Math.sin(Math.PI * hop) * 22}px)` });
    const fl = Math.exp(-Math.pow((t - A.proTaps[2] - 0.2) / 0.12, 2));
    job.style.boxShadow = `0 0 0 ${4 * fl}px rgba(110,30,43,${0.5 * fl})`;
  };
})();

/* ===== 10 · email notifications ===== */
const S10 = (() => {
  const list = $('m-list'), ph = $('m-ph');
  const MAILS = [['Linkr — vous avez reçu un devis', 'Pinceau & Fils · 540,00 $'], ['Linkr — votre demande a été acceptée', 'Atelier Camille · samedi 8 novembre'], ['Linkr — votre prestataire a terminé le travail', 'Confirmez ou signalez un problème.']];
  const els = MAILS.map(([s, p]) => { const d = document.createElement('div'); d.className = 'mail'; d.innerHTML = `<div class="ic">L</div><div><div class="s">${s}</div><div class="p">${p}</div></div>`; list.appendChild(d); return d; });
  return (t) => {
    layerTrans($('L10'), t, SC.notify[0], SC.notify[1]);
    const pe = eIn(P(t, A.phone, A.phone + D.enter));
    let buzz = 0; for (const m of A.mails) { const d = t - m; if (d > 0 && d < 0.35) buzz += Math.sin(d * 70) * Math.exp(-d * 12); }
    css(ph, { o: P(t, A.phone, A.phone + 0.15), tf: `translateY(${(1 - pe) * 90}px) rotate(${1.6 * buzz}deg)` });
    caption($('cap10'), t, A.cap10);
    els.forEach((el, i) => {
      let y = 0; for (let j = i + 1; j < els.length; j++) y += 150 * ePop(P(t, A.mails[j], A.mails[j] + 0.35));
      const a = P(t, A.mails[i], A.mails[i] + 0.35);
      css(el, { o: P(t, A.mails[i], A.mails[i] + 0.1), tf: `translateY(${y + (1 - ePop(a)) * -110}px) scale(${lerp(0.9, 1, eIn(a))})` });
      el.style.zIndex = 10 + i;
    });
  };
})();

/* ===== 11 · two roles (3D flip) ===== */
const S11 = (() => {
  const card = $('r-card'), wrap = $('r-wrap'), segi = $('r-segi'), a = $('r-a'), b = $('r-b'), seg = $('r-seg'), tapEl = $('tap11');
  return (t) => {
    layerTrans($('L11'), t, SC.roles[0], SC.roles[1]);
    caption($('cap11'), t, A.cap11);
    const we = eIn(P(t, A.roleCard, A.roleCard + D.enter)); css(wrap, { o: we, tf: `translateY(${(1 - we) * 70}px)` });
    enter(seg, t, A.roleCard + D.group, 18);
    card.style.transform = `rotateY(${180 * ePop(P(t, A.flip, A.flip + 0.55))}deg)`;
    const sr = seg.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const sw = ePop(P(t, A.roleTap, A.roleTap + D.micro));
    segi.style.left = `${lerp(ra.left, rb.left, sw) - sr.left}px`;
    a.style.color = sw > 0.5 ? '#2e211e' : '#f8f2ea'; b.style.color = sw > 0.5 ? '#f8f2ea' : '#2e211e';
    tap(tapEl, t, A.roleTap, b);
  };
})();

/* ===== 12 · soon ===== */
const S12 = (() => {
  const tt = $('s-tt'), tr = $('s-trades'), lab = $('s-l0'), codes = ['s-l1', 's-l2', 's-l3'].map($), pics = [...$('s-pics').children];
  const ws = splitWords(tt, tt.textContent);
  return (t) => {
    layerTrans($('L12'), t, SC.soon[0], SC.soon[1]);
    ws.forEach((w, i) => slam(w, t, A.soonTitle + i * D.stagger));
    enter(tr, t, A.soonTrades, 18);
    enter(lab, t, A.licences, 14);
    codes.forEach((c, i) => {
      const s0 = A.stamps[i], q = P(t, s0 - 0.12, s0 + 0.25);
      const sc = t < s0 ? lerp(1.55, 1, EASE.inCubic(P(t, s0 - 0.16, s0))) : 1 + 0.05 * Math.exp(-(t - s0) * 8) * Math.cos((t - s0) * 30);
      css(c, { o: eIn(P(t, s0 - 0.16, s0)), tf: `scale(${sc}) rotate(${lerp(-8, 0, clamp(q))}deg)` });
    });
    pics.forEach((p, i) => { const e = eIn(P(t, A.pics + i * D.group, A.pics + i * D.group + D.enter)); css(p, { o: e, tf: `translateY(${(1 - e) * 80}px) rotate(${(1 - e) * (i ? 4 : -4)}deg)` }); });
  };
})();

/* ===== 13 · call to action ===== */
const S13 = (() => {
  const logo = $('c-logo'), open = splitWords($('c-open'), 'La version d’essai est ouverte à tous');
  const urlEl = $('c-url'), ul = $('c-ul'), ring = $('c-ring'), cursor = $('cursor'), glow = $('c-glow'), ctx = $('c-fx').getContext('2d');
  const letters = (() => { urlEl.textContent = ''; return [...'linkrapp.com'].map((c) => { const s = document.createElement('span'); s.textContent = c; urlEl.appendChild(s); return s; }); })();
  const s1 = $('c-s1'), s2 = $('c-s2'), box = $('c-tbox'), qc = $('c-qc');
  s1.textContent = 'Devenez testeur : créez votre compte'; s2.textContent = 'et donnez-nous votre avis.';
  const r = rng(99), sparks = [];
  for (let i = 0; i < 110; i++) sparks.push({ x: 300 + r() * 840, v: 120 + r() * 320, d: (r() - 0.5) * 160, s: 1.2 + r() * 3, life: 0.7 + r() * 1.1, c: r() < 0.6 ? '110,30,43' : '217,130,142' });
  let geo = null;
  return (t) => {
    layerTrans($('L13'), t, SC.cta[0], 99);
    if (!geo) { const a = letters[0], b = letters[letters.length - 1]; geo = { left: a.offsetLeft + urlEl.offsetLeft, right: b.offsetLeft + b.offsetWidth + urlEl.offsetLeft }; Object.assign(ul.style, { left: `${geo.left}px`, width: `${geo.right - geo.left}px` }); }
    const lq = P(t, A.ctaLogo, A.ctaLogo + D.enter);
    css(logo, { o: P(t, A.ctaLogo, A.ctaLogo + 0.15), tf: `scale(${lerp(0.8, 1, ePop(lq))})` });
    open.forEach((w, i) => slam(w, t, A.ctaOpen + i * D.stagger, 1.4));
    letters.forEach((s, i) => { const st = A.url + i * D.letters, q = P(t, st, st + 0.45); css(s, { o: P(t, st, st + 0.12), tf: `translateY(${(1 - ePop(q)) * 90}px) scale(${lerp(1.35, 1, eSlam(q))})`, f: blurF(10 * (1 - eIn(q))) }); });
    const ue = eIn(P(t, A.urlUnderline, A.urlUnderline + 0.45));
    const hover = eIn(P(t, A.cursorIn + 0.5, A.cursorIn + 0.7));
    const breathe = t > A.clicks[0] ? 0.5 + 0.5 * loopSin(t - A.clicks[0] - CONFIG.loop / 4) : 0.5;
    css(ul, { tf: `scaleX(${ue}) scaleY(${1 + 0.35 * hover + 0.25 * hover * breathe})`, o: 0.85 + 0.15 * breathe });
    css(glow, { o: eIn(P(t, A.url, A.url + 0.8)) * (0.85 + 0.15 * loopSin(t)), tf: `scale(${1 + 0.04 * loopSin(t)})` });
    enter(s1, t, A.ctaSub, 18); enter(s2, t, A.ctaSub + D.group, 18);
    enter(box, t, A.testBox, 18);
    enter(qc, t, A.quebec, 12);
    // sparks from the underline, once
    ctx.clearRect(0, 0, W, H);
    for (const p of sparks) { const d = t - A.sparks; if (d < 0 || d > p.life) continue; ctx.fillStyle = `rgba(${p.c},${0.75 * (1 - d / p.life)})`; ctx.beginPath(); ctx.arc(p.x + p.d * d, 580 - p.v * d + 60 * d * d, p.s, 0, 6.283); ctx.fill(); }
    // cursor glides onto the underline (never over the letters) and clicks; one ring per click
    const ce = eIn(P(t, A.cursorIn, A.cursorIn + 0.5));
    const tx = geo.right - 70, ty = ul.offsetTop + ul.offsetHeight / 2;
    let ps = 1; for (const c of A.clicks) ps -= 0.12 * Math.exp(-Math.pow((t - c) / 0.08, 2));
    css(cursor, { o: t >= A.cursorIn ? 1 : 0, tf: `translate(${lerp(1310, tx, ce)}px, ${lerp(990, ty, ce)}px) scale(${ps})` });
    let ro = 0, rs = 0.4;
    for (const c of A.clicks) { const q = P(t, c, c + 0.45); if (q > 0 && q < 1) { ro = 0.8 * (1 - q); rs = lerp(0.4, 1.4, eIn(q)); } }
    ring.style.left = `${tx + 2}px`; ring.style.top = `${ty + 2}px`; css(ring, { o: ro, tf: `scale(${rs})` });
  };
})();

const LAYERS = [
  ['L1', 0, SC.opening[1] + 0.05, S1], ['L3', SC.needs[0] - 0.05, SC.needs[1] + 0.25, S3], ['L4', SC.proximity[0] - 0.28, SC.price[1] + 0.25, S4],
  ['L7', SC.quotes[0] - 0.28, SC.quotes[1] + 0.25, S7], ['L8', SC.payment[0] - 0.28, SC.payment[1] + 0.05, S8], ['L9', SC.pros[0] - 0.02, SC.pros[1] + 0.25, S9],
  ['L10', SC.notify[0] - 0.28, SC.notify[1] + 0.25, S10], ['L11', SC.roles[0] - 0.28, SC.roles[1] + 0.25, S11], ['L12', SC.soon[0] - 0.28, SC.soon[1] + 0.25, S12],
  ['L13', SC.cta[0] - 0.28, 99, S13],
];

window.renderFrame = function renderFrame(t) {
  LAYERS.forEach(([id, a, b, fn], i) => {
    const el = $(id), on = t >= a && t < b;
    el.style.display = on ? 'block' : 'none';
    if (!on) return;
    el.style.zIndex = i + 1;
    fn(t);
  });
  const tg = $('tagline');
  tg.style.display = t < SC.needs[1] + 0.2 ? 'block' : 'none';
  if (t < SC.needs[1] + 0.2) TAG(t);
  wipe(t);
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
