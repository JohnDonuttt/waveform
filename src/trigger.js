// Oscilloscope trigger.
//
// Each animation frame grabs a fresh block of samples that starts at an
// arbitrary point in the waveform. Drawing it as is makes a periodic signal
// slide around. A scope fixes this by starting the trace at the same point of
// the cycle every time: here, the first rising crossing of `level`.
//
// Hysteresis stops noise from triggering: the signal has to dip below
// `level - hysteresis` first (the trigger "arms"), and only then does a
// crossing up through `level` count. The returned position is fractional
// (linear interpolation between the two samples either side), so the trace
// doesn't jitter by up to a sample from frame to frame.

// Returns the fractional index of the first rising crossing of `level` in
// samples[start..end], or -1 if there isn't one.
export function findRisingEdge(samples, opts = {}) {
  const level = opts.level ?? 0;
  const hysteresis = Math.max(0, opts.hysteresis ?? 0.01);
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(samples.length - 1, opts.end ?? samples.length - 1);
  const armBelow = level - hysteresis;
  let armed = false;

  for (let i = start; i < end; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a < armBelow) armed = true;
    if (armed && a < level && b >= level) {
      return i + (level - a) / (b - a);
    }
  }
  return -1;
}

// Hysteresis as a fraction of the peak, so quiet inputs still trigger and
// loud noisy ones don't chatter.
export function adaptiveHysteresis(samples, fraction = 0.05, floor = 0.0005) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return Math.max(floor, peak * fraction);
}
