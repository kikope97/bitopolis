import { lowMotion } from './prefs.ts';

/**
 * Feedback visual (spec §8.2): squash & stretch al construir, polvo al
 * terminar o derribar y monedas que vuelan al contador. Con movimiento
 * reducido o modo tranquilo no se anima nada.
 */
const pops = new Map<number, number>();

export interface Particle {
  /** Posición en píxeles de sprite (escala 1). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: number;
}
const particles: Particle[] = [];

/** Un edificio «salta» al aparecer o terminarse. */
export function pop(buildingId: number, now = performance.now()): void {
  if (lowMotion()) return;
  pops.set(buildingId, now);
}

/** Escala (ancho, alto) del edificio en este instante: 1,1 si no hay animación. */
export function squash(buildingId: number, now: number): [number, number] {
  const t0 = pops.get(buildingId);
  if (t0 === undefined) return [1, 1];
  const t = (now - t0) / 420;
  if (t >= 1) {
    pops.delete(buildingId);
    return [1, 1];
  }
  // Primero se aplasta, luego se estira y se asienta.
  const k = Math.sin(t * Math.PI * 2.5) * (1 - t) * 0.22;
  return [1 + k, 1 - k];
}

/** Nube de polvo en la casilla (tx, ty). */
export function dust(tx: number, ty: number, now = performance.now(), colors = [29, 30, 28]): void {
  if (lowMotion()) return;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const sp = 6 + (i % 4) * 3;
    particles.push({ x: tx * 32 + 16, y: ty * 32 + 26, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 6, born: now, life: 500 + (i % 3) * 120, color: colors[i % colors.length]! });
  }
  if (particles.length > 300) particles.splice(0, particles.length - 300);
}

/** Partículas vivas en `now` (posición ya calculada). */
export function liveParticles(now: number): { x: number; y: number; color: number; size: number }[] {
  const out: { x: number; y: number; color: number; size: number }[] = [];
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    const t = (now - p.born) / 1000;
    if (t * 1000 > p.life) {
      particles.splice(i, 1);
      continue;
    }
    out.push({ x: p.x + p.vx * t, y: p.y + p.vy * t + 18 * t * t, color: p.color, size: t * 1000 < p.life / 2 ? 2 : 1 });
  }
  return out;
}

/** Monedas que vuelan desde un punto de la pantalla hasta el contador de la caja. */
export function coins(fromX: number, fromY: number, n = 5): void {
  if (lowMotion()) return;
  const target = document.querySelector('#hud-money');
  if (!target) return;
  const r = target.getBoundingClientRect();
  const tx = r.left + r.width / 2;
  const ty = r.top + r.height / 2;
  for (let i = 0; i < Math.min(12, n); i++) {
    const c = document.createElement('div');
    c.className = 'coin';
    c.setAttribute('aria-hidden', 'true');
    c.style.left = `${fromX + (i % 3) * 6 - 6}px`;
    c.style.top = `${fromY + Math.floor(i / 3) * 4}px`;
    document.body.append(c);
    const anim = c.animate(
      [
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${(tx - fromX) * 0.4}px, ${ty - fromY - 60}px) scale(1.2)`, offset: 0.45 },
        { transform: `translate(${tx - fromX}px, ${ty - fromY}px) scale(0.6)` },
      ],
      { duration: 700 + i * 70, easing: 'cubic-bezier(.4,0,.6,1)', delay: i * 50 },
    );
    anim.onfinish = () => {
      c.remove();
      target.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 160 });
    };
  }
}

/* ---------------- sacudida de cámara (v1.1) ---------------- */

let shakeStart = -1;
let shakeAmp = 0;
let shakeMs = 0;

/**
 * Sacudida breve de la cámara. Poca y corta (regla de «game feel»: el feedback
 * acompaña, no tapa): 3 px al derribar, 6 px en la noche electoral. Nada con
 * movimiento reducido o en modo tranquilo.
 */
export function shake(amplitude: number, ms = 300, now = performance.now()): void {
  if (lowMotion()) return;
  // Si ya hay una más fuerte en curso, no se pisa.
  if (shakeStart >= 0 && now - shakeStart < shakeMs && shakeAmp > amplitude) return;
  shakeStart = now;
  shakeAmp = amplitude;
  shakeMs = ms;
}

/** Desplazamiento de la cámara en este instante (píxeles CSS, se escalan con el dpr). */
export function shakeOffset(now: number): [number, number] {
  if (shakeStart < 0) return [0, 0];
  const t = (now - shakeStart) / shakeMs;
  if (t >= 1 || lowMotion()) {
    shakeStart = -1;
    return [0, 0];
  }
  const a = shakeAmp * (1 - t) * (1 - t);
  return [Math.round(Math.sin(now * 0.09) * a), Math.round(Math.cos(now * 0.113) * a)];
}
