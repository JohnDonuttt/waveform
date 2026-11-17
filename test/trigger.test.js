import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRisingEdge, adaptiveHysteresis } from '../src/trigger.js';

const sine = (n, period, phase = 0, amp = 1) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * i) / period + phase));

test('finds the rising zero crossing of a sine to sub-sample accuracy', () => {
  // Phase pi/2: starts at the top, falls, first rising crossing at 3/4 period.
  const period = 40.3;
  const s = sine(400, period, Math.PI / 2);
  const t = findRisingEdge(s);
  assert.ok(Math.abs(t - 0.75 * period) < 0.02, `got ${t}`);
});

test('the same point of the cycle is found whatever the starting phase', () => {
  const period = 64;
  for (let phase = 0; phase < 2 * Math.PI; phase += 0.37) {
    const s = sine(512, period, phase);
    const t = findRisingEdge(s);
    // Value just after the trigger must be rising through zero.
    const i = Math.floor(t);
    assert.ok(s[i] < 0 && s[i + 1] >= 0, `phase ${phase.toFixed(2)}`);
  }
});

test('a signal that starts above zero does not trigger on its first sample', () => {
  const s = Float32Array.from([0.5, 0.6, 0.7, 0.2, -0.3, -0.1, 0.4]);
  const t = findRisingEdge(s, { hysteresis: 0.05 });
  assert.ok(t > 5 && t < 6, `got ${t}`);
});

test('noise smaller than the hysteresis never arms the trigger', () => {
  const s = Float32Array.from([0.004, -0.003, 0.002, -0.004, 0.003, -0.002, 0.001]);
  assert.equal(findRisingEdge(s, { hysteresis: 0.01 }), -1);
});

test('hysteresis ignores a small wiggle and waits for the real crossing', () => {
  // Small dip and recovery near zero, then a proper swing down and back up.
  const s = Float32Array.from([0.3, 0.1, -0.005, 0.02, 0.2, -0.5, -0.2, 0.3]);
  const t = findRisingEdge(s, { hysteresis: 0.05 });
  assert.ok(t > 6 && t < 7, `got ${t}`);
});

test('DC and silence give no trigger', () => {
  assert.equal(findRisingEdge(new Float32Array(256)), -1);
  assert.equal(findRisingEdge(new Float32Array(256).fill(0.5)), -1);
});

test('respects a non-zero level and the search window', () => {
  const s = sine(1000, 100);
  const t = findRisingEdge(s, { level: 0.5, start: 150 });
  // sin(x) = 0.5 on the rising side at x = pi/6 -> period * (1 + 1/12) = 208.33
  assert.ok(Math.abs(t - 208.333) < 0.1, `got ${t}`);
  assert.equal(findRisingEdge(s, { start: 10, end: 90 }), -1);
});

test('adaptive hysteresis scales with the signal and has a floor', () => {
  assert.ok(Math.abs(adaptiveHysteresis(sine(256, 32, 0, 0.8)) - 0.04) < 1e-3);
  assert.equal(adaptiveHysteresis(new Float32Array(64)), 0.0005);
});
