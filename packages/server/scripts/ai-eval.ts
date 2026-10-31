/**
 * Evaluación de la IA del pueblo (2.0): simula partidas en Modo IA y, en cada
 * turno del pueblo, pide los lotes de vecinos como lo hace el servidor. Mide el
 * coste por turno y por hora de juego, la caché, las decisiones válidas, la
 * variedad (acciones, actitudes, gasto, planes) y el dinero que circula.
 *
 *   pnpm ai-eval --days 360 --seeds 3                  # simulador local, sin red
 *   pnpm ai-eval --replay e2e/fixtures/ia-replay.json   # respuestas grabadas
 *   BITOPOLIS_API_KEY=sk-ant-… pnpm ai-eval --live --record grabacion.json   (el proveedor sale de la key)
 *   … --share 50 --pace 7 --profile constructor --batch 15
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { REAL_MS_PER_DAY_AT_X1, TICKS_PER_DAY } from '@bitopolis/shared';
import {
  applyCommand,
  buildDirectorRequest,
  buildTurnRequest,
  type DirectorChoice,
  createInitialState,
  type GameState,
  parseDirector,
  parseTurn,
  PROFILES,
  profileRng,
  step,
  turnBatches,
  turnMenu,
  turnShared,
  type TurnAct,
} from '@bitopolis/sim';
import { costEur, DEFAULT_PRICES, modelFor, PROVIDER_INFO, providerFromKey, type ProviderId } from '../src/ai/catalog.ts';
import { type LLMProvider, type LLMRequest, type LLMResult, makeProvider, ReplayProvider } from '../src/ai/providers.ts';

const { values } = parseArgs({
  options: {
    days: { type: 'string', default: '360' },
    seeds: { type: 'string', default: '3' },
    profile: { type: 'string', default: 'constructor' },
    share: { type: 'string', default: '50' },
    pace: { type: 'string', default: '7' },
    batch: { type: 'string', default: '15' },
    live: { type: 'boolean', default: false },
    replay: { type: 'string' },
    record: { type: 'string' },
    out: { type: 'string' },
  },
});

const tokens = (s: string) => Math.ceil(s.length / 3.5);

/** Simulador sin red: elige con algo de sentido entre las acciones del menú. */
const simulated: LLMProvider = {
  async complete(req: LLMRequest): Promise<LLMResult> {
    if (req.user.startsWith('Director')) {
      const d = JSON.parse(req.user.slice(req.user.indexOf('\n') + 1)) as { presupuesto_drama: { sucesos_malos_que_caben: number }; menu: { id: string; malo: boolean; avisado: boolean }[] };
      const sucesos = [...d.menu.filter((m) => !m.malo).slice(0, 1), ...d.menu.filter((m) => m.malo && m.avisado).slice(0, d.presupuesto_drama.sucesos_malos_que_caben)];
      const avisos = d.menu.filter((m) => m.malo && !m.avisado).slice(0, 2);
      const text = JSON.stringify({ sucesos: sucesos.map((m) => ({ id: m.id, motivo: 'Toca.' })), avisos: avisos.map((m) => ({ id: m.id, motivo: 'Se nota.' })), foco: 'La semana', cronica: 'Pasan cosas en el pueblo.' });
      return { text, usage: { in: tokens(req.system + (req.shared ?? '') + req.user), cachedIn: 0, out: tokens(text) } };
    }
    const list = JSON.parse(req.user.slice(req.user.indexOf('\n') + 1)) as {
      vecino: number;
      nombre: string;
      acciones: string[];
      con_quien: { id: number }[];
      necesidades: string[];
      bolsillo: string;
    }[];
    const voces = ['Aquí estoy bien y no pienso moverme.', 'Esto hay que decirlo alto y claro.', 'A ver si el alcalde se entera de una vez.', 'Con calma, que las prisas no traen nada bueno.', 'Si no lo hago ahora, no lo hago nunca.'];
    const decisiones = list.map((v, i) => {
      const acts = v.acciones.map((a) => a.split(' ')[0]!);
      const accion = acts[(v.vecino * 3 + i) % acts.length]!;
      return {
        vecino: v.vecino,
        accion: accion === 'irse' || accion === 'robar' ? 'seguir' : accion,
        gesto: { con: v.con_quien[0]?.id ?? 0, tipo: v.con_quien.length && i % 3 === 0 ? 'acercarse' : 'ninguno' },
        actitud: (v.vecino % 5) - 2,
        gasto: { donde: v.bolsillo === 'holgado' ? 'pueblo' : 'ahorrar', tienda: 0, ocio: v.bolsillo === 'holgado' },
        plan: i % 7 === 0 && v.necesidades.length ? { tipo: 'protestar_si_no', necesidad: v.necesidades[0]!, meses: 3 } : { tipo: 'ninguno', necesidad: '', meses: 0 },
        pensamiento: voces[(v.vecino + i) % voces.length]!,
        motivo: voces[(v.vecino * 7 + i) % voces.length]!,
        recuerdo: i % 2 ? 'Fui a la tienda del pueblo.' : '',
      };
    });
    const text = JSON.stringify({ decisiones });
    return { text, usage: { in: tokens(req.system + (req.shared ?? '') + req.user), cachedIn: 0, out: tokens(text) } };
  },
};

const provider: ProviderId = providerFromKey(process.env.BITOPOLIS_API_KEY, process.env.BITOPOLIS_AI_BASE_URL);
const model = modelFor(provider, process.env.BITOPOLIS_AI_MODEL, 'cheap');
const directorModel = modelFor(provider, process.env.BITOPOLIS_AI_DIRECTOR_MODEL ?? process.env.BITOPOLIS_AI_MODEL, 'premium');
const recordings = new Map<string, LLMResult>();
let llm: LLMProvider = simulated;
let source = 'simulador local (sin red)';
if (values.replay) {
  const data = JSON.parse(readFileSync(values.replay, 'utf8')) as Record<string, LLMResult>;
  llm = new ReplayProvider(new Map(Object.entries(data)), (req) => {
    throw new Error(`sin grabación ${ReplayProvider.key(req)}`);
  });
  source = `ReplayProvider (${values.replay})`;
} else if (values.live) {
  llm = makeProvider(provider, process.env.BITOPOLIS_API_KEY, process.env.BITOPOLIS_AI_BASE_URL);
  source = `${PROVIDER_INFO[provider].label} · ${model} (en vivo)`;
}

const days = Number(values.days);
const share = Number(values.share);
const pace = Number(values.pace);
const batchSize = Number(values.batch);
const profile = PROFILES[values.profile]!;
const totals = { turns: 0, calls: 0, citizens: 0, parsed: 0, valid: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, errors: 0, retries: 0, latencyMs: [] as number[] };
const actions: Record<string, number> = {};
const attitude: Record<string, number> = {};
const spending: Record<string, number> = {};
let plans = 0;
let gestures = 0;
const thoughts: string[] = [];
const notes: string[] = [];
const dir = { calls: 0, valid: 0, tokensIn: 0, tokensCached: 0, tokensOut: 0, picked: {} as Record<string, number>, warned: {} as Record<string, number>, fired: 0, chronicles: [] as string[] };
const shopSales: number[] = [];

for (let seed = 1; seed <= Number(values.seeds); seed++) {
  const state: GameState = createInitialState({ seed, aiMode: true, aiShare: share });
  state.ai!.paceDays = pace;
  const prng = profileRng(seed);
  for (let d = 0; d < days; d++) {
    for (const cmd of profile.decide(state, prng)) applyCommand(state, cmd);
    for (let h = 0; h < TICKS_PER_DAY; h++) {
      step(state);
      const t = state.ai?.turn;
      if (!t || t.opened !== state.tick) continue;
      totals.turns++;
      const shared = turnShared(state);
      const acts: TurnAct[] = [];
      const queue = turnBatches(state, batchSize).map((ids) => ({ ids, retry: true }));
      for (let qi = 0; qi < queue.length; qi++) {
        const { ids, retry } = queue[qi]!;
        const req = buildTurnRequest(state, ids, shared);
        totals.calls++;
        if (retry) totals.citizens += ids.length;
        else totals.retries++;
        try {
          const t0 = performance.now();
          const r = await llm.complete({ system: req.system, shared: req.shared, user: req.user, schema: req.schema, model, maxTokens: 400 + ids.length * 320 });
          totals.latencyMs.push(performance.now() - t0);
          if (values.record) recordings.set(ReplayProvider.key({ system: req.system, shared: req.shared, user: req.user }), r);
          totals.tokensIn += r.usage.in || tokens(req.system + req.shared + req.user);
          totals.tokensCached += r.usage.cachedIn;
          totals.tokensOut += r.usage.out || tokens(r.text);
          const parsed = parseTurn(r.text, ids, `${req.shared}\n${req.user}`);
          totals.parsed += parsed.acts.length;
          for (const a of parsed.acts) {
            const c = state.citizens.find((x) => x.id === a.vecino);
            if (c && turnMenu(state, c).some((m) => m.accion === a.accion)) totals.valid++;
            const verb = a.accion.split(':')[0]!;
            actions[verb] = (actions[verb] ?? 0) + 1;
            attitude[String(a.actitud)] = (attitude[String(a.actitud)] ?? 0) + 1;
            spending[a.gasto.donde] = (spending[a.gasto.donde] ?? 0) + 1;
            if (a.plan.tipo !== 'ninguno') plans++;
            if (a.gesto.tipo !== 'ninguno') gestures++;
            if (a.pensamiento) thoughts.push(a.pensamiento);
            if (a.recuerdo) notes.push(a.recuerdo);
          }
          acts.push(...parsed.acts);
          // Como el servidor: a los que se deja, una segunda pregunta.
          if (retry && parsed.missing.length && parsed.missing.length < ids.length) queue.push({ ids: parsed.missing, retry: false });
        } catch (e) {
          totals.errors++;
          if (totals.errors <= 3) console.error('error de la IA:', (e as Error).message);
        }
      }
      // Director (turnos semanales).
      let director: { director: DirectorChoice; focus: string; chronicle: string } | null = null;
      if (t.kind === 'semana') {
        const req = buildDirectorRequest(state, shared);
        dir.calls++;
        try {
          const r = await llm.complete({ system: req.system, shared: req.shared, user: req.user, schema: req.schema, model: directorModel, maxTokens: 900 });
          if (values.record) recordings.set(ReplayProvider.key({ system: req.system, shared: req.shared, user: req.user }), r);
          dir.tokensIn += r.usage.in || tokens(req.system + req.shared + req.user);
          dir.tokensCached += r.usage.cachedIn;
          dir.tokensOut += r.usage.out || tokens(r.text);
          director = parseDirector(r.text, req.ids, `${req.shared}\n${req.user}`);
          if (director) {
            dir.valid++;
            for (const x of director.director.sucesos) dir.picked[x.id.split(':')[0]!] = (dir.picked[x.id.split(':')[0]!] ?? 0) + 1;
            for (const x of director.director.avisos) dir.warned[x.id.split(':')[0]!] = (dir.warned[x.id.split(':')[0]!] ?? 0) + 1;
            if (director.chronicle) dir.chronicles.push(director.chronicle);
          }
        } catch (e) {
          totals.errors++;
          if (totals.errors <= 3) console.error('error del director:', (e as Error).message);
        }
      }
      if (acts.length) {
        applyCommand(state, { type: 'TownTurn', n: t.n, acts, ...(director ? { director: director.director, focus: director.focus, chronicle: director.chronicle } : {}) });
        if (director) dir.fired += state.ai!.log.at(-1)!.lines.filter((l) => l.text.startsWith('✦')).length;
      }
    }
  }
  for (const s of state.stats.slice(-12)) shopSales.push(s.margin ?? 0);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(2) : 100);
const perTurn = { tokensIn: totals.tokensIn / Math.max(1, totals.turns), tokensCached: totals.tokensCached / Math.max(1, totals.turns), tokensOut: totals.tokensOut / Math.max(1, totals.turns) };
// Turnos por hora real a x1: un día de juego son REAL_MS_PER_DAY_AT_X1 ms.
const turnsPerHourX1 = 3_600_000 / (REAL_MS_PER_DAY_AT_X1 * pace);
const costs = Object.fromEntries(
  Object.keys(DEFAULT_PRICES).map((m) => {
    const perT = costEur(DEFAULT_PRICES, m, 'anthropic', { in: perTurn.tokensIn, cachedIn: perTurn.tokensCached, out: perTurn.tokensOut });
    return [m, { eurPorTurno: +perT.toFixed(4), eurPorHoraX1: +(perT * turnsPerHourX1).toFixed(3) }];
  }),
);
const sorted = [...totals.latencyMs].sort((a, b) => a - b);
const report = {
  source,
  days,
  seeds: Number(values.seeds),
  share,
  pace,
  batch: batchSize,
  turns: totals.turns,
  calls: totals.calls,
  citizensAsked: totals.citizens,
  answeredPct: pct(totals.parsed, totals.citizens),
  validActionPct: pct(totals.valid, totals.parsed),
  errors: totals.errors,
  retries: totals.retries,
  perTurn,
  cachePct: pct(totals.tokensCached, totals.tokensIn),
  latencyMs: sorted.length ? { p50: Math.round(sorted[Math.floor(sorted.length / 2)]!), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]!) } : null,
  costByModel: costs,
  actions,
  attitude,
  negativeAttitudePct: pct((attitude['-1'] ?? 0) + (attitude['-2'] ?? 0), totals.parsed),
  spending,
  plans,
  gestures,
  distinctThoughtsPct: pct(new Set(thoughts).size, thoughts.length),
  sampleThoughts: [...new Set(thoughts)].slice(0, 10),
  notesPct: pct(notes.length, totals.parsed),
  sampleNotes: [...new Set(notes)].slice(-6),
  director: {
    model: directorModel,
    calls: dir.calls,
    validPct: pct(dir.valid, dir.calls),
    perCall: { tokensIn: dir.tokensIn / Math.max(1, dir.calls), tokensCached: dir.tokensCached / Math.max(1, dir.calls), tokensOut: dir.tokensOut / Math.max(1, dir.calls) },
    eurPorTurno: +costEur(DEFAULT_PRICES, directorModel, 'anthropic', { in: dir.tokensIn / Math.max(1, dir.calls), cachedIn: dir.tokensCached / Math.max(1, dir.calls), out: dir.tokensOut / Math.max(1, dir.calls) }).toFixed(4),
    picked: dir.picked,
    warned: dir.warned,
    fired: dir.fired,
    sampleChronicles: dir.chronicles.slice(-4),
  },
  avgBusinessMargin: shopSales.length ? Math.round(sum(shopSales) / shopSales.length) : 0,
};
if (values.record) writeFileSync(values.record, JSON.stringify(Object.fromEntries(recordings), null, 1));
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
// Con respuestas grabadas, cualquier petición sin grabación (el prompt ha cambiado) o
// inválida hace fallar el CI: hay que volver a grabar con `--live --record`.
if (values.replay && (report.errors > 0 || report.validActionPct < 95 || report.director.validPct < 95)) {
  console.error(`La grabación no cuadra con el prompt actual (errores: ${report.errors}, válidas: ${report.validActionPct} %, director: ${report.director.validPct} %). Vuelve a grabar con --live --record.`);
  process.exit(1);
}
