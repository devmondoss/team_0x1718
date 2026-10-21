import { iniciarFixtureAtomicMemory } from './atomicmemory-fixture';

/**
 * FIXTURE — levanta la imitación local de Atomic Memory para probar o grabar
 * las notas del analista sin credenciales reales. NO es el servicio real.
 *
 *   ATOMICMEMORY_FIXTURE_KEY=fixture-key npx tsx tests/fixtures/servir-atomicmemory-fixture.ts 17399
 */
const puerto = Number(process.argv[2] ?? 17399);
const apiKey = process.env.ATOMICMEMORY_FIXTURE_KEY ?? 'fixture-key';

void iniciarFixtureAtomicMemory({ apiKey, puerto }).then((fixture) => {
  console.log(`FIXTURE de Atomic Memory (no es el servicio real) en ${fixture.url}`);
  console.log(`  ATOMICMEMORY_API_URL=${fixture.url} ATOMICMEMORY_API_KEY=${apiKey}`);
  setInterval(() => console.log(`  ${fixture.filas.length} nota(s) en RAM`), 30_000).unref();
  process.on('SIGINT', () => void fixture.cerrar().then(() => process.exit(0)));
});
