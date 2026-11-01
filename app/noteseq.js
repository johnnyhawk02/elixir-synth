// ---- the seq page: the note sequencer. Four pages of sixteen steps, played in turn a bar each; the page tabs pick
// the page shown (the one playing is underlined), and copy puts the page shown onto the next one; oct - and
// oct + move the whole sequence an octave. A page's steps sit in one line of sixteen: a step's height is its note,
// two octaves of the scale (a touch on a resting step brings it on), and the A and S under it switch its accent and
// slide (tap, or drag along the row). Under the notes, a lane of the steps' gate times: bottom rests, then a quarter
// to all of the step, top rings. Under that: root, scale, accent, density (thins the playing steps, off-beats first), glide and algo, and random, alter, undo ----
let nsPage = 0;
const nsStep = (i) => seq.steps[nsPage * 16 + i];
const nsCells = Array.from({ length: 16 }, (_, i) => {
  const c = document.createElement('div'); c.className = 'm-step'; c.dataset.i = i; c.setAttribute('role', 'gridcell');
  c.innerHTML = '<span class="m-sn"></span><i class="m-sbar"></i><span class="m-sm"><b class="a" role="button" aria-label="accent">A</b><b class="s" role="button" aria-label="slide">S</b></span>';
  $('m-steps').append(c); return c;
});
const GATE_NAMES = ['rest', '¼', '½', '¾', 'full', 'ring'];
const nsGates = Array.from({ length: 16 }, (_, i) => {
  const c = document.createElement('div'); c.className = 'm-step m-gstep'; c.dataset.i = i; c.setAttribute('role', 'gridcell');
  c.innerHTML = '<i class="m-sbar"></i><span class="m-sn"></span>';
  $('m-gates').append(c); return c;
});
function nsDraw() {
  const thin = thinned();
  nsCells.forEach((c, i) => {
    const st = nsStep(i);
    c.classList.toggle('thin', thin[nsPage * 16 + i]); nsGates[i].classList.toggle('thin', thin[nsPage * 16 + i]);
    c.querySelector('.m-sn').textContent = st.gate ? noteName(stepNote(st)) : '—';
    c.style.setProperty('--f', (Math.min(st.d, degMax()) + 1) / (degMax() + 1));
    c.classList.toggle('rest', !st.gate); c.classList.toggle('acc', st.acc); c.classList.toggle('slide', st.slide);
    c.setAttribute('aria-label', `step ${i + 1}: ${st.gate ? noteName(stepNote(st)) : 'rest'}${st.acc ? ', accent' : ''}${st.slide ? ', slide' : ''}`);
    const g = nsGates[i];
    g.style.setProperty('--f', st.gate / 5); g.classList.toggle('rest', !st.gate);
    g.querySelector('.m-sn').textContent = GATE_NAMES[st.gate];
    g.setAttribute('aria-label', `step ${i + 1} gate: ${GATE_NAMES[st.gate]}`);
  });
  document.querySelectorAll('#m-npages [data-page]').forEach((b) => b.setAttribute('aria-selected', +b.dataset.page === nsPage));
  $('m-ncopy').textContent = `copy to ${Math.min(nsPage + 2, PAGES)}`; $('m-ncopy').disabled = nsPage >= PAGES - 1;
  $('m-noct-out').textContent = seq.oct > 0 ? `+${seq.oct}` : String(seq.oct);
  $('m-noct-dn').disabled = seq.oct <= OCT_MIN; $('m-noct-up').disabled = seq.oct >= OCT_MAX;
}
drawHooks.push(nsDraw);
$('m-npages').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { nsPage = +b.dataset.page; nsDraw(); nsNow(); } });
// octave down and up: the whole sequence, every page
const nsOct = (k) => { seq.oct = Math.max(OCT_MIN, Math.min(OCT_MAX, seq.oct + k)); sendSeq(); nsDraw(); };
$('m-noct-dn').addEventListener('click', () => nsOct(-1));
$('m-noct-up').addEventListener('click', () => nsOct(1));
// hear a note as it's set, while stopped
function nsHear(st) { if (!playing && st.gate) { startAudio(); send({ type: 'note', n: degSemis(st.d), acc: st.acc, gate: st.gate }); } }
// a row of sixteen that a touch, or a drag across, edits: what(i, y, first) changes step i (y from 0 at the bottom to
// 1 at the top) and says whether to play it
function nsLane(box, what) {
  let on = false;
  const at = (e, first) => {
    const r = box.getBoundingClientRect();
    const i = Math.max(0, Math.min(15, Math.floor((e.clientX - r.left) / r.width * 16)));
    const cr = box.children[i].getBoundingClientRect();
    const y = Math.max(0, Math.min(1, (cr.bottom - e.clientY) / cr.height));
    const hear = what(i, y, first, e);
    if (hear === null) return;
    if (hear || first) nsHear(nsStep(i));
    sendSeq(); nsDraw();
  };
  box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); on = true; at(e, true); });
  box.addEventListener('pointermove', (e) => { if (on) at(e, false); });
  const stop = () => { on = false; };
  box.addEventListener('pointerup', stop); box.addEventListener('pointercancel', stop);
}
// the notes; a touch that starts on an A or S switches that, and a drag along the row sets the others the same
{
  let flag = null;
  nsLane($('m-steps'), (i, y, first, e) => {
    const st = nsStep(i);
    if (first) { const b = e.target.closest('.m-sm b'); flag = b ? { k: b.classList.contains('a') ? 'acc' : 'slide', to: null, seen: new Set() } : null; }
    if (flag) {
      if (flag.seen.has(i)) return null;
      if (flag.to === null) flag.to = !st[flag.k];
      flag.seen.add(i); st[flag.k] = flag.to;
      return false;
    }
    const d = Math.min(degMax(), Math.floor(y * (degMax() + 1)));
    if (d !== st.d || !st.gate) { st.d = d; if (!st.gate) st.gate = 4; return true; }
    return first ? false : null;
  });
}
// the gate times
nsLane($('m-gates'), (i, y, first) => {
  const st = nsStep(i), g = Math.min(5, Math.floor(y * 6));
  if (g !== st.gate) { st.gate = g; return true; }
  return first ? false : null;
});
// the step playing (if its page is shown) and its page, marked as they're heard
let nsAt = null;
function nsNow() {
  nsCells.forEach((c, i) => c.classList.toggle('now', !!nsAt && nsAt.page === nsPage && i === nsAt.step));
  document.querySelectorAll('#m-npages [data-page]').forEach((b) => b.classList.toggle('now', !!nsAt && +b.dataset.page === nsAt.page));
}
eventHandlers.push((ev) => {
  if (ev.type !== 'step') return;
  setTimeout(() => { if (playing) { nsAt = ev; nsNow(); } }, ctx && ctx.outputLatency ? ctx.outputLatency * 1000 : 0);
});
stopHooks.push(() => { nsAt = null; nsNow(); });

const ROOTS = NOTE_NAMES;
mFader($('m-seqf'), 'root', { min: 0, max: 11, get: () => seq.root, set: (v) => { seq.root = v; sendSeq(); nsDraw(); }, show: (v) => ROOTS[v], dflt: 0 });
mFader($('m-seqf'), 'scale', { min: 0, max: SCALES.length - 1, get: () => seq.scale, set: (v) => { seq.scale = v; sendSeq(); nsDraw(); }, show: (v) => SCALES[v][0], dflt: SEQ0.scale });
mFader($('m-seqf'), 'accent', { min: 0, max: 12, get: () => seq.accent, set: (v) => { seq.accent = v; sendSeq(); }, show: (v) => `+${v}dB`, dflt: SEQ0.accent });
mFader($('m-seqf'), 'density', { min: 0, max: 100, step: 5, get: () => seq.density, set: (v) => { seq.density = v; sendSeq(); nsDraw(); }, show: (v) => v + '%', dflt: 100 });
mFader($('m-seqf'), 'glide', { min: 0, max: 100, step: 5, get: () => seq.glide, set: (v) => { seq.glide = v; sendSeq(); }, show: (v) => v + '%', dflt: SEQ0.glide });

// random: a new line for a page, made by the algorithm picked on the algo fader (kept in the preset). Each makes 16
// steps of { d: degree of the scale, gate, acc, slide }, so whatever it makes stays in the key
const st = (d, gate, acc = false, slide = false) => ({ d: Math.max(0, Math.min(degMax(), d)), gate, acc, slide });
const euclid = (k, rot) => Array.from({ length: 16 }, (_, i) => ((i + rot) * k) % 16 < k);
const SEQ_ALGOS = [
  // 1 dice: each step on its own: mostly the root and the notes near it, now and then an octave up; about one step in
  // five rests, one in five accented and one in six sliding
  ['dice', (n) => {
    const near = [0, 0, 0, 1, 2, 2, 3, 4, 4, n - 1, n - 2].map((d) => (d + n) % n);
    return Array.from({ length: 16 }, (_, i) => {
      let d = pick(near);
      if (chance(0.18)) d += n;
      if (chance(0.06)) d += n;
      return st(d, i && chance(0.22) ? 0 : pick([2, 3, 4, 4, 5]), chance(0.2), chance(0.17));
    });
  }],
  // 2 acid: a 303 line: the root and its octave, now and then the fifth or the seventh, short notes, lots of slides
  // and accents, few rests
  ['acid', (n) => Array.from({ length: 16 }, (_, i) => {
    const d = pick([0, 0, 0, n, n, 4 % n, n - 1, n + 2]);
    return st(d, i && chance(0.15) ? 0 : pick([1, 2, 2, 3]), chance(0.35), chance(0.3));
  })],
  // 3 euclid: hits spread as evenly as they go (5 to 11 in 16, turned round), playing a three-note cell over them
  ['euclid', (n) => {
    const hits = euclid(rIn(5, 11), rIn(0, 15)), cell = [0, pick([2, 4, n - 1]), pick([1, 3, n])];
    let k = 0;
    return hits.map((h, i) => (h || i === 0 ? st(cell[k++ % 3], pick([2, 3, 4]), i % 4 === 0, false) : st(0, 0)));
  }],
  // 4 arp: the chord (root, third, fifth, octave) up, down or up and down, every step, the beat accented
  ['arp', (n) => {
    const tones = [0, 2, 4, n], order = pick(['up', 'down', 'updown']);
    const seqd = order === 'up' ? tones : order === 'down' ? tones.slice().reverse() : [...tones, tones[2], tones[1]];
    const oct = chance(0.4) ? n : 0;
    return Array.from({ length: 16 }, (_, i) => st(seqd[i % seqd.length] + (i >= 8 ? oct : 0), pick([2, 2, 3]), i % 4 === 0, false));
  }],
  // 5 walk: from the root, each note a step or two up or down the scale from the last; a step slides into its
  // neighbour now and then; a few rests
  ['walk', (n) => {
    let d = pick([0, n]);
    return Array.from({ length: 16 }, (_, i) => {
      if (i) d = Math.max(0, Math.min(2 * n, d + pick([-2, -1, -1, 1, 1, 2, 0])));
      return st(d, i && chance(0.15) ? 0 : pick([3, 4, 4]), chance(0.15), chance(0.2));
    });
  }],
  // 6 motif: a four-step idea, then it again, then moved up the scale, then a changed ending that comes home to
  // the root (A A A' B)
  ['motif', (n) => {
    const A = Array.from({ length: 4 }, (_, i) => st(i === 0 ? 0 : pick([0, 1, 2, 4, n - 1]), i && chance(0.25) ? 0 : pick([2, 3, 4]), i === 0, chance(0.15)));
    const up = pick([1, 2, 4]);
    const B = A.map((x, i) => (i < 2 ? { ...x } : st(i === 3 ? 0 : pick([1, 2, 4]), pick([3, 4, 5]), i === 3, false)));
    return [...A, ...A.map((x) => ({ ...x })), ...A.map((x) => ({ ...x, d: x.d + up })), ...B];
  }],
  // 7 groove: a bass groove: the root on a syncopated rhythm (3+3+2, or one like it), the octave or fifth on the
  // offbeats between, and quiet ghost notes
  ['groove', (n) => {
    const rhythm = pick([[0, 3, 6, 8, 11, 14], [0, 3, 6, 10, 12], [0, 2, 3, 6, 8, 10, 11, 14], [0, 4, 7, 10, 12, 14]]);
    return Array.from({ length: 16 }, (_, i) => {
      if (rhythm.includes(i)) return st(i % 8 === 0 ? 0 : pick([0, 0, n, 4 % n]), pick([2, 3]), i % 8 === 0 || chance(0.25), chance(0.1));
      return chance(0.25) ? st(pick([0, n, 4 % n]), 1, false, false) : st(0, 0);
    });
  }],
  // 8 phrase: a slow tune: longer notes that ring, mostly moving by step, a breath (rest) now and then, ending on
  // the root
  ['phrase', (n) => {
    const out = [];
    let d = pick([0, 2, 4]);
    while (out.length < 16) {
      const len = Math.min(16 - out.length, pick([2, 2, 3, 4]));
      if (out.length + len >= 16) d = pick([0, n]);
      out.push(st(d, 5, out.length % 8 === 0, chance(0.25)));
      for (let k = 1; k < len; k++) out.push(st(d, 0));
      if (chance(0.2) && out.length < 15) out.push(st(0, 0));
      d = Math.max(0, Math.min(2 * n, d + pick([-2, -1, -1, 1, 1, 2, 3])));
    }
    return out.slice(0, 16);
  }]];
function randomPage(pg) {
  const n = SCALES[seq.scale][1].length;
  const algo = SEQ_ALGOS[seq.algo] || SEQ_ALGOS[0];
  algo[1](n).forEach((x, i) => { seq.steps[pg * 16 + i] = x; });
}
// alter: k steps of a page changed a little: a note a step or two up or down the scale, a rest played or a note
// rested, an accent or a slide switched
function alterPage(pg, k = rIn(2, 4)) {
  for (let j = 0; j < k; j++) {
    const st = seq.steps[pg * 16 + rIn(0, 15)], what = rIn(0, 3);
    if (what === 0 || (what === 1 && !st.gate)) { st.d = Math.max(0, Math.min(degMax(), st.d + pick([-2, -1, 1, 2]))); if (!st.gate) st.gate = 4; }
    else if (what === 1) st.gate = chance(0.4) ? 0 : rIn(1, 5);
    else if (what === 2) st.acc = !st.acc;
    else st.slide = !st.slide;
  }
}
// copy: page 1 onto pages 2 to 4, each changed a little (two or three steps; the last page, the turnaround, a few more)
function copyVary() {
  for (let pg = 1; pg < PAGES; pg++) {
    for (let i = 0; i < 16; i++) seq.steps[pg * 16 + i] = { ...seq.steps[i] };
    alterPage(pg, pg === PAGES - 1 ? rIn(3, 5) : rIn(2, 3));
  }
}
// the whole sequence, for the perf page's randomisers: a new page 1 and its variations
function randomNotes() { randomPage(0); copyVary(); sendSeq(); }
$('m-nrand').addEventListener('click', (e) => mRandomise(e.currentTarget, () => { randomPage(nsPage); sendSeq(); }));
$('m-nalter').addEventListener('click', (e) => mRandomise(e.currentTarget, () => { alterPage(nsPage); sendSeq(); }));
// copy to the next page: the page shown, exactly, onto the one after it, which is then shown (so pressing it again
// carries on to the next); off on page 4. Undo puts the page back as it was
$('m-ncopy').addEventListener('click', (e) => {
  if (nsPage >= PAGES - 1) return;
  const from = nsPage;
  mRandomise(e.currentTarget, () => { for (let i = 0; i < 16; i++) seq.steps[(from + 1) * 16 + i] = { ...seq.steps[from * 16 + i] }; sendSeq(); });
  nsPage = from + 1; nsDraw(); nsNow();
});
// the algorithm random uses: its number on the fader, its name on the random button
mFader($('m-seqf'), 'algo', { min: 0, max: SEQ_ALGOS.length - 1, get: () => seq.algo, set: (v) => { seq.algo = v; drawAll(); }, show: (v) => String(v + 1), dflt: 0 });
drawHooks.push(() => { $('m-nalgo').textContent = `${seq.algo + 1} ${SEQ_ALGOS[seq.algo][0]}`; });
