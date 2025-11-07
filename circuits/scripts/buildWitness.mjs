import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.resolve(__dirname, '../build');
const WITNESS_DIR = path.resolve(__dirname, '../../server/tmp/generation-witness');

function uuidToFieldElement(uuid) {
  const hash = createHash('sha256').update(uuid).digest('hex');
  return BigInt('0x' + hash).toString();
}

const GENERATION_CONFIG = [
  { id: 0, minYear: 1997, maxYear: 2012 },  // Gen Z
  { id: 1, minYear: 1981, maxYear: 1996 },  // Millennial
  { id: 2, minYear: 1965, maxYear: 1980 },  // Gen X
  { id: 3, minYear: 1946, maxYear: 1964 },  // Boomer
  { id: 4, minYear: 1928, maxYear: 1945 },  // Silent
];

async function findLatestWitness() {
  const files = await fs.readdir(WITNESS_DIR);
  const sorted = files.filter(f => f.endsWith('.json')).sort().reverse();
  if (sorted.length === 0) {
    throw new Error('No witness files found. Run: npm run build-generation-witness');
  }
  return path.join(WITNESS_DIR, sorted[0]);
}

async function buildCircuitInput(witnessPath) {
  const raw = await fs.readFile(witnessPath, 'utf8');
  const witness = JSON.parse(raw);

  // Flatten generation config into circuit format: [id, minYear, maxYear, ...]
  const configArray = [];
  for (const gen of GENERATION_CONFIG) {
    configArray.push(gen.id.toString());
    configArray.push(gen.minYear.toString());
    configArray.push(gen.maxYear.toString());
  }

  const input = {
    selfNullifier: witness.selfProof.nullifier,
    sessionNonce: witness.sessionBinding.sessionNonce,
    generationConfigHash: witness.generationConfig.hash,
    targetGenerationId: witness.derived.generationId.toString(),
    generationConfig: configArray,
    birthYear: witness.derived.birthYear.toString(),
    userIdentifier: uuidToFieldElement(witness.verification.userData.userIdentifier),
  };

  return input;
}

async function main() {
  const witnessPath = process.argv[2] || await findLatestWitness();
  console.log(`Building circuit input from: ${witnessPath}`);

  const input = await buildCircuitInput(witnessPath);
  const outputPath = path.join(BUILD_DIR, 'input.json');

  await fs.mkdir(BUILD_DIR, { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(input, null, 2));

  console.log(`Circuit input written to: ${outputPath}`);
  console.log('\nInput summary:');
  console.log(`  User: ${input.userIdentifier}`);
  console.log(`  Birth year: ${input.birthYear}`);
  console.log(`  Target generation: ${input.targetGenerationId}`);
  console.log(`  Session nonce: ${input.sessionNonce.slice(0, 20)}...`);
}

main().catch(console.error);
