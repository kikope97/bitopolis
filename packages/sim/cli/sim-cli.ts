import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PROFILES, runSimulation } from '../src/index.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '42' },
    days: { type: 'string', default: '365' },
    profile: { type: 'string', default: 'casual' },
    out: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});

const profile = values.profile;
if (!PROFILES[profile]) {
  console.error(`Perfil desconocido "${profile}". Disponibles: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(2);
}
const t0 = performance.now();
const { report } = runSimulation({
  seed: Number(values.seed),
  days: Number(values.days),
  profile,
  checkEveryDay: values.check,
});
const ms = Math.round(performance.now() - t0);
const summary = { ...report, commands: report.commands.length, elapsedMs: ms };
if (values.out) {
  writeFileSync(values.out, JSON.stringify({ ...report, elapsedMs: ms }, null, 2));
}
console.log(JSON.stringify({ ...summary, monthly: undefined }, null, 2));
if (report.invariantErrors.length > 0) process.exit(1);
