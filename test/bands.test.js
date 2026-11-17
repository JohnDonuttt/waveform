import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logBandEdges, buildBands, bandEnergies, bandLevels } from '../src/bands.js';

const SR = 48000;
const FFT = 8192;
const BIN_HZ = SR / FFT;

test('edges are strictly increasing and cover the requested range', () => {
  const edges = logBandEdges(64, 20, 24000);
  assert.equal(edges.length, 65);
  assert.equal(edges[0], 20);
  assert.equal(edges[64], 24000);
  for (let i = 1; i < edges.length; i++) assert.ok(edges[i] > edges[i - 1], `edge ${i}`);
});

test('edges have a constant ratio (evenly spaced on a log axis)', () => {
  const edges = logBandEdges(10, 20, 20480); // ratio 1024 over 10 bands: one octave each
  for (let i = 1; i < edges.length; i++) {
    assert.ok(Math.abs(edges[i] / edges[i - 1] - 2) < 1e-9);
  }
});

test('bad arguments throw', () => {
  assert.throws(() => logBandEdges(0, 20, 100), RangeError);
  assert.throws(() => logBandEdges(4, 0, 100), RangeError);
  assert.throws(() => logBandEdges(4, 200, 100), RangeError);
});

test('bands tile the range with no gaps or overlaps', () => {
  const bands = buildBands({ sampleRate: SR, fftSize: FFT, count: 64, fMin: 20 });
  assert.equal(bands.length, 64);
  assert.equal(bands[0].lo, 20);
  assert.equal(bands.at(-1).hi, SR / 2);
  for (let i = 1; i < bands.length; i++) assert.equal(bands[i].lo, bands[i - 1].hi);
});

test('low bands narrower than one FFT bin are not empty', () => {
  const bands = buildBands({ sampleRate: SR, fftSize: FFT, count: 64, fMin: 20 });
  assert.ok(bands[0].widthBins < 1, 'the first band should be sub-bin for this setup');
  for (const [i, b] of bands.entries()) {
    assert.ok(b.bins.length > 0, `band ${i} has bins`);
    assert.ok(b.weightSum > 0, `band ${i} has weight`);
  }
  // A flat spectrum must read the same level in every band, sub-bin or not.
  const flat = new Float64Array(FFT / 2).fill(1);
  const levels = bandLevels(bands, flat);
  for (const [i, v] of levels.entries()) assert.ok(Math.abs(v - 1) < 1e-9, `band ${i} level ${v}`);
});

test('neighbouring sub-bin bands interpolate instead of repeating one bin', () => {
  const bands = buildBands({ sampleRate: SR, fftSize: FFT, count: 64, fMin: 20 });
  // Power rising linearly with bin index: interpolated levels must rise too.
  const ramp = Float64Array.from({ length: FFT / 2 }, (_, k) => k);
  const levels = bandLevels(bands, ramp);
  const sub = bands.filter((b) => b.interp).length;
  assert.ok(sub >= 4, `expected several sub-bin bands, got ${sub}`);
  for (let i = 1; i < sub; i++) assert.ok(levels[i] > levels[i - 1], `band ${i} rises`);
  // And the interpolated value sits at the band's centre frequency.
  assert.ok(Math.abs(levels[0] - bands[0].center / BIN_HZ) < 1e-9);
});

test('bin weights add up to one, so energy is conserved', () => {
  const bands = buildBands({ sampleRate: SR, fftSize: FFT, count: 64, fMin: 20 });
  const perBin = new Float64Array(FFT / 2);
  for (const b of bands) for (let j = 0; j < b.bins.length; j++) perBin[b.bins[j]] += b.weights[j];

  const firstFull = Math.ceil(20 / BIN_HZ + 0.5); // first bin wholly above 20 Hz
  for (let k = firstFull; k < FFT / 2; k++) {
    assert.ok(Math.abs(perBin[k] - 1) < 1e-9, `bin ${k} weight ${perBin[k]}`);
  }

  // Random spectrum: sum of band energies equals the in-range power.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const power = Float64Array.from({ length: FFT / 2 }, rand);
  const energies = bandEnergies(bands, power);
  let total = 0;
  for (const e of energies) total += e;
  let expected = 0;
  for (let k = 0; k < FFT / 2; k++) expected += power[k] * perBin[k];
  assert.ok(Math.abs(total - expected) < 1e-9);
  let inRange = 0;
  for (let k = firstFull; k < FFT / 2; k++) inRange += power[k];
  assert.ok(total >= inRange && total - inRange <= power[firstFull - 1] + 1e-9);
});

test('a single tone lands in the band that contains it', () => {
  const bands = buildBands({ sampleRate: SR, fftSize: FFT, count: 64, fMin: 20 });
  const power = new Float64Array(FFT / 2);
  const k = Math.round(1000 / BIN_HZ);
  power[k] = 1;
  const energies = bandEnergies(bands, power);
  const hit = energies.findIndex((e) => e > 0.5);
  assert.ok(bands[hit].lo <= k * BIN_HZ && k * BIN_HZ < bands[hit].hi);
});

test('works at 44.1 kHz with a small FFT', () => {
  const bands = buildBands({ sampleRate: 44100, fftSize: 2048, count: 48, fMin: 20 });
  assert.equal(bands.length, 48);
  for (const b of bands) assert.ok(b.weightSum > 0);
});
