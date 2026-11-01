// Reads folders of .pat and .ph2seq files into patterns/patternz.json, the raw material for the seq page's patternz random.
//   node tools/import-patternz.mjs <patterns folder> ...
// A .pat is text: a tag line with the length then rows of `c-3 gate accent slide`, or a tag line with the length then
// rows of `semitone down up slide accent gate` (the column order is that of the one XML patch's labels); a line of
// knobs is a comment. A file can hold several patterns, one after another, or no header at all.
// Each pattern comes out as a list of steps, one number each: (semitone above its home note + 24) * 8 + gate + 2 * accent + 4 * slide.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = process.argv.slice(2);
if (!ROOTS.length) { console.error('usage: node tools/import-patternz.mjs <patterns folder> ...'); process.exit(2); }
const NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const noteOf = (t) => { const m = /^([a-g])([-#b])(-?\d+)$/i.exec(t); return m ? NAMES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2].toLowerCase() === 'b' && m[1] !== 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1) : null; };
const row = (f) => {
  if (f.length === 6 && f.every((x) => /^-?\d+$/.test(x))) { const [p, down, up, slide, acc, gate] = f.map(Number); return { note: p + 12 * (up - down), gate, acc, slide }; }
  if (f.length === 4 && noteOf(f[0]) !== null) return { note: noteOf(f[0]), gate: +f[1], acc: +f[2], slide: +f[3] };
  return null;
};
function textPatterns(text) {
  const out = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const tag = /Meta tag:\s*(\d+)/.exec(line);
    if (tag) { cur = { len: +tag[1], rows: [] }; out.push(cur); continue; }
    if (!line || line.startsWith(';')) continue;
    const r = row(line.split(/\s+/));
    if (!r) continue;
    if (!cur) { cur = { len: 0, rows: [] }; out.push(cur); }
    cur.rows.push(r);
  }
  return out.map((p) => (p.len ? p.rows.slice(0, p.len) : p.rows));
}
// a .ph2seq is one XML tag with steps="2aa|309|488|...": three hex digits a step, the octave, the semitone, then flags
// (8 gate, 2 accent, 1 slide; which of accent and slide is which is read from where they fall in the bar)
function stepsPattern(text) {
  const m = /steps="([0-9a-f|]+)"/i.exec(text);
  return m ? [m[1].split('|').map((x) => { const v = parseInt(x, 16), f = v & 15; return { note: (v >> 8) * 12 + ((v >> 4) & 15), gate: f >> 3, acc: (f >> 1) & 1, slide: f & 1 }; })] : [];
}
function xmlPattern(text) {
  const val = (k) => { const m = new RegExp(`property="${k}"[^>]*>\\s*(-?[\\d.]+)`).exec(text); return m ? Number(m[1]) : 0; };
  const len = val('dpatternlength') || 16;
  return [Array.from({ length: len }, (_, i) => ({ note: val(`dpitch${i}`) + 12 * (val(`dup${i}`) - val(`ddown${i}`)), gate: val(`dgate${i}`), acc: val(`daccent${i}`), slide: val(`dslide${i}`) }))];
}
// the notes as semitones above the pattern's home note (its commonest, in the octave under its lowest note), so any
// pattern can be played in any key
function encode(rows) {
  const on = rows.filter((r) => r.gate);
  if (on.length < 2) return null;
  const count = new Array(12).fill(0);
  on.forEach((r) => count[((r.note % 12) + 12) % 12]++);
  const home = count.indexOf(Math.max(...count)), low = Math.min(...on.map((r) => r.note));
  const base = low - (((low - home) % 12) + 12) % 12;
  return rows.map((r) => {
    let s = (r.gate ? r.note : on[0].note) - base;
    while (s > 36) s -= 12;
    return (s + 24) * 8 + (r.gate ? 1 : 0) + (r.acc ? 2 : 0) + (r.slide ? 4 : 0);
  });
}
const files = [];
const walk = (d) => readdirSync(d).sort().forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(pat|ph2seq)$/i.test(f)) files.push(p); });
ROOTS.forEach(walk);
const seen = new Set(), patterns = [];
let skipped = 0;
for (const f of files) {
  const text = readFileSync(f, 'latin1');
  for (const rows of /\.ph2seq$/i.test(f) ? stepsPattern(text) : text.includes('<JukeboxPatch') ? xmlPattern(text) : textPatterns(text)) {
    const p = encode(rows);
    if (!p || new Set(p).size < 2 || seen.has(p.join())) { skipped++; continue; }
    seen.add(p.join()); patterns.push(p);
  }
}
writeFileSync(new URL('../patterns/patternz.json', import.meta.url), `{"patterns":[\n${patterns.map((p) => JSON.stringify(p)).join(',\n')}\n]}\n`);
console.log(`${files.length} files: ${patterns.length} patterns kept, ${skipped} empty or repeated`);
