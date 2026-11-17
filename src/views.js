// The three views. Each gets a context already scaled for devicePixelRatio,
// so everything here is in CSS pixels.

import { findRisingEdge, adaptiveHysteresis } from './trigger.js';

export const DB_FLOOR = -96;
export const DB_CEIL = -12;

export const dbToUnit = (db) => Math.min(1, Math.max(0, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));

const OCTAVE_TICKS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const tickLabel = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

const MONO = '500 11px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

function freqToUnit(f, lo, hi) {
  return Math.log(f / lo) / Math.log(hi / lo);
}

export function drawSpectrum(fr) {
  const { g, w, h, theme, levels, peaks, bands } = fr;
  const padL = 40;
  const padR = 14;
  const padT = 18;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const n = levels.length;
  const lo = bands.length ? bands[0].lo : 20;
  const hi = bands.length ? bands[bands.length - 1].hi : 24000;

  // Horizontal dB rules.
  g.font = MONO;
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  g.lineWidth = 1;
  for (let db = DB_CEIL; db >= DB_FLOOR; db -= 12) {
    const y = Math.round(padT + plotH * (1 - dbToUnit(db))) + 0.5;
    g.strokeStyle = theme.grid;
    g.beginPath();
    g.moveTo(padL, y);
    g.lineTo(w - padR, y);
    g.stroke();
    g.fillStyle = theme.muted;
    g.fillText(String(db), padL - 8, y);
  }

  // Octave ticks along the bottom.
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const f of OCTAVE_TICKS) {
    if (f < lo || f > hi) continue;
    const x = Math.round(padL + plotW * freqToUnit(f, lo, hi)) + 0.5;
    g.strokeStyle = theme.grid;
    g.beginPath();
    g.moveTo(x, padT);
    g.lineTo(x, padT + plotH + 4);
    g.stroke();
    const crowded = plotW < 360 && f % 250 === 0 && f < 1000;
    if (!crowded && x < w - padR - 30) {
      g.fillStyle = theme.muted;
      g.fillText(tickLabel(f), x, padT + plotH + 10);
    }
  }
  g.textAlign = 'left';
  g.fillStyle = theme.muted;
  g.fillText('Hz', w - padR - 14, padT + plotH + 10);

  // Bars: one per band, laid out evenly (the bands are already log-spaced).
  const slot = plotW / n;
  const gap = Math.min(3, slot * 0.28);
  const barW = Math.max(1, slot - gap);
  const base = padT + plotH;
  g.fillStyle = theme.ink;
  for (let i = 0; i < n; i++) {
    const v = levels[i];
    const x = padL + i * slot + gap / 2;
    const bh = Math.max(1, v * plotH);
    g.fillRect(x, base - bh, barW, bh);
  }
  // Peak caps in the accent colour.
  g.fillStyle = theme.accent;
  for (let i = 0; i < n; i++) {
    const p = peaks[i];
    if (p <= 0.004) continue;
    const x = padL + i * slot + gap / 2;
    g.fillRect(x, base - p * plotH - 2, barW, 2);
  }
}

export function drawScope(fr) {
  const { g, w, h, theme, wave, sampleRate, scope } = fr;
  const divX = 10;
  const divY = 8;
  const pad = 14;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const cx = pad;
  const cy = pad + plotH / 2;

  // Graticule: fine dotted divisions, solid centre axes with minor ticks.
  g.lineWidth = 1;
  g.strokeStyle = theme.grid;
  g.setLineDash([1, 3]);
  g.beginPath();
  for (let i = 1; i < divX; i++) {
    const x = Math.round(pad + (plotW * i) / divX) + 0.5;
    g.moveTo(x, pad);
    g.lineTo(x, pad + plotH);
  }
  for (let j = 1; j < divY; j++) {
    const y = Math.round(pad + (plotH * j) / divY) + 0.5;
    g.moveTo(pad, y);
    g.lineTo(pad + plotW, y);
  }
  g.stroke();
  g.setLineDash([]);
  g.strokeRect(pad + 0.5, pad + 0.5, plotW - 1, plotH - 1);
  g.beginPath();
  const midX = Math.round(pad + plotW / 2) + 0.5;
  const midY = Math.round(cy) + 0.5;
  for (let i = 0; i <= divX * 5; i++) {
    const x = Math.round(pad + (plotW * i) / (divX * 5)) + 0.5;
    g.moveTo(x, midY - 3);
    g.lineTo(x, midY + 3);
  }
  for (let j = 0; j <= divY * 5; j++) {
    const y = Math.round(pad + (plotH * j) / (divY * 5)) + 0.5;
    g.moveTo(midX - 3, y);
    g.lineTo(midX + 3, y);
  }
  g.stroke();

  if (!wave) return;

  // Time base: ~40 ms across the screen, shorter on narrow screens.
  const span = Math.round(Math.min(wave.length / 2, sampleRate * (w < 500 ? 0.025 : 0.04)));
  const hyst = adaptiveHysteresis(wave);
  let start = findRisingEdge(wave, { level: 0, hysteresis: hyst, end: wave.length - span - 2 });
  scope.triggered = start >= 0;
  if (start < 0) start = 0;

  // Vertical auto-gain in powers of two, eased so it doesn't pump.
  let peak = 0;
  for (let i = 0; i < wave.length; i++) peak = Math.max(peak, Math.abs(wave[i]));
  const target = peak > 1e-4 ? Math.min(32, Math.max(1, 2 ** Math.floor(Math.log2(0.85 / peak)))) : scope.gain;
  if (target < scope.gain) scope.gain = target;
  else if (target > scope.gain) scope.gain = Math.min(target, scope.gain * (fr.reducedMotion ? 1.02 : 1.05));
  scope.spanMs = (span / sampleRate) * 1000;

  const yScale = (plotH / 2) * scope.gain;
  const i0 = Math.floor(start);
  const frac = start - i0;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = theme.accent;
  g.lineWidth = 1.75;
  g.save();
  g.beginPath();
  g.rect(pad, pad, plotW, plotH);
  g.clip();
  g.beginPath();
  for (let j = 0; j <= span + 1; j++) {
    const x = cx + ((j - frac) / span) * plotW;
    const v = wave[i0 + j] ?? 0;
    const y = cy - v * yScale;
    if (j === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.restore();

  // Trigger marker on the left edge.
  g.fillStyle = scope.triggered ? theme.accent : theme.muted;
  g.beginPath();
  g.moveTo(pad + 1, cy - 5);
  g.lineTo(pad + 7, cy);
  g.lineTo(pad + 1, cy + 5);
  g.closePath();
  g.fill();
}

export function drawRadial(fr) {
  const { g, w, h, theme, levels, peaks, reducedMotion, time } = fr;
  const n = levels.length;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2 - 16;

  // Low end sets the inner radius, so the ring breathes with the kick.
  let low = 0;
  for (let i = 0; i < Math.min(8, n); i++) low += levels[i];
  low /= Math.min(8, n) || 1;
  const inner = R * (0.34 + (reducedMotion ? 0 : 0.05 * low));
  const outer = R;
  const reach = outer - inner;

  // Concentric guides.
  g.lineWidth = 1;
  g.strokeStyle = theme.grid;
  for (const f of [0.25, 0.5, 0.75, 1]) {
    g.beginPath();
    g.arc(cx, cy, inner + reach * f, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.arc(cx, cy, inner, 0, Math.PI * 2);
  g.fillStyle = theme.stage;
  g.fill();
  g.strokeStyle = theme.muted;
  g.stroke();

  // Bands mirrored left and right: low at the top, high at the bottom.
  const drift = reducedMotion ? 0 : Math.sin(time * 0.15) * 0.04;
  const step = Math.PI / n;
  const barW = Math.max(1, ((2 * Math.PI * inner) / (2 * n)) * 0.55);
  g.lineCap = 'butt';
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + side * (step * (i + 0.5) + drift);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const v = levels[i];
      const r1 = inner + 3;
      const r2 = r1 + Math.max(1, v * (reach - 3));
      g.strokeStyle = theme.ink;
      g.lineWidth = barW;
      g.beginPath();
      g.moveTo(cx + cos * r1, cy + sin * r1);
      g.lineTo(cx + cos * r2, cy + sin * r2);
      g.stroke();
      const p = peaks[i];
      if (p > 0.004) {
        const rp = r1 + p * (reach - 3) + 2;
        g.strokeStyle = theme.accent;
        g.beginPath();
        g.moveTo(cx + cos * rp, cy + sin * rp);
        g.lineTo(cx + cos * (rp + 2), cy + sin * (rp + 2));
        g.stroke();
      }
    }
  }

  // Centre dot pulses with overall level.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += levels[i];
  mean /= n || 1;
  g.fillStyle = theme.accent;
  g.beginPath();
  g.arc(cx, cy, Math.max(2, inner * (0.08 + (reducedMotion ? 0 : 0.18 * mean))), 0, Math.PI * 2);
  g.fill();
}
