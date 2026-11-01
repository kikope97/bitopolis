import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ScenarioId, TerrainShape } from '@bitopolis/shared';
import { PROFILES, runSimulation } from '../src/index.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '42' },
    days: { type: 'string', default: '365' },
    profile: { type: 'string', default: 'casual' },
    out: { type: 'string' },
    check: { type: 'boolean', default: false },
    // 2.3: escenario (libre, quiebra, vaciado, riada) y forma del terreno (aleatorio, rio, costa, colina, llano).
    scenario: { type: 'string', default: 'libre' },
    terrain: { type: 'string', default: 'aleatorio' },
  },
});

const profile = values.profile;
if (!PROFILES[profile]) {
  console.error(`Perfil desconocido "${profile}". Disponibles: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(2);
}
const scenario = ScenarioId.safeParse(values.scenario);
const terrain = TerrainShape.safeParse(values.terrain);
if (!scenario.success || !terrain.success) {
  console.error(`Escenario o terreno desconocido. Escenarios: ${ScenarioId.options.join(', ')}. Terrenos: ${TerrainShape.options.join(', ')}`);
  process.exit(2);
}
const t0 = performance.now();
const { report } = runSimulation({
  seed: Number(values.seed),
  days: Number(values.days),
  profile,
  checkEveryDay: values.check,
  scenario: scenario.data,
  terrain: terrain.data,
});
const ms = Math.round(performance.now() - t0);
const summary = { ...report, commands: report.commands.length, elapsedMs: ms };
if (values.out) {
  writeFileSync(values.out, JSON.stringify({ ...report, elapsedMs: ms }, null, 2));
}
console.log(JSON.stringify({ ...summary, monthly: undefined }, null, 2));
if (report.invariantErrors.length > 0) process.exit(1);
