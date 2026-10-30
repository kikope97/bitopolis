/**
 * Evaluación de la IA (criterio de la v0.2): coste por mes de juego, % de
 * respuestas válidas y motivos. Simula partidas en Modo IA y, al cerrar cada
 * día, pide las decisiones pendientes como lo hace el servidor.
 *
 *   pnpm ai-eval --days 360 --seeds 3                  # simulador local, sin red
 *   pnpm ai-eval --replay e2e/fixtures/ia.json         # respuestas grabadas
 *   BITOPOLIS_AI_PROVIDER=openai BITOPOLIS_API_KEY=sk-… pnpm ai-eval --live --record grabacion.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { TICKS_PER_DAY } from '@bitopolis/shared';
import {
  applyCommand,
  buildDecisionRequest,
  createInitialState,
  type GameState,
  parseDecisions,
  PROFILES,
  profileRng,
  step,
} from '@bitopolis/sim';
import { costEur, DEFAULT_PRICES, PROVIDER_INFO, type ProviderId } from '../src/ai/catalog.ts';
import { type LLMProvider, type LLMRequest, type LLMResult, makeProvider, ReplayProvider } from '../src/ai/providers.ts';

const { values } = parseArgs({
  options: {
    days: { type: 'string', default: '360' },
    seeds: { type: 'string', default: '3' },
    profile: { type: 'string', default: 'casual' },
    live: { type: 'boolean', default: false },
    replay: { type: 'string' },
    record: { type: 'string' },
    out: { type: 'string' },
  },
});

const tokens = (s: string) => Math.ceil(s.length / 3.5);

/** Simulador sin red: elige con sentido entre las acciones y escribe un motivo variado. */
const simulated: LLMProvider = {
  async complete(req: LLMRequest): Promise<LLMResult> {
    const body = JSON.parse(req.user) as { vecinos: { vecino: number; nombre: string; acciones: { accion: string }[] }[] };
    const decisiones = body.vecinos.map((v, i) => ({
      vecino: v.vecino,
      accion: v.acciones[(v.vecino + i) % v.acciones.length]!.accion,
      motivo: `${v.nombre.split(' ')[0]} lo tiene claro: esto es lo que toca ahora.`,
    }));
    const text = JSON.stringify({ decisiones });
    return { text, usage: { in: tokens(req.system + req.user), cachedIn: 0, out: tokens(text) } };
  },
};

const provider: ProviderId = (process.env.BITOPOLIS_AI_PROVIDER as ProviderId) || 'openai';
const model = process.env.BITOPOLIS_AI_MODEL || PROVIDER_INFO[provider].cheap;
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

const totals = { calls: 0, requested: 0, validFirst: 0, validRetry: 0, fallback: 0, tokensIn: 0, tokensOut: 0, errors: 0 };
const motivos: string[] = [];
const days = Number(values.days);
const profile = PROFILES[values.profile]!;

for (let seed = 1; seed <= Number(values.seeds); seed++) {
  const state: GameState = createInitialState({ seed, aiMode: true });
  const prng = profileRng(seed);
  for (let d = 0; d < days; d++) {
    for (const cmd of profile.decide(state, prng)) applyCommand(state, cmd);
    for (let h = 0; h < TICKS_PER_DAY; h++) step(state);
    const pend = state.pending.filter((p) => p.dueTick > state.tick);
    if (pend.length === 0) continue;
    const req = buildDecisionRequest(state, pend);
    totals.calls++;
    totals.requested += pend.length;
    const call = async (system: string, user: string, list: typeof pend) => {
      const r = await llm.complete({ system, user, schema: buildDecisionRequest(state, list).schema, model, maxTokens: 200 + list.length * 120 });
      if (values.record) recordings.set(ReplayProvider.key({ system, user }), r);
      totals.tokensIn += r.usage.in || tokens(system + user);
      totals.tokensOut += r.usage.out || tokens(r.text);
      return parseDecisions(r.text, list);
    };
    try {
      let parsed = await call(req.system, req.user, pend);
      const apply = (ds: typeof parsed.decisions) => {
        for (const x of ds) {
          applyCommand(state, { type: 'CitizenAct', citizenId: x.citizenId, action: x.action, motivo: x.motivo, source: 'ai' });
          motivos.push(x.motivo);
        }
      };
      apply(parsed.decisions);
      totals.validFirst += parsed.decisions.length;
      if (parsed.invalid.length) {
        const again = pend.filter((p) => parsed.invalid.includes(p.citizenId));
        const r2 = buildDecisionRequest(state, again);
        parsed = await call(`${r2.system}\n\nTu respuesta anterior no era válida.`, r2.user, again);
        apply(parsed.decisions);
        totals.validRetry += parsed.decisions.length;
        totals.fallback += parsed.invalid.length;
      }
    } catch (e) {
      totals.errors++;
      totals.fallback += pend.length;
      if (totals.errors <= 3) console.error('error de la IA:', (e as Error).message);
    }
  }
}

const gameMonths = (days / 30) * Number(values.seeds);
const perMonth = { calls: totals.calls / gameMonths, tokensIn: totals.tokensIn / gameMonths, tokensOut: totals.tokensOut / gameMonths };
const costs = Object.fromEntries(
  Object.keys(DEFAULT_PRICES).map((m) => [m, +costEur(DEFAULT_PRICES, m, 'openai', { in: perMonth.tokensIn, cachedIn: 0, out: perMonth.tokensOut }).toFixed(5)]),
);
const resolved = totals.validFirst + totals.validRetry + totals.fallback;
const report = {
  source,
  days,
  seeds: Number(values.seeds),
  ...totals,
  validOrFallbackPct: totals.requested ? +((100 * resolved) / totals.requested).toFixed(2) : 100,
  validWithoutFallbackPct: totals.requested ? +((100 * (totals.validFirst + totals.validRetry)) / totals.requested).toFixed(2) : 100,
  perGameMonth: perMonth,
  eurPerGameMonthByModel: costs,
  distinctMotivosPct: motivos.length ? +((100 * new Set(motivos).size) / motivos.length).toFixed(1) : 0,
  sampleMotivos: [...new Set(motivos)].slice(0, 8),
};
if (values.record) writeFileSync(values.record, JSON.stringify(Object.fromEntries(recordings), null, 1));
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
