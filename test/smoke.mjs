// Drives the built page in Chromium's phone emulation (Pixel 9a's 412 x 915 and a small 360 x 640): no errors, no page
// scrolls but the presets list, swipes and page buttons turn the page, fader and pad drags don't, holding a fader opens
// its sequencer, MIDI CC 1-12 turn the perf dials, the reverb sends, the note grid edits steps on four pages and copies
// page 1 to the others, space plays and stops, play runs the steps, presets save and load, and record downloads a WAV.
//   node test/smoke.mjs [index.html]   (needs Playwright)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = pathToFileURL(process.argv[2] || new URL('../index.html', import.meta.url).pathname).href;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const [w, h] of [[412, 915], [360, 640]]) {
  console.log(`-- ${w} x ${h}`);
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, acceptDownloads: true });
  // a stand-in MIDI controller: one input, its handler kept where the test can call it
  await c.addInitScript(() => {
    const input = { onmidimessage: null };
    window.__midiIn = input;
    navigator.requestMIDIAccess = () => Promise.resolve({ inputs: new Map([['x', input]]), onstatechange: null });
  });
  const pg = await c.newPage(), errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(url); await pg.waitForTimeout(300);
  const page = () => pg.evaluate(() => document.querySelector('[data-m-tab][aria-selected="true"]').dataset.mTab);
  const box = async (sel) => pg.locator(sel).first().boundingBox();
  // drag with the mouse (pointer events), from one point to another
  const drag = async (x0, y0, x1, y1, steps = 12) => { await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move(x1, y1, { steps }); await pg.mouse.up(); await pg.waitForTimeout(450); };
  // no page scrolls; every panel fits
  for (const t of ['play', 'seq', 'voice', 'xy', 'fx', 'comp', 'presets']) {
    await pg.click(`[data-m-tab="${t}"]`);
    const o = await pg.evaluate((t) => { const p = document.querySelector(`[data-m-panel="${t}"]`); return [p.scrollHeight - p.clientHeight, document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]; }, t);
    check(o.every((v) => v <= 0), `${t}: fits the screen (${o})`);
  }
  // touch targets: every button at least 36 px high
  const small = await pg.evaluate(() => [...document.querySelectorAll('.m button, .m .m-btn')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height < 36; }).map((e) => e.textContent.trim()));
  check(!small.length, `buttons at least 36 px high ${small.length ? small.join(', ') : ''}`);
  // swipes
  await pg.click('[data-m-tab="play"]');
  let r = await box('#m-sound');
  await drag(r.x + r.width / 2, r.y + 10, r.x + r.width / 2 - w * 0.6, r.y + 14);
  check(await page() === 'seq', 'swipe left turns to seq');
  r = await box('.m-modes');
  await drag(r.x + 20, r.y + 10, r.x + 20 + w * 0.6, r.y + 10);
  check(await page() === 'play', 'swipe right turns back to perf');
  // a fader dragged sideways and up moves it, and doesn't turn the page
  r = await box('#m-perf .m-vtrack >> nth=3');
  const before = await pg.evaluate(() => macro.filter);
  await drag(r.x + r.width / 2, r.y + r.height / 2, r.x + r.width / 2 - w * 0.5, r.y + r.height / 4);
  check(await page() === 'play' && await pg.evaluate(() => macro.filter) > before, 'a fader drag moves the fader, not the page');
  // MIDI: CC 4 sends the filter dial to the top, CC 10 the reverb send to 50%, on any channel
  await pg.evaluate(() => { window.__midiIn.onmidimessage({ data: [0xb0, 4, 127] }); window.__midiIn.onmidimessage({ data: [0xb3, 10, 64] }); });
  check(await pg.evaluate(() => macro.filter === 200 && fx.verb === 50 && document.querySelectorAll('#m-perf .m-dial').length === 12), 'MIDI CC 4 and 10 turn the filter and reverb dials');
  // the reverb: the FX page's reverb send is the same as the dial's
  await pg.click('[data-m-tab="fx"]');
  check(await pg.evaluate(() => document.querySelector('#m-verb .m-vtrack').getAttribute('aria-valuenow') === '50'), 'the fx page shows the reverb send');
  await pg.evaluate(() => window.__midiIn.onmidimessage({ data: [0xb0, 10, 0] }));
  await pg.click('[data-m-tab="play"]');
  // the x/y pad
  await pg.click('[data-m-tab="xy"]');
  r = await box('.m-xy');
  await drag(r.x + 30, r.y + r.height - 30, r.x + r.width - 16, r.y + 16);
  check(await page() === 'xy' && await pg.evaluate(() => values[PAR.FILTER_FREQ_1] > 115 && values[PAR.RESO_1] > 115), 'the x/y pad moves its two parameters, not the page');
  // holding a fader opens its step sequencer
  await pg.click('[data-m-tab="voice"]');
  r = await box('#m-voice-tone .m-vtrack');
  await pg.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await pg.mouse.down(); await pg.waitForTimeout(650); await pg.mouse.up();
  check(await pg.isVisible('#m-fs') && await pg.textContent('#m-fs-name') === 'note', 'holding a fader opens its sequencer');
  r = await box('#m-fs-rand'); await pg.click('#m-fs-rand'); await pg.click('#m-fs-close');
  check(await pg.evaluate(() => mFaders.find((f) => f.key === 'm-voice-tone:note').seq.vals.some((v) => v)), 'randomise fills its steps');
  // the note grid: in gate mode the bottom of a step rests it; in accent mode a tap switches it
  await pg.click('[data-m-tab="seq"]');
  await pg.click('[data-mode="gate"]');
  r = await box('.m-step >> nth=1');
  await pg.mouse.click(r.x + r.width / 2, r.y + r.height - 3);
  await pg.click('[data-mode="acc"]');
  r = await box('.m-step >> nth=2');
  await pg.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  check(await pg.evaluate(() => seq.steps[1].gate === 0 && seq.steps[2].acc), 'steps edit: a gate rested, an accent set');
  // pages: page 2's steps are steps 17 to 32; copy makes pages 2 to 4 page 1 with a few steps changed
  await pg.click('#m-npages [data-page="1"]');
  await pg.click('[data-mode="gate"]');
  r = await box('.m-step >> nth=5');
  await pg.mouse.click(r.x + r.width / 2, r.y + r.height - 3);
  check(await pg.evaluate(() => seq.steps.length === 64 && seq.steps[21].gate === 0), 'page 2 edits its own steps');
  await pg.click('#m-ncopy');
  check(await pg.evaluate(() => { const k = [1, 2, 3].map((p) => seq.steps.slice(p * 16, p * 16 + 16).filter((st, i) => JSON.stringify(st) !== JSON.stringify(seq.steps[i])).length); return k.every((n) => n <= 5) && k.some((n) => n > 0); }), 'copy: pages 2 to 4 are page 1, slightly varied');
  // every algorithm makes a valid page
  check(await pg.evaluate(() => SEQ_ALGOS.every((_, a) => { seq.algo = a; for (let k = 0; k < 100; k++) { randomPage(1); const p = seq.steps.slice(16, 32);
    if (p.some((x) => !(x.d >= 0 && x.d <= DEG_MAX && x.gate >= 0 && x.gate <= 5)) || !p.some((x) => x.gate)) return false; } return true; })), 'all eight algorithms make valid pages');
  await pg.evaluate(() => { seq.algo = 0; });
  await pg.click('#m-npages [data-page="0"]');
  // the space bar starts and stops
  await pg.keyboard.press('Space'); await pg.waitForTimeout(300);
  const on = await pg.evaluate(() => playing);
  await pg.keyboard.press('Space'); await pg.waitForTimeout(200);
  check(on && !(await pg.evaluate(() => playing)), 'space starts and stops');
  await pg.click('#m-nrand');
  check(await pg.isEnabled('#m-nalter ~ [data-undo]'), 'random notes can be undone');
  // play runs the steps
  await pg.click('#m-play'); await pg.waitForTimeout(1200);
  check(await pg.evaluate(() => document.querySelectorAll('#m-led i.on').length === 1 && document.querySelectorAll('.m-step.now').length === 1), 'playing lights the step');
  // presets: load a built-in one, save a new one
  await pg.click('[data-m-tab="presets"]');
  await pg.click('.m-pload >> text=Acid Line');
  await pg.waitForTimeout(1500);
  check(await pg.evaluate(() => tempo === 128 && seq.root === 9), 'a built-in preset loads (at the next bar)');
  await pg.click('#m-psave');
  check(await pg.evaluate(() => JSON.parse(localStorage.getItem('elixir-synth-presets')).length === 1), 'save new keeps a preset in its own storage');
  // record: a take downloads as a WAV
  await pg.click('#m-rec'); await pg.waitForTimeout(1000);
  const dl = pg.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await pg.click('#m-rec');
  const d = await dl;
  check(!!d && /\.wav$/.test(d.suggestedFilename()), `record downloads ${d ? d.suggestedFilename() : 'nothing'}`);
  check(!errs.length, `no page errors ${errs.join('; ')}`);
  await c.close();
}
await b.close();
process.exit(fails ? 1 : 0);
