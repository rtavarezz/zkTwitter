import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { once } from 'events';

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
  const cliPath = await ensureCliPath();
  const workDir = await fs.mkdtemp(path.join(tmpdir(), 'sp1-input-'));
  const inputPath = path.join(workDir, `payload-${randomUUID()}.json`);
  await fs.writeFile(inputPath, JSON.stringify(payload, null, 2));

  const args = ['prove', inputPath];
  const network = process.env.SP1_NETWORK;
  if (network) {
    args.push('--network', network);
  }
  const proofMode = process.env.SP1_PROOF_MODE;
  if (proofMode) {
    args.push('--proof', proofMode);
  }

  const child = spawn(cliPath, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  const [code] = (await once(child, 'close')) as [number];
  await fs.rm(workDir, { recursive: true, force: true });

  if (code !== 0) {
    throw new Error(`SP1 CLI exited with code ${code}`);
  }

  try {
    return JSON.parse(stdout) as Sp1ProofArtifact;
  } catch (error) {
    throw new Error(`Failed to parse SP1 CLI output: ${stdout}`);
  }
}
