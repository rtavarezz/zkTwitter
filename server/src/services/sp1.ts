import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { once } from 'events';
import { logger } from '../lib/logger.js';

export class Sp1UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sp1UnavailableError';
  }
}

export interface Groth16Payload {
  proof: unknown;
  publicSignals: string[];
}

export interface AggregationPayload {
  generation: Groth16Payload;
  social: Groth16Payload;
  sessionNonce: string;
  verifiedRoot: string;
  minVerifiedNeeded: number;
  targetGenerationId: number;
  selfNullifier: string;
  generationClaimHash: string;
  socialClaimHash: string;
}

export interface Sp1ProofArtifact {
  proof: string;
  public_values: string;
  vk_hash: string;
  metadata?: {
    self_nullifier: string;
    generation_id: number;
    social_level: number;
    claim_hash: string;
  };
}

async function ensureCliPath(): Promise<string> {
  const cliPath = process.env.SP1_PROVER_BIN;
  if (!cliPath) {
    throw new Sp1UnavailableError('SP1_PROVER_BIN env var not set');
  }
  await fs.access(cliPath);
  return cliPath;
}

// Aggregates generation and social Groth16 proofs into single SP1 proof.
// zkVM validates structure and binds to selfNullifier plus sessionNonce.
// In groth16 mode output is verifiable on-chain for around 270k gas.
export async function runSp1Aggregator(payload: AggregationPayload): Promise<Sp1ProofArtifact> {
  logger.info('[SP1 STEP 1] Checking SP1 CLI availability');
  const cliPath = await ensureCliPath();
  logger.info({ cliPath }, '[SP1 STEP 1] CLI path resolved');

  logger.info('[SP1 STEP 2] Creating temporary workspace for input payload');
  const workDir = await fs.mkdtemp(path.join(tmpdir(), 'sp1-input-'));
  const inputPath = path.join(workDir, `payload-${randomUUID()}.json`);
  logger.info({ inputPath }, '[SP1 STEP 2] Workspace created');

  logger.info('[SP1 STEP 3] Serializing Groth16 proofs for zkVM consumption');
  // zkVM expects proofs as JSON strings. Stringify proof objects but keep
  // publicSignals as string arrays for easier extraction in Rust.
  const serializedPayload = {
    generation: {
      proof: JSON.stringify(payload.generation.proof),
      publicSignals: payload.generation.publicSignals,
    },
    social: {
      proof: JSON.stringify(payload.social.proof),
      publicSignals: payload.social.publicSignals,
    },
    session_nonce: payload.sessionNonce,
    verified_root: payload.verifiedRoot,
    min_verified_needed: payload.minVerifiedNeeded,
    target_generation_id: payload.targetGenerationId,
    self_nullifier: payload.selfNullifier,
    generation_claim_hash: payload.generationClaimHash,
    social_claim_hash: payload.socialClaimHash,
  };
  await fs.writeFile(inputPath, JSON.stringify(serializedPayload, null, 2));
  logger.info('[SP1 STEP 3] Payload serialized and written to disk');

  logger.info('[SP1 STEP 4] Building CLI arguments');
  const proofMode = process.env.SP1_PROOF_MODE || 'compressed';

  // SP1 recommended workflow: execute mode for dev, compressed for testing, groth16 for production.
  // Execute runs zkVM without proof generation, under 1 sec.
  const isExecuteMode = proofMode === 'execute';
  const args = isExecuteMode ? ['execute', inputPath] : ['prove', inputPath];

  if (!isExecuteMode) {
    const network = process.env.SP1_NETWORK;
    if (network) {
      args.push('--network', network);
    }
    args.push('--proof', proofMode);
  }

  logger.info({ args, mode: proofMode }, '[SP1 STEP 4] CLI arguments prepared');

  // Timing per SP1 docs: execute under 1sec, compressed 10-20min, groth16 30min-2hr on local.
  const expectedTime = isExecuteMode ? '<1 sec' : '5-120 min';
  logger.info({ mode: proofMode }, `[SP1 STEP 5] Spawning SP1 (expected time: ${expectedTime})`);

  const child = spawn(cliPath, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  // Log progress every 30 seconds so we know it's still running
  const progressInterval = setInterval(() => {
    logger.info('[SP1 PROGRESS] Still proving... (this can take 5-120 min for local proving)');
  }, 30000);

  const [code] = (await once(child, 'close')) as [number];
  clearInterval(progressInterval);
  logger.info({ exitCode: code }, '[SP1 STEP 6] Prover process completed');

  await fs.rm(workDir, { recursive: true, force: true });
  logger.info('[SP1 STEP 7] Cleaned up temporary workspace');

  if (code !== 0) {
    logger.error({ exitCode: code, stdout }, '[SP1 ERROR] CLI exited with non-zero code');
    throw new Error(`SP1 CLI exited with code ${code}`);
  }

  logger.info('[SP1 STEP 8] Parsing proof artifact from CLI output');
  try {
    const artifact = JSON.parse(stdout) as Sp1ProofArtifact;
    logger.info(
      {
        proofLength: artifact.proof.length,
        publicValuesLength: artifact.public_values.length,
        vkHash: artifact.vk_hash.slice(0, 16) + '...',
        hasMetadata: !!artifact.metadata,
      },
      '[SP1 STEP 8] Proof artifact parsed successfully'
    );
    return artifact;
  } catch (error) {
    logger.error({ stdout, error }, '[SP1 ERROR] Failed to parse CLI output');
    throw new Error(`Failed to parse SP1 CLI output: ${stdout}`);
  }
}
