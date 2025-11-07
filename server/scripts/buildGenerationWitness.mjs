import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import * as circomlib from 'circomlibjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(moduleDir, '..');

const DEFAULT_DUMP_DIR = resolveFromServer(process.env.SELF_PROOF_DUMP_DIR ?? 'tmp/self-proofs');
const OUTPUT_DIR = resolveFromServer(process.env.GENERATION_WITNESS_DIR ?? 'tmp/generation-witness');

// Versioned generation configuration to support circuit updates without breaking old proofs
const GENERATION_CONFIGS = {
  v1: {
    version: 1,
    createdAt: '2025-11-06',
    description: 'Initial generation configuration',
    ranges: [
      { id: 0, label: 'Gen Z', minYear: 1997, maxYear: 2012 },
      { id: 1, label: 'Millennial', minYear: 1981, maxYear: 1996 },
      { id: 2, label: 'Gen X', minYear: 1965, maxYear: 1980 },
      { id: 3, label: 'Boomer', minYear: 1946, maxYear: 1964 },
      { id: 4, label: 'Silent', minYear: 1928, maxYear: 1945 },
    ]
  }
};

// Default to latest version
const ACTIVE_CONFIG_VERSION = 'v1';
const GENERATION_CONFIG = GENERATION_CONFIGS[ACTIVE_CONFIG_VERSION].ranges;

function resolveFromServer(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(serverRoot, relativeOrAbsolute);
}

function usage() {
  console.error('Usage: node scripts/buildGenerationWitness.mjs [path/to/dump.json|--latest] [--target=<generationId>]');
  process.exit(1);
}

async function listFiles(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.map((name) => path.join(dir, name));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let dumpPath;
  let targetGenerationId;

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      usage();
    } else if (arg === '--latest') {
      dumpPath = '--latest';
    } else if (arg.startsWith('--target=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isNaN(value)) {
        console.error('Invalid --target value, must be a number.');
        usage();
      }
      targetGenerationId = value;
    } else if (!dumpPath) {
      dumpPath = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      usage();
    }
  }

  return { dumpPath, targetGenerationId };
}

async function pickLatestDump(dir) {
  const files = await listFiles(dir);
  if (files.length === 0) {
    throw new Error(`No dump files found in ${dir}. Run a verification flow first.`);
  }
  const sorted = files.sort((a, b) => b.localeCompare(a));
  return sorted[0];
}

function inferBirthYear(dob, now = new Date()) {
  if (!dob || dob.length < 6) {
    throw new Error(`Unexpected dateOfBirth format: "${dob}"`);
  }
  const yearTwoDigits = Number(dob.slice(4, 6));
  const currentYear = now.getFullYear();
  const pivot = currentYear % 100;
  const century = yearTwoDigits <= pivot ? Math.floor(currentYear / 100) : Math.floor(currentYear / 100) - 1;
  return century * 100 + yearTwoDigits;
}

function inferBirthYearFromMinimumAge(minimumAge, now = new Date()) {
  // Conservative estimate: if user is >= minimumAge, assume they were born exactly minimumAge years ago
  // This is used when DOB is not disclosed but minimumAge check passed
  const currentYear = now.getFullYear();
  return currentYear - Number(minimumAge);
}

async function generateSessionNonce() {
  // Generate a random field element as hex string
  // Use 31 bytes to ensure it's within the BN128 field (< 254 bits)
  const randomHex = '0x' + randomBytes(31).toString('hex');
  return randomHex;
}

function pickGenerationId(year) {
  const match = GENERATION_CONFIG.find((range) => year >= range.minYear && year <= range.maxYear);
  return match?.id ?? null;
}

let poseidonInstance;
let poseidonField;

async function ensurePoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await circomlib.buildPoseidon();
    poseidonField = poseidonInstance.F;
  }
  return { poseidonInstance, poseidonField };
}

async function computeGenerationConfigHash(config) {
  const { poseidonInstance, poseidonField } = await ensurePoseidon();
  const inputs = [];
  for (const range of config) {
    inputs.push(BigInt(range.id));
    inputs.push(BigInt(range.minYear));
    inputs.push(BigInt(range.maxYear));
  }
  const hash = poseidonInstance(inputs);
  return poseidonField.toString(hash);
}

async function main() {
  const { dumpPath: argDumpPath, targetGenerationId } = parseArgs(process.argv);

  const dumpPath =
    !argDumpPath || argDumpPath === '--latest'
      ? await pickLatestDump(DEFAULT_DUMP_DIR)
      : path.isAbsolute(argDumpPath)
      ? argDumpPath
      : path.resolve(process.cwd(), argDumpPath);

  const raw = await fs.readFile(dumpPath, 'utf8');
  const parsedDump = JSON.parse(raw);

  const {
    capturedAt,
    context,
    proof: { attestationId, proof, pubSignals, userContextData },
    verification,
  } = parsedDump;

  // Gracefully handle missing DOB - try to infer from minimumAge if available
  let birthYear;
  let birthYearSource;

  const dob = verification.discloseOutput.dateOfBirth;
  const minimumAge = verification.discloseOutput.minimumAge;

  // Check if DOB is disclosed (not empty or null bytes)
  const hasDOB = dob && dob.trim() && dob !== '\u0000\u0000\u0000\u0000\u0000\u0000';

  if (hasDOB) {
    birthYear = inferBirthYear(dob);
    birthYearSource = 'dateOfBirth';
  } else if (minimumAge) {
    birthYear = inferBirthYearFromMinimumAge(minimumAge);
    birthYearSource = 'minimumAge_estimate';
    console.warn(`DOB not disclosed. Estimating birth year from minimumAge=${minimumAge}: ${birthYear}`);
  } else {
    throw new Error(
      'Cannot determine birth year: dateOfBirth not disclosed and minimumAge not available'
    );
  }

  const detectedGenerationId = pickGenerationId(birthYear);

  const generationId = targetGenerationId ?? detectedGenerationId;
  if (generationId === null || generationId === undefined) {
    throw new Error(
      `Birth year ${birthYear} (source: ${birthYearSource}) does not fall into any configured generation range. ` +
        'Provide --target=<id> to override or update the configuration.'
    );
  }
  const generationRange = GENERATION_CONFIG.find((range) => range.id === generationId);
  if (!generationRange) {
    throw new Error(`Generation id ${generationId} is not configured.`);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const generationConfigHash = await computeGenerationConfigHash(GENERATION_CONFIG);

  // Generate session nonce for replay protection
  const sessionNonce = await generateSessionNonce();

  // Extract Self nullifier for binding
  const selfNullifier = verification.discloseOutput.nullifier;
  if (!selfNullifier) {
    throw new Error('Self nullifier missing from verification output - cannot generate witness');
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceDump: path.relative(process.cwd(), dumpPath),
    capturedAt,
    context,
    selfProof: {
      attestationId,
      proof,
      pubSignals,
      userContextData,
      nullifier: selfNullifier.toString(),
    },
    verification: {
      isValidDetails: verification.isValidDetails,
      discloseOutput: verification.discloseOutput,
      userData: verification.userData,
    },
    derived: {
      birthYear,
      birthYearSource,
      generationId,
      generationLabel: generationRange.label,
      generationBounds: {
        minYear: generationRange.minYear,
        maxYear: generationRange.maxYear,
      },
    },
    generationConfig: {
      version: ACTIVE_CONFIG_VERSION,
      versionMetadata: GENERATION_CONFIGS[ACTIVE_CONFIG_VERSION],
      ranges: GENERATION_CONFIG,
      hash: generationConfigHash,
    },
    sessionBinding: {
      sessionNonce,
      sessionId: context.sessionId || context.userId,
      note: 'Session nonce prevents proof replay across different login/registration sessions'
    },
  };

  const outFileName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${context.action}_${context.handle}_generation_witness.json`;
  const outPath = path.join(OUTPUT_DIR, outFileName);
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`Generation witness written to ${outPath}`);
  console.log(`Detected generation: ${generationRange.label} (${generationRange.minYear}-${generationRange.maxYear})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
