// Precompute land dots for the globe scene (Natural Earth via world-atlas, public domain).
// Usage: node make-globe-dots.js <land-50m.json> <topojson-client dir> <out.json>
const fs = require('fs');
const [, , landPath, tjDir, outPath] = process.argv;
const topojson = require(require('path').resolve(tjDir));
const topo = JSON.parse(fs.readFileSync(landPath, 'utf8'));
const land = topojson.feature(topo, topo.objects.land);
const polys = [];
for (const f of land.features ?? [land]) {
  const g = f.geometry ?? f;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of list) polys.push(p);
}
// bounding boxes for speed
const boxes = polys.map((p) => {
  let a = 180, b = -180, c = 90, d = -90;
  for (const [x, y] of p[0]) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
  return [a, b, c, d];
});
function inRing(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function onLand(lng, lat) {
  for (let k = 0; k < polys.length; k++) {
    const [a, b, c, d] = boxes[k];
    if (lng < a || lng > b || lat < c || lat > d) continue;
    const p = polys[k];
    if (inRing(lng, lat, p[0])) {
      let hole = false;
      for (let h = 1; h < p.length; h++) if (inRing(lng, lat, p[h])) { hole = true; break; }
      if (!hole) return true;
    }
  }
  return false;
}
const r = (v) => Math.round(v * 100) / 100;
// Global: fibonacci sphere
const N = 26000, world = [];
const ga = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2;
  const lat = (Math.asin(y) * 180) / Math.PI;
  const lng = ((((i * ga * 180) / Math.PI) % 360) + 540) % 360 - 180;
  if (lat < -60) continue; // skip Antarctica clutter
  if (onLand(lng, lat)) world.push([r(lng), r(lat)]);
}
// Regional dense grid: Québec and surroundings
const region = [];
for (let lat = 41; lat <= 64; lat += 0.42) {
  const step = 0.42 / Math.cos((lat * Math.PI) / 180);
  for (let lng = -84; lng <= -54; lng += step) if (onLand(lng, lat)) region.push([r(lng), r(lat)]);
}
fs.writeFileSync(outPath, JSON.stringify({ world, region }));
console.log('world', world.length, 'region', region.length);
