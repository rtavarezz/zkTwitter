import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { groth16, type Groth16Proof } from 'snarkjs';
import { logger } from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOCIAL_VKEY_PATH = path.resolve(__dirname, '../../circuits/social_proof_verification_key.json');

let cachedVerificationKey: unknown | null = null;

// Lazy-load the Groth16 verification key used by `/social/verify`.
async function loadVerificationKey() {
  if (cachedVerificationKey) {
    return cachedVerificationKey;
  }

  try {
    const raw = await fs.readFile(SOCIAL_VKEY_PATH, 'utf8');
    cachedVerificationKey = JSON.parse(raw);
    logger.info({ SOCIAL_VKEY_PATH }, 'Loaded social proof verification key');
    return cachedVerificationKey;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      throw new Error(`Social proof verification key missing at ${SOCIAL_VKEY_PATH}`);
    }
    throw error;
  }
}

export type SocialPublicSignals = {
  selfNullifier: string;
  sessionNonce: string;
  verifiedRoot: string;
  minVerifiedNeeded: bigint;
  isQualified: string;
  claimHash: string;
};

// Circuit outputs the public signals in this fixed order.
export function parseSocialPublicSignals(publicSignals: string[]): SocialPublicSignals {
  if (!Array.isArray(publicSignals) || publicSignals.length < 6) {
    throw new Error('Invalid public signals payload');
  }

  const [
    isQualified,
    claimHash,
    selfNullifier,
    sessionNonce,
    verifiedRoot,
    minVerifiedNeeded,
  ] = publicSignals;

  return {
    selfNullifier,
    sessionNonce,
    verifiedRoot,
    minVerifiedNeeded: BigInt(minVerifiedNeeded),
    isQualified,
    claimHash,
  };
}

// Step 3 of the social badge flow: actually verify the Groth16 proof and parse its public outputs.
export async function verifySocialProof(proof: Groth16Proof, publicSignals: string[]): Promise<SocialPublicSignals> {
  const verificationKey = await loadVerificationKey();
  const isValid = await groth16.verify(verificationKey, publicSignals, proof);

  if (!isValid) {
    throw new Error('Invalid Groth16 proof');
  }

  return parseSocialPublicSignals(publicSignals);
}
