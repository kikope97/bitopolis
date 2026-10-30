import { prefs } from './prefs.ts';

/**
 * Sonido sintetizado propio con WebAudio (estilo jsfxr): sin archivos ni
 * assets de terceros. Cada efecto lleva una pequeña variación de tono para
 * que no canse. La música es un ambiente generativo que cambia con la hora
 * del día. Efectos y música se silencian por separado (Ajustes).
 */
let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.35;
  sfxBus.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.08;
  musicBus.connect(ctx.destination);
  return ctx;
}

/** Los navegadores solo dejan sonar tras un gesto del usuario. */
export function unlockAudio(): void {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume();
}

let noiseBuf: AudioBuffer | null = null;
function noise(a: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return noiseBuf;
}

interface Note {
  wave?: OscillatorType | 'noise';
  from: number;
  to?: number;
  dur: number;
  vol?: number;
  at?: number;
}

/** Último instante de cada efecto: el mismo no suena dos veces en menos de 400 ms (a x10 era una ráfaga). */
const lastPlayed = new Map<string, number>();

function play(notes: Note[], bus: 'sfx' | 'music' = 'sfx', name = ''): void {
  const p = prefs();
  if (bus === 'sfx' ? !p.sfx : !p.music) return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  if (name) {
    const now = a.currentTime;
    if (now - (lastPlayed.get(name) ?? -1) < 0.4) return;
    lastPlayed.set(name, now);
  }
  const out = bus === 'sfx' ? sfxBus! : musicBus!;
  const vary = 1 + (Math.random() - 0.5) * 0.08;
  for (const n of notes) {
    const t0 = a.currentTime + (n.at ?? 0);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(n.vol ?? 0.6, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
    g.connect(out);
    if (n.wave === 'noise') {
      const s = a.createBufferSource();
      s.buffer = noise(a);
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(n.from * vary, t0);
      if (n.to) f.frequency.exponentialRampToValueAtTime(n.to, t0 + n.dur);
      s.connect(f).connect(g);
      s.start(t0);
      s.stop(t0 + n.dur);
    } else {
      const o = a.createOscillator();
      o.type = n.wave ?? 'square';
      o.frequency.setValueAtTime(n.from * vary, t0);
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to * vary, t0 + n.dur);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + n.dur + 0.02);
    }
  }
}

/** Catálogo de efectos. */
export const sfx = {
  tap: () => play([{ wave: 'square', from: 880, to: 660, dur: 0.05, vol: 0.25 }], 'sfx', 'tap'),
  build: () =>
    play([
      { wave: 'noise', from: 900, to: 200, dur: 0.18, vol: 0.5 },
      { wave: 'triangle', from: 140, to: 90, dur: 0.16, vol: 0.6 },
    ]),
  road: () => play([{ wave: 'noise', from: 2400, to: 600, dur: 0.07, vol: 0.3 }]),
  done: () =>
    play(
      [
      { wave: 'square', from: 523, dur: 0.09, vol: 0.3 },
      { wave: 'square', from: 659, dur: 0.09, vol: 0.3, at: 0.08 },
      { wave: 'square', from: 784, dur: 0.16, vol: 0.3, at: 0.16 },
      ],
      'sfx',
      'done',
    ),
  coin: () =>
    play(
      [
        { wave: 'triangle', from: 988, dur: 0.06, vol: 0.35 },
        { wave: 'triangle', from: 1319, dur: 0.14, vol: 0.35, at: 0.06 },
      ],
      'sfx',
      'coin',
    ),
  error: () => play([{ wave: 'sawtooth', from: 160, to: 110, dur: 0.18, vol: 0.3 }]),
  demolish: () =>
    play([
      { wave: 'noise', from: 600, to: 80, dur: 0.4, vol: 0.6 },
      { wave: 'triangle', from: 90, to: 40, dur: 0.3, vol: 0.5 },
    ]),
  arrival: () => play([{ wave: 'triangle', from: 660, to: 880, dur: 0.12, vol: 0.3 }], 'sfx', 'arrival'),
  milestone: () =>
    play([523, 659, 784, 1047].map((f, i) => ({ wave: 'square' as const, from: f, dur: 0.14, vol: 0.3, at: i * 0.09 }))),
  warn: () =>
    play([
      { wave: 'square', from: 440, dur: 0.1, vol: 0.25 },
      { wave: 'square', from: 349, dur: 0.18, vol: 0.25, at: 0.12 },
    ]),
};

/* ---------------- música / ambiente ---------------- */

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // pentatónica mayor
let musicTimer: number | null = null;
let step = 0;

/**
 * Ambiente generativo: de día, arpegio suave de pentatónica; de noche, más
 * lento y grave, con algún grillo. `night` lo da el render (hora del juego).
 */
export function startMusic(isNight: () => boolean): void {
  if (musicTimer !== null) return;
  // Frases de 8 notas con silencios de 4–8 s entre ellas; alguna nota se calla.
  let rest = 0;
  const tick = () => {
    const night = isNight();
    let wait = night ? 900 : 600;
    if (prefs().music) {
      if (rest > 0) {
        rest -= wait;
      } else {
        const base = night ? 196 : 262;
        const deg = SCALE[(step * 3 + (step >> 2) + (step >> 5)) % SCALE.length]!;
        if (Math.random() > 0.3) play([{ wave: 'triangle', from: base * 2 ** (deg / 12), dur: night ? 1.4 : 0.9, vol: 0.5 }], 'music');
        if (step % 8 === 0) play([{ wave: 'sine', from: base / 2, dur: 2.2, vol: 0.45 }], 'music');
        if (night && step % 5 === 2) play([{ wave: 'noise', from: 5200, to: 4800, dur: 0.05, vol: 0.12 }], 'music');
        step++;
        if (step % 8 === 0) rest = 4000 + Math.random() * 4000;
      }
    } else wait = 1000;
    musicTimer = window.setTimeout(tick, wait);
  };
  tick();
}

export function stopMusic(): void {
  if (musicTimer !== null) window.clearTimeout(musicTimer);
  musicTimer = null;
}
