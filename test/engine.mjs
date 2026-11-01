// Checks the synth's sound side without a browser: the built page's engine, audio thread and state (app/core.js) run
// in Node, the player rendering offline.
//   node test/engine.mjs [index.html]
// - a note on a whole semitone is bit-exact: the voice renders exactly what the engine's own trigger on that note does
// - pitch between semitones is continuous (cents), and back on a semitone it's exact again
// - the sequencer: rests don't play, a slide glides into the next step without a retrigger, a short gate closes;
//   four pages play in turn
// - the reverb leaves a finite tail, and holds at the top of its decay
// - a retrigger over a note still sounding doesn't jump (the declick), and the new note settles to the engine's own
// - every built-in preset loads and plays at a sane level
import { readFileSync } from 'node:fs';
const html = readFileSync(process.argv[2] || new URL('../index.html', import.meta.url), 'utf8');
const script = (id) => new RegExp(`<script id="${id}">\\n([\\s\\S]*?)</script>`).exec(html)[1];
const core = readFileSync(new URL('../app/core.js', import.meta.url), 'utf8');
const presets = /const BUILTIN_PRESETS = (.*);\n/.exec(html)[1];
const env = new Function(`${script('engine')}\n${script('player')}\nconst BUILTIN_PRESETS = ${presets};\n${core}
  return { LXR, Player, useSnapshot, snapshot, SCALES, degSemis, setFallback: (p) => { fallback = p; }, setPlaying: (v) => { playing = v; } };`)();
const { LXR, Player } = env;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

// whole semitones: the player's note against a bare engine's trigger, sample for sample
{
  let worst = 0;
  for (const n of [-24, -12, -5, 0, 3, 7, 12, 19]) {
    // (the player renders two blocks as it starts)
    const p = new Player(LXR.REAL_FS), ref = new LXR.LxrEngine(); ref.loadInitKit(); ref.renderBlock(); ref.renderBlock();
    p.msg({ type: 'pitch', v: 0 }); p.msg({ type: 'note', n, acc: true, gate: 5 });
    ref.trigger(0, 127, 60 + n);
    for (let k = 0; k < 200; k++) { p._render(p.A); const a = p.e.out[0], b = ref.renderBlock()[0]; for (let i = 0; i < 64; i++) worst = Math.max(worst, Math.abs(a[i] - b[i])); }
  }
  check(worst === 0, `whole semitones are bit-exact (max difference ${worst})`);
}
// between semitones: the oscillator's frequency moves in cents, and is exact again on the semitone
{
  const p = new Player(LXR.REAL_FS), ref = new LXR.LxrEngine(); ref.loadInitKit();
  p.msg({ type: 'note', n: 0, acc: true, gate: 5 }); ref.trigger(0, 127, 60);
  const f0 = p.e.drums[0].osc.freq;
  p.msg({ type: 'pitch', v: 0.25 }); const c = 1200 * Math.log2(p.e.drums[0].osc.freq / f0);
  p.msg({ type: 'pitch', v: 0 });
  check(Math.abs(c - 25) < 0.01, `pitch +0.25 st is +${c.toFixed(2)} cents`);
  check(p.e.drums[0].osc.freq === ref.drums[0].osc.freq, 'back on the semitone the frequency is exact');
}
// the sequencer
{
  const p = new Player(LXR.REAL_FS), hits = [];
  const trig = p.e.trigger.bind(p.e);
  p.e.trigger = (v, vel, note) => { hits.push([p.step, note]); trig(v, vel, note); };
  const S = (n, gate, acc, slide) => ({ n, gate, acc, slide });
  const steps = [S(0, 4, 1, 0), S(2, 0, 0, 0), S(3, 4, 0, 1), S(5, 4, 0, 0), S(7, 1, 0, 0), ...Array.from({ length: 11 }, () => S(0, 0, 0, 0))];
  p.msg({ type: 'seq', playing: true, bpm: 120, vel: 100, glide: 0.5, accentDb: 6, steps });
  const len = LXR.REAL_FS * 60 / 120 / 4;
  let minGain = 1, slid = false;
  for (let b = 0; b < Math.ceil(16 * len / 64); b++) {
    p._render(p.A);
    if (p.slideFrom !== null) slid = true;
    if (p.step === 5 && p.toNext < len * 0.3) minGain = Math.min(minGain, p.gain);
  }
  const played = hits.map(([s, note]) => [s, note - 60]);
  check(JSON.stringify(played) === JSON.stringify([[0, 0], [2, 3], [4, 7]]), `steps 0, 2 and 4 trigger; the rest and the slid-into step don't (${JSON.stringify(played)})`);
  check(slid, 'step 2 slides into step 3');
  check(minGain === 0, 'a quarter gate closes before its step is out');
}
// four pages: they play in turn, a bar each, then page 1 again
{
  const p = new Player(LXR.REAL_FS), hits = [];
  const trig = p.e.trigger.bind(p.e);
  p.e.trigger = (v, vel, note) => { hits.push(note - 60); trig(v, vel, note); };
  const steps = Array.from({ length: 64 }, (_, i) => ({ n: Math.floor(i / 16), gate: i % 16 === 0 ? 4 : 0, acc: false, slide: false }));
  p.msg({ type: 'seq', playing: true, bpm: 120, vel: 100, glide: 0.5, accentDb: 6, steps });
  for (let b = 0; b < Math.ceil(LXR.REAL_FS * 2 * 4.5 / 64); b++) p._render(p.A);
  check(JSON.stringify(hits) === '[0,1,2,3,0]', `four pages play in turn (${JSON.stringify(hits)})`);
}
// the reverb: a note sent to it leaves a tail after the voice has stopped, finite and at a sane level, and at the top
// of its decay (with the tone in the middle) it holds
{
  // the reverb alone (no compressor): the loudest sample, and the loudest from `from` seconds on, over `secs` seconds
  const run = (decay, secs, from) => {
    const p = new Player(LXR.REAL_FS);
    p.msg({ type: 'mix', master: { comp: false }, dist: { type: 0, p: [0, 0, 0, 0], mix: 0 }, ring: { wave: 0, freq: 40 }, sendE: 0, sendR: 0,
      width: 100, sendV: 1, verb: [16, decay, 64, 64] });
    p.msg({ type: 'note', n: 0, acc: true, gate: 2 });
    let peak = 0, tail = 0, bad = false;
    for (let b = 0; b < Math.ceil(LXR.REAL_FS * secs / 64); b++) {
      p._render(p.A);
      for (const ch of p.A) for (const x of ch) { if (!Number.isFinite(x)) bad = true; peak = Math.max(peak, Math.abs(x)); if (b * 64 > LXR.REAL_FS * from) tail = Math.max(tail, Math.abs(x)); }
    }
    return { peak, tail, bad };
  };
  const dB = (x) => (20 * Math.log10(x)).toFixed(1);
  const r = run(100, 0.6, 0.4), held = run(127, 3, 2.8);
  check(!r.bad && !held.bad && r.peak < 1.5 && held.peak < 1.5, `reverb: finite and sane (peak ${dB(r.peak)} dB)`);
  check(r.tail > 0.001, `reverb: a tail after the note (${dB(r.tail)} dB at 0.4 s)`);
  check(held.tail > 0.01, `reverb: decay at the top holds (${dB(held.tail)} dB after 2.8 s)`);
}
// the declick: retriggering the default sound while a note still sounds, at many points in its cycle, the first sample
// of the new note is never further from the last one than the waveform itself moves in a sample; 10 ms on, the note
// is the engine's own again (the compressor off, to compare)
{
  let worstJump = 0, worstEdge = 0, worstLater = 0;
  for (let at = 20; at < 60; at++) {
    const p = new Player(LXR.REAL_FS); env.setFallback(p); env.useSnapshot(env.snapshot(), false);
    p.master.comp = false;
    const L = [], B = [new Float32Array(64), new Float32Array(64)];
    const blk = () => { p._render(B); L.push(...B[0]); };
    p.msg({ type: 'note', n: 0, acc: true, gate: 5 });
    for (let k = 0; k < at; k++) blk();
    const i0 = L.length;
    p.msg({ type: 'note', n: 7, acc: true, gate: 5 });
    for (let k = 0; k < 10; k++) blk();
    for (let i = 1; i < i0; i++) worstEdge = Math.max(worstEdge, Math.abs(L[i] - L[i - 1]));
    worstJump = Math.max(worstJump, Math.abs(L[i0] - L[i0 - 1]));
    // past 10 ms the offset is gone: the voice is the engine's output, at the gain
    const late = i0 + Math.ceil(0.01 * LXR.REAL_FS);
    const raw = p.e.out[0], pl = p.e.drums[0].triggeredPanL / 32768;
    for (let i = L.length - 64; i < L.length; i++) if (i >= late) worstLater = Math.max(worstLater, Math.abs(L[i] - raw[i - (L.length - 64)] * pl));
  }
  check(worstJump <= worstEdge, `a retrigger doesn't jump (at most ${worstJump.toFixed(3)}, the waveform's own steps up to ${worstEdge.toFixed(3)})`);
  check(worstLater < 1e-4, `the declick has died away 10 ms on (${worstLater.toExponential(1)})`);
  env.setFallback(null);
}
// the built-in presets: each loads and plays at a sane level
{
  const list = JSON.parse(presets);
  for (const pr of list) {
    const p = new Player(LXR.REAL_FS);
    env.setFallback(p); env.setPlaying(true);
    env.useSnapshot(pr, false);
    let peak = 0, sum = 0, n = 0, bad = false;
    for (let b = 0; b < Math.ceil(LXR.REAL_FS * 240 / pr.tempo * 2 / 64); b++) {
      p._render(p.A);
      for (const ch of p.A) for (const x of ch) { if (!Number.isFinite(x)) bad = true; peak = Math.max(peak, Math.abs(x)); sum += x * x; n++; }
    }
    const rms = Math.sqrt(sum / n);
    check(!bad && peak > 0.05 && peak < 1.5, `${pr.name}: peak ${(20 * Math.log10(peak)).toFixed(1)} dB, rms ${(20 * Math.log10(rms)).toFixed(1)} dB`);
  }
}
process.exit(fails ? 1 : 0);
