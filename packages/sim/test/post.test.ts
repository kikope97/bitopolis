import { TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  buildLetterRequest,
  checkInvariants,
  createInitialState,
  type GameState,
  grantOfferDays,
  hashState,
  LETTER_TEMPLATES,
  letterCandidates,
  letterText,
  moneyDrift,
  newBuilding,
  onCitizenLeaves,
  parseLetter,
  POST,
  postMonth,
  step,
  wouldReturn,
} from '../src/index.ts';

/** Pueblo con correos, una pareja (Ana y Luis) y otros vecinos; Luis se va hace dos meses. */
function fixture(opts: { post?: boolean } = {}) {
  const s = createInitialState({ seed: 21 });
  const base = s.citizens[0]!;
  for (let k = 0; k < 8; k++) s.citizens.push({ ...structuredClone(base), id: s.nextId++, jobId: null, named: true, relations: [], memories: [], name: ['Ana García', 'Luis Pérez', 'Marta Ruiz', 'Pedro Gil', 'Elena Sanz', 'Jorge León', 'Rosa Vidal', 'Iván Mora'][k]! });
  s.ledger.initialTotal += 8 * base.money;
  const ana = s.citizens.find((c) => c.name === 'Ana García')!;
  const luis = s.citizens.find((c) => c.name === 'Luis Pérez')!;
  ana.relations.push({ id: luis.id, kind: 'amistad', strength: 60, since: 0 });
  luis.relations.push({ id: ana.id, kind: 'amistad', strength: 60, since: 0 });
  s.tick = TICKS_PER_MONTH;
  onCitizenLeaves(s, luis);
  s.citizens = s.citizens.filter((c) => c !== luis);
  s.ledger.externalOut += luis.money;
  luis.money = 0;
  if (opts.post !== false) {
    const b = newBuilding(s, 'post', 20, 20, 0);
    b.built = true;
  }
  s.tick = 3 * TICKS_PER_MONTH;
  return { s, ana, luisId: luis.id };
}

/** Avanza mes a mes llamando a postMonth hasta que llega una carta (como mucho `months`). */
function untilLetter(s: GameState, months = 12, freeHome = false) {
  for (let m = 0; m < months; m++) {
    const n = s.letters.length;
    postMonth(s, freeHome);
    if (s.letters.length > n) return s.letters.at(-1)!;
    s.tick += TICKS_PER_MONTH;
  }
  return null;
}

describe('correos (2.5, bloque H)', () => {
  it('sin correos, la Diputación da 20 días para responder; con correos, 30', () => {
    const { s } = fixture({ post: false });
    expect(grantOfferDays(s)).toBe(POST.grantDaysWithout);
    newBuilding(s, 'post', 30, 30, 0).built = true;
    expect(grantOfferDays(s)).toBe(POST.grantDaysWith);
  });

  it('sin oficina de correos no llegan cartas', () => {
    const { s } = fixture({ post: false });
    expect(untilLetter(s, 24)).toBeNull();
  });

  it('escribe quien se fue a quien era su amistad; +ánimo y un recuerdo', () => {
    const { s, ana, luisId } = fixture();
    expect(letterCandidates(s).map((x) => [x.from.id, x.to.id])).toEqual([[luisId, ana.id]]);
    const h = ana.happiness;
    const l = untilLetter(s)!;
    expect(l).not.toBeNull();
    expect(l.from).toBe(luisId);
    expect(l.to).toBe(ana.id);
    expect(ana.happiness).toBeCloseTo(Math.min(100, h + POST.letterMood));
    expect(ana.memories.some((m) => m.kind === 'carta' && m.names?.[0] === 'Luis')).toBe(true);
    expect(Object.keys(l).sort()).toEqual(['from', 'id', 'template', 'tick', 'to']);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('como mucho una carta al mes y una por persona al año', () => {
    const { s } = fixture();
    // Más gente que se fue: tres amistades de Ana.
    for (let k = 0; k < 3; k++) {
      const c = s.citizens.find((x) => x.name !== 'Ana García' && x.relations.length === 0 && x.id !== s.citizens[0]!.id)!;
      const ana = s.citizens.find((x) => x.name === 'Ana García')!;
      ana.relations.push({ id: c.id, kind: 'amistad', strength: 60, since: 0 });
      c.relations.push({ id: ana.id, kind: 'amistad', strength: 60, since: 0 });
      onCitizenLeaves(s, c);
      s.citizens = s.citizens.filter((x) => x !== c);
    }
    s.tick += 2 * TICKS_PER_MONTH;
    const months = new Map<number, number>();
    for (let m = 0; m < 24; m++) {
      postMonth(s, false);
      postMonth(s, false); // dos veces el mismo mes: no llega otra
      s.tick += TICKS_PER_MONTH;
    }
    for (const l of s.letters) months.set(Math.floor(l.tick / TICKS_PER_MONTH), (months.get(Math.floor(l.tick / TICKS_PER_MONTH)) ?? 0) + 1);
    expect(s.letters.length).toBeGreaterThan(0);
    for (const n of months.values()) expect(n).toBeLessThanOrEqual(POST.lettersPerMonth);
    const byFrom = new Map<number, number[]>();
    for (const l of s.letters) byFrom.set(l.from, [...(byFrom.get(l.from) ?? []), l.tick]);
    for (const ticks of byFrom.values()) for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(POST.everyDays * TICKS_PER_DAY);
  });

  it('la vuelta es determinista (hash), y solo con el pueblo contento y casa libre', () => {
    const { s } = fixture();
    for (const c of s.citizens) c.happiness = 80;
    const ids = Array.from({ length: 400 }, (_, i) => 1_000 + i);
    const yes = ids.filter((id) => wouldReturn(s, id, true));
    expect(yes).toEqual(ids.filter((id) => wouldReturn(structuredClone(s), id, true)));
    // Alrededor del 10 %.
    expect(yes.length).toBeGreaterThan(20);
    expect(yes.length).toBeLessThan(70);
    expect(ids.some((id) => wouldReturn(s, id, false))).toBe(false);
    for (const c of s.citizens) c.happiness = 50;
    expect(ids.some((id) => wouldReturn(s, id, true))).toBe(false);
  });

  it('quien vuelve es el mismo vecino (mismo id) y la plantilla lo anuncia; el dinero cuadra', () => {
    // Busca una semilla en la que la primera carta trae de vuelta a quien escribe.
    for (let seed = 1; seed < 400; seed++) {
      const { s, luisId } = fixture();
      s.seed = seed;
      for (const c of s.citizens) c.happiness = 90;
      const drift = moneyDrift(s);
      const n = s.citizens.length;
      let back = null;
      for (let m = 0; m < 6 && !s.letters.length; m++) {
        back = postMonth(s, true);
        s.tick += TICKS_PER_MONTH;
      }
      if (!back) continue;
      expect(back.id).toBe(luisId);
      expect(back.name).toBe('Luis Pérez');
      expect(s.citizens.length).toBe(n + 1);
      expect(s.departed.some((d) => d.id === luisId)).toBe(false);
      expect(s.letters.at(-1)!.template).toBe('vuelvo');
      expect(moneyDrift(s)).toBe(drift);
      expect(checkInvariants(s)).toEqual([]);
      return;
    }
    throw new Error('ninguna semilla trae a nadie de vuelta');
  });

  it('las plantillas son texto válido en español con los nombres de pila', () => {
    const { s, ana, luisId } = fixture();
    for (const t of LETTER_TEMPLATES) {
      const text = letterText(s, { id: 1, from: luisId, to: ana.id, tick: s.tick, template: t });
      expect(text).toContain('Ana');
      expect(text).toContain('Luis');
      expect(text.length).toBeLessThanOrEqual(POST.maxText);
      expect(text).not.toMatch(/\d/);
    }
    // Una plantilla desconocida no rompe: sale la de siempre.
    expect(letterText(s, { id: 1, from: luisId, to: ana.id, tick: s.tick, template: 'otra' })).toContain('Ana');
  });

  it('la carta con IA: datos reales, y parseText rechaza cifras y nombres inventados', () => {
    const { s } = fixture();
    const l = untilLetter(s)!;
    const req = buildLetterRequest(s, l)!;
    expect(req.max).toBe(POST.maxText);
    const data = JSON.parse(req.user);
    expect(data.escribe.nombre).toBe('Luis Pérez');
    expect(data.para.nombre).toBe('Ana García');
    expect(data.pueblo.vecinos).toBe(s.citizens.length);
    const ok = JSON.stringify({ texto: 'Hola, Ana: te escribo desde lejos con mucho cariño. Un abrazo, Luis.' });
    expect(parseLetter(ok, req)).toMatch(/te escribo desde lejos/);
    expect(parseLetter(JSON.stringify({ texto: 'Ana, aquí gano 3517 euros al mes. Luis.' }), req)).toBeNull();
    expect(parseLetter(JSON.stringify({ texto: 'Ana, dale recuerdos a Gonzalo de mi parte. Luis.' }), req)).toBeNull();
    expect(parseLetter(JSON.stringify({ texto: 'x'.repeat(POST.maxText + 10) }), req)).toBeNull();
    expect(parseLetter('esto no es json', req)).toBeNull();
    // Nunca va texto del jugador: solo datos del motor.
    expect(req.user).not.toMatch(/apiKey|sk-/);
  });

  it('el texto no entra en el estado: pedir la carta no cambia el hash', () => {
    const { s } = fixture();
    const l = untilLetter(s)!;
    const h = hashState(s);
    buildLetterRequest(s, l);
    letterText(s, l);
    expect(hashState(s)).toBe(h);
  });

  it('una partida con correos sigue siendo determinista', () => {
    const a = fixture().s;
    const b = fixture().s;
    for (let i = 0; i < 24 * 90; i++) {
      step(a);
      step(b);
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(checkInvariants(a)).toEqual([]);
  });
});
