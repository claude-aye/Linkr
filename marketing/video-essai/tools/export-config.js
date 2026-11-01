// Copies the CONFIG block of anim.js (between CONFIG-START / CONFIG-END) into timeline.json,
// so the soundtrack (tools/audio.py) and the renderer read the very same timings.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'anim.js'), 'utf8');
const block = src.slice(src.indexOf('/* CONFIG-START */') + 18, src.indexOf('/* CONFIG-END */'));
const CONFIG = new Function(`${block}; return CONFIG;`)();
fs.writeFileSync(path.join(root, 'timeline.json'), JSON.stringify({ fps: 30, duration: CONFIG.total, ...CONFIG }, null, 1));
console.log('timeline.json <- CONFIG', CONFIG.total, 's');
