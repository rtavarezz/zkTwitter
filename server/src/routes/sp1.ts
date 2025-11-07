import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { groth16, type Groth16Proof } from 'snarkjs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { getSocialConfig } from '../services/configService.js';
import { logger } from '../lib/logger.js';
import { runSp1Aggregator, Sp1UnavailableError, type AggregationPayload } from '../services/sp1.js';
import { getVerifiedUserTree } from '../services/merkleTree.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATION_VKEY_PATH = path.resolve(__dirname, '../../circuits/verification_key.json');
const SOCIAL_VKEY_PATH = path.resolve(__dirname, '../../circuits/social_proof_verification_key.json');

let generationVKey: unknown | null = null;
let socialVKey: unknown | null = null;

async function loadVerificationKeys() {
  if (!generationVKey) {
    const raw = await fs.readFile(GENERATION_VKEY_PATH, 'utf8');
    generationVKey = JSON.parse(raw);
  }
  if (!socialVKey) {
    const raw = await fs.readFile(SOCIAL_VKEY_PATH, 'utf8');
    socialVKey = JSON.parse(raw);
  }
  return { generationVKey, socialVKey };
}

const router = Router();

const GENERATION_CONFIG = [
  0, 1997, 2012, // Gen Z
  1, 1981, 1996, // Millennial
  2, 1965, 1980, // Gen X
  3, 1946, 1964, // Boomer
  4, 1928, 1945, // Silent
] as const;

const GENERATION_CONFIG_HASH = '20410492734497820080861672359265859434102176107885102445278438694323581735438';

const proofSchema = z.object({
  proof: z.unknown(),
  publicSignals: z.array(z.string()),
});

const aggregateSchema = z.object({
  generation: proofSchema,
  social: proofSchema,
  sessionNonce: z.string(),
  targetGenerationId: z.number().int().min(0).max(4),
  generationClaimHash: z.string(),
  socialClaimHash: z.string(),
});

const verifySchema = z.object({
  proof: z.string(),
  publicValues: z.string(),
  vkHash: z.string(),
  sessionNonce: z.string(),
  metadata: z.object({
    self_nullifier: z.string(),
    generation_id: z.number().int(),
    social_level: z.number().int(),
    claim_hash: z.string(),
  }),
});

router.get('/context', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    logger.info({ userId }, '[SP1 CONTEXT STEP 1] Fetching user Self nullifier');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { selfNullifier: true },
    });

    if (!user?.selfNullifier) {
      logger.warn({ userId }, '[SP1 CONTEXT] User missing Self nullifier');
      return res.status(400).json({ error: 'User missing Self nullifier. Please re-run Self verification.' });
    }
    logger.info({ userId }, '[SP1 CONTEXT STEP 1] Self nullifier retrieved');

    logger.info('[SP1 CONTEXT STEP 2] Loading social config and verified user tree');
    const socialConfig = await getSocialConfig();
    const tree = await getVerifiedUserTree();
    logger.info({ verifiedRoot: socialConfig.verifiedRoot, treeLeaves: tree.getZeroLeaf() }, '[SP1 CONTEXT STEP 2] Social config loaded');

    logger.info('[SP1 CONTEXT STEP 3] Generating fresh session nonce');
    // Generate nonce as a large decimal number (compatible with circuit field elements)
    const nonceBytes = randomBytes(31); // 31 bytes to fit in field element
    let nonceBigInt = BigInt(0);
    for (let i = 0; i < nonceBytes.length; i++) {
      nonceBigInt = (nonceBigInt << BigInt(8)) | BigInt(nonceBytes[i]!);
    }
    const sessionNonce = nonceBigInt.toString();

    await prisma.usedNonce.create({
      data: {
        scope: 'sp1',
        sessionNonce,
      },
    });
    logger.info({ sessionNonce: sessionNonce.slice(0, 16) + '...' }, '[SP1 CONTEXT STEP 3] Session nonce created and stored');

    const response = {
      selfNullifier: user.selfNullifier,
      generationConfig: GENERATION_CONFIG,
      generationConfigHash: GENERATION_CONFIG_HASH,
      socialConfig: {
        ...socialConfig,
        zeroLeaf: tree.getZeroLeaf(),
      },
      sessionNonce,
    };

    logger.info({ userId }, '[SP1 CONTEXT STEP 4] Returning context to client');
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post('/prove', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    logger.info({ userId }, '[SP1 PROVE STEP 1] Parsing aggregation request');
    const payload = aggregateSchema.parse(req.body);
    logger.info(
      {
        userId,
        targetGenerationId: payload.targetGenerationId,
        sessionNonce: payload.sessionNonce.slice(0, 16) + '...',
      },
      '[SP1 PROVE STEP 1] Request parsed successfully'
    );

    logger.info({ userId }, '[SP1 PROVE STEP 2] Fetching user Self nullifier');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { selfNullifier: true },
    });

    if (!user?.selfNullifier) {
      logger.warn({ userId }, '[SP1 PROVE] User missing Self nullifier');
      return res.status(400).json({ error: 'User missing Self nullifier. Please re-verify with Self.' });
    }
    logger.info({ userId }, '[SP1 PROVE STEP 2] Self nullifier retrieved');

    logger.info({ userId }, '[SP1 PROVE STEP 3] Loading social config');
    const socialConfig = await getSocialConfig();
    logger.info({ verifiedRoot: socialConfig.verifiedRoot, minVerifiedNeeded: socialConfig.minVerifiedNeeded }, '[SP1 PROVE STEP 3] Social config loaded');

    logger.info({ userId, sessionNonce: payload.sessionNonce.slice(0, 16) + '...' }, '[SP1 PROVE STEP 4] Validating session nonce');
    const nonce = await prisma.usedNonce.findUnique({
      where: { sessionNonce: payload.sessionNonce },
    });

    if (!nonce || nonce.scope !== 'sp1') {
      logger.warn({ userId, sessionNonce: payload.sessionNonce.slice(0, 16) + '...' }, '[SP1 PROVE] Invalid or expired session nonce');
      return res.status(400).json({ error: 'Unknown or expired session nonce.' });
    }
    logger.info({ userId }, '[SP1 PROVE STEP 4] Session nonce validated');

    logger.info({ userId }, '[SP1 PROVE STEP 5] Loading Groth16 verification keys');
    const { generationVKey, socialVKey } = await loadVerificationKeys();
    logger.info({ userId }, '[SP1 PROVE STEP 5] Verification keys loaded');

    logger.info({ userId }, '[SP1 PROVE STEP 6] Verifying generation Groth16 proof');
    logger.info({
      userId,
      publicSignalsCount: payload.generation.publicSignals.length,
      publicSignals: payload.generation.publicSignals.slice(0, 4).map((s: string) => s.slice(0, 20) + '...'),
    }, '[SP1 PROVE DEBUG] Generation proof public signals');

    const generationValid = await groth16.verify(
      generationVKey,
      payload.generation.publicSignals,
      payload.generation.proof as Groth16Proof
    );

    if (!generationValid) {
      logger.warn({
        userId,
        publicSignalsCount: payload.generation.publicSignals.length,
        firstSignal: payload.generation.publicSignals[0],
        secondSignal: payload.generation.publicSignals[1],
      }, '[SP1 PROVE] Generation proof verification FAILED');
      return res.status(400).json({ error: 'Invalid generation proof' });
    }
    logger.info({ userId }, '[SP1 PROVE STEP 6] Generation proof verified');

    logger.info({ userId }, '[SP1 PROVE STEP 7] Verifying social Groth16 proof');
    const socialValid = await groth16.verify(
      socialVKey,
      payload.social.publicSignals,
      payload.social.proof as Groth16Proof
    );

    if (!socialValid) {
      logger.warn({ userId }, '[SP1 PROVE] Social proof verification FAILED');
      return res.status(400).json({ error: 'Invalid social proof' });
    }
    logger.info({ userId }, '[SP1 PROVE STEP 7] Social proof verified');

    logger.info({ userId }, '[SP1 PROVE STEP 8] Both Groth16 proofs verified, preparing aggregation payload');
    const aggregationPayload: AggregationPayload = {
      generation: {
        proof: payload.generation.proof,
        publicSignals: payload.generation.publicSignals,
      },
      social: {
        proof: payload.social.proof,
        publicSignals: payload.social.publicSignals,
      },
      sessionNonce: payload.sessionNonce,
      verifiedRoot: socialConfig.verifiedRoot,
      minVerifiedNeeded: socialConfig.minVerifiedNeeded,
      targetGenerationId: payload.targetGenerationId,
      selfNullifier: user.selfNullifier,
      generationClaimHash: payload.generationClaimHash,
      socialClaimHash: payload.socialClaimHash,
    };
    logger.info({ userId }, '[SP1 PROVE STEP 8] Aggregation payload prepared');

    logger.info({ userId }, '[SP1 PROVE STEP 9] Invoking SP1 aggregator CLI (this may take several minutes)');
    const artifact = await runSp1Aggregator(aggregationPayload);
    logger.info({ userId, vkHash: artifact.vk_hash.slice(0, 16) + '...' }, '[SP1 PROVE STEP 10] SP1 proof generated successfully, returning to client');
    res.json(artifact);
  } catch (error) {
    if (error instanceof Sp1UnavailableError) {
      logger.warn({ error: (error as Error).message }, '[SP1 PROVE] SP1 CLI unavailable');
      return res.status(503).json({ error: (error as Error).message });
    }
    next(error);
  }
});

router.post('/verify', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    logger.info({ userId }, '[SP1 VERIFY STEP 1] Parsing SP1 proof verification request');
    const body = verifySchema.parse(req.body);
    logger.info(
      {
        userId,
        vkHash: body.vkHash.slice(0, 16) + '...',
        sessionNonce: body.sessionNonce.slice(0, 16) + '...',
      },
      '[SP1 VERIFY STEP 1] Request parsed'
    );

    logger.info({ userId }, '[SP1 VERIFY STEP 2] Validating session nonce');
    const nonceRecord = await prisma.usedNonce.findUnique({
      where: { sessionNonce: body.sessionNonce },
    });

    if (!nonceRecord || nonceRecord.scope !== 'sp1') {
      logger.warn({ userId, sessionNonce: body.sessionNonce.slice(0, 16) + '...' }, '[SP1 VERIFY] Session nonce already used or unknown');
      return res.status(400).json({ error: 'Session nonce already used or unknown.' });
    }
    logger.info({ userId }, '[SP1 VERIFY STEP 2] Session nonce valid');

    logger.info({ userId }, '[SP1 VERIFY STEP 3] Fetching user record');
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      logger.warn({ userId }, '[SP1 VERIFY] User not found');
      return res.status(404).json({ error: 'User not found' });
    }
    logger.info({ userId }, '[SP1 VERIFY STEP 3] User record retrieved');

    logger.info({ userId }, '[SP1 VERIFY STEP 4] Validating Self nullifier binding');
    if (!user.selfNullifier || user.selfNullifier !== body.metadata.self_nullifier) {
      logger.warn({ userId, stored: user.selfNullifier?.slice(0, 16), claimed: body.metadata.self_nullifier.slice(0, 16) }, '[SP1 VERIFY] Self nullifier mismatch');
      return res.status(400).json({ error: 'Self nullifier mismatch' });
    }
    logger.info({ userId }, '[SP1 VERIFY STEP 4] Self nullifier matches');

    // TODO(sp1): verify the aggregated proof with sp1-verifier before persisting.
    logger.info({ userId }, '[SP1 VERIFY STEP 5] Persisting aggregated badge (SP1 proof verification skipped in demo mode)');
    await prisma.$transaction(async (tx) => {
      await tx.usedNonce.delete({ where: { sessionNonce: body.sessionNonce } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          generationId: body.metadata.generation_id,
          generationProofHash: body.metadata.claim_hash,
          socialProofLevel: body.metadata.social_level,
          socialClaimHash: body.metadata.claim_hash,
          socialVerifiedAt: new Date(),
        },
      });
    });
    logger.info(
      {
        userId,
        generationId: body.metadata.generation_id,
        socialLevel: body.metadata.social_level,
      },
      '[SP1 VERIFY STEP 6] Aggregated badge persisted successfully'
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
