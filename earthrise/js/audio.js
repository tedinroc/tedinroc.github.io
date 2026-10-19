// Minimal procedural sound (WebAudio, no files). Muted by default; the context is created on the first unmute,
// which is always a user gesture. Low drone + O-ring friction while turning + a soft stop knock + a warm chord
// that swells with how much of the Earth has cleared the horizon.
export class Sound {
  constructor() { this.ctx = null; this.muted = true; this.level = { glow: 0, speed: 0 }; }

  _build() {
    // iPhone silent switch: Web Audio is "ambient" by default and goes quiet; "playback" plays like a video does
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = this.master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    { const d = noiseBuf.getChannelData(0); let b = 0; for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 4; } }
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    this.noiseBuf = noiseBuf;
    // drone: two low sines a fifth apart, slightly detuned, plus a breath of filtered noise
    const drone = ctx.createGain(); drone.gain.value = 0.16; drone.connect(master);
    for (const [f, g] of [[55, 0.5], [55.4, 0.35], [82.4, 0.22]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g; o.connect(og).connect(drone); o.start();
    }
    const air = noise(), airF = ctx.createBiquadFilter(); airF.type = 'lowpass'; airF.frequency.value = 180;
    const airG = ctx.createGain(); airG.gain.value = 0.10; air.connect(airF).connect(airG).connect(drone);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lfoG = ctx.createGain(); lfoG.gain.value = 60;
    lfo.connect(lfoG).connect(airF.frequency); lfo.start();
    // friction while the crank turns
    const fr = noise(), frF = ctx.createBiquadFilter(); frF.type = 'bandpass'; frF.frequency.value = 700; frF.Q.value = 0.8;
    this.frG = ctx.createGain(); this.frG.gain.value = 0; fr.connect(frF).connect(this.frG).connect(master);
    // warm chord (D: D3 A3 F#4 E5 C#5) — swells with glow
    this.chord = ctx.createGain(); this.chord.gain.value = 0;
    const chordF = ctx.createBiquadFilter(); chordF.type = 'lowpass'; chordF.frequency.value = 1400;
    this.chord.connect(chordF).connect(master);
    for (const [f, g] of [[146.83, 0.30], [220.0, 0.24], [369.99, 0.16], [554.37, 0.08], [659.25, 0.06]]) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = g * 0.5; o.connect(og).connect(this.chord); o.start();
      }
    }
  }

  setMuted(m) {
    this.muted = m;
    if (!m && !this.ctx) { try { this._build(); } catch (e) { console.warn('[audio]', e.message); return; } }
    if (!this.ctx) return;
    if (!m && this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, m ? 0.08 : 1.2);
  }

  update(speedDegPerS, glow) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.frG.gain.setTargetAtTime(Math.min(0.10, Math.abs(speedDegPerS) / 900), t, 0.05);
    this.chord.gain.setTargetAtTime(0.11 * glow * glow, t, glow > this.level.glow ? 0.9 : 0.5);
    this.level.glow = glow;
  }

  // a very small O-ring "tick" (20 ms of band-passed noise) — fired every few degrees of crank
  tick(strength = 1) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime, s = Math.max(0.2, Math.min(1, strength));
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = 1.6;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14 * s, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 1.5); src.stop(t + 0.03);
  }

  knock(strength = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime, s = Math.min(1, strength);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * s + 0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  }
}
