const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Loudest bin, refined with a parabola through it and its neighbours (in dB).
// For a clean tone that gets well under one bin of error.
export function peakFrequency(db, sampleRate, fftSize, fMin = 30, fMax = 5000) {
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.ceil(fMin / binHz));
  const hi = Math.min(db.length - 2, Math.floor(fMax / binHz));
  let best = -1;
  let bestDb = -Infinity;
  for (let k = lo; k <= hi; k++) {
    if (db[k] > bestDb) {
      bestDb = db[k];
      best = k;
    }
  }
  if (best < 0 || !Number.isFinite(bestDb)) return null;
  const a = db[best - 1];
  const b = db[best];
  const c = db[best + 1];
  let offset = 0;
  const denom = a - 2 * b + c;
  if (Number.isFinite(a) && Number.isFinite(c) && denom !== 0) {
    offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  }
  return { freq: (best + offset) * binHz, db: b - 0.25 * (a - c) * offset };
}

export function nearestNote(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  const name = NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  return { name, cents };
}
