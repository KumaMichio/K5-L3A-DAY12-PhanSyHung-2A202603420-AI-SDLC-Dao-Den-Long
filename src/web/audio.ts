/** All sound is synthesised with Web Audio (no audio files): night music + the SFX Ticket-02 lists. */
export type Sfx = 'pickup' | 'lit' | 'pulse' | 'hit' | 'jump' | 'dash' | 'win' | 'lose' | 'shade' | 'tick' | 'steal' | 'charm' | 'wind';

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private musicTimer = 0;
  private volume = 0.7;

  /** Must be called from a user gesture (browser autoplay rules). */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.master);
    this.startMusic();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setMusic(on: boolean): void {
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(on ? 0.18 : 0.04, this.ctx.currentTime, 0.3);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, when = 0, to?: number, dest?: AudioNode): void {
    const c = this.ctx;
    if (!c) return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, gain: number, freq: number, when = 0): void {
    const c = this.ctx;
    if (!c) return;
    const t0 = c.currentTime + when;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  play(s: Sfx): void {
    switch (s) {
      case 'pickup': this.tone(880, 0.12, 'sine', 0.2, 0, 1320); break;
      case 'lit': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.22, i * 0.09)); break;
      case 'pulse': this.noise(0.4, 0.3, 900); this.tone(220, 0.45, 'sine', 0.35, 0, 660); break;
      case 'hit': this.tone(160, 0.35, 'square', 0.25, 0, 60); break;
      case 'jump': this.tone(392, 0.15, 'triangle', 0.18, 0, 700); break;
      case 'dash': this.noise(0.18, 0.35, 2200); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.25, i * 0.12)); break;
      case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.25, i * 0.18)); break;
      case 'shade': this.tone(98, 0.9, 'sawtooth', 0.12, 0, 82); this.tone(104, 0.9, 'sawtooth', 0.1); break;
      case 'tick': this.tone(1200, 0.05, 'square', 0.12); break;
      case 'steal': this.tone(660, 0.25, 'sine', 0.2, 0, 330); this.noise(0.25, 0.15, 1500); break;
      case 'charm': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.2, i * 0.06)); break;
      case 'wind': this.noise(1.8, 0.25, 500); break;
    }
  }

  /** Slow pentatonic plucks over a soft drone: "nhạc nền đêm". */
  private startMusic(): void {
    const c = this.ctx!;
    const drone = c.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 110;
    const dg = c.createGain();
    dg.gain.value = 0.25;
    drone.connect(dg).connect(this.musicGain);
    drone.start();
    const scale = [220, 247, 294, 330, 392, 440, 494, 587];
    let step = 0;
    this.musicTimer = window.setInterval(() => {
      const f = scale[(step * 5 + (step >> 2)) % scale.length];
      this.tone(f, 1.6, 'triangle', 0.35, 0, undefined, this.musicGain);
      if (step % 4 === 0) this.tone(f / 2, 2.4, 'sine', 0.3, 0, undefined, this.musicGain);
      step++;
    }, 700);
  }

  stop(): void {
    window.clearInterval(this.musicTimer);
  }
}
