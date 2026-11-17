import { AudioEngine, FFT_SIZE } from './audio.js';
import { buildBands, bandLevels, dbToPower, powerToDb } from './bands.js';
import { peakFrequency, nearestNote } from './pitch.js';
import { drawSpectrum, drawScope, drawRadial, dbToUnit } from './views.js';

const BANDS = 64;
// Music falls off at roughly 3 dB per octave. Tilting the display by the same
// amount (pivoting at 1 kHz) keeps the top end from looking dead.
const TILT_DB_PER_OCTAVE = 3;

const MODES = {
  spectrum: { key: '1', label: 'Spectrum', draw: drawSpectrum, describe: 'Spectrum: 64 log-spaced frequency bands from 20 Hz to Nyquist.' },
  scope: { key: '2', label: 'Oscilloscope', draw: drawScope, describe: 'Oscilloscope: the waveform, triggered on a rising zero crossing.' },
  radial: { key: '3', label: 'Radial', draw: drawRadial, describe: 'Radial: the 64 frequency bands arranged around a circle.' },
};
const SOURCE_NAMES = { demo: 'Demo chord', mic: 'Microphone', file: 'Audio file' };

const $ = (sel) => document.querySelector(sel);
const canvas = $('#view');
const g = canvas.getContext('2d');
const player = $('#player');
const fileInput = $('#file');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const engine = new AudioEngine();

const state = {
  mode: 'spectrum',
  sampleRate: 0,
  bands: [],
  tilt: new Float32Array(BANDS),
  levels: new Float32Array(BANDS),
  peaks: new Float32Array(BANDS),
  hold: new Float32Array(BANDS),
  raw: new Float32Array(BANDS),
  db: new Float32Array(FFT_SIZE / 2),
  power: new Float32Array(FFT_SIZE / 2),
  wave: new Float32Array(FFT_SIZE),
  scope: { gain: 1, spanMs: 40, triggered: false },
  theme: readTheme(),
  running: false,
  last: 0,
  lastReadout: 0,
  size: { w: 0, h: 0, dpr: 0 },
};

function useSampleRate(rate) {
  if (rate === state.sampleRate) return;
  state.sampleRate = rate;
  state.bands = buildBands({ sampleRate: rate, fftSize: FFT_SIZE, count: BANDS, fMin: 20 });
  state.bands.forEach((b, i) => (state.tilt[i] = TILT_DB_PER_OCTAVE * Math.log2(b.center / 1000)));
}
useSampleRate(48000);

function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return { ink: v('--ink'), muted: v('--muted'), grid: v('--grid'), accent: v('--accent'), stage: v('--stage') };
}

function fitCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const s = state.size;
  if (width === s.w && height === s.h && dpr === s.dpr) return false;
  Object.assign(s, { w: width, h: height, dpr });
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  return true;
}

function analyse(dt) {
  const reduced = reducedMotion.matches;
  // Rise fast, fall slowly. Reduced motion slows both and drops the peak caps.
  const attack = reduced ? 0.18 : 0.55;
  const decay = reduced ? 0.35 : 0.9;
  const { levels, peaks, hold, raw } = state;
  const live = Boolean(engine.kind);

  if (live) {
    engine.analyser.getFloatFrequencyData(state.db);
    engine.analyser.getFloatTimeDomainData(state.wave);
    dbToPower(state.db, state.power);
    bandLevels(state.bands, state.power, raw);
  }

  let moving = false;
  for (let i = 0; i < BANDS; i++) {
    const target = live ? dbToUnit(powerToDb(raw[i]) + state.tilt[i]) : 0;
    const cur = levels[i];
    levels[i] = target > cur ? cur + (target - cur) * attack : Math.max(target, cur - decay * dt);

    if (reduced) {
      peaks[i] = 0;
    } else if (levels[i] >= peaks[i]) {
      peaks[i] = levels[i];
      hold[i] = 0.6;
    } else if ((hold[i] -= dt) <= 0) {
      peaks[i] = Math.max(levels[i], peaks[i] - 0.45 * dt);
    }
    if (levels[i] > 0.002 || peaks[i] > 0.002) moving = true;
  }
  return moving;
}

function render(now) {
  fitCanvas();
  const { w, h, dpr } = state.size;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  MODES[state.mode].draw({
    g,
    w,
    h,
    theme: state.theme,
    levels: state.levels,
    peaks: state.peaks,
    bands: state.bands,
    wave: engine.kind ? state.wave : null,
    sampleRate: state.sampleRate,
    reducedMotion: reducedMotion.matches,
    time: now / 1000,
    scope: state.scope,
  });
  if (now - state.lastReadout > 180) {
    state.lastReadout = now;
    updateReadout();
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - state.last) / 1000);
  state.last = now;
  const moving = analyse(dt);
  render(now);
  // Keep going while there's a source, or until the bars have fallen.
  if (engine.kind || moving) requestAnimationFrame(frame);
  else state.running = false;
}

function wake() {
  if (state.running) return;
  state.running = true;
  state.last = performance.now();
  requestAnimationFrame(frame);
}

function redraw() {
  if (!state.running) render(performance.now());
}

function updateReadout() {
  $('#readout-mode').textContent = MODES[state.mode].label;
  $('#readout-value').textContent = readoutText();
}

function readoutText() {
  if (!engine.kind) return 'No input';
  if (state.mode === 'scope') {
    const { gain, spanMs, triggered } = state.scope;
    const zoom = gain >= 1.5 ? `  ×${Math.round(gain)}` : '';
    return `${Math.round(spanMs)} ms${zoom}  ${triggered ? 'Triggered' : 'Free run'}`;
  }
  const peak = peakFrequency(state.db, state.sampleRate, FFT_SIZE);
  if (!peak || peak.db < -80) return 'Quiet';
  const note = nearestNote(peak.freq);
  const cents = note.cents === 0 ? '' : ` ${note.cents > 0 ? '+' : '−'}${Math.abs(note.cents)}¢`;
  const hz = peak.freq < 1000 ? peak.freq.toFixed(1) : Math.round(peak.freq);
  return `${hz} Hz  ${note.name}${cents}`;
}

function setMode(mode) {
  state.mode = mode;
  for (const btn of document.querySelectorAll('[data-mode]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  canvas.setAttribute('aria-label', MODES[mode].describe);
  updateReadout();
  redraw();
}

function syncSourceButtons() {
  for (const btn of document.querySelectorAll('[data-source]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.source === engine.kind));
  }
  $('#file-label').classList.toggle('is-on', engine.kind === 'file');
  $('#stop').disabled = !engine.kind;
  $('#idle').hidden = Boolean(engine.kind);
  player.hidden = engine.kind !== 'file';
}

function say(msg) {
  $('#status').textContent = msg;
}

function started() {
  useSampleRate(engine.ctx.sampleRate);
  syncSourceButtons();
  wake();
}

async function start(kind, run) {
  try {
    await run();
    started();
    say(`${SOURCE_NAMES[kind]} on.`);
  } catch (err) {
    syncSourceButtons();
    if (err.name === 'NotAllowedError' && kind === 'file') {
      // Autoplay was refused; the file is loaded, the native controls can start it.
      started();
      say('Press play to start the file.');
    } else if (err.name === 'NotAllowedError') {
      say('Microphone access was blocked. Allow it in your browser’s site settings and try again.');
    } else if (err.name === 'NotFoundError') {
      say('No microphone found.');
    } else if (err.name === 'NotSupportedError') {
      say('This browser can’t play that file.');
    } else {
      say(err.message || 'Couldn’t start audio.');
    }
  }
}

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.dataset.mode) {
    setMode(btn.dataset.mode);
  } else if (btn.dataset.source === 'demo' || btn.id === 'idle-demo') {
    start('demo', () => engine.startDemo());
  } else if (btn.dataset.source === 'mic') {
    start('mic', () => engine.startMic());
  } else if (btn.id === 'stop') {
    engine.stop();
    syncSourceButtons();
    say('Stopped.');
    wake();
  }
});

// The click that opens the file picker is the gesture iOS needs to unlock audio.
fileInput.addEventListener('click', () => engine.unlock());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  $('#file-name').textContent = file.name;
  start('file', () => engine.startFile(file, player));
});

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.target.closest('input, textarea, audio')) return;
  const mode = Object.keys(MODES).find((m) => MODES[m].key === ev.key);
  if (mode) {
    setMode(mode);
    say(`${MODES[mode].label} view.`);
  }
});

// Mobile browsers suspend audio in background tabs.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && engine.kind && engine.ctx.state === 'suspended') engine.ctx.resume();
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  state.theme = readTheme();
  redraw();
});
reducedMotion.addEventListener('change', redraw);
new ResizeObserver(() => fitCanvas() && redraw()).observe(canvas);

const params = new URLSearchParams(location.search);
setMode(params.get('mode') in MODES ? params.get('mode') : 'spectrum');
syncSourceButtons();

// ?demo starts the demo without a click where the browser allows it (most
// don't, and then the start button simply stays up).
if (params.has('demo')) {
  engine.startDemo().then(() => (engine.ctx.state === 'running' ? started() : engine.stop()));
}
