// Log-spaced frequency bands built on top of a linear FFT.
//
// An FFT gives bins that are evenly spaced in Hz. Hearing (and music) is
// closer to logarithmic, so a straight bin-per-bar display spends almost all
// of its width above 2 kHz. Here we split [fMin, fMax] into bands whose edges
// are a constant ratio apart, then work out how much of each FFT bin falls
// inside each band.
//
// FFT bin k is centred on k * binHz and is treated as covering
// [(k - 0.5) * binHz, (k + 0.5) * binHz). A band takes a fractional weight from
// every bin it overlaps, so the weights of all bands over one bin add up to 1
// and total energy is conserved.
//
// Near 20 Hz a band can be much narrower than one bin (at 48 kHz with an
// 8192-point FFT a bin is about 5.9 Hz wide; the first of 64 bands is 2.3 Hz).
// Those bands still get a weight from the bin they sit in, so none is empty,
// but for display their level is interpolated between neighbouring bins at
// the band's centre frequency. Otherwise neighbouring low bands would show
// identical values and the left of the spectrum would look like a staircase.

// count + 1 edges with a constant ratio between neighbours.
export function logBandEdges(count, fMin, fMax) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
  if (!(fMin > 0) || !(fMax > fMin)) throw new RangeError('need 0 < fMin < fMax');
  const edges = new Float64Array(count + 1);
  const span = Math.log(fMax / fMin);
  for (let i = 0; i <= count; i++) edges[i] = fMin * Math.exp((span * i) / count);
  edges[0] = fMin;
  edges[count] = fMax;
  return edges;
}

// Each band: edges in Hz, the FFT bins it overlaps and how much of each bin
// falls inside it. `interp` is set for bands narrower than one bin.
export function buildBands({ sampleRate, fftSize, count = 64, fMin = 20 }) {
  const binHz = sampleRate / fftSize;
  const binCount = fftSize / 2;
  const edges = logBandEdges(count, fMin, sampleRate / 2);
  const bands = [];

  for (let i = 0; i < count; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const first = Math.max(0, Math.floor(lo / binHz + 0.5));
    const last = Math.min(binCount - 1, Math.floor(hi / binHz + 0.5));
    const bins = [];
    const weights = [];
    for (let k = first; k <= last; k++) {
      const a = Math.max(lo, (k - 0.5) * binHz);
      const b = Math.min(hi, (k + 0.5) * binHz);
      if (b > a) {
        bins.push(k);
        weights.push((b - a) / binHz);
      }
    }
    // A band that lies wholly above the last bin (only possible in the
    // sliver just under Nyquist) borrows the last bin rather than going empty.
    if (bins.length === 0) {
      bins.push(binCount - 1);
      weights.push(Math.max((hi - lo) / binHz, 1e-9));
    }

    const center = Math.sqrt(lo * hi);
    const widthBins = (hi - lo) / binHz;
    let interp = null;
    if (widthBins < 1) {
      const pos = Math.min(center / binHz, binCount - 1);
      const k = Math.min(Math.floor(pos), binCount - 2);
      interp = { k, t: pos - k };
    }

    let weightSum = 0;
    for (const w of weights) weightSum += w;
    bands.push({
      lo,
      hi,
      center,
      widthBins,
      bins: Int32Array.from(bins),
      weights: Float64Array.from(weights),
      weightSum,
      interp,
    });
  }
  return bands;
}

// Weighted sum of bin powers. Summed over all bands this is the total power
// of the bins inside [fMin, Nyquist].
export function bandEnergies(bands, power, out = new Float64Array(bands.length)) {
  for (let i = 0; i < bands.length; i++) {
    const { bins, weights } = bands[i];
    let e = 0;
    for (let j = 0; j < bins.length; j++) e += power[bins[j]] * weights[j];
    out[i] = e;
  }
  return out;
}

// Average power per bin, which is what the bars show.
export function bandLevels(bands, power, out = new Float64Array(bands.length)) {
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    if (band.interp) {
      const { k, t } = band.interp;
      out[i] = power[k] * (1 - t) + power[k + 1] * t;
    } else {
      const { bins, weights } = band;
      let e = 0;
      for (let j = 0; j < bins.length; j++) e += power[bins[j]] * weights[j];
      out[i] = e / band.weightSum;
    }
  }
  return out;
}

export function dbToPower(db, out) {
  for (let i = 0; i < db.length; i++) out[i] = Math.pow(10, db[i] / 10);
  return out;
}

export function powerToDb(p) {
  return p > 1e-20 ? 10 * Math.log10(p) : -200;
}
