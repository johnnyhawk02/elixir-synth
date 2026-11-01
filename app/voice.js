// ---- voice: every drum 1 parameter in four sections: tone (oscillator, fm), shape (amp eg, pitch envelope, click),
// filter (and the voice's mix) and mod (lfo and its target, velocity). The page has two tabs, each with two sections
// side by side in two rows of faders: tone and shape, filter and mod ----
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
// every drum 1 parameter, by page, for the randomisers
const DR1 = VP_PAGES.flatMap(([, ps]) => ps);
const VP_TABS = [['tone + shape', ['tone', 'shape']], ['filter + mod', ['filter', 'mod']]];
let mVSec = 0;
const mVBoxes = VP_TABS.map(([title, secs], k) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'm-btn'; b.setAttribute('role', 'tab'); b.textContent = title;
  b.addEventListener('click', () => { mVSec = k; mVoiceShow(); }); $('m-vsec').append(b);
  const tab = document.createElement('div'); tab.className = 'm-vtab'; $('m-vsets').append(tab);
  const cols = secs.map((name) => Math.ceil(VP_PAGES.find(([n]) => n === name)[1].length / 2));
  tab.style.gridTemplateColumns = cols.map((c) => `${c}fr`).join(' '); // (each section as wide as its columns)
  secs.forEach((name, j) => {
    const ps = VP_PAGES.find(([n]) => n === name)[1];
    const sec = document.createElement('div'); sec.className = 'm-vpart';
    const head = document.createElement('div'); head.className = 'm-fxhead'; head.innerHTML = '<b></b>'; head.firstChild.textContent = name;
    const box = document.createElement('div'); box.className = 'm-faders m-vset'; box.id = `m-voice-${name}`;
    box.style.gridTemplateColumns = `repeat(${cols[j]}, minmax(0, 1fr))`;
    sec.append(head, box); tab.append(sec);
    for (const pn of ps) {
      const par = PAR[pn], sp = spec(par);
      mFader(box, VP_LABEL[pn], { min: 0, max: sp.max, get: () => parGet(par), set: (x) => parSet(par, x), show: (x) => sp.show(x),
        dflt: () => (sp.idx ? Math.max(0, TARGETS.indexOf(factoryInit[par])) : factoryInit[par]) });
    }
  });
  return tab;
});
function mVoiceShow() {
  [...$('m-vsec').children].forEach((b, k) => b.setAttribute('aria-selected', k === mVSec));
  mVBoxes.forEach((tab, k) => { tab.hidden = k !== mVSec; });
}
mVoiceShow();
