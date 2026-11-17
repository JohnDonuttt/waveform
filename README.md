# waveform

An audio visualiser built on the Web Audio API and a 2D canvas. It has three views:

1. **Spectrum**: 64 bars on a log frequency axis from 20 Hz to Nyquist
2. **Oscilloscope**: the raw waveform, triggered on a rising zero crossing so it holds still
3. **Radial**: the same 64 bands mirrored around a circle

Live demo: https://johndonuttt.github.io/waveform/

Sources are a built-in demo chord (oscillators, nothing bundled), your microphone, or an audio file you pick. The mic is only requested when you press the button, and nothing leaves the browser. Switch views with the buttons or the 1, 2 and 3 keys.

No framework and no build step: plain ES modules, under a thousand lines of JavaScript.

## How the log binning works

An `AnalyserNode` with an 8192-point FFT gives 4096 bins spaced evenly in Hz (about 5.9 Hz apart at 48 kHz). Drawn one bar per bin, nearly the whole screen would be above 2 kHz. So the range 20 Hz to Nyquist is cut into 64 bands whose edges are a constant ratio apart, and each FFT bin is shared out between the bands it overlaps, weighted by how much of the bin falls inside each band. Those weights add up to 1 per bin, so no energy is lost or counted twice. The bar height is the band's average power per bin, in dB.

The awkward part is the bottom end. The first band, 20 to 22.3 Hz, is narrower than a single bin. It still gets a fractional weight from the bin it sits in (so it's never empty), but if you display that directly, several neighbouring low bands all show the same bin and the left of the graph turns into a staircase. For bands narrower than one bin the level is interpolated between the two nearest bins at the band's centre frequency instead.

The display also tilts the spectrum by +3 dB per octave around 1 kHz, which is roughly how much typical music falls off, so the top end doesn't look empty.

The code is in [`src/bands.js`](src/bands.js) and the trigger in [`src/trigger.js`](src/trigger.js).

## Run it locally

Needs Node 22 or later (only for the dev server and tests, there are no dependencies).

```sh
npm start        # http://localhost:5173
npm test         # node:test, covers band edges, energy, interpolation and the trigger
npm run build    # copies the site into dist/
```

Microphone input needs HTTPS or localhost.

## Licence

MIT
