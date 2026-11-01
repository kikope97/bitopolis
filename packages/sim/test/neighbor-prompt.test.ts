import { describe, expect, it } from 'vitest';
import { applyCommand, buildNeighborRequest, COMARCA, comarcaMonth, createInitialState, createNeighbors, type GameState, hashState, NEIGHBOR_HEADER, neighborMenu, parseNeighbors } from '../src/index.ts';

function town(): GameState {
  const s = createInitialState({ seed: 8, aiMode: true });
  s.comarca.towns = createNeighbors(s);
  s.comarca.towns[0]!.treasury = 12_345;
  return s;
}

const answer = (s: GameState, f: (id: number, menu: string[]) => { accion: string; declaracion: string }) =>
  JSON.stringify({ alcaldes: Object.fromEntries(s.comarca.towns.map((t) => [`pueblo_${t.id}`, f(t.id, neighborMenu(s, t))])) });

describe('prompt de los alcaldes vecinos (2.5, bloque J)', () => {
  it('una petición para todos: datos en bandas (sin cifras de caja) y un enum por alcalde con su menú', () => {
    const s = town();
    const req = buildNeighborRequest(s);
    expect(req.user.startsWith(NEIGHBOR_HEADER)).toBe(true);
    expect(req.user).not.toContain('12345');
    expect(req.max).toBe(COMARCA.maxSaid);
    const props = (req.schema as { properties: { alcaldes: { properties: Record<string, { properties: { accion: { enum: string[] } } }> } } }).properties.alcaldes.properties;
    for (const t of s.comarca.towns) {
      expect(props[`pueblo_${t.id}`]!.properties.accion.enum).toEqual(neighborMenu(s, t));
      expect(req.user).toContain(t.mayor.name);
    }
  });

  it('valida: acción del menú y declaración sin cifras inventadas, sin nombres inventados y ≤ 140', () => {
    const s = town();
    const req = buildNeighborRequest(s);
    const [a, b, c] = s.comarca.towns.map((t) => t.id) as [number, number, number];
    const raw = answer(s, (id, menu) => {
      if (id === a) return { accion: 'felicitar', declaracion: 'Bitópolis es un buen vecino, lo digo alto y claro.' };
      if (id === b) return { accion: menu[0]!, declaracion: 'Os daremos 5000 euros si nos votáis.' };
      return { accion: 'bombardear', declaracion: 'Nada.' };
    });
    const { picks, invalid } = parseNeighbors(raw, req);
    expect(picks.find((p) => p.pueblo === a)!.declaracion).toBe('Bitópolis es un buen vecino, lo digo alto y claro.');
    // Cifra inventada: la acción vale, la declaración no (plantilla).
    expect(picks.find((p) => p.pueblo === b)!.declaracion).toBe('');
    expect(invalid).toEqual([c]);
    // Nombre inventado y demasiado larga.
    const raw2 = answer(s, () => ({ accion: 'nada', declaracion: 'Manolo dice que en la comarca hay que trabajar más.' }));
    expect(parseNeighbors(raw2, req).picks.every((p) => p.declaracion === '')).toBe(true);
    const raw3 = answer(s, () => ({ accion: 'nada', declaracion: 'Muy bien. '.repeat(20) }));
    expect(parseNeighbors(raw3, req).picks.every((p) => p.declaracion === '')).toBe(true);
    // JSON roto: todos a reglas.
    expect(parseNeighbors('{no', req).invalid).toHaveLength(s.comarca.towns.length);
  });

  it('de la respuesta al comando: lo que valida el servidor se aplica igual en dos copias', () => {
    const s = town();
    comarcaMonth(s, () => undefined);
    const req = buildNeighborRequest(s);
    const { picks } = parseNeighbors(answer(s, (_id, menu) => ({ accion: menu.at(-2)!, declaracion: 'Desde aquí, saludos a toda la comarca.' })), req);
    const x = structuredClone(s);
    const y = structuredClone(s);
    const cmd = { type: 'NeighborTurn' as const, month: s.comarca.turn!.month, picks };
    expect(applyCommand(x, cmd).ok).toBe(true);
    applyCommand(y, cmd);
    expect(hashState(x)).toBe(hashState(y));
    expect(x.comarca.towns.every((t) => t.saidBy === 'ia')).toBe(true);
  });
});
