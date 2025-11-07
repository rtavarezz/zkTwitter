import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { groth16 } from 'snarkjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(__dirname, '../build/generationMembership_js/generationMembership.wasm');
const ZKEY_PATH = path.resolve(__dirname, '../build/generationMembership_final.zkey');

const GENERATION_CONFIG = [
  { id: 0, minYear: 1997, maxYear: 2012 }, // Gen Z
  { id: 1, minYear: 1981, maxYear: 1996 }, // Millennial
  { id: 2, minYear: 1965, maxYear: 1980 }, // Gen X
  { id: 3, minYear: 1946, maxYear: 1964 }, // Boomer
  { id: 4, minYear: 1928, maxYear: 1945 }, // Silent
];

const GENERATION_CONFIG_HASH = '20410492734497820080861672359265859434102176107885102445278438694323581735438';
const SELF_NULLIFIER = '8222833695484793693655664972457592856023758319486951690260161616247704983785';
const USER_IDENTIFIER = uuidToBigInt('cc19268e-f326-456a-87f0-4c2576ca55b7');
const SESSION_NONCE = uuidToBigInt('05620460-ebd4-414c-9f53-e6da9ebe7ba2');

function uuidToBigInt(uuid) {
  const hex = uuid.replace(/-/g, '');
  return BigInt(`0x${hex}`).toString();
}

function flattenConfig(config) {
  return config.flatMap(({ id, minYear, maxYear }) => [id, minYear, maxYear].map(String));
}

function buildInput(birthYear, overrides = {}) {
  return {
    selfNullifier: SELF_NULLIFIER,
    sessionNonce: SESSION_NONCE,
    generationConfigHash: GENERATION_CONFIG_HASH,
    targetGenerationId: '0', // Gen Z
    generationConfig: flattenConfig(GENERATION_CONFIG),
    birthYear: String(birthYear),
    userIdentifier: USER_IDENTIFIER,
    ...overrides,
  };
}

async function runCase(name, birthYear, expectMember) {
  console.log(`\n--- ${name} ---`);
  console.log(`Preparing witness: birthYear=${birthYear}, expectMember=${expectMember}`);

  const input = buildInput(birthYear);
  const { proof, publicSignals } = await groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
  const isMember = publicSignals[0];

  console.log(`[${name}] publicSignals = ${JSON.stringify(publicSignals)}`);
  assert.strictEqual(
    isMember,
    expectMember ? '1' : '0',
    `[${name}] Expected isMember=${expectMember ? 1 : 0}, got ${isMember}`
  );

  if (expectMember) {
    const claimedGeneration = Number(publicSignals[5]);
    assert.strictEqual(claimedGeneration, 0, `[${name}] Expected targetGenerationId=0`);
  }

  return { proof, publicSignals };
}

async function main() {
  console.log('Testing GenerationMembership circuit with real Self data');
  console.log(`Using WASM=${WASM_PATH}`);
  console.log(`Using ZKey=${ZKEY_PATH}`);
  console.log(`Generation config hash=${GENERATION_CONFIG_HASH}`);

  // Base case: real user born 2005 should be Gen Z
  const base = await runCase('Real proof birthYear=2005', 2005, true);

  // Min boundary
  await runCase('Boundary birthYear=1997', 1997, true);

  // Max boundary
  await runCase('Boundary birthYear=2012', 2012, true);

  // Rejection case: 1975 (Gen X) claiming Gen Z
  await runCase('Reject birthYear=1975', 1975, false);

  // Privacy check: ensure birth year does not leak in public signals
  const birthYearStr = '2005';
  const leaked = base.publicSignals.includes(birthYearStr);
  assert.strictEqual(leaked, false, 'Birth year leaked into public signals');

  console.log('[Privacy] Birth year not present in public signals');
  console.log('All generation circuit tests passed ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
