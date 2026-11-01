import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  buildPlenoRequest,
  closePleno,
  type GameState,
  hashState,
  OUTSIDE,
  parsePleno,
  PLENO_TALK,
  plenoLines,
  plenoPlan,
  plenoRuleLine,
  plenoReactionMenu,
  runSimulation,
  TREASURY,
  transfer,
  turnMenu,
} from '../src/index.ts';

let base: GameState | null = null;
function town(aiMode = false): GameState {
  if (!base) {
    base = runSimulation({ seed: 1, days: 200, profile: 'constructor' }).state;
    transfer(base, OUTSIDE, TREASURY, 20_000, 'subvencion');
  }
  const s = structuredClone(base);
  s.pleno = null;
  s.lastPlenoTick = -1;
  s.townhallLevel = Math.max(2, s.townhallLevel ?? 1);
  if (aiMode) {
    s.aiMode = true;
    s.ai = { share: 100, paceDays: 7, turn: null, lastN: 0, next: s.tick + 168, mayor: [], quick: null, lastQuick: -1e9, log: [] };
  }
  return s;
}

const answer = (lines: { vecino: number; postura: string; linea: string }[]) => JSON.stringify({ intervenciones: lines });

describe('plenos hablados (2.4)', () => {
  it('hasta 4 vecinos con nombre: quien pide, uno a favor y uno en contra', () => {
    const s = town();
    expect(applyCommand(s, { type: 'ConvenePleno' }).ok).toBe(true);
    const sp = s.pleno!.speakers!;
    expect(sp.length).toBeGreaterThanOrEqual(2);
    expect(sp.length).toBeLessThanOrEqual(PLENO_TALK.speakers);
    expect(sp[0]!.role).toBe('pide');
    expect(sp[0]!.id).toBe(s.pleno!.petitions[0]!.citizenId);
    for (const x of sp) expect(s.citizens.find((c) => c.id === x.id)?.named).toBe(true);
    expect(new Set(sp.map((x) => x.id)).size).toBe(sp.length);
    // Las plantillas: una línea por vecino, sin cifras y dentro del límite.
    const lines = plenoLines(s, s.pleno!);
    expect(lines.length).toBe(sp.length);
    for (const l of lines) {
      expect(l.linea.length).toBeLessThanOrEqual(PLENO_TALK.maxLine);
      expect(l.source).toBe('reglas');
    }
  }, 120_000);

  it('valida cada línea: cifras inventadas, nombres inventados o más de 140 caracteres no pasan', () => {
    const s = town();
    applyCommand(s, { type: 'ConvenePleno' });
    const p = s.pleno!;
    const req = buildPlenoRequest(s, p);
    const [a, b, c] = p.speakers!;
    const out = parsePleno(
      answer([
        { vecino: a!.id, postura: a!.postura, linea: 'Lo que pido es de justicia para el pueblo, y lo sabe todo el mundo.' },
        { vecino: b!.id, postura: b!.postura, linea: 'Ya van 4817 vecinos esperando, alcalde.' },
        ...(c ? [{ vecino: c.id, postura: c.postura, linea: 'x'.repeat(PLENO_TALK.maxLine + 5) }] : []),
      ]),
      req,
      p,
    );
    expect(out.map((x) => x.id)).toEqual([a!.id]);
    // Ronda 20: si el modelo cambia la postura, manda la del motor (no se tira la línea); un vecino que no habla, no.
    expect(parsePleno(answer([{ vecino: a!.id, postura: a!.postura === 'en_contra' ? 'a_favor' : 'en_contra', linea: 'Estoy muy de acuerdo con todo esto.' }]), req, p).map((x) => x.postura)).toEqual([a!.postura]);
    expect(parsePleno(answer([{ vecino: 999_999, postura: 'a_favor', linea: 'Estoy muy de acuerdo con todo esto.' }]), req, p)).toEqual([]);
    expect(parsePleno('no es json', req, p)).toEqual([]);
    // Las cifras de los datos sí valen (los votos).
    const pet = p.petitions[0]!;
    expect(parsePleno(answer([{ vecino: a!.id, postura: a!.postura, linea: `Somos ${pet.yes} a favor, alcalde.` }]), req, p).length).toBe(1);
    // Las que valen se mezclan con las plantillas del resto.
    const lines = plenoLines(s, p, out);
    expect(lines.find((l) => l.id === a!.id)?.source).toBe('ia');
    expect(lines.filter((l) => l.source === 'reglas').length).toBe(lines.length - 1);
  }, 120_000);

  it('el texto del pleno no cambia el estado ni el hash', () => {
    const s = town();
    applyCommand(s, { type: 'ConvenePleno' });
    const before = hashState(s);
    const req = buildPlenoRequest(s, s.pleno!);
    const sp = s.pleno!.speakers![0]!;
    plenoLines(s, s.pleno!, parsePleno(answer([{ vecino: sp.id, postura: sp.postura, linea: 'Pido lo que es justo para el pueblo.' }]), req, s.pleno!));
    expect(hashState(s)).toBe(before);
  }, 120_000);

  it('Modo normal: al responder, los que hablaron reaccionan por reglas según su postura', () => {
    const s = town();
    applyCommand(s, { type: 'ConvenePleno' });
    const pet = s.pleno!.petitions[0]!;
    const sp = s.pleno!.speakers!.filter((x) => x.petitionId === pet.id);
    const asker = s.citizens.find((c) => c.id === sp[0]!.id)!;
    asker.happiness = 50;
    expect(applyCommand(s, { type: 'AnswerPetition', petitionId: pet.id, answer: 'promise' }).ok).toBe(true);
    for (const x of sp) expect(x.reaction).toBeTruthy();
    expect(sp[0]!.reaction).toBe('aplaude');
    // +3 de prometer (si apoya) y la reacción.
    expect(asker.happiness).toBeGreaterThanOrEqual(50 + PLENO_TALK.reaction.aplaude!);
    const against = sp.find((x) => x.postura === 'en_contra');
    if (against) expect(['murmura', 'abuchea']).toContain(against.reaction);
  }, 120_000);

  it('Modo IA: quien habló espera a la reacción rápida (reaccion_pleno) y, si no llega, reacciona por reglas', () => {
    const s = town(true);
    applyCommand(s, { type: 'ConvenePleno' });
    const pet = s.pleno!.petitions[0]!;
    const sp = s.pleno!.speakers!.find((x) => x.petitionId === pet.id)!;
    const c = s.citizens.find((x) => x.id === sp.id)!;
    applyCommand(s, { type: 'AnswerPetition', petitionId: pet.id, answer: 'reject' });
    expect(sp.waiting).toBe('reject');
    expect(sp.reaction).toBeUndefined();
    // Pide reacción rápida y el menú tiene las 4 reacciones.
    expect(s.ai!.quick).toBeTruthy();
    expect(plenoReactionMenu(s, c).map((m) => m.accion)).toEqual(['reaccion_pleno:aplaude', 'reaccion_pleno:murmura', 'reaccion_pleno:abuchea', 'reaccion_pleno:se_levanta']);
    expect(turnMenu(s, c).some((m) => m.accion === 'reaccion_pleno:se_levanta')).toBe(true);
    const copy = structuredClone(s);
    // La IA elige en el turno: efecto determinista del motor.
    const t = { n: 1, opened: copy.tick, due: copy.tick + 12, kind: 'rapida' as const, ids: [c.id] };
    copy.ai!.turn = t;
    copy.ai!.lastN = 1;
    const cc = copy.citizens.find((x) => x.id === c.id)!;
    cc.happiness = 50;
    const act = { vecino: c.id, accion: 'reaccion_pleno:se_levanta', gesto: { con: 0, tipo: 'ninguno' }, actitud: -1, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: '', motivo: '' };
    expect(applyCommand(copy, { type: 'TownTurn', n: 1, acts: [act] }).ok).toBe(true);
    const spc = copy.pleno!.speakers!.find((x) => x.id === c.id)!;
    expect(spc.reaction).toBe('se_levanta');
    expect(cc.happiness).toBe(50 + PLENO_TALK.reaction.se_levanta!);
    // Sin respuesta de la IA: al cerrar el pleno, reglas.
    closePleno(s);
    expect(sp.reaction).toBeTruthy();
  }, 120_000);
});

describe('pleno: vista previa y plantilla de la oposición', () => {
  it('«Hoy pedirían» es justo lo que trae el pleno al convocarlo', () => {
    const s = town();
    const plan = plenoPlan(s);
    expect(plan.length).toBeGreaterThan(0);
    expect(applyCommand(s, { type: 'ConvenePleno' }).ok).toBe(true);
    expect(s.pleno!.petitions.map((p) => ({ citizenId: p.citizenId, need: p.need, ...(p.opposition ? { opposition: true } : {}) }))).toEqual(plan);
  }, 120_000);

  it('la oposición habla en primera persona y sin comillas anidadas', () => {
    const s = town();
    const leader = s.citizens.find((c) => c.named)!;
    s.politics.party = { leaderId: leader.id, leaderName: leader.name, name: 'Jóvenes por Bitópolis', faction: 'jovenes', founded: s.tick, promises: [], style: 'populista' };
    s.politics.mayor = 'player';
    const plan = plenoPlan(s);
    expect(plan.some((p) => p.opposition)).toBe(true);
    expect(applyCommand(s, { type: 'ConvenePleno' }).ok).toBe(true);
    const opp = s.pleno!.petitions.find((p) => p.opposition)!;
    for (let t = 0; t < 6; t++) {
      const line = plenoRuleLine(s, { ...s.pleno!, tick: s.pleno!.tick + t }, { id: leader.id, role: 'oposicion', postura: 'matiz', petitionId: opp.id });
      expect(line).not.toContain('«');
      expect(line).not.toContain(' pregunta al alcalde');
      expect(line).toMatch(/preguntamos|queremos/);
    }
  }, 120_000);
});
