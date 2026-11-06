// Outbreak's sound, synthesised in code (no audio files), in the spirit of Eko Lockdown's Sounds.cs.
// Wind and a low drone under everything, distant sirens, zombie groans placed in stereo, a scream
// when one lunges, footsteps paced to the player's speed, a heartbeat when time or distance is short,
// and stingers. Starts on the first tap (browsers require a user gesture).
import { playerSpeed, playerVehicle, type GameState } from '../core/state';
import type { GameEvent, WeaponKind } from '../core/types';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private nextSiren = 20;
  private nextStep = 0;
  private nextBeat = 0;
  private groanAt = new Map<number, number>();
  private t = 0;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; lp: BiquadFilterNode } | null = null;
  muted = false;

  /** Call from a user gesture. Safe to call more than once. */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    // 2 s of white noise, reused by every noisy sound
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.ambience();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume();
    });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  private ambience(): void {
    const ctx = this.ctx!;
    // wind: looping noise through a lowpass whose cutoff drifts
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(lp.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.16;
    wind.connect(lp).connect(wg).connect(this.master);
    wind.start();
    lfo.start();
    // drone: two detuned low saws, heavily filtered
    const dg = ctx.createGain();
    dg.gain.value = 0.05;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 160;
    dlp.connect(dg).connect(this.master);
    for (const f of [55, 55.6, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(dlp);
      o.start();
    }
  }

  private env(g: GainNode, at: number, peak: number, attack: number, release: number): void {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  }

  private noiseSrc(at: number, dur: number): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise;
    n.start(at, Math.random() * 1.5, dur);
    return n;
  }

  private panner(pan: number): StereoPannerNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfx);
    return p;
  }

  siren(): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    o.frequency.setValueAtTime(620, at);
    for (let k = 0; k < 4; k++) {
      o.frequency.linearRampToValueAtTime(900, at + k * 1.6 + 0.8);
      o.frequency.linearRampToValueAtTime(620, at + k * 1.6 + 1.6);
    }
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.025, at + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 6.5);
    o.connect(lp).connect(g).connect(this.panner(Math.random() * 1.6 - 0.8));
    o.start(at);
    o.stop(at + 6.6);
  }

  groan(pan: number, vol: number, angry: boolean): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const dur = angry ? 0.7 : 1.1 + Math.random() * 0.5;
    const base = (angry ? 120 : 85) + Math.random() * 30;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, at);
    o.frequency.linearRampToValueAtTime(base * (angry ? 1.25 : 0.8), at + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6 + Math.random() * 4;
    const vg = ctx.createGain();
    vg.gain.value = base * 0.05;
    vib.connect(vg).connect(o.frequency);
    const out = this.panner(pan);
    const g = ctx.createGain();
    this.env(g, at, vol, 0.12, dur);
    g.connect(out);
    for (const [f, q] of [[520, 6], [1150, 8]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (0.9 + Math.random() * 0.2);
      bp.Q.value = q;
      o.connect(bp).connect(g);
    }
    // breath
    const n = this.noiseSrc(at, dur + 0.2);
    const nb = ctx.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = 900;
    const ng = ctx.createGain();
    this.env(ng, at, vol * 0.5, 0.1, dur);
    n.connect(nb).connect(ng).connect(out);
    o.start(at);
    vib.start(at);
    o.stop(at + dur + 0.2);
    vib.stop(at + dur + 0.2);
  }

  scream(pan: number, vol: number): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const n = this.noiseSrc(at, 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, at);
    bp.frequency.exponentialRampToValueAtTime(700, at + 0.5);
    bp.Q.value = 3;
    const g = ctx.createGain();
    this.env(g, at, vol, 0.03, 0.5);
    n.connect(bp).connect(g).connect(this.panner(pan));
    this.groan(pan, vol * 0.8, true);
  }

  footstep(vol: number): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const n = this.noiseSrc(at, 0.08);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 + Math.random() * 300;
    const g = ctx.createGain();
    this.env(g, at, vol, 0.004, 0.07);
    n.connect(lp).connect(g).connect(this.sfx);
  }

  heartbeat(vol: number): void {
    const ctx = this.ctx!;
    for (const [off, v] of [[0, 1], [0.18, 0.7]] as const) {
      const at = ctx.currentTime + off;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, at);
      o.frequency.exponentialRampToValueAtTime(40, at + 0.12);
      const g = ctx.createGain();
      this.env(g, at, vol * v, 0.01, 0.16);
      o.connect(g).connect(this.sfx);
      o.start(at);
      o.stop(at + 0.2);
    }
  }

  stinger(): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const g = ctx.createGain();
    this.env(g, at, 0.12, 0.05, 2.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, at);
    lp.frequency.exponentialRampToValueAtTime(200, at + 2.8);
    lp.connect(g).connect(this.sfx);
    for (const f of [65.4, 69.3, 98, 138.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(at);
      o.stop(at + 3);
    }
    const n = this.noiseSrc(at, 1.5);
    const ng = ctx.createGain();
    this.env(ng, at, 0.06, 0.6, 0.8);
    n.connect(ng).connect(this.sfx);
  }

  chime(): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, at + i * 0.09, 0.07, 0.01, 0.6);
      o.connect(g).connect(this.sfx);
      o.start(at + i * 0.09);
      o.stop(at + i * 0.09 + 0.7);
    });
  }

  gunshot(kind: WeaponKind): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const big = kind === 'shotgun', sharp = kind === 'rifle';
    const n = this.noiseSrc(at, big ? 0.5 : 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(big ? 2600 : sharp ? 5200 : 3800, at);
    bp.frequency.exponentialRampToValueAtTime(300, at + (big ? 0.4 : 0.18));
    const g = ctx.createGain();
    this.env(g, at, big ? 0.55 : sharp ? 0.3 : 0.38, 0.002, big ? 0.45 : 0.16);
    n.connect(bp).connect(g).connect(this.sfx);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(big ? 90 : 130, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.15);
    const og = ctx.createGain();
    this.env(og, at, big ? 0.5 : 0.3, 0.002, 0.15);
    o.connect(og).connect(this.sfx);
    o.start(at);
    o.stop(at + 0.2);
  }

  click(high = false): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 2400 : 1500;
    const g = ctx.createGain();
    this.env(g, at, 0.05, 0.001, 0.03);
    o.connect(g).connect(this.sfx);
    o.start(at);
    o.stop(at + 0.05);
  }

  thud(vol: number): void {
    const ctx = this.ctx!, at = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(35, at + 0.25);
    const g = ctx.createGain();
    this.env(g, at, vol, 0.004, 0.3);
    o.connect(g).connect(this.sfx);
    o.start(at);
    o.stop(at + 0.35);
    const n = this.noiseSrc(at, 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    this.env(ng, at, vol * 0.6, 0.003, 0.25);
    n.connect(lp).connect(ng).connect(this.sfx);
  }

  private engineOn(): void {
    if (this.engine || !this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.07, ctx.currentTime, 0.2);
    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(gain).connect(this.master);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, gain, lp };
  }

  private engineOff(): void {
    if (!this.engine || !this.ctx) return;
    const e = this.engine;
    e.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    e.osc.stop(this.ctx.currentTime + 0.6);
    e.osc2.stop(this.ctx.currentTime + 0.6);
    this.engine = null;
  }

  /** Per frame: react to events, pace footsteps and heartbeat, let nearby zombies groan. */
  update(s: GameState, events: readonly GameEvent[], dt: number, panOf: (x: number, y: number) => number): void {
    if (!this.ctx || this.muted) return;
    this.t += dt;
    const p = s.player.pos;
    const car = s.phase === 'playing' ? playerVehicle(s) : null;
    if (car) {
      this.engineOn();
      const f = 32 + Math.abs(car.speed) * 4.5;
      this.engine!.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
      this.engine!.osc2.frequency.setTargetAtTime(f * 0.5, this.ctx.currentTime, 0.08);
      this.engine!.lp.frequency.setTargetAtTime(300 + Math.abs(car.speed) * 60, this.ctx.currentTime, 0.1);
    } else this.engineOff();
    for (const e of events) {
      if (e.type === 'shot') this.gunshot(e.weapon);
      else if (e.type === 'reload') this.click();
      else if (e.type === 'empty') this.click(true);
      else if (e.type === 'pickup' || e.type === 'purchase') this.chime();
      else if (e.type === 'vehicle-crash') this.thud(Math.min(0.5, e.force / 25));
      else if (e.type === 'zombie-killed' && car) this.thud(0.3);
      else if (e.type === 'tier-up') this.stinger();
      else if (e.type === 'task-done') this.chime();
      else if (e.type === 'zombie-attack' || e.type === 'zombie-alert') {
        const z = s.zombies.find((q) => q.id === e.id);
        if (!z) continue;
        const d = Math.hypot(z.pos.x - p.x, z.pos.y - p.y);
        const vol = Math.min(0.35, 2.2 / (d + 2));
        if (e.type === 'zombie-attack') this.scream(panOf(z.pos.x, z.pos.y), vol * 1.4);
        else this.groan(panOf(z.pos.x, z.pos.y), vol, true);
      }
    }
    if (s.phase !== 'playing') return;

    if (this.t > this.nextSiren) { this.siren(); this.nextSiren = this.t + 25 + Math.random() * 30; }

    const sp = playerSpeed(s);
    if (!car && sp > 0.3 && this.t > this.nextStep) {
      this.footstep(Math.min(0.12, 0.04 + sp * 0.015));
      this.nextStep = this.t + Math.max(0.24, 0.62 - sp * 0.07);
    }

    let nearest = Infinity;
    for (const z of s.zombies) {
      const d = Math.hypot(z.pos.x - p.x, z.pos.y - p.y);
      nearest = Math.min(nearest, d);
      if (d > 22 || z.action === 'rise') continue;
      const due = this.groanAt.get(z.id) ?? this.t + Math.random() * 4;
      if (this.t >= due) {
        this.groan(panOf(z.pos.x, z.pos.y), Math.min(0.22, 1.6 / (d + 3)), z.action === 'chase');
        this.groanAt.set(z.id, this.t + (z.action === 'chase' ? 2 : 4.5) + Math.random() * 4);
      } else if (!this.groanAt.has(z.id)) this.groanAt.set(z.id, due);
    }

    const timeTight = s.remaining / s.timeLimit < 0.3;
    if ((timeTight || nearest < 6) && this.t > this.nextBeat) {
      const urgency = Math.max(timeTight ? 0.5 : 0, nearest < 6 ? 1 - nearest / 6 : 0);
      this.heartbeat(0.18 + urgency * 0.2);
      this.nextBeat = this.t + 60 / (75 + urgency * 70);
    }
  }
}
