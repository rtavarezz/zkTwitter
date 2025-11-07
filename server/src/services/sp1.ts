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

export async function runSp1Aggregator(payload: AggregationPayload): Promise<Sp1ProofArtifact> {
  logger.info('[SP1 STEP 1] Checking SP1 CLI availability');
  const cliPath = await ensureCliPath();
  logger.info({ cliPath }, '[SP1 STEP 1] CLI path resolved');

  logger.info('[SP1 STEP 2] Creating temporary workspace for input payload');
  const workDir = await fs.mkdtemp(path.join(tmpdir(), 'sp1-input-'));
  const inputPath = path.join(workDir, `payload-${randomUUID()}.json`);
  logger.info({ inputPath }, '[SP1 STEP 2] Workspace created');

  logger.info('[SP1 STEP 3] Serializing Groth16 proofs for zkVM consumption');
  const serializedPayload = {
    ...payload,
    generation: {
      proof: JSON.stringify(payload.generation.proof),
      publicSignals: payload.generation.publicSignals,
    },
    social: {
      proof: JSON.stringify(payload.social.proof),
      publicSignals: payload.social.publicSignals,
    },
  };
  await fs.writeFile(inputPath, JSON.stringify(serializedPayload, null, 2));
  logger.info('[SP1 STEP 3] Payload serialized and written to disk');

  logger.info('[SP1 STEP 4] Building CLI arguments');
  const args = ['prove', inputPath];
  const network = process.env.SP1_NETWORK;
  if (network) {
    args.push('--network', network);
  }
  const proofMode = process.env.SP1_PROOF_MODE;
  if (proofMode) {
    args.push('--proof', proofMode);
  }
  logger.info({ args, network, proofMode }, '[SP1 STEP 4] CLI arguments prepared');

  logger.info('[SP1 STEP 5] Spawning SP1 prover (this may take several minutes depending on mode/network)');
  const child = spawn(cliPath, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  const [code] = (await once(child, 'close')) as [number];
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
