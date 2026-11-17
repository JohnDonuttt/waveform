// Audio graph: one AnalyserNode, fed by whichever source is active.
//
//   demo chord ─┐
//   file        ├─► mix ─► analyser ─► silent gain ─► destination
//   microphone ─┘     └──► speakers (demo and file only)
//
// The analyser is pulled through a zero-gain node so it keeps running in
// every browser, without ever sending the microphone to the speakers.

export const FFT_SIZE = 8192;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.kind = null; // 'demo' | 'mic' | 'file' | null
    this.stopCurrent = () => {};
    this.playerNode = null;
  }

  // Call this synchronously from a click or key handler: iOS Safari only
  // lets audio start inside a user gesture.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.5;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      analyser.connect(silent).connect(ctx.destination);
      this.speakers = ctx.createGain();
      this.speakers.connect(ctx.destination);
      this.ctx = ctx;
      this.analyser = analyser;
    }
    if (this.ctx.state !== 'running') return this.ctx.resume();
    return Promise.resolve();
  }

  stop() {
    this.stopCurrent();
    this.stopCurrent = () => {};
    this.kind = null;
  }

  // A just-intonation A major chord with a slow filter sweep and a plucked arpeggio.
  async startDemo() {
    const resumed = this.unlock();
    this.stop();
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.08);
    out.connect(this.analyser);
    const toSpeakers = ctx.createGain();
    toSpeakers.gain.value = 0.18;
    out.connect(toSpeakers).connect(this.speakers);

    // Every pitch is a whole multiple of 55 Hz, so the mix repeats exactly
    // every 1/55 s and the scope trace stays put.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.Q.value = 3;
    filter.connect(out);
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.07;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 900;
    sweep.connect(sweepDepth).connect(filter.frequency);

    const voices = [
      { f: 55, type: 'sine', g: 0.34 },
      { f: 110, type: 'sawtooth', g: 0.11 },
      { f: 165, type: 'sawtooth', g: 0.07 },
      { f: 220, type: 'triangle', g: 0.16 },
      { f: 275, type: 'triangle', g: 0.12 },
      { f: 330, type: 'triangle', g: 0.1 },
    ];
    const oscs = [sweep];
    for (const v of voices) {
      const o = ctx.createOscillator();
      o.type = v.type;
      o.frequency.value = v.f;
      const g = ctx.createGain();
      g.gain.value = v.g;
      o.connect(g).connect(filter);
      oscs.push(o);
    }

    const pluck = ctx.createOscillator();
    pluck.type = 'triangle';
    const pluckGain = ctx.createGain();
    pluckGain.gain.value = 0;
    pluck.connect(pluckGain).connect(out);
    oscs.push(pluck);

    const pattern = [440, 550, 660, 880, 660, 550, 440, 330];
    const step = 0.36;
    let next = ctx.currentTime + 0.1;
    let n = 0;
    const schedule = () => {
      while (next < ctx.currentTime + 1) {
        pluck.frequency.setValueAtTime(pattern[n % pattern.length], next);
        pluckGain.gain.setValueAtTime(0, next);
        pluckGain.gain.linearRampToValueAtTime(0.22, next + 0.008);
        pluckGain.gain.setTargetAtTime(0.0, next + 0.01, 0.12);
        next += step;
        n++;
      }
    };
    schedule();
    const timer = setInterval(schedule, 250);

    for (const o of oscs) o.start();
    this.kind = 'demo';
    this.stopCurrent = () => {
      clearInterval(timer);
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.03);
      for (const o of oscs) o.stop(t + 0.2);
      setTimeout(() => out.disconnect(), 400);
    };
    await resumed;
  }

  async startMic() {
    const resumed = this.unlock();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser has no microphone access (it needs HTTPS).');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    await resumed;
    this.stop();
    const ctx = this.ctx;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(this.analyser);
    this.kind = 'mic';
    this.stopCurrent = () => {
      src.disconnect();
      for (const track of stream.getTracks()) track.stop();
    };
  }

  // Files play through an <audio> element so people get normal seek and pause.
  async startFile(file, player) {
    const resumed = this.unlock();
    this.stop();
    const ctx = this.ctx;
    if (!this.playerNode) {
      // An element can only ever be wrapped once.
      this.playerNode = ctx.createMediaElementSource(player);
      this.playerNode.connect(this.analyser);
      this.playerNode.connect(this.speakers);
    }
    const url = URL.createObjectURL(file);
    player.src = url;
    this.kind = 'file';
    this.stopCurrent = () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
      URL.revokeObjectURL(url);
    };
    await resumed;
    await player.play();
  }
}
