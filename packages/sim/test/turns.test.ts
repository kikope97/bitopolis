import { Command, TICKS_PER_DAY, TICKS_PER_MONTH } from '@bitopolis/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  buildTurnRequest,
  checkInvariants,
  createInitialState,
  directorMenu,
  directorOwns,
  dramaBudget,
  buildDirectorRequest,
  parseDirector,
  type GameState,
  GESTURES,
  gestureCandidates,
  hashState,
  isAiCitizen,
  migrate,
  NEEDS,
  parseTurn,
  PLANS,
  runSimulation,
  SPEND,
  step,
  turnBatches,
  turnMenu,
  validateCommand,
} from '../src/index.ts';
import { FIRST_NAMES } from '../src/names.ts';

/** IA de pruebas: elige al azar (con su propio generador) entre todo lo que permite el menú. */
function fuzzTurn(seed: number) {
  let x = seed >>> 0 || 1;
  const rnd = (n: number) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
  return (state: GameState): Command | null => {
    const t = state.ai?.turn;
    if (!t) return null;
    const acts = t.ids
      .map((id) => state.citizens.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => {
        const menu = turnMenu(state, c).map((m) => m.accion);
        const others = gestureCandidates(state, c);
        return {
          vecino: c.id,
          accion: menu[rnd(menu.length)]!,
          gesto: { con: others.length ? others[rnd(others.length)]!.id : 0, tipo: GESTURES[rnd(GESTURES.length)]! },
          actitud: rnd(5) - 2,
          gasto: { donde: SPEND[rnd(SPEND.length)]!, tienda: 0, ocio: rnd(2) === 0 },
          plan: rnd(6) === 0 ? { tipo: PLANS[1 + rnd(PLANS.length - 1)]!, necesidad: NEEDS[rnd(NEEDS.length)]!, meses: 1 + rnd(6) } : { tipo: 'ninguno', necesidad: '', meses: 0 },
          pensamiento: 'Hoy pienso en el pueblo.',
          motivo: 'Porque toca.',
          recuerdo: rnd(2) ? `Semana ${t.n}: fui a la plaza.` : '',
        };
      });
    // Director al azar entre su menú (en los turnos semanales).
    const menu = directorMenu(state).map((m) => m.id);
    const some = () => menu.filter(() => rnd(3) === 0).map((id) => ({ id, motivo: 'Porque sí.' }));
    return { type: 'TownTurn', n: t.n, acts, ...(t.kind === 'semana' && rnd(4) > 0 ? { director: { sucesos: some(), avisos: some() }, focus: 'La semana', chronicle: 'Pasan cosas.' } : {}) };
  };
}

describe('turnos del pueblo con IA (2.0)', () => {
  it('en Modo IA se abre un turno cada semana; sin respuesta, deciden las reglas y el dinero cuadra', () => {
    const { state, report } = runSimulation({ seed: 3, days: 200, profile: 'constructor', aiMode: true, aiShare: 50, checkEveryDay: true });
    expect(report.invariantErrors).toEqual([]);
    expect(state.ai!.lastN).toBeGreaterThan(20);
    expect(state.ai!.log.every((l) => l.source === 'reglas')).toBe(true);
    // En Modo normal no hay turnos.
    const normal = runSimulation({ seed: 3, days: 30, profile: 'constructor' }).state;
    expect(normal.ai).toBeUndefined();
  }, 120_000);

  it('una IA que elige al azar entre todo lo posible durante años: dinero, deuda e invariantes intactos', () => {
    for (const seed of [1, 2, 3]) {
      const { state, report } = runSimulation({ seed, days: 900, profile: 'constructor', aiMode: true, aiShare: 100, checkEveryDay: true, onTurn: fuzzTurn(seed) });
      expect(report.invariantErrors).toEqual([]);
      expect(checkInvariants(state)).toEqual([]);
      expect(state.ai!.log.some((l) => l.source === 'ia')).toBe(true);
      expect(state.citizens.length).toBeGreaterThan(0);
      // El director ha hecho pasar cosas (líneas con ✦).
      expect(state.ai!.log.some((l) => l.lines.some((x) => x.text.startsWith('✦')))).toBe(true);
    }
  }, 600_000);

  it('es determinista: reproducir los comandos (con los turnos de la IA) da el mismo estado', () => {
    const { state, report } = runSimulation({ seed: 5, days: 240, profile: 'constructor', aiMode: true, aiShare: 60, onTurn: fuzzTurn(9) });
    const s = createInitialState({ seed: 5, aiMode: true, aiShare: 60 });
    const byTick = new Map<number, Command[]>();
    for (const c of report.commands) byTick.set(c.tick, [...(byTick.get(c.tick) ?? []), c.cmd]);
    // Mismo orden que el runner: los comandos del día, luego las horas (y el turno en su hora).
    for (const c of byTick.get(0) ?? []) applyCommand(s, c);
    while (s.tick < state.tick) {
      step(s);
      for (const c of byTick.get(s.tick) ?? []) expect(applyCommand(s, c).ok).toBe(true);
    }
    expect(hashState(s)).toBe(hashState(state));
  }, 120_000);

  it('cada parte se valida: una acción que no está en el menú se ignora; un turno cerrado se rechaza', () => {
    const { state } = runSimulation({ seed: 4, days: 120, profile: 'constructor', aiMode: true, aiShare: 100 });
    // Se avanza hasta que se abra un turno.
    let guard = 0;
    while (!state.ai!.turn && guard++ < 24 * 40) step(state);
    const t = state.ai!.turn!;
    const c = state.citizens.find((x) => t.ids.includes(x.id))!;
    const job = c.jobId;
    const bad = { vecino: c.id, accion: 'fundar:banco_suizo', gesto: { con: 0, tipo: 'ninguno' }, actitud: 2, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: 'Pienso.', motivo: 'Motivo.' };
    expect(applyCommand(state, { type: 'TownTurn', n: t.n, acts: [bad] }).ok).toBe(true);
    expect(c.jobId).toBe(job);
    expect(c.attitude).toBe(2);
    expect(c.thought).toBe('Pienso.');
    expect(validateCommand(state, { type: 'TownTurn', n: t.n, acts: [] }).ok).toBe(false);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('un ultimátum que vence sin cumplirse hace que el vecino se vaya', () => {
    const { state } = runSimulation({ seed: 2, days: 150, profile: 'constructor', aiMode: true, aiShare: 100 });
    const c = state.citizens.find((x) => x.named)!;
    c.plan = { kind: 'irse_si_no', need: 'colegio', until: state.tick + TICKS_PER_DAY, since: state.tick };
    // Sin colegio en el pueblo, para que no se cumpla.
    state.buildings = state.buildings.filter((b) => b.kind !== 'school');
    for (const x of state.citizens) if (x.jobId !== null && !state.buildings.some((b) => b.id === x.jobId)) x.jobId = null;
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) step(state);
    expect(state.citizens.includes(c)).toBe(false);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('una medida gorda del alcalde abre una reacción rápida del pueblo', () => {
    const { state } = runSimulation({ seed: 3, days: 100, profile: 'constructor', aiMode: true, aiShare: 100 });
    // Se espera a que no haya turno abierto.
    while (state.ai!.turn) step(state);
    expect(applyCommand(state, { type: 'SetMinimumWage', level: 'high' }).ok).toBe(true);
    expect(state.ai!.quick).toContain('sueldo mínimo');
    while (state.tick % TICKS_PER_DAY !== 0) step(state);
    step(state);
    const opened = state.ai!.turn ?? state.ai!.log.at(-1);
    expect(opened).toBeTruthy();
  }, 120_000);

  it('el % de vecinos con IA: al subirlo, más vecinos con nombre; nunca baja a nadie', () => {
    const { state } = runSimulation({ seed: 6, days: 300, profile: 'constructor', aiMode: true, aiShare: 10 });
    const before = state.citizens.filter((c) => c.named).length;
    expect(applyCommand(state, { type: 'SetAiShare', share: 90 }).ok).toBe(true);
    const after = state.citizens.filter((c) => c.named).length;
    expect(after).toBeGreaterThan(before);
    expect(applyCommand(state, { type: 'SetAiShare', share: 0 }).ok).toBe(true);
    expect(state.citizens.filter((c) => c.named).length).toBe(after);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('el prompt de un turno: bloque común igual en todos los lotes y respuesta validada', () => {
    const { state } = runSimulation({ seed: 3, days: 250, profile: 'constructor', aiMode: true, aiShare: 100 });
    while (!state.ai!.turn) step(state);
    const batches = turnBatches(state, 5);
    expect(batches.length).toBeGreaterThan(0);
    const a = buildTurnRequest(state, batches[0]!);
    const b = buildTurnRequest(state, batches.at(-1)!);
    expect(a.shared).toBe(b.shared);
    expect(a.system).toBe(b.system);
    const id = batches[0]![0]!;
    const sent = a.shared + a.user;
    const stranger = FIRST_NAMES.find((n) => !sent.includes(n))!;
    const good = JSON.stringify({ decisiones: [{ vecino: id, accion: 'seguir (nada)', gesto: { con: 0, tipo: 'ninguno' }, actitud: 9, gasto: { donde: 'pueblo', tienda: 0, ocio: true }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: `Hablo con ${stranger}.`, motivo: 'Bien.' }] });
    const r = parseTurn(good, batches[0]!, sent);
    expect(r.acts[0]!.accion).toBe('seguir');
    expect(r.acts[0]!.actitud).toBe(2);
    // Un nombre que no está en los datos se borra.
    expect(r.acts[0]!.pensamiento).toBe('');
    expect(parseTurn('no es json', batches[0]!, '').missing).toEqual(batches[0]);
  }, 120_000);

  it('migración 12→13: una partida en Modo IA recibe sus turnos (25 %)', () => {
    const { state } = runSimulation({ seed: 4, days: 60, profile: 'casual', aiMode: true });
    const old = { ...structuredClone(state), formatVersion: 12 } as Record<string, unknown>;
    delete old.ai;
    const m = migrate(old);
    expect(m.ai!.share).toBe(25);
    expect(m.ai!.next).toBeGreaterThan(m.tick);
    const normal = { ...structuredClone(runSimulation({ seed: 4, days: 10, profile: 'casual' }).state), formatVersion: 12 };
    expect(migrate(normal).ai).toBeUndefined();
    expect(TICKS_PER_MONTH).toBeGreaterThan(0);
  });

  it('director: lo malo solo pasa avisado antes y si cabe en el presupuesto de drama', () => {
    const { state } = runSimulation({ seed: 3, days: 260, profile: 'constructor', aiMode: true, aiShare: 100 });
    // Se fuerza un candidato malo: delincuencia alta en una tienda con caja.
    const shop = state.buildings.find((b) => b.kind === 'shop' && b.built && b.cash > 0);
    expect(shop).toBeTruthy();
    const open = () => {
      while (!state.ai!.turn || state.ai!.turn.kind !== 'semana') step(state);
      state.fields.crime[shop!.y * state.map.w + shop!.x] = 90;
      return state.ai!.turn!;
    };
    let t = open();
    const id = `robo_tienda:${shop!.id}`;
    expect(directorMenu(state).some((m) => m.id === id)).toBe(true);
    // Pueblo descontento para que quepa algo malo.
    for (const c of state.citizens) c.happiness = 30;
    expect(dramaBudget(state).bad).toBe(2);
    const robberies = state.justice.robberies;
    // Sin aviso previo: no pasa, se queda como aviso (con un vecino que sigue igual).
    {
      const c = state.citizens.find((x) => t.ids.includes(x.id))!;
      const keep = { vecino: c.id, accion: 'seguir', gesto: { con: 0, tipo: 'ninguno' }, actitud: 0, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: '', motivo: '' };
      expect(applyCommand(state, { type: 'TownTurn', n: t.n, acts: [keep], director: { sucesos: [{ id, motivo: 'Ya tocaba.' }], avisos: [{ id, motivo: 'Se huele.' }] } }).ok).toBe(true);
      expect(state.justice.robberies).toBe(robberies);
      expect(state.ai!.brewing!.some((b) => b.id === id)).toBe(true);
      expect(directorOwns(state)).toBe(true);
      // Turno siguiente: ya avisado, ahora sí pasa.
      t = open();
      for (const x of state.citizens) x.happiness = 30;
      const c2 = state.citizens.find((x) => t.ids.includes(x.id))!;
      expect(applyCommand(state, { type: 'TownTurn', n: t.n, acts: [{ ...keep, vecino: c2.id }], director: { sucesos: [{ id, motivo: 'Ya tocaba.' }], avisos: [] } }).ok).toBe(true);
      expect(state.justice.robberies).toBe(robberies + 1);
      expect(state.ai!.log.at(-1)!.lines[0]!.text).toContain('✦');
      // Con el pueblo contento, nada malo cabe.
      for (const x of state.citizens) x.happiness = 90;
      expect(dramaBudget(state).bad).toBe(0);
    }
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('director: sin respuesta, las reglas vuelven a tirar los dados; el prompt y la respuesta se validan', () => {
    const { state } = runSimulation({ seed: 2, days: 200, profile: 'constructor', aiMode: true, aiShare: 100, onTurn: fuzzTurn(4) });
    expect(state.ai!.directed === true || state.ai!.directed === false).toBe(true);
    // Un turno que vence sin respuesta devuelve los dados a las reglas.
    while (!state.ai!.turn || state.ai!.turn.kind !== 'semana') step(state);
    state.ai!.directed = true;
    const req = buildDirectorRequest(state);
    expect(req.user).toContain('presupuesto_drama');
    const sent = `${req.shared}\n${req.user}`;
    while (state.ai!.turn) step(state);
    expect(directorOwns(state)).toBe(false);
    // Ids fuera del menú y nombres inventados fuera.
    const stranger = FIRST_NAMES.find((n) => !sent.includes(n))!;
    const parsed = parseDirector(JSON.stringify({ sucesos: [{ id: 'robo_tienda:999999', motivo: 'x' }, ...(req.ids[0] ? [{ id: req.ids[0], motivo: `Lo dice ${stranger}.` }] : [])], avisos: [], foco: 'Semana tranquila', cronica: `${stranger} lo cuenta todo.` }), req.ids, sent);
    expect(parsed).not.toBeNull();
    expect(parsed!.director.sucesos.every((x) => req.ids.includes(x.id))).toBe(true);
    if (req.ids[0]) expect(parsed!.director.sucesos[0]!.motivo).toBe('');
    expect(parsed!.chronicle).toBe('');
    expect(parseDirector('nada', req.ids, sent)).toBeNull();
  }, 120_000);

  it('continuidad: cada vecino con IA guarda sus notas (4 como mucho) y su actitud se contagia a los vecinos por reglas', () => {
    // 2.1: con 11, la actitud media de ese pueblo se redondeaba a 0 y nadie la copiaba (depende del azar del fuzz).
    const { state } = runSimulation({ seed: 7, days: 300, profile: 'constructor', aiMode: true, aiShare: 40, onTurn: fuzzTurn(12) });
    const ais = state.citizens.filter((c) => c.named && c.notes?.length);
    expect(ais.length).toBeGreaterThan(0);
    expect(ais.every((c) => c.notes!.length <= 4)).toBe(true);
    // Las notas van al prompt del vecino la semana siguiente.
    while (!state.ai!.turn) step(state);
    const id = state.ai!.turn!.ids.find((x) => state.citizens.find((c) => c.id === x)?.notes?.length);
    if (id) expect(buildTurnRequest(state, [id]).user).toContain('sus_notas');
    // Contagio: vecinos que no piensan con IA con actitud (−1…1).
    const rules = state.citizens.filter((c) => !c.named && c.attitude !== undefined);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((c) => Math.abs(c.attitude!) <= 1)).toBe(true);
    expect(checkInvariants(state)).toEqual([]);
  }, 120_000);

  it('con el % de vecinos con IA a 0, el turno abierto vence y vuelven las reglas', () => {
    const { state } = runSimulation({ seed: 5, days: 120, profile: 'constructor', aiMode: true, aiShare: 60 });
    while (!state.ai!.turn) step(state);
    const n = state.ai!.turn!.n;
    state.ai!.share = 0;
    for (let i = 0; i < 24; i++) step(state);
    expect(state.ai!.turn).toBeNull();
    expect(state.ai!.log.at(-1)!.n).toBe(n);
    expect(state.citizens.some((c) => c.named && isAiCitizen(state, c))).toBe(false);
    for (let i = 0; i < 24 * 30; i++) step(state);
    expect(state.ai!.turn).toBeNull();
    expect(checkInvariants(state)).toEqual([]);
  });

  it('director justo (ronda 16): la delincuencia alta sin policía no sale gratis, lo robado no se repite y los ultimátums son justos', () => {
    const { state } = runSimulation({ seed: 3, days: 260, profile: 'constructor', aiMode: true, aiShare: 100 });
    while (!state.ai!.turn || state.ai!.turn.kind !== 'semana') step(state);
    const shop = state.buildings.find((b) => b.kind === 'shop' && b.built && b.cash > 0)!;
    state.buildings = state.buildings.filter((b) => b.kind !== 'police');
    for (const x of state.citizens) if (x.jobId !== null && !state.buildings.some((b) => b.id === x.jobId)) x.jobId = null;
    state.fields.crime[shop.y * state.map.w + shop.x] = 80;
    for (const c of state.citizens) c.happiness = 90;
    state.ai!.drama = undefined;
    const menu = directorMenu(state);
    expect(menu.find((m) => m.id === `robo_tienda:${shop.id}`)?.owed).toBe(true);
    // Pueblo contento, pero los datos lo justifican: cabe uno.
    expect(dramaBudget(state, menu).bad).toBe(1);
    // Robada hace poco: no vuelve al menú.
    state.justice.hot.push({ x: shop.x, y: shop.y, until: state.tick + 24 * 30 });
    expect(directorMenu(state).some((m) => m.id === `robo_tienda:${shop.id}`)).toBe(false);
    // Ultimátum de irse con el vecino feliz o por algo que no es lo suyo: no vale.
    const t = state.ai!.turn!;
    const c = state.citizens.find((x) => t.ids.includes(x.id) && !x.plan)!;
    const act = { vecino: c.id, accion: 'seguir', gesto: { con: 0, tipo: 'ninguno' }, actitud: 0, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'irse_si_no', necesidad: 'colegio', meses: 1 }, pensamiento: '', motivo: '' };
    expect(applyCommand(state, { type: 'TownTurn', n: t.n, acts: [act] }).ok).toBe(true);
    expect(c.plan).toBeUndefined();
    expect(checkInvariants(state)).toEqual([]);
  });

  it('ronda 17: un campo largo o raro de la IA nunca tumba el turno (la salida de parseTurn siempre es un comando válido)', () => {
    const ids = [1, 2];
    const raw = JSON.stringify({
      decisiones: [
        { vecino: 1, accion: 'aceptar_trabajo_en_la_fabrica_grande_del_pueblo:12', gesto: { con: 0, tipo: 'hacer_las_paces_con_todos_ya' }, actitud: 5, gasto: { donde: 'en_el_pueblo', tienda: 0, ocio: true }, plan: { tipo: 'irse_si_no_hay_colegio_pronto_de_verdad', necesidad: 'colegio_y_centro_de_salud', meses: 3 }, pensamiento: 'Bien.', motivo: 'Bien.', recuerdo: '', escudo: { pieza: 'pequeno_pero_valiente', lema: 'otro' } },
        { vecino: 2, accion: 'seguir', gesto: { con: 0, tipo: 'ninguno' }, actitud: 0, gasto: { donde: 'pueblo', tienda: 0, ocio: false }, plan: { tipo: 'ninguno', necesidad: '', meses: 0 }, pensamiento: '', motivo: '' },
      ],
    });
    const r = parseTurn(raw, ids, 'votacion_escudo "id":"torre"');
    expect(r.acts).toHaveLength(2);
    expect(r.acts[0]!.escudo).toBeUndefined();
    expect(Command.safeParse({ type: 'TownTurn', n: 1, acts: r.acts }).success).toBe(true);
  });
});
