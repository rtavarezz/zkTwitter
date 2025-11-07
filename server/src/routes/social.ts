import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import type { Groth16Proof } from 'snarkjs';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { getSocialConfig, setConfigValue } from '../services/configService.js';
import { verifySocialProof } from '../services/socialProof.js';
import { getVerifiedUserTree } from '../services/merkleTree.js';

/**
 * Social proof flow in plain English:
 * 1. `/social/context` -> build Merkle tree snapshot, mint nonce, hand the user their selfNullifier + root.
 * 2. `/social/proof-data` -> send Poseidon leaves + siblings for the user's verified follows.
 * 3. Frontend runs the `socialProof` Groth16 circuit.
 * 4. `/social/verify` -> verify the proof, burn the nonce, and persist `socialProofLevel`.
 */

const router = Router();
const DECIMAL_PATTERN = /^[0-9]+$/;
const BN254_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

const verifyRequestSchema = z.object({
  proof: z.record(z.unknown()),
  publicSignals: z.array(z.string().regex(DECIMAL_PATTERN)).max(128),
});

const contextResponseSchema = z.object({
  verifiedRoot: z.string().regex(DECIMAL_PATTERN),
  merkleDepth: z.number().int().positive(),
  minVerifiedNeeded: z.number().int().positive(),
  sessionNonce: z.string().regex(DECIMAL_PATTERN),
  zeroLeaf: z.string().regex(DECIMAL_PATTERN),
  selfNullifier: z.string().regex(DECIMAL_PATTERN),
  leafHashKind: z.literal('Poseidon(selfNullifier)'),
});

// Step 1: hand the browser the Merkle root, nonce, and their stored selfNullifier.
router.get('/context', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    logger.info({ userId: req.auth!.sub }, '[SOCIAL STEP 1] Fetching proof context');

    const dbUser = await prisma.user.findUnique({
      where: { id: req.auth!.sub },
      select: { selfNullifier: true },
    });

    if (!dbUser?.selfNullifier) {
      return res.status(400).json({ error: 'User missing Self nullifier. Please re-verify with Self.' });
    }

    // Rebuild tree with latest verified users
    const tree = await getVerifiedUserTree();
    const treeRoot = tree.getRoot();

    logger.info({ root: treeRoot }, '[SOCIAL STEP 2] Merkle tree built');

    await setConfigValue('SOCIAL_VERIFIED_ROOT', treeRoot);
    const config = await getSocialConfig();
    const nonce = generateNonce();

    await prisma.usedNonce.create({
      data: {
        scope: 'social',
        sessionNonce: nonce,
      },
    });

    const payload = {
      verifiedRoot: treeRoot,
      merkleDepth: config.merkleDepth,
      minVerifiedNeeded: config.minVerifiedNeeded,
      sessionNonce: nonce,
      zeroLeaf: tree.getZeroLeaf(),
      selfNullifier: dbUser.selfNullifier,
      leafHashKind: 'Poseidon(selfNullifier)' as const,
    };

    logger.info({ nonce, minVerified: config.minVerifiedNeeded }, '[SOCIAL STEP 3] Context sent to client');
    res.json(contextResponseSchema.parse(payload));
  } catch (error) {
    next(error);
  }
});

// New endpoint: Get Merkle proofs for user's followees
// Step 2: ship Poseidon leaves + sibling paths for the user's verified followees only.
router.get('/proof-data', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    logger.info({ userId }, '[SOCIAL STEP 4] Fetching proof data for followees');

    // Get user's followees (people they follow)
    const followRelations = await prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: {
            selfNullifier: true,
            humanStatus: true,
          },
        },
      },
    });

    // Filter only verified followees with nullifiers
    const verifiedFollowees = followRelations
      .filter(
        (f) =>
          f.following.humanStatus === 'verified' && f.following.selfNullifier
      )
      .map((f) => f.following.selfNullifier!);

    logger.info(
      { userId, verifiedCount: verifiedFollowees.length },
      '[SOCIAL STEP 5] Found verified followees'
    );

    // Get Merkle tree and generate proofs
    const tree = await getVerifiedUserTree();
    const proofData = await tree.getProofsForFollowees(verifiedFollowees);

    logger.info(
      { userId, proofCount: proofData.leaves.length },
      '[SOCIAL STEP 6] Merkle proofs generated, sending to client'
    );

    res.json({
      leaves: proofData.leaves,
      siblings: proofData.siblings,
      pathIndices: proofData.pathIndices,
      count: proofData.leaves.length,
    });
  } catch (error) {
    logger.error({ error, userId: req.auth!.sub }, '[SOCIAL ERROR] Failed to fetch proof data');
    next(error);
  }
});

// Step 4: callback once the Groth16 proof is ready; burns the nonce and stamps the badge.
router.post('/verify', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.auth?.sub) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    logger.info({ userId: req.auth.sub }, '[SOCIAL STEP 7] Received proof from client, verifying...');
    const { proof, publicSignals } = verifyRequestSchema.parse(req.body);
    const config = await getSocialConfig();
    const signals = await verifySocialProof(proof as unknown as Groth16Proof, publicSignals);

    logger.info({ userId: req.auth.sub, isQualified: signals.isQualified }, '[SOCIAL STEP 8] ZK proof verified');

    if (signals.isQualified !== '1') {
      return res.status(400).json({ error: 'ZK circuit did not meet threshold' });
    }

    if (signals.verifiedRoot !== config.verifiedRoot) {
      return res.status(400).json({ error: 'Verified root mismatch' });
    }

    if (signals.minVerifiedNeeded !== BigInt(config.minVerifiedNeeded)) {
      return res.status(400).json({ error: 'Threshold mismatch' });
    }

    await prisma.$transaction(async (tx) => {
      const nonceRecord = await tx.usedNonce.findUnique({
        where: { sessionNonce: signals.sessionNonce },
      });

      if (!nonceRecord || nonceRecord.scope !== 'social') {
        throw new Error('Unknown or reused session nonce');
      }

      await tx.usedNonce.delete({ where: { sessionNonce: signals.sessionNonce } });

      const user = await tx.user.findUnique({ where: { id: req.auth!.sub } });
      if (!user) {
        throw new Error('User not found for proof submission');
      }

      if (!user.selfNullifier) {
        throw new Error('User missing stored self nullifier');
      }

      if (user.selfNullifier !== signals.selfNullifier) {
        throw new Error('Self nullifier mismatch between proof and account');
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          socialProofLevel: config.minVerifiedNeeded,
          socialClaimHash: signals.claimHash,
          socialVerifiedAt: new Date(),
        },
      });
    });

    logger.info(
      {
        userId: req.auth.sub,
        minVerifiedNeeded: config.minVerifiedNeeded,
      },
      'Social proof verified and badge issued'
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

function generateNonce(): string {
  const buf = randomBytes(32);
  let value = BigInt('0x' + buf.toString('hex')) % BN254_PRIME;
  if (value === 0n) {
    value = 1n;
  }
  return value.toString(10);
}

export default router;
