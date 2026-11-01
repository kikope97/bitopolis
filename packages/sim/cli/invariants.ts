import { PROFILES, runSimulation } from '../src/index.ts';

/** Invariantes en CI: 365 días con varias semillas y todos los perfiles. */
const SEEDS = [1, 42, 1337, 2026, 99991];
const DAYS = 365;
let failed = false;
const t0 = performance.now();
for (const profile of Object.keys(PROFILES)) {
  for (const seed of SEEDS) {
    const a = runSimulation({ seed, days: DAYS, profile, checkEveryDay: true }).report;
    const b = runSimulation({ seed, days: DAYS, profile }).report;
    const problems = [...a.invariantErrors];
    if (a.stateHash !== b.stateHash) problems.push('misma semilla, distinto hash');
    if (a.moneyDrift !== 0) problems.push(`dinero descuadrado ${a.moneyDrift}`);
    const status = problems.length ? 'FALLA' : 'ok';
    console.log(`${status.padEnd(5)} ${profile.padEnd(12)} seed=${String(seed).padEnd(6)} pob=${a.final.population} caja=${a.final.treasury} quiebra=${a.bankruptDay ?? '-'}`);
    for (const p of problems.slice(0, 5)) console.log(`      ${p}`);
    if (problems.length) failed = true;
  }
}
// 2.3: cada escenario con dos perfiles y un terreno distinto por semilla.
const SHAPES = ['aleatorio', 'rio', 'costa', 'colina', 'llano'] as const;
for (const [si, scenario] of (['quiebra', 'vaciado', 'riada'] as const).entries()) {
  for (const profile of ['casual', 'constructor']) {
    for (const [k, seed] of SEEDS.slice(0, 2).entries()) {
      const terrain = SHAPES[(2 * si + k) % SHAPES.length]!;
      const a = runSimulation({ seed, days: DAYS, profile, checkEveryDay: true, scenario, terrain }).report;
      const b = runSimulation({ seed, days: DAYS, profile, scenario, terrain }).report;
      const problems = [...a.invariantErrors];
      if (a.stateHash !== b.stateHash) problems.push('misma semilla, distinto hash');
      if (a.moneyDrift !== 0) problems.push(`dinero descuadrado ${a.moneyDrift}`);
      console.log(`${(problems.length ? 'FALLA' : 'ok').padEnd(5)} ${`${scenario}/${terrain}`.padEnd(18)} ${profile.padEnd(12)} seed=${String(seed).padEnd(6)} pob=${a.final.population} caja=${a.final.treasury} meta=${a.scenario.won ? `mes ${a.scenario.month}` : '-'}`);
      for (const p of problems.slice(0, 5)) console.log(`      ${p}`);
      if (problems.length) failed = true;
    }
  }
}
console.log(`Tiempo total: ${Math.round(performance.now() - t0)} ms`);
process.exit(failed ? 1 : 0);
