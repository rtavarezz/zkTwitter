import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { getSocialConfig } from '../services/configService.js';
import { logger } from '../lib/logger.js';
import { runSp1Aggregator, Sp1UnavailableError, type AggregationPayload } from '../services/sp1.js';
import { getVerifiedUserTree } from '../services/merkleTree.js';

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
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.sub },
      select: { selfNullifier: true },
    });

    if (!user?.selfNullifier) {
      return res.status(400).json({ error: 'User missing Self nullifier. Please re-run Self verification.' });
    }

    const socialConfig = await getSocialConfig();
    const tree = await getVerifiedUserTree();
    const sessionNonce = randomBytes(32).toString('hex');

    await prisma.usedNonce.create({
      data: {
        scope: 'sp1',
        sessionNonce,
      },
    });

    res.json({
      selfNullifier: user.selfNullifier,
      generationConfig: GENERATION_CONFIG,
      generationConfigHash: GENERATION_CONFIG_HASH,
      socialConfig: {
        ...socialConfig,
        zeroLeaf: tree.getZeroLeaf(),
      },
      sessionNonce,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/prove', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const payload = aggregateSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.sub },
      select: { selfNullifier: true },
    });

    if (!user?.selfNullifier) {
      return res.status(400).json({ error: 'User missing Self nullifier. Please re-verify with Self.' });
    }

    const socialConfig = await getSocialConfig();

    const nonce = await prisma.usedNonce.findUnique({
      where: { sessionNonce: payload.sessionNonce },
    });

    if (!nonce || nonce.scope !== 'sp1') {
      return res.status(400).json({ error: 'Unknown or expired session nonce.' });
    }

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

    logger.info({ userId: req.auth!.sub }, '[SP1] Invoking aggregator CLI');
    const artifact = await runSp1Aggregator(aggregationPayload);
    res.json(artifact);
  } catch (error) {
    if (error instanceof Sp1UnavailableError) {
      return res.status(503).json({ error: error.message });
    }
    next(error);
  }
});

router.post('/verify', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = verifySchema.parse(req.body);
    const nonceRecord = await prisma.usedNonce.findUnique({
      where: { sessionNonce: body.sessionNonce },
    });

    if (!nonceRecord || nonceRecord.scope !== 'sp1') {
      return res.status(400).json({ error: 'Session nonce already used or unknown.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth!.sub },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.selfNullifier || user.selfNullifier !== body.metadata.self_nullifier) {
      return res.status(400).json({ error: 'Self nullifier mismatch' });
    }

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

    // TODO(sp1): verify the aggregated proof with sp1-verifier before persisting.

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
