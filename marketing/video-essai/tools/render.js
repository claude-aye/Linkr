// Frame-by-frame capture of index.html with the preinstalled Chromium.
// node tools/render.js --scale 0.5 --out frames-preview [--from 0 --to 50] [--workers 4] [--stills 1,2,3 --stillsdir stills] [--qa]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1] ?? true; };
const has = (k) => process.argv.includes('--' + k);
const TL = JSON.parse(fs.readFileSync(path.join(root, 'timeline.json'), 'utf8'));
const GLOBE = fs.readFileSync(path.join(root, 'assets/globe-dots.json'), 'utf8');
const scale = Number(arg('scale', 1)), fps = TL.fps;
const from = Number(arg('from', 0)), to = Number(arg('to', TL.duration));
const workers = Number(arg('workers', 4));
const out = path.resolve(arg('out', 'frames'));
const quality = Number(arg('quality', 92));

async function openPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.addInitScript(`window.TL = ${JSON.stringify(TL)}; window.GLOBE = ${GLOBE};`);
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.evaluate(() => window.__ready);
  return page;
}

(async () => {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  if (has('stills')) {
    const page = await openPage(browser);
    const dir = path.resolve(arg('stillsdir', 'stills')); fs.mkdirSync(dir, { recursive: true });
    for (const t of String(arg('stills')).split(',').map(Number)) {
      await page.evaluate(([t, s]) => { window.renderFrame(t); window.showSafe(s); }, [t, has('safe')]);
      await page.screenshot({ path: path.join(dir, `t${t.toFixed(2)}.png`) });
    }
    await browser.close(); return;
  }
  if (has('qa')) {
    const page = await openPage(browser);
    const times = String(arg('qa')).split(',').map(Number);
    let bad = 0;
    for (const t of times) {
      const v = await page.evaluate((t) => {
        window.renderFrame(t);
        const L = 115, R = 1325, T = 86, B = 994, res = [];
        const walker = document.createTreeWalker(document.getElementById('stage'), NodeFilter.SHOW_TEXT);
        for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
          if (!tn.textContent.trim()) continue;
          let o = 1, n = tn.parentElement, hidden = false;
          while (n && n.nodeType === 1) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') { hidden = true; break; } o *= Number(cs.opacity); n = n.parentElement; }
          if (hidden || o < 0.1) continue;
          const rg = document.createRange(); rg.selectNodeContents(tn);
          const r = rg.getBoundingClientRect();
          if (!r.width || r.right < 0 || r.left > 1440 || r.bottom < 0 || r.top > 1080) continue;
          if (r.left < L - 0.5 || r.right > R + 0.5 || r.top < T - 0.5 || r.bottom > B + 0.5)
            res.push(`"${tn.textContent.trim().slice(0, 40)}" [${r.left|0},${r.top|0},${r.right|0},${r.bottom|0}] o=${o.toFixed(2)}`);
        }
        return res;
      }, t);
      console.log(`t=${t}: ${v.length ? 'OUT ' + v.length : 'ok'}`); v.forEach((x) => console.log('   ', x)); bad += v.length;
    }
    console.log('violations', bad);
    await browser.close(); process.exit(bad ? 1 : 0);
  }
  fs.mkdirSync(out, { recursive: true });
  const first = Math.round(from * fps), last = Math.round(to * fps); // [first, last)
  const total = last - first, per = Math.ceil(total / workers);
  const t0 = Date.now(); let done = 0;
  await Promise.all([...Array(workers)].map(async (_, w) => {
    const page = await openPage(browser);
    for (let i = first + w * per; i < Math.min(last, first + (w + 1) * per); i++) {
      await page.evaluate((t) => window.renderFrame(t), i / fps);
      await page.screenshot({ path: path.join(out, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality });
      if (++done % 100 === 0) console.log(`${done}/${total} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  console.log(`done ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await browser.close();
})();
