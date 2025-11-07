import { Router } from 'express';
import { z } from 'zod';
import { groth16 } from 'snarkjs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';

/**
 * My generation badge checklist:
 * 1. Self QR proof lands in `/auth/self/verify` and I persist the nullifier + birth-year commitment.
 * 2. Frontend runs `generationMembership` with that DOB to prove the requested range.
 * 3. This endpoint verifies the Groth16 proof and stores `generationId` plus the claim hash.
 * 4. Timeline/profile use those fields to render badges and enable filters.
 */

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vKeyPath = path.resolve(__dirname, '../../circuits/verification_key.json');

const GENERATION_NAMES = ['Gen Z', 'Millennial', 'Gen X', 'Boomer', 'Silent'];

let verificationKey: any = null;

async function loadVerificationKey() {
  if (!verificationKey) {
    const vKeyStr = await fs.readFile(vKeyPath, 'utf8');
    verificationKey = JSON.parse(vKeyStr);
  }
  return verificationKey;
}

const verifyProofSchema = z.object({
  proof: z.any(),  // snarkjs format
  publicSignals: z.array(z.string()),
});

/**
 * Backend verification endpoint for generation proofs.
 *
 * Flow:
 * 1. Frontend (GenerationProof.tsx) generates proof client-side using generationMembership.circom
 * 2. Proof + public signals sent to this endpoint
 * 3. We cryptographically verify the proof with snarkjs (Groth16 verification)
 * 4. Extract generation ID, selfNullifier, and birthYearCommitment from public signals
 * 5. Validate nullifier binding (prevents proof stealing)
 * 6. Store generation ID in DB WITHOUT storing birth year (privacy preserved)
 *
 * Security: Birth year never leaves the client. We only store which generation they belong to.
 */
router.post('/verify-generation', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    logger.info('=== GENERATION PROOF VERIFICATION START ===');

    // Step 1: Parse and validate request
    logger.info('Step 1: Parsing proof from request body');
    const { proof, publicSignals } = verifyProofSchema.parse(req.body);
    const userId = req.auth!.sub;
    logger.info({ userId, publicSignalsCount: publicSignals.length }, 'Step 1 complete: Request parsed');

    // Step 2: Load verification key (generated during circuit trusted setup)
    logger.info('Step 2: Loading circuit verification key');
    const vKey = await loadVerificationKey();
    logger.info('Step 2 complete: Verification key loaded');

    // Step 3: Cryptographically verify Groth16 proof using snarkjs
    // This proves the circuit was executed correctly with valid inputs
    logger.info('Step 3: Verifying Groth16 proof with snarkjs');
    const isValid = await groth16.verify(vKey, publicSignals, proof);
    logger.info({ isValid }, 'Step 3 complete: Groth16 verification result');

    if (!isValid) {
      logger.warn('REJECTED: Invalid Groth16 proof');
      return res.status(400).json({ error: 'Invalid proof' });
    }

    // Step 4: Extract public signals from circuit output
    logger.info('Step 4: Extracting public signals from circuit');
    // Circuit outputs: [isMember, claimHash, birthYearCommitment, selfNullifier, sessionNonce, configHash, targetGenerationId]
    const isMember = publicSignals[0];
    const claimHash = publicSignals[1];
    const birthYearCommitment = publicSignals[2];
    const selfNullifier = publicSignals[3];
    const sessionNonce = publicSignals[4];
    const configHash = publicSignals[5];
    const targetGenerationId = parseInt(publicSignals[6]);

    logger.info({
      isMember,
      targetGenerationId,
      generationName: GENERATION_NAMES[targetGenerationId],
      selfNullifierPreview: selfNullifier.slice(0, 20) + '...',
      commitmentPreview: birthYearCommitment.slice(0, 20) + '...',
    }, 'Step 4 complete: Public signals extracted');

    // Step 5: Check circuit output isMember flag (TRUST THE CIRCUIT)
    logger.info('Step 5: Checking if circuit says user is member of target generation');
    if (isMember !== '1') {
      logger.warn({ isMember, targetGenerationId }, 'REJECTED: Circuit says birth year NOT in range');
      return res.status(400).json({ error: 'Birth year not in target generation range' });
    }
    logger.info('Step 5 complete: Circuit confirms membership (isMember=1)');

    // Step 6: Fetch user from DB to validate identity binding
    // DB query: SELECT * FROM User WHERE id = userId
    // Returns: selfNullifier, birthYearCommitment (if previously proven)
    logger.info('Step 6: Fetching user to validate identity binding');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      logger.error({ userId }, 'REJECTED: User not found in database');
      return res.status(404).json({ error: 'User not found' });
    }

    // Step 7: Verify selfNullifier matches (prevents proof stealing)
    logger.info('Step 7: Verifying selfNullifier binding');
    if (user.selfNullifier !== selfNullifier) {
      logger.error({
        claimedNullifier: selfNullifier.slice(0, 20) + '...',
        storedNullifier: user.selfNullifier?.slice(0, 20) + '...',
      }, 'REJECTED: selfNullifier mismatch - proof not bound to this user');
      return res.status(403).json({ error: 'Proof nullifier does not match user identity' });
    }
    logger.info('Step 7 complete: selfNullifier matches, proof is bound to authenticated user');

    // Step 8: Verify birthYearCommitment matches (if user has proven before)
    logger.info('Step 8: Checking birthYearCommitment consistency');
    if (user.birthYearCommitment && user.birthYearCommitment !== birthYearCommitment) {
      logger.error({
        storedCommitment: user.birthYearCommitment.slice(0, 20) + '...',
        proofCommitment: birthYearCommitment.slice(0, 20) + '...',
      }, 'REJECTED: birthYearCommitment changed - user trying to prove with different age');
      return res.status(400).json({
        error: 'Birth year commitment mismatch. You cannot change your age after initial proof.',
      });
    }
    logger.info('Step 8 complete: Commitment validated (or first proof)');

    // Step 9: Save proof results to DB (TRUST CIRCUIT OUTPUT)
    // DB operation: UPDATE User SET birthYearCommitment, generationId, generationProofHash
    // What we store:
    //   - birthYearCommitment: Poseidon(birthYear, salt) - hides exact age
    //   - generationId: 0-4 (GenZ, Millennial, GenX, Boomer, Silent)
    //   - generationProofHash: Binds proof to identity + session
    // What we DON'T store: birthYear (never leaves client!)
    logger.info('Step 9: Updating user record with ZK-proven generation');
    await prisma.user.update({
      where: { id: userId },
      data: {
        birthYearCommitment,  // Store commitment (first time) or verify it matches (subsequent)
        generationId: targetGenerationId,
        generationProofHash: claimHash,
      },
    });
    logger.info({ userId, generationId: targetGenerationId }, 'Step 9 complete: User updated with ZK-proven generation');

    // Step 10: Return success response to frontend
    // Response body: { success: true, generationId: 0-4, generationName: "Gen Z", claimHash: "..." }
    // Frontend (GenerationProof.tsx) receives this and:
    //   1. Updates local user context with generationId
    //   2. Redirects to timeline where badge now displays
    logger.info({
      userId,
      generationId: targetGenerationId,
      generationName: GENERATION_NAMES[targetGenerationId],
    }, 'Step 10 complete: SUCCESS - Generation proof verified');
    logger.info('=== GENERATION PROOF VERIFICATION END ===');

    res.json({
      success: true,
      generationId: targetGenerationId,
      generationName: GENERATION_NAMES[targetGenerationId],
      claimHash,
    });
  } catch (error) {
    logger.error({ error }, 'ERROR: Generation proof verification failed');
    next(error);
  }
});

export default router;
