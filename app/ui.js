// ---- the screen: pages, transport and the faders every page uses; then the perf, voice, x/y, fx and master
// pages and the randomisers ----

// ---- pages: perf stays on the left; the others sit on the right, one at a time: swipe across them, or tap a page button. A swipe starts anywhere but on a fader, the x/y pad, the
// steps or a list, so dragging those never turns the page ----
const mPages = $('m-pages'), PANELS = [...mPages.querySelectorAll('[data-m-panel]')];
const PAGE_NAMES = { play: 'perform', seq: 'notes', voice: 'voice', xy: 'x/y', fx: 'effects', comp: 'master', presets: 'presets' };
// the screen is laid out once at 1000 x 600 and scaled as a whole to fit the window, as a plugin window resizes
const M_W = 1000, M_H = 600;
let mK = 1;
function mFit() { mK = Math.min(innerWidth / M_W, innerHeight / M_H); $('m').style.setProperty('--k', mK); }
mFit(); addEventListener('resize', mFit);
let mCur = 0;
const pageHooks = [];
function mGo(i, smooth) {
  mCur = Math.max(0, Math.min(PANELS.length - 1, i));
  const t = PANELS[mCur].dataset.mPanel;
  mPages.scrollTo({ left: PANELS[mCur].offsetLeft - PANELS[0].offsetLeft, behavior: smooth ? 'smooth' : 'instant' });
  $('m-pagename').textContent = PAGE_NAMES[t];
  document.querySelectorAll('[data-m-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mTab === t));
  pageHooks.forEach((h) => h(t));
}
document.querySelectorAll('[data-m-tab]').forEach((b) => b.addEventListener('click', () => mGo(PANELS.findIndex((p) => p.dataset.mPanel === b.dataset.mTab))));
addEventListener('resize', () => mGo(mCur));
{
  const NOSWIPE = '.m-vtrack, .m-xy, .m-steps, select, input';
  let sw = null;
  mPages.addEventListener('pointerdown', (e) => {
    if (sw || e.target.closest(NOSWIPE)) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, left: mPages.scrollLeft, on: false };
  });
  mPages.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = (e.clientX - sw.x) / mK, dy = (e.clientY - sw.y) / mK;
    if (!sw.on) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
      if (Math.abs(dx) < 12) return;
      sw.on = true; mPages.setPointerCapture(e.pointerId); mPages.classList.add('swiping');
    }
    mPages.scrollLeft = sw.left - dx;
  });
  const end = (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const s = sw; sw = null;
    if (!s.on) return;
    mPages.classList.remove('swiping');
    const dx = (e.clientX - s.x) / mK, fast = Math.abs(dx) / Math.max(1, e.timeStamp - s.t) > 0.5;
    mGo(mCur + (Math.abs(dx) > mPages.clientWidth * 0.2 || (fast && Math.abs(dx) > 30) ? (dx < 0 ? 1 : -1) : 0), true);
  };
  // (a swipe holds the pointer, so one that ends on a button doesn't press it)
  mPages.addEventListener('pointerup', end); mPages.addEventListener('pointercancel', end);
}
$('m').addEventListener('contextmenu', (e) => e.preventDefault());

// ---- transport ----
function setPlaying(on) {
  playing = on;
  $('m-play').setAttribute('aria-pressed', on); $('m-play').querySelector('span').textContent = on ? 'stop' : 'play';
  sendSeq();
  if (!on) stopHooks.forEach((h) => h());
}
const stopHooks = [];
$('m-play').addEventListener('click', async () => { await startAudio(); setPlaying(!playing); });
// the space bar starts and stops (but still types in a text box); it never presses the button that has the focus
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target.closest('input[type="text"], textarea, select')) return;
  e.preventDefault();
  if (!e.repeat) $('m-play').click();
}, true);
addEventListener('keyup', (e) => { if (e.code === 'Space' && !e.target.closest('input[type="text"], textarea, select')) e.preventDefault(); }, true);
// ---- faders: vertical, readout on top and label under; dragging moves the value from where it is (a touch doesn't jump
// it), the whole track's height is the full range (travel 2: twice it, for finer steps), a double tap on the label
// resets it, and holding one still for half a second opens its step sequencer. While a sequencer runs, the fader sets
// its base (fd.base) and the sequencer moves the value around it: the fill is the value heard, the bar the base ----
const mFaders = [];
function mFader(box, label, { min, max, step = 1, get, set, show, dflt, travel = 1, cc = 0 }) {
  const el = document.createElement('div');
  el.className = cc ? 'm-vf m-dial' : 'm-vf';
  el.innerHTML = '<output></output><div class="m-vtrack" role="slider" tabindex="0"><i></i><b></b></div><span class="m-flab"></span>';
  // a dial (cc: its MIDI CC number, shown in its middle) turns by dragging up and down over 200 px
  if (cc) el.querySelector('.m-vtrack').insertAdjacentHTML('beforeend', `<em aria-hidden="true">${cc}</em>`);
  el.querySelector('.m-flab').textContent = label;
  const tr = el.querySelector('.m-vtrack'), out = el.querySelector('output');
  tr.setAttribute('aria-label', label);
  const hiOf = () => (typeof max === 'function' ? max() : max);
  const snap = (v) => Math.round(Math.max(min, Math.min(hiOf(), min + Math.round((v - min) / step) * step)) * 1e6) / 1e6;
  const put = (v) => { v = snap(v); if (v !== get()) set(v); draw(); };
  const draw = () => {
    const hi = hiOf(), v = get();
    out.textContent = show(v); tr.style.setProperty('--f', (v - min) / (hi - min || 1));
    tr.classList.toggle('mod', fd.base !== null); if (fd.base !== null) tr.style.setProperty('--b', (fd.base - min) / (hi - min || 1));
    tr.setAttribute('aria-valuemin', min); tr.setAttribute('aria-valuemax', hi); tr.setAttribute('aria-valuenow', v); tr.setAttribute('aria-valuetext', show(v));
  };
  const fd = { key: `${box.id}:${label}`, label, min, hiOf, step, get, show, put, snap, el, draw, cc, seq: null, base: null, off: 0, glide: null };
  // a move of the fader: its base while a sequencer runs, else its value
  const move = (v) => { if (fd.base !== null) { fd.base = snap(v); fsApply(fd); } else put(v); };
  fd.move = move;
  let drag = null, hold = 0;
  tr.addEventListener('pointerdown', (e) => {
    tr.setPointerCapture(e.pointerId); el.classList.add('held');
    drag = { y: e.clientY, v: fd.base !== null ? fd.base : get(), h: cc ? 200 : tr.getBoundingClientRect().height };
    clearTimeout(hold);
    hold = setTimeout(() => { if (!drag) return; const v = drag.v; end(); move(v); fsOpen(fd); }, 500);
  });
  tr.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.abs(drag.y - e.clientY) > 6) clearTimeout(hold);
    move(drag.v + (drag.y - e.clientY) / (drag.h * travel) * (hiOf() - min));
  });
  const end = () => { clearTimeout(hold); drag = null; el.classList.remove('held'); };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
  tr.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d) { e.preventDefault(); move((fd.base !== null ? fd.base : get()) + d * step); }
  });
  let last = 0;
  el.querySelector('.m-flab').addEventListener('click', () => {
    const t = performance.now();
    if (t - last < 350 && dflt !== undefined) move(typeof dflt === 'function' ? dflt() : dflt); last = t;
  });
  box.append(el); mFaders.push(fd); drawHooks.push(draw);
  return fd;
}
const pct = (v) => (v === 100 ? '0%' : (v > 100 ? '+' : '−') + Math.abs(v - 100) + '%');

// ---- perf: eight dials in a line along the top, MIDI CC 1 to 8 in order: tempo, pitch, decay, filter, reso, fm, the
// echo send and the reverb send. Decay, filter and fm are macros on top of
// the sound; the rest move the same settings as their faders on the other pages ----
const sendPct = (v) => (v ? v + '%' : 'off');
const PERF_DIALS = [
  ['tempo', { min: 40, max: 240, travel: 2, get: () => tempo, set: (v) => { tempo = v; sendSeq(); }, show: (v) => `${v} bpm`, dflt: 120 }],
  // pitch is free: hundredths of a semitone, over twice the travel
  ['pitch', { min: -24, max: 24, step: 0.01, travel: 2, get: () => macro.pitch, set: (v) => setMacro('pitch', v),
    show: (v) => (Math.abs(v) < 0.005 ? '0 st' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' st'), dflt: 0 }],
  ...['decay', 'filter'].map((m) => [m, { min: 0, max: 200, get: () => macro[m], set: (v) => setMacro(m, v), show: pct, dflt: 100 }]),
  ['reso', { min: 0, max: 127, get: () => values[PAR.RESO_1], set: (v) => setValue(PAR.RESO_1, v), show: String, dflt: () => factoryInit[PAR.RESO_1] }],
  ['fm', { min: 0, max: 200, get: () => macro.fm, set: (v) => setMacro('fm', v), show: pct, dflt: 100 }],
  ['echo', { min: 0, max: 100, get: () => fx.send, set: (v) => { fx.send = v; sendMix(); }, show: sendPct, dflt: 0 }],
  ['reverb', { min: 0, max: 100, get: () => fx.verb, set: (v) => { fx.verb = v; sendMix(); }, show: sendPct, dflt: 0 }]];
const ccDials = PERF_DIALS.map(([label, o], i) => mFader($('m-perf'), label, { ...o, cc: i + 1 }));
// MIDI in (Web MIDI, any input, any channel): CC 1 to 8 turn the dials, 0..127 over each one's range. Access is asked
// for at the first touch (or straight away if it was given before); controllers plugged in later are picked up
{
  let redraw = 0;
  const onMidi = (e) => {
    const [st, n, v] = e.data;
    if ((st & 0xf0) !== 0xb0 || n < 1 || n > ccDials.length) return;
    const fd = ccDials[n - 1];
    fd.el.classList.add('cc');
    fd.move(fd.min + v / 127 * (fd.hiOf() - fd.min));
    if (!redraw) redraw = requestAnimationFrame(() => { redraw = 0; drawAll(); });
  };
  let asked = false;
  const ask = () => {
    if (asked || !navigator.requestMIDIAccess) return;
    asked = true;
    navigator.requestMIDIAccess().then((acc) => {
      const bind = () => acc.inputs.forEach((i) => { i.onmidimessage = onMidi; });
      bind(); acc.onstatechange = bind;
    }, () => {});
  };
  addEventListener('pointerdown', ask, { once: true, capture: true });
  if (navigator.permissions) navigator.permissions.query({ name: 'midi' }).then((p) => { if (p.state === 'granted') ask(); }, () => {});
}

// ---- voice: every drum 1 parameter, on four tabs of up to twelve: tone (oscillator, fm), shape (amp eg, pitch
// envelope, click), filter (and the voice's mix) and mod (lfo and its target, velocity) ----
const VP_LABEL = {
  COARSE1: 'note', FINE1: 'fine', OSC_WAVE_DRUM1: 'wave', PWM_1: 'pwm', VELOA1: 'attack', VELOD1: 'decay', VOL_SLOPE1: 'slope',
  MOD_EG1: 'pitch dec', PITCH_SLOPE1: 'pitch slp', MODAMNT1: 'pitch amt', VEL_DEST_1: 'vel dest', VELO_MOD_AMT_1: 'vel amt', VOLUME_MOD_ON_OFF1: 'vel vol',
  FMAMNT1: 'fm amt', FM_FREQ1: 'fm freq', MOD_WAVE_DRUM1: 'fm wave', MIX_MOD_1: 'fm mode', TRANS1_WAVE: 'click', TRANS1_VOL: 'click vol', TRANS1_FREQ: 'click frq',
  FILTER_FREQ_1: 'cutoff', RESO_1: 'reso', FILTER_TYPE_1: 'type', FILTER_DRIVE_1: 'flt drive', FREQ_LFO1: 'lfo rate', SYNC_LFO1: 'lfo sync',
  AMOUNT_LFO1: 'lfo amt', WAVE_LFO1: 'lfo wave', RETRIGGER_LFO1: 'retrig', OFFSET_LFO1: 'lfo phase', TARGET_LFO1: 'lfo dest',
  VOL1: 'volume', PAN1: 'pan', VOICE_DECIMATION1: 'srate', DRIVE1: 'drive' };
const VP_PAGES = [
  ['tone', ['COARSE1', 'FINE1', 'OSC_WAVE_DRUM1', 'PWM_1', 'FMAMNT1', 'FM_FREQ1', 'MOD_WAVE_DRUM1', 'MIX_MOD_1']],
  ['shape', ['VELOA1', 'VELOD1', 'VOL_SLOPE1', 'MOD_EG1', 'PITCH_SLOPE1', 'MODAMNT1', 'TRANS1_WAVE', 'TRANS1_VOL', 'TRANS1_FREQ']],
  ['filter', ['FILTER_FREQ_1', 'RESO_1', 'FILTER_TYPE_1', 'FILTER_DRIVE_1', 'VOL1', 'PAN1', 'VOICE_DECIMATION1', 'DRIVE1']],
  ['mod', ['FREQ_LFO1', 'SYNC_LFO1', 'AMOUNT_LFO1', 'WAVE_LFO1', 'RETRIGGER_LFO1', 'OFFSET_LFO1', 'TARGET_LFO1', 'VEL_DEST_1', 'VELO_MOD_AMT_1', 'VOLUME_MOD_ON_OFF1']]];
// every drum 1 parameter, by page, for the x/y pad and the randomisers
const DR1 = VP_PAGES.flatMap(([, ps]) => ps);
let mVSec = 0;
const mVBoxes = VP_PAGES.map(([name, ps], k) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'm-btn'; b.setAttribute('role', 'tab'); b.textContent = name;
  b.addEventListener('click', () => { mVSec = k; mVoiceShow(); }); $('m-vsec').append(b);
  const box = document.createElement('div'); box.className = 'm-faders m-vset'; box.id = `m-voice-${name}`; $('m-vsets').append(box);
  box.style.gridTemplateRows = `repeat(${Math.ceil(ps.length / 4)}, minmax(0, 1fr))`; // (as tall as the rows it fills)
  for (const pn of ps) {
    const par = PAR[pn], sp = spec(par);
    mFader(box, VP_LABEL[pn], { min: 0, max: sp.max, get: () => parGet(par), set: (x) => parSet(par, x), show: (x) => sp.show(x),
      dflt: () => (sp.idx ? Math.max(0, TARGETS.indexOf(factoryInit[par])) : factoryInit[par]) });
  }
  return box;
});
function mVoiceShow() {
  [...$('m-vsec').children].forEach((b, k) => b.setAttribute('aria-selected', k === mVSec));
  mVBoxes.forEach((box, k) => { box.hidden = k !== mVSec; });
}
mVoiceShow();

// ---- x/y: one pad moving any two drum 1 parameters, picked in the two lists over it (kept in this browser). The
// pad moves the voice page's faders, so a fader's sequencer moves around where the pad puts it ----
const XY_KEY = 'elixir-synth-xy', XY_IN = 16;
let mXY = (() => { try { const v = JSON.parse(localStorage.getItem(XY_KEY)); return Array.isArray(v) && v.every((n) => DR1.includes(n)) ? v : null; } catch (e) { return null; } })() || ['FILTER_FREQ_1', 'RESO_1'];
const xyFader = (pn) => mFaders.find((f) => f.key === `m-voice-${VP_PAGES.find(([, ps]) => ps.includes(pn))[0]}:${VP_LABEL[pn]}`);
{
  const card = $('m-xy-card');
  card.innerHTML = ['x', 'y'].map((ax) => `<div class="m-xyrow"><span>${ax === 'x' ? 'x →' : 'y ↑'}</span><select aria-label="pad ${ax === 'x' ? 'across' : 'up'}"></select></div>`).join('')
    + '<div class="m-xy" role="group"><span class="m-xy-x"></span><span class="m-xy-y"></span><i></i><output></output></div>';
  const sels = [...card.querySelectorAll('select')], pad = card.querySelector('.m-xy'), out = pad.querySelector('output');
  sels.forEach((s, k) => {
    for (const [name, ps] of VP_PAGES) {
      const og = document.createElement('optgroup'); og.label = name;
      for (const pn of ps) og.append(new Option(VP_LABEL[pn], pn));
      s.append(og);
    }
    s.value = mXY[k];
    s.addEventListener('change', () => { mXY[k] = s.value; try { localStorage.setItem(XY_KEY, JSON.stringify(mXY)); } catch (e) {} draw(); });
  });
  const fr = (f) => ((f.base !== null ? f.base : f.get()) - f.min) / ((f.hiOf() - f.min) || 1);
  const draw = () => {
    const X = xyFader(mXY[0]), Y = xyFader(mXY[1]);
    pad.querySelector('.m-xy-x').textContent = `${X.label} →`; pad.querySelector('.m-xy-y').textContent = `↑ ${Y.label}`;
    pad.setAttribute('aria-label', `x/y pad: ${X.label} across, ${Y.label} up`);
    pad.style.setProperty('--x', fr(X)); pad.style.setProperty('--y', fr(Y));
    out.textContent = `${X.label} ${X.show(X.get())}\n${Y.label} ${Y.show(Y.get())}`;
  };
  const at = (e) => {
    const r = pad.getBoundingClientRect(), X = xyFader(mXY[0]), Y = xyFader(mXY[1]);
    const val = (f, x) => f.min + Math.max(0, Math.min(1, x)) * (f.hiOf() - f.min);
    X.move(val(X, (e.clientX - r.left - XY_IN * mK) / (r.width - 2 * XY_IN * mK)));
    Y.move(val(Y, (r.bottom - XY_IN * mK - e.clientY) / (r.height - 2 * XY_IN * mK)));
    drawAll();
  };
  let held = false;
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); held = true; pad.classList.add('held'); at(e); });
  pad.addEventListener('pointermove', (e) => { if (held) at(e); });
  const end = () => { held = false; pad.classList.remove('held'); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  drawHooks.push(draw);
}

// ---- fx: the echo (ping pong, send, time on the musical lengths, tone, feedback, width) and the ring mod (send,
// carrier wave and frequency) ----
const fxF = (box, label, o) => mFader($(box), label, { show: String, ...o });
$('m-pp').addEventListener('change', () => setValue(PAR.FX_DELAY_TYPE, $('m-pp').checked ? 1 : 0));
drawHooks.push(() => { $('m-pp').checked = values[PAR.FX_DELAY_TYPE] === 1; });
fxF('m-echo', 'send', { min: 0, max: 100, get: () => fx.send, set: (v) => { fx.send = v; sendMix(); }, show: sendPct, dflt: 0 });
fxF('m-echo', 'time', { min: 0, max: 1000, get: () => Math.round(delayPos * 1000), set: (v) => setDelay(v / 1000), show: showDelay, dflt: Math.round(posOf(3 / 16) * 1000) });
fxF('m-echo', 'tone', { min: 0, max: 127, get: () => values[PAR.FX_P3], set: (v) => setValue(PAR.FX_P3, v), dflt: 90 });
fxF('m-echo', 'feedback', { min: 0, max: 127, get: () => values[PAR.FX_P4], set: (v) => setValue(PAR.FX_P4, v), dflt: 50 });
fxF('m-echo', 'width', { min: 0, max: 200, get: () => fx.width, set: (v) => { fx.width = v; sendMix(); }, show: (v) => v + '%', dflt: 100 });
// the reverb: send, then the firmware's four: predelay (1 to 46 ms), decay (its feedback; at the top it holds), tone (a
// tilt: in the middle it's flat, down darkens and damps the tail, up thins it) and early (the early reflections' level)
const preMs = (v) => Math.round(2031 * (0.02166 + v / 127 * 0.97784) / (LXR.REAL_FS / 1000)) + ' ms';
fxF('m-verb', 'send', { min: 0, max: 100, get: () => fx.verb, set: (v) => { fx.verb = v; sendMix(); }, show: sendPct, dflt: 0 });
[['predelay', 'vPre', preMs], ['decay', 'vDecay'], ['tone', 'vTone'], ['early', 'vEarly']].forEach(([l, k, show]) =>
  fxF('m-verb', l, { min: 0, max: 127, get: () => fx[k], set: (v) => { fx[k] = v; sendMix(); }, show: show || String, dflt: FX0[k] }));
const RING_W = OSC_WAVE_NAMES.map((n) => n.toLowerCase());
fxF('m-ring', 'send', { min: 0, max: 100, get: () => fx.ring, set: (v) => { fx.ring = v; sendMix(); }, show: sendPct, dflt: 0 });
fxF('m-ring', 'wave', { min: 0, max: RING_W.length - 1, get: () => fx.ringWave, set: (v) => { fx.ringWave = v; sendMix(); }, show: (v) => RING_W[v], dflt: 0 });
fxF('m-ring', 'freq', { min: 0, max: 127, get: () => fx.ringFreq, set: (v) => { fx.ringFreq = v; sendMix(); }, dflt: 40 });

// ---- master, in signal order: the distortion on the whole mix (mix 0 bypasses it; tube, fold or rat), then the compressor ----
const DIST_T = LXR.DIST_NAMES.map((n) => n.toLowerCase());
fxF('m-dist', 'mix', { min: 0, max: 100, get: () => dist.mix, set: (v) => { dist.mix = v; sendMix(); }, show: sendPct, dflt: 0 });
fxF('m-dist', 'type', { min: 0, max: DIST_T.length - 1, get: () => dist.type, set: (v) => { dist.type = v; sendMix(); }, show: (v) => DIST_T[v], dflt: 0 });
['drive', 'color', 'tone', 'volume'].forEach((l, i) => fxF('m-dist', l, { min: 0, max: 127, get: () => dist.p[i], set: (v) => { dist.p[i] = v; sendMix(); }, dflt: DIST0.p[i] }));
const mMaster = (label, key, lo, hi, step, show) => fxF('m-comp', label, { min: lo, max: hi, step, get: () => master[key], set: (v) => { master[key] = v; sendMix(); }, show, dflt: MASTER0[key] });
mMaster('threshold', 'thresh', -40, 0, 1, (v) => v + ' dB');
fxF('m-comp', 'ratio', { min: 0, max: RATIOS.length - 1, get: () => Math.max(0, RATIOS.indexOf(master.ratio)), set: (v) => { master.ratio = RATIOS[v]; sendMix(); }, show: (v) => RATIOS[v] + ':1', dflt: RATIOS.indexOf(MASTER0.ratio) });
mMaster('attack', 'attack', 1, 50, 1, (v) => v + ' ms');
mMaster('release', 'release', 20, 500, 10, (v) => v + ' ms');
mMaster('makeup', 'makeup', 0, 12, 1, (v) => '+' + v + ' dB');
$('m-comp-on').addEventListener('click', () => { master.comp = !master.comp; sendMix(); drawAll(); });
drawHooks.push(() => { $('m-comp-on').setAttribute('aria-pressed', master.comp); $('m-comp-on').textContent = master.comp ? 'on' : 'off'; $('m-comp').classList.toggle('off', !master.comp); });
// the gain reduction meter, from each step's reading
eventHandlers.push((ev) => {
  if (ev.type !== 'step') return;
  const d = Math.max(0, Math.min(20, ev.gr || 0));
  $('m-gr').style.width = (Math.log1p(d) / Math.log1p(20) * 100).toFixed(1) + '%'; $('m-gr-out').textContent = `${d.toFixed(1)} dB`;
});
stopHooks.push(() => { $('m-gr').style.width = '0%'; $('m-gr-out').textContent = '0.0 dB'; });

// ---- randomisers. Each keeps everything as it was for undo (one step back; a preset load clears it). With next bar
// ticked, while playing, a randomise's changes wait for the start of the next bar, its button flashing until then ----
let mUndoSnap = null;
const mUndoDraw = () => document.querySelectorAll('[data-undo]').forEach((b) => { b.disabled = !mUndoSnap; });
const mBarBtns = new Set();
function mRandomise(btn, fn) {
  startAudio();
  const was = snapshot();
  const bar = $('m-nextbar').checked && playing;
  if (bar) { barSync = true; mBarBtns.add(btn); btn.classList.add('pending'); }
  try { fn(); } finally { barSync = false; }
  mUndoSnap = was; mUndoDraw(); drawAll();
}
document.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => {
  if (!mUndoSnap) return;
  const s = mUndoSnap; mUndoSnap = null;
  const bar = $('m-nextbar').checked && playing;
  if (bar) barSync = true;
  try { useSnapshot(s, true); } finally { barSync = false; }
  mUndoDraw();
}));
eventHandlers.push((ev) => {
  if (ev.type !== 'step' || ev.step !== 0 || !mBarBtns.size) return;
  const bs = [...mBarBtns]; mBarBtns.clear();
  setTimeout(() => bs.forEach((b) => b.classList.remove('pending')), ctx && ctx.outputLatency ? ctx.outputLatency * 1000 : 0);
});
stopHooks.push(() => { mBarBtns.forEach((b) => b.classList.remove('pending')); mBarBtns.clear(); });
const NB_KEY = 'elixir-synth-nextbar';
try { $('m-nextbar').checked = localStorage.getItem(NB_KEY) === '1'; } catch (e) {}
$('m-nextbar').addEventListener('change', () => { try { localStorage.setItem(NB_KEY, $('m-nextbar').checked ? '1' : '0'); } catch (e) {} });

// sound: a new patch for the voice, in ranges that still play notes: the note (coarse) and the level and pan stay;
// mostly saw, square or pwm through a low-pass, now and then fm, a pitch blip, a click or the lfo on a parameter
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
function randomSound() {
  const set = (n, v) => setValue(PAR[n], Math.max(0, Math.min(spec(PAR[n]).max, Math.round(v))));
  const T = (name) => TARGETS.findIndex((i) => MOD_TARGETS[i][0] === name && i >= T0 && i <= T1);
  set('OSC_WAVE_DRUM1', pick([2, 2, 3, 5, 1, 0])); set('PWM_1', rIn(0, 127)); set('FINE1', 63);
  set('VELOA1', chance(0.7) ? rIn(0, 6) : rIn(6, 40)); set('VELOD1', rIn(30, 115)); set('VOL_SLOPE1', rIn(10, 90));
  const blip = chance(0.3);
  set('MODAMNT1', blip ? rIn(4, 40) : 0); set('MOD_EG1', rIn(5, 40)); set('PITCH_SLOPE1', rIn(0, 80));
  const fm = chance(0.35);
  set('FMAMNT1', fm ? rIn(5, 70) : 0); set('FM_FREQ1', pick([48, 60, 60, 67, 72, 79, 84]) + (chance(0.2) ? rIn(-3, 3) : 0));
  set('MOD_WAVE_DRUM1', pick([0, 0, 1, 2, 3])); set('MIX_MOD_1', chance(0.85) ? 0 : 1);
  set('TRANS1_WAVE', rIn(0, 13)); set('TRANS1_VOL', chance(0.25) ? rIn(10, 60) : 0); set('TRANS1_FREQ', rIn(20, 110));
  set('FILTER_TYPE_1', chance(0.75) ? 0 : pick([2, 6, 5])); set('FILTER_FREQ_1', rIn(35, 110)); set('RESO_1', rIn(0, 105)); set('FILTER_DRIVE_1', rIn(0, 60));
  set('VOICE_DECIMATION1', chance(0.1) ? rIn(40, 120) : 127); set('DRIVE1', rIn(40, 95));
  const lfo = chance(0.35);
  setValue(PAR.TARGET_LFO1, lfo ? TARGETS[pick([T('FILTER_F'), T('PWM'), T('FM_AMOUNT'), T('FILTER_RESO')].filter((i) => i > 0))] : 0);
  set('AMOUNT_LFO1', lfo ? rIn(10, 70) : 0); set('SYNC_LFO1', chance(0.6) ? rIn(3, 10) : 0); set('FREQ_LFO1', rIn(10, 90));
  set('WAVE_LFO1', rIn(0, 7)); set('RETRIGGER_LFO1', chance(0.5) ? 1 : 0); set('OFFSET_LFO1', rIn(0, 127));
}
// alter: every continuous parameter moved up to 10% of its range either way (menus, note, level and pan stay)
function alterSound(a = 0.1) {
  for (const pn of DR1) {
    const par = PAR[pn], sp = spec(par);
    if (sp.max < 20 || sp.idx || ['COARSE1', 'VOL1', 'PAN1', 'FINE1'].includes(pn)) continue;
    if (pn === 'MODAMNT1' && !values[par]) continue;
    setValue(par, Math.max(0, Math.min(sp.max, Math.round(values[par] + (rnd() * 2 - 1) * a * sp.max))));
  }
}
// random fx: the echo on (half the time) at a musical length, the reverb as often (a room to a long hall), the ring mod
// now and then; alter fx: each moved a little
function randomFx() {
  fx.send = chance(0.55) ? rIn(10, 60) : 0; fx.ring = chance(0.2) ? rIn(10, 60) : 0;
  fx.verb = chance(0.5) ? rIn(10, 55) : 0;
  fx.vPre = rIn(0, 90); fx.vDecay = rIn(70, 122); fx.vTone = rIn(30, 85); fx.vEarly = rIn(0, 127);
  setDelay(randomDelayPos());
  setValue(PAR.FX_DELAY_TYPE, chance(0.6) ? 1 : 0); setValue(PAR.FX_P3, rIn(40, 110)); setValue(PAR.FX_P4, chance(0.2) ? rIn(70, 105) : rIn(15, 70));
  fx.width = rIn(60, 160); fx.ringWave = rIn(0, RING_W.length - 1); fx.ringFreq = rIn(5, 120);
  sendMix();
}
function alterFx(a = 0.1) {
  const nudge = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v + (rnd() * 2 - 1) * a * (hi - lo))));
  if (fx.send) fx.send = nudge(fx.send, 1, 100);
  if (fx.ring) fx.ring = nudge(fx.ring, 1, 100);
  if (fx.verb) fx.verb = nudge(fx.verb, 1, 100);
  fx.vPre = nudge(fx.vPre, 0, 127); fx.vDecay = nudge(fx.vDecay, 0, 124); fx.vTone = nudge(fx.vTone, 8, 120); fx.vEarly = nudge(fx.vEarly, 0, 127);
  setDelay(Math.max(0, Math.min(1, delayPos + (rnd() * 2 - 1) * a / 2)));
  setValue(PAR.FX_P3, nudge(values[PAR.FX_P3], 0, 127)); setValue(PAR.FX_P4, nudge(values[PAR.FX_P4], 0, 110));
  fx.width = nudge(fx.width, 0, 200); fx.ringFreq = nudge(fx.ringFreq, 0, 127);
  sendMix();
}
$('m-everything').addEventListener('click', (e) => mRandomise(e.currentTarget, () => { randomSound(); randomNotes(); randomFx(); }));
$('m-sound').addEventListener('click', (e) => mRandomise(e.currentTarget, randomSound));
$('m-alter').addEventListener('click', (e) => mRandomise(e.currentTarget, () => alterSound()));
$('m-pattern').addEventListener('click', (e) => mRandomise(e.currentTarget, randomNotes));
for (const id of ['m-fxr', 'm-fxr2']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, randomFx));
for (const id of ['m-fxa', 'm-fxa2']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, () => alterFx()));

// the randomise popup: opens over the pages and stays open while its buttons are used (next bar's pending flash shows
// there); done, the opener again, or Escape closes it
function mRnd(on) { $('m-rnd').hidden = !on; $('m-rnd-open').setAttribute('aria-expanded', on); $('m-rnd-open').classList.toggle('on', on); if (on) mDepth(); }
$('m-rnd-open').addEventListener('click', () => mRnd($('m-rnd').hidden));
$('m-rnd-close').addEventListener('click', () => mRnd(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('m-rnd').hidden) mRnd(false); });

// ---- the glass isn't flat: each control's ink shadow deepens a little toward the top right of the screen (--d, used
// by the CSS), worked out from where it sits on its own page, and again when the screen's size changes ----
function mDepth() {
  const m = $('m').getBoundingClientRect();
  for (const el of document.querySelectorAll('.m-vf, .m-btn, .m-toggle, .m-pload, .m-tabs button, .m-xy, .m-chead, .m-title, .m-trans button, .m-seq-lenrow, .m-step')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const x = (((r.left + r.width / 2 - m.left) % m.width) + m.width) % m.width / m.width, y = (r.top + r.height / 2 - m.top) / m.height;
    el.style.setProperty('--d', (1 + 0.7 * Math.max(0, Math.min(1, x)) * Math.max(0, Math.min(1, 1 - y))).toFixed(2));
  }
}
addEventListener('resize', mDepth);
