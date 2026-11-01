// The audio thread: runs the engine's drum 1 voice as a mono synth, the note sequencer, the echo, reverb and ring mod
// sends, the distortion and compressor on the mix and the recorder, and resamples the engine's rate to the output's.
// Used inside the AudioWorklet (or a ScriptProcessor fallback).
// the tempo-synced echo: 1/128 of a bar at 0, a whole bar at 1, evenly in octaves between
const delaySamples = (pos, bpm) => 240 / bpm * Math.pow(2, -7 * (1 - pos)) * LXR.REAL_FS;
const RING_MAKEUP = 3;
// a step's gate: 0 rests, 1 to 4 close after a quarter to all of the step, 5 lets the note ring out
const GATE_RING = 5;
class Player {
  constructor(outRate) {
    this.e = new LXR.LxrEngine();
    this.e.loadInitKit();
    this.ratio = LXR.REAL_FS / outRate;
    this.A = [new Float32Array(64), new Float32Array(64)];
    this.B = [new Float32Array(64), new Float32Array(64)];
    this.idx = 0; this.frac = 0;
    // the sequence: 16 steps a page (up to 4 pages) of { n: semitones from middle C, gate, acc, slide }
    this.steps = Array.from({ length: 16 }, () => ({ n: 0, gate: 0, acc: false, slide: false }));
    this.playing = false; this.bpm = 120; this.vel = 100; this.accGain = 0.5; this.glide = 0.35;
    this.step = 0; this.bar = 0; this.toNext = 0; this.atBar = []; this.clock = 0;
    // pitch: the perf page's pitch, in semitones (hundredths), added to every note
    this.pitch = 0;
    // the note sounding (in semitones from middle C, before pitch), where a slide has it now (cur), its slide and where its gate closes
    this.note = 0; this.cur = 0; this.slideFrom = null; this.slideAt = 0; this.slideLen = 1; this.cutAt = Infinity;
    // the voice's gain: the accent (an unaccented note is turned down by the accent amount) times the gate
    this.gain = 1; this.gainTo = 1; this.gate = 1;
    this.rec = null;
    // the master: the distortion as an insert on the mix, then a compressor, the same design as the LXR-02's FX compressor
    this.master = { comp: true, thresh: -12, ratio: 3, attack: 5, release: 120, makeup: 0 };
    // the echo is the engine's own FX bus (the firmware's delay, tempo-synced, all wet as a send); the ring mod a send bus
    this.delayPos = 1 + Math.log2(3 / 16) / 7;
    this.dist = new LXR.FxBus(); this.dist.fxType = LXR.FX_DISTORTION; this.dist.forceWet = true;
    this.ring = new LXR.FxBus(); this.ring.fxType = LXR.FX_RING; this.ring.forceWet = true;
    // the reverb: the firmware's own (compiled out of the LXR-02, switched back on in the engine), a send bus
    this.verb = new LXR.FxBus(); this.verb.fxType = LXR.FX_REVERB; this.verb.forceWet = true;
    this.fxRng = new LXR.Rng(0x2545f491);
    this.sendE = 0; this.sendR = 0; this.sendV = 0; this.verbQuiet = 256; this.echoWidth = 1; this.fxGain = new Float32Array(6);
    this.distMix = 0; this.distAt = 0;
    this.busIn = new Float32Array(128); this.busOut = new Int16Array(128);
    this.compEnv = 0; this.gr = 0;
    this.events = [];
    this._render(this.A); this._render(this.B);
  }
  msg(m) {
    if (m.type === 'param') this.e.setParam(m.par, m.value);
    else if (m.type === 'kit') this.e.loadKit(m.values);
    else if (m.type === 'pitch') { this.pitch = m.v; this.setPitch(this.cur); }
    else if (m.type === 'note') this.play(m.n, m.acc, m.gate, false);
    else if (m.type === 'delay') this.delayPos = m.pos;
    else if (m.type === 'atBar') { if (this.playing) this.atBar.push(m.m); else this.msg(m.m); }
    else if (m.type === 'mix') {
      Object.assign(this.master, m.master);
      this.dist.distortion.type = m.dist.type;
      m.dist.p.forEach((v, i) => this.dist.setParameter(i, v / 127));
      this.distMix = (m.dist.mix || 0) / 100;
      this.ring.ringmod.osc.waveform = m.ring.wave;
      this.ring.setParameter(0, m.ring.freq / 127);
      if (m.verb) m.verb.forEach((v, i) => this.verb.setParameter(i, v / 127));
      this.sendE = m.sendE; this.sendR = m.sendR; this.sendV = m.sendV || 0; this.echoWidth = m.width / 100;
    } else if (m.type === 'rec') {
      this.rec = { L: new Float32Array(16384), R: new Float32Array(16384), n: 0 };
      this.events.push({ type: 'rec', state: 'on' });
    } else if (m.type === 'recStop') { if (this.rec) this.recEnd(); }
    else if (m.type === 'seq') {
      // a live change wins over one still waiting for the bar
      this.atBar = this.atBar.filter((q) => q.type !== 'seq');
      this.steps = m.steps; this.bpm = m.bpm; this.e.bpm = m.bpm; this.vel = m.vel; this.glide = m.glide;
      this.accGain = Math.pow(10, -m.accentDb / 20);
      if (m.playing && !this.playing) { this.step = 0; this.bar = 0; this.toNext = 0; this.cutAt = Infinity; this.slideFrom = null; }
      this.playing = m.playing;
      if (!this.playing) { this.flushBar(); this.cutAt = this.clock; }
    }
  }
  recFlush() {
    const r = this.rec;
    if (r.n) this.events.push({ type: 'recData', L: r.L.slice(0, r.n), R: r.R.slice(0, r.n) });
    r.n = 0;
  }
  recEnd() { this.recFlush(); this.events.push({ type: 'rec', state: 'done', bpm: this.bpm }); this.rec = null; }
  // a preset (or a randomise) waiting for the bar: its messages come in on the first step of the next one
  flushBar() {
    const q = this.atBar; this.atBar = [];
    for (const m of q) this.msg(m.type === 'seq' ? { ...m, playing: this.playing } : m);
  }
  // the voice to semitone n (from middle C) plus pitch, without a retrigger: a whole note is set exactly as a trigger sets it
  setPitch(n) { this.e.setDrumPitch(0, Math.max(0, Math.min(127, 60 + n + this.pitch))); }
  // a note: a trigger on its whole semitone, then (only if pitch puts it between semitones) the rest of the way.
  // slide: glide there from the note sounding instead, without a retrigger
  play(n, acc, gate, slide) {
    if (slide) { this.slideFrom = this.cur; this.slideAt = 0; }
    else {
      this.slideFrom = null;
      const p = Math.max(0, Math.min(127, 60 + n + this.pitch)), base = Math.floor(p);
      this.e.trigger(0, acc ? 127 : this.vel, base);
      if (p !== base) this.e.setDrumPitch(0, p);
      this.gainTo = acc ? 1 : this.accGain; this.gate = 1; this.cur = n;
    }
    this.note = n;
    const len = LXR.REAL_FS * 60 / this.bpm / 4;
    this.slideLen = Math.max(64, this.glide * len);
    this.cutAt = gate >= GATE_RING ? Infinity : this.clock + gate / 4 * len;
  }
  // step s (of all the pages): its note, slid into from the step before when that one slides and both play; a step that slides on
  // keeps its gate open into the next
  doStep(s) {
    const S = this.steps, N = S.length, cur = S[s], prev = S[(s + N - 1) % N], next = S[(s + 1) % N];
    if (!cur.gate) return;
    const slideIn = prev.slide && prev.gate > 0 && this.cutAt === Infinity && this.gate > 0;
    this.play(cur.n, cur.acc, cur.slide && next.gate ? GATE_RING : cur.gate, slideIn);
    if (slideIn && cur.acc) this.gainTo = 1;
  }
  _render(dst) {
    if (this.playing) {
      if (this.toNext <= 0) {
        if (this.step === 0 && this.atBar.length) this.flushBar();
        const len = LXR.REAL_FS * 60 / this.bpm / 4;
        // the pages play in turn, a bar each
        const page = this.bar % Math.max(1, this.steps.length / 16);
        this.doStep(page * 16 + this.step);
        this.events.push({ type: 'step', step: this.step, page, bar: this.bar, gr: this.gr });
        this.gr = 0;
        this.step = (this.step + 1) % 16;
        if (this.step === 0) this.bar++;
        this.toNext += len;
      }
      this.toNext -= 64;
    }
    // a slide: the pitch glides from the note before over the glide time
    if (this.slideFrom !== null) {
      this.slideAt += 64;
      const k = Math.min(1, this.slideAt / this.slideLen);
      this.cur = this.slideFrom + (this.note - this.slideFrom) * k;
      this.setPitch(this.cur);
      if (k >= 1) { this.slideFrom = null; this.cur = this.note; }
    }
    // the gate closes: the voice fades out over three blocks (about 4 ms)
    if (this.clock >= this.cutAt) this.gate = Math.max(0, this.gate - 0.34);
    this.clock += 64;
    const out = this.e.renderBlock(), e = this.e, v = e.drums[0];
    const [L, R] = dst;
    const isDelay = e.fx.fxType === LXR.FX_DELAY;
    e.fx.forceWet = isDelay;
    e.fx.setDelaySync(isDelay ? delaySamples(this.delayPos, this.bpm) : null);
    // the voice, its gain ramped over the block
    const g0 = this.gain, g1 = this.gainTo * this.gate, dg = (g1 - g0) / 64;
    const pl = v.triggeredPanL / 32768, pr = v.triggeredPanR / 32768, o = out[0];
    for (let i = 0; i < 64; i++) { const s = o[i] * (g0 + dg * i); L[i] = s * pl; R[i] = s * pr; }
    this.gain = g1;
    // the echo: the firmware's FX bus, sample-exact, fed at the echo send when the voice is routed to it
    this.fxGain[0] = e.audioRouting[0] === LXR.MIXER_ROUTING_FX_BUS ? g1 * this.sendE : 0;
    const fx = e.renderFx(this.fxGain, this.echoWidth);
    // the ring mod and reverb buses: the voice at each one's send, saturated to int16; the firmware's ring mod carrier
    // is quiet, so it gets makeup gain. The reverb runs every block, sent to or not, so its tail rings out
    const bi = this.busIn, bo = this.busOut;
    const busFeed = (bus, gain) => {
      for (let i = 0; i < 64; i++) {
        bi[2 * i] = gain ? Math.max(-32768, Math.min(32767, Math.round(o[i] * v.triggeredPanL * gain))) : 0;
        bi[2 * i + 1] = gain ? Math.max(-32768, Math.min(32767, Math.round(o[i] * v.triggeredPanR * gain))) : 0;
      }
      bus.input.set(bi); bo.fill(0);
      bus.process(bo, 64, this.fxRng);
    };
    busFeed(this.ring, this.sendR * g1);
    for (let i = 0; i < 64; i++) {
      L[i] += (bo[2 * i] * RING_MAKEUP + fx[2 * i]) / 32768; R[i] += (bo[2 * i + 1] * RING_MAKEUP + fx[2 * i + 1]) / 32768;
    }
    // (once nothing is sent and its tail has been silent for a while, it rests until something is sent again)
    const vg = this.sendV * g1;
    if (vg || this.verbQuiet < 256) {
      busFeed(this.verb, vg);
      let quiet = !vg;
      for (let i = 0; i < 64; i++) { L[i] += bo[2 * i] / 32768; R[i] += bo[2 * i + 1] / 32768; if (bo[2 * i]) quiet = false; }
      this.verbQuiet = quiet ? this.verbQuiet + 1 : 0;
    }
    // the distortion, a master insert: the whole mix through the firmware's distortion, blended in at its mix amount,
    // ramped across the block; at 0 it's bypassed
    if (this.distMix || this.distAt) {
      const di = this.dist.input;
      for (let i = 0; i < 64; i++) { di[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32768))); di[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32768))); }
      bo.fill(0);
      this.dist.process(bo, 64, this.fxRng);
      const m0 = this.distAt, m1 = this.distMix;
      for (let i = 0; i < 64; i++) { const m = m0 + (m1 - m0) * (i + 1) / 64; L[i] += (bo[2 * i] / 32768 - L[i]) * m; R[i] += (bo[2 * i + 1] / 32768 - R[i]) * m; }
      this.distAt = m1;
    }
    const M = this.master;
    if (M.comp) {
      // peak detector in dB, attack/release smoothing, gain = over * (1/ratio - 1) + makeup
      const ca = Math.exp(-1000 / (M.attack * LXR.REAL_FS)), cr = Math.exp(-1000 / (M.release * LXR.REAL_FS));
      const slope = 1 / M.ratio - 1, mk = Math.pow(10, M.makeup / 20);
      let env = this.compEnv, gr = this.gr;
      for (let i = 0; i < 64; i++) {
        const peak = Math.max(Math.abs(L[i]), Math.abs(R[i])) + 1e-9;
        const over = Math.max(0, 20 * Math.log10(peak) - M.thresh);
        env = over + (over > env ? ca : cr) * (env - over);
        const g = Math.pow(10, env * slope / 20) * mk;
        L[i] *= g; R[i] *= g;
        gr = Math.max(gr, -env * slope);
      }
      this.compEnv = env; this.gr = gr;
    }
    // the recorder takes the finished mix at the engine's own rate
    const r = this.rec;
    if (r) { r.L.set(L, r.n); r.R.set(R, r.n); r.n += 64; if (r.n === r.L.length) this.recFlush(); }
  }
  process(L, R) {
    for (let n = 0; n < L.length; n++) {
      while (this.idx >= 64) {
        const t = this.A; this.A = this.B; this.B = t;
        this._render(this.B);
        this.idx -= 64;
      }
      const i = this.idx, fr = this.frac;
      const l0 = this.A[0][i], r0 = this.A[1][i];
      const l1 = i < 63 ? this.A[0][i + 1] : this.B[0][0];
      const r1 = i < 63 ? this.A[1][i + 1] : this.B[1][0];
      L[n] = l0 + (l1 - l0) * fr;
      R[n] = r0 + (r1 - r0) * fr;
      this.frac += this.ratio;
      const k = Math.floor(this.frac);
      this.idx += k; this.frac -= k;
    }
  }
}
