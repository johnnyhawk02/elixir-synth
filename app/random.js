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
  whenHeard(() => bs.forEach((b) => b.classList.remove('pending')));
});
stopHooks.push(() => { mBarBtns.forEach((b) => b.classList.remove('pending')); mBarBtns.clear(); });
storedCheck('m-nextbar', 'elixir-synth-nextbar', false);

// sound: a new patch for the voice, in ranges that still play notes: the note (coarse) and the level and pan stay;
// mostly saw, square or pwm through a low-pass, now and then fm, a pitch blip, a click or the lfo on a parameter. One
// part per section of the voice page, so each section can be randomised on its own
const rSet = (n, v) => setValue(PAR[n], Math.max(0, Math.min(spec(PAR[n]).max, Math.round(v))));
const RANDOM_VOICE = {
  tone() {
    rSet('OSC_WAVE_DRUM1', pick([2, 2, 3, 5, 1, 0])); rSet('PWM_1', rIn(0, 127)); rSet('FINE1', 63);
    const fm = chance(0.35);
    rSet('FMAMNT1', fm ? rIn(5, 70) : 0); rSet('FM_FREQ1', pick([48, 60, 60, 67, 72, 79, 84]) + (chance(0.2) ? rIn(-3, 3) : 0));
    rSet('MOD_WAVE_DRUM1', pick([0, 0, 1, 2, 3])); rSet('MIX_MOD_1', chance(0.85) ? 0 : 1);
  },
  shape() {
    rSet('VELOA1', chance(0.7) ? rIn(0, 6) : rIn(6, 40)); rSet('VELOD1', rIn(30, 115)); rSet('VOL_SLOPE1', rIn(10, 90));
    const blip = chance(0.3);
    rSet('MODAMNT1', blip ? rIn(4, 40) : 0); rSet('MOD_EG1', rIn(5, 40)); rSet('PITCH_SLOPE1', rIn(0, 80));
    rSet('TRANS1_WAVE', rIn(0, 13)); rSet('TRANS1_VOL', chance(0.25) ? rIn(10, 60) : 0); rSet('TRANS1_FREQ', rIn(20, 110));
  },
  filter() {
    rSet('FILTER_TYPE_1', chance(0.75) ? 0 : pick([2, 6, 5])); rSet('FILTER_FREQ_1', rIn(35, 110)); rSet('RESO_1', rIn(0, 105)); rSet('FILTER_DRIVE_1', rIn(0, 60));
    rSet('VOICE_DECIMATION1', chance(0.1) ? rIn(40, 120) : 127); rSet('DRIVE1', rIn(40, 95));
  },
  mod() {
    const T = (name) => TARGETS.findIndex((i) => MOD_TARGETS[i][0] === name && i >= T0 && i <= T1);
    const lfo = chance(0.35);
    setValue(PAR.TARGET_LFO1, lfo ? TARGETS[pick([T('FILTER_F'), T('PWM'), T('FM_AMOUNT'), T('FILTER_RESO')].filter((i) => i > 0))] : 0);
    rSet('AMOUNT_LFO1', lfo ? rIn(10, 70) : 0); rSet('SYNC_LFO1', chance(0.6) ? rIn(3, 10) : 0); rSet('FREQ_LFO1', rIn(10, 90));
    rSet('WAVE_LFO1', rIn(0, 7)); rSet('RETRIGGER_LFO1', chance(0.5) ? 1 : 0); rSet('OFFSET_LFO1', rIn(0, 127));
  } };
function randomSound() { Object.values(RANDOM_VOICE).forEach((f) => f()); }
// alter: every continuous parameter (of the voice, or of the parameters given) moved up to 10% of its range either way
// (menus, note, level and pan stay)
function alterSound(a = 0.1, pns = DR1) {
  for (const pn of pns) {
    const par = PAR[pn], sp = spec(par);
    if (sp.max < 20 || sp.idx || ['COARSE1', 'VOL1', 'PAN1', 'FINE1'].includes(pn)) continue;
    if (pn === 'MODAMNT1' && !values[par]) continue;
    setValue(par, Math.max(0, Math.min(sp.max, Math.round(values[par] + (rnd() * 2 - 1) * a * sp.max))));
  }
}
// random fx: the echo on (half the time) at a musical length, the reverb as often (a room to a long hall), the ring mod
// now and then; alter fx: each moved a little
// (one part per effect, so the fx page can randomise each on its own)
const RANDOM_FX = {
  echo() {
    fx.send = chance(0.55) ? rIn(10, 60) : 0;
    setDelay(randomDelayPos());
    setValue(PAR.FX_DELAY_TYPE, chance(0.6) ? 1 : 0); setValue(PAR.FX_P3, rIn(40, 110)); setValue(PAR.FX_P4, chance(0.2) ? rIn(70, 105) : rIn(15, 70));
    fx.width = rIn(60, 160);
  },
  reverb() { fx.verb = chance(0.5) ? rIn(10, 55) : 0; fx.vPre = rIn(0, 90); fx.vDecay = rIn(70, 122); fx.vTone = rIn(30, 85); fx.vEarly = rIn(0, 127); },
  ring() { fx.ring = chance(0.2) ? rIn(10, 60) : 0; fx.ringWave = rIn(0, RING_W.length - 1); fx.ringFreq = rIn(5, 120); } };
function randomFx() { Object.values(RANDOM_FX).forEach((f) => f()); sendMix(); }
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
for (const id of ['m-alter', 'm-valter']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, () => alterSound()));
$('m-vrand').addEventListener('click', (e) => mRandomise(e.currentTarget, randomSound));
// the voice page's section randomisers: one section new, and its tab shown so the change can be seen
for (const b of document.querySelectorAll('[data-vrand]')) b.addEventListener('click', (e) => {
  const sec = b.dataset.vrand;
  mVSec = VP_TABS.findIndex(([, secs]) => secs.includes(sec)); mVoiceShow();
  mRandomise(e.currentTarget, RANDOM_VOICE[sec]);
});
$('m-pattern').addEventListener('click', (e) => mRandomise(e.currentTarget, randomNotes));
for (const b of document.querySelectorAll('[data-fxrand]')) b.addEventListener('click', (e) => mRandomise(e.currentTarget, () => { RANDOM_FX[b.dataset.fxrand](); sendMix(); }));
for (const id of ['m-fxr', 'm-fxr2']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, randomFx));
for (const id of ['m-fxa', 'm-fxa2']) $(id).addEventListener('click', (e) => mRandomise(e.currentTarget, () => alterFx()));

// the randomise popup: opens over the pages and stays open while its buttons are used (next bar's pending flash shows
// there); done, the opener again, or Escape closes it
function mRnd(on) { $('m-rnd').hidden = !on; $('m-rnd-open').setAttribute('aria-expanded', on); $('m-rnd-open').classList.toggle('on', on); if (on) mDepth(); }
$('m-rnd-open').addEventListener('click', () => mRnd($('m-rnd').hidden));
$('m-rnd-close').addEventListener('click', () => mRnd(false));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('m-rnd').hidden) mRnd(false); });
