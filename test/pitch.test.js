import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakFrequency, nearestNote } from '../src/pitch.js';

test('parabolic peak lands close to a tone between bins', () => {
  const sr = 48000;
  const fft = 8192;
  const binHz = sr / fft;
  const f = 443.1;
  // Fake a Gaussian-ish main lobe in dB around the true frequency.
  const db = Float32Array.from({ length: fft / 2 }, (_, k) => -20 - 6 * ((k * binHz - f) / binHz) ** 2);
  const peak = peakFrequency(db, sr, fft);
  assert.ok(Math.abs(peak.freq - f) < 0.05, `got ${peak.freq}`);
});

test('silence has no peak', () => {
  assert.equal(peakFrequency(new Float32Array(1024).fill(-Infinity), 48000, 2048), null);
});

test('note names', () => {
  assert.deepEqual(nearestNote(440), { name: 'A4', cents: 0 });
  assert.equal(nearestNote(261.63).name, 'C4');
  assert.equal(nearestNote(55).name, 'A1');
  assert.equal(nearestNote(452).cents, 47);
});
