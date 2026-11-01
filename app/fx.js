// ---- fx: the echo (ping pong, send, time on the musical lengths, tone, feedback, width) and the ring mod (send,
// carrier wave and frequency) ----
const fxF = (box, label, o) => mFader($(box), label, { show: String, ...o });
// a fader on one of the mix's settings (obj[key], fx, dist or master), sent with the mix
const mixF = (box, label, obj, key, o) => fxF(box, label, { get: () => obj[key], set: (v) => { obj[key] = v; sendMix(); }, ...o });
$('m-pp').addEventListener('change', () => setValue(PAR.FX_DELAY_TYPE, $('m-pp').checked ? 1 : 0));
drawHooks.push(() => { $('m-pp').checked = values[PAR.FX_DELAY_TYPE] === 1; });
mixF('m-echo', 'send', fx, 'send', { min: 0, max: 100, show: sendPct, dflt: 0 });
fxF('m-echo', 'time', { min: 0, max: 1000, get: () => Math.round(delayPos * 1000), set: (v) => setDelay(v / 1000), show: showDelay, dflt: Math.round(posOf(3 / 16) * 1000) });
fxF('m-echo', 'tone', { min: 0, max: 127, get: () => values[PAR.FX_P3], set: (v) => setValue(PAR.FX_P3, v), dflt: 90 });
fxF('m-echo', 'feedback', { min: 0, max: 127, get: () => values[PAR.FX_P4], set: (v) => setValue(PAR.FX_P4, v), dflt: 50 });
mixF('m-echo', 'width', fx, 'width', { min: 0, max: 200, show: (v) => v + '%', dflt: 100 });
// the reverb: send, then the firmware's four: predelay (1 to 46 ms), decay (its feedback; at the top it holds), tone (a
// tilt: in the middle it's flat, down darkens and damps the tail, up thins it) and early (the early reflections' level)
const preMs = (v) => Math.round(2031 * (0.02166 + v / 127 * 0.97784) / (LXR.REAL_FS / 1000)) + ' ms';
mixF('m-verb', 'send', fx, 'verb', { min: 0, max: 100, show: sendPct, dflt: 0 });
[['predelay', 'vPre', preMs], ['decay', 'vDecay'], ['tone', 'vTone'], ['early', 'vEarly']].forEach(([l, k, show]) =>
  mixF('m-verb', l, fx, k, { min: 0, max: 127, show: show || String, dflt: FX0[k] }));
const RING_W = OSC_WAVE_NAMES.map((n) => n.toLowerCase());
mixF('m-ring', 'send', fx, 'ring', { min: 0, max: 100, show: sendPct, dflt: 0 });
mixF('m-ring', 'wave', fx, 'ringWave', { min: 0, max: RING_W.length - 1, show: (v) => RING_W[v], dflt: 0 });
mixF('m-ring', 'freq', fx, 'ringFreq', { min: 0, max: 127, dflt: 40 });

// ---- master, in signal order: the distortion on the whole mix (mix 0 bypasses it; tube, fold or rat), then the compressor ----
const DIST_T = LXR.DIST_NAMES.map((n) => n.toLowerCase());
mixF('m-dist', 'mix', dist, 'mix', { min: 0, max: 100, show: sendPct, dflt: 0 });
mixF('m-dist', 'type', dist, 'type', { min: 0, max: DIST_T.length - 1, show: (v) => DIST_T[v], dflt: 0 });
['drive', 'color', 'tone', 'volume'].forEach((l, i) => mixF('m-dist', l, dist.p, i, { min: 0, max: 127, dflt: DIST0.p[i] }));
const mMaster = (label, key, lo, hi, step, show) => mixF('m-comp', label, master, key, { min: lo, max: hi, step, show, dflt: MASTER0[key] });
mMaster('threshold', 'thresh', -40, 0, 1, (v) => v + ' dB');
fxF('m-comp', 'ratio', { min: 0, max: RATIOS.length - 1, get: () => Math.max(0, RATIOS.indexOf(master.ratio)), set: (v) => { master.ratio = RATIOS[v]; sendMix(); }, show: (v) => RATIOS[v] + ':1', dflt: RATIOS.indexOf(MASTER0.ratio) });
mMaster('attack', 'attack', 1, 50, 1, (v) => v + ' ms');
mMaster('release', 'release', 20, 500, 10, (v) => v + ' ms');
mMaster('makeup', 'makeup', 0, 12, 1, (v) => '+' + v + ' dB');
$('m-comp-on').addEventListener('click', () => { master.comp = !master.comp; sendMix(); drawAll(); });
drawHooks.push(() => { $('m-comp-on').setAttribute('aria-pressed', master.comp); $('m-comp-on').textContent = master.comp ? 'on' : 'off'; $('m-comp').classList.toggle('off', !master.comp); });
// the gain reduction meter, from each step's reading: only while its page is on screen (each move of the meter lays out
// and repaints the page, which a phone shouldn't spend time on unseen), and only when the reading changes
let grShown = '';
eventHandlers.push((ev) => {
  if (ev.type !== 'step' || document.hidden || PANELS[mCur].dataset.mPanel !== 'comp') return;
  const d = Math.max(0, Math.min(20, ev.gr || 0)), t = `${d.toFixed(1)} dB`;
  if (t === grShown) return;
  grShown = t;
  $('m-gr').style.setProperty('--gr', (Math.log1p(d) / Math.log1p(20)).toFixed(3)); $('m-gr-out').textContent = t;
});
stopHooks.push(() => { grShown = '0.0 dB'; $('m-gr').style.setProperty('--gr', 0); $('m-gr-out').textContent = grShown; });
