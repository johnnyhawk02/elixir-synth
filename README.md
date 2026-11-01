# Elixir Synth

A mono synth in the browser, laid out landscape as the prototype of a VST3 plugin. **Play it: https://johnnyhawk02.github.io/elixir-synth/**

Elixir Synth is built from [Elixir Mobile](https://github.com/johnnyhawk02/elixir-mobile). It keeps one voice of its
engine, the LXR drum 1 voice (DR1), and plays it as a synth: a note sequencer instead of the drum patterns, and
the same LCD screen. It installs as an app and works offline.

The engine is a JavaScript port of the drum voices and FX bus in the Erica Synths LXR-02 firmware
([erica-synths/lxr-desktop-app](https://github.com/erica-synths/lxr-desktop-app), GPL-3.0, commit a43cd4f).
Elixir Synth is unofficial: it is not made, approved or endorsed by Erica Synths.

## The screen

The screen is landscape, 5:3, laid out once at 1000 x 600 and scaled as a whole to fit the window, with the case
showing round it where the window is a different shape. That is how the plugin's window will resize.

Perf is on show all the time. The other pages share the space under its dials: tap the page buttons along the bottom of the window, or swipe across
them. The space bar starts and stops. Dragging a fader, a dial or the steps never turns the page. There are
no play or record buttons: R starts and stops a recording.

- **PERF** (always on show): eight dials in a line along the top right, and the randomise button (bottom left, beside the page buttons), which opens a popup of everything, sound, alter, notes, random fx, alter fx, undo, and
  *next bar* (while playing, a randomise waits for the next bar). Drag a dial up or down to turn it. A MIDI controller
  turns them too: CC 1 to 8, on any channel, left to right:

  | CC | dial | | CC | dial |
  |---|---|---|---|---|
  | 1 | tempo | | 5 | reso |
  | 2 | pitch (two octaves either way) | | 6 | fm |
  | 3 | decay | | 7 | echo send |
  | 4 | filter | | 8 | reverb send |

  Drive, echo feedback, reverb decay and the distortion mix are on the voice, fx and mstr pages.

  Chrome asks for MIDI access at the first touch.
- **SEQ**: the note sequencer. Four pages of sixteen steps, played in turn a bar each; each step has a note, a gate
  (from a quarter step to ringing out; the bottom rests it), an accent and a slide into the next step. Pick the page
  (the one playing is underlined) and what a touch sets (note, gate, accent, slide), then draw across the steps.
  *Copy 1 → 2-4* copies page 1 onto the other three, each with a few steps changed. Root, scale, accent amount and
  glide time, and random, alter (the page shown) and undo. The algo fader picks how random writes a page: 1 dice,
  2 acid, 3 euclid, 4 arp, 5 walk, 6 motif, 7 groove, 8 phrase. Presets from before there were pages play their one page
  on all four.
- **VOICE**: every DR1 parameter, on four tabs: tone, shape, filter, mod.
- **FX**: the echo (tempo-synced on musical lengths, ping pong, tone, feedback, width), the reverb (send, predelay,
  decay, tone, early reflections; at the top its decay holds) and the ring mod, with random, alter and undo.
- **MSTR**: distortion (tube, fold or rat) on the whole mix, then the compressor.
- **PRST**: presets, kept in this browser: save new, save over, load, delete, import and export. While playing, a
  preset comes in at the next bar.

Hold any fader for half a second to open its step sequencer: 2 to 16 steps, depth, slew, speed, draw with a finger,
randomise, on or off. Presets keep them.

**R** records the finished mix from the moment you press it (REC and the time show under the title) and downloads a WAV when you press it again.

## The engine

`lxr.js` follows the firmware's C line by line. Elixir Mobile's `verify.mjs` compares it sample for sample with the
firmware's own code built for the Cortex-M7 and run under qemu (see `ref/`). The engine runs as it does there, in
64-sample blocks at the firmware's rate, resampled to the phone's.

Elixir Synth adds two things to it. `setDrumPitch()` moves drum 1 to a note between semitones without a retrigger,
for the pitch dial and for slides. A note on a whole semitone goes through the firmware's own trigger and is
bit-exact; `test/engine.mjs` checks that.

The audio thread (`app/player.js`) declicks retriggers. The firmware's trigger restarts the voice from silence (it
resets the filter and the oscillator), so a note still sounding when the next one starts would jump straight to the
new one's first sample and change direction there. The player takes both out with an offset that starts at the jump,
leaves at the old note's slope and dies away over a few ms (critically damped, a 2 ms time constant), for the dry
voice and every send; a retrigger also starts at its new gain (accent) at once, the offset taking up the step. Matching
the slope matters with the filter closed down, where a near-sine has nothing on top to hide a kink. The engine's own
output is untouched, and so is the new note once the offset has gone.

And the reverb: the firmware has one (`FX/Reverb.c` and `FX/VerbTools/`), compiled out of the LXR-02 with
`USE_REVERB 0`. `lxr.js` ports it line by line as the FX bus's `FX_REVERB`, with its quirks (a mono output, loop 2
running through loop 1's allpass, a modulated allpass whose depth is never set). It hasn't been compared sample for
sample with the firmware, since the firmware never builds it.

## Files

| Path | What it is |
|---|---|
| `index.html` | the whole app in one file, built by `build.mjs` |
| `index.src.html` | the page's markup |
| `app/` | the page's code: `style.css`, `player.js` (the audio thread), then `core`, `ui`, `noteseq`, `fseq`, `presets`, `record`, `pwa` |
| `lxr.js`, `lxr-tables.js`, `lxr-ui-data.js`, `lxr-clicks.js` | the engine |
| `presets/` | the built-in presets, in the format the presets page exports |
| `sw.js`, `manifest.webmanifest`, `icons/` | the offline app |
| `test/` | `engine.mjs` (sound, in Node) and `smoke.mjs` (the page, in Chromium at three window sizes) |
| `verify.mjs`, `ref/` | the sample-for-sample comparison with the firmware |

## Build and test

```sh
node build.mjs               # rebuild index.html
node test/engine.mjs         # bit-exact semitones, cents, the sequencer, the presets' levels
node test/smoke.mjs          # the page at 1000 x 600, 1600 x 900 and 700 x 520 (needs Playwright)
```

## Licence

GPL-3.0-only, like the firmware it is derived from (see [LICENSE](LICENSE)). "Erica Synths", "LXR" and "LXR-02" are
trademarks of Erica Synths; they are used here only to say where the engine comes from.
