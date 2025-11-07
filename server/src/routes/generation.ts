import { Router } from 'express';
import { z } from 'zod';
import { groth16 } from 'snarkjs';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';

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

router.post('/verify-generation', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    logger.info('=== GENERATION PROOF VERIFICATION START ===');

    // Step 1: Parse and validate request
    logger.info('Step 1: Parsing proof from request body');
    const { proof, publicSignals } = verifyProofSchema.parse(req.body);
    const userId = req.auth!.sub;
    logger.info({ userId, publicSignalsCount: publicSignals.length }, 'Step 1 complete: Request parsed');

    // Step 2: Load verification key
    logger.info('Step 2: Loading circuit verification key');
    const vKey = await loadVerificationKey();
    logger.info('Step 2 complete: Verification key loaded');

    // Step 3: Verify Groth16 proof cryptographically
    logger.info('Step 3: Verifying Groth16 proof with snarkjs');
    const isValid = await groth16.verify(vKey, publicSignals, proof);
    logger.info({ isValid }, 'Step 3 complete: Groth16 verification result');

    if (!isValid) {
      logger.warn('REJECTED: Invalid Groth16 proof');
      return res.status(400).json({ error: 'Invalid proof' });
    }

    // Step 4: Extract public signals from circuit output
    logger.info('Step 4: Extracting public signals from circuit');
    // Our circuit outputs: [isMember, claimHash, selfNullifier, sessionNonce, configHash, targetGenerationId]
    const isMember = publicSignals[0];
    const claimHash = publicSignals[1];
    const selfNullifier = publicSignals[2];
    const sessionNonce = publicSignals[3];
    const configHash = publicSignals[4];
    const targetGenerationId = parseInt(publicSignals[5]);

    logger.info({
      isMember,
      targetGenerationId,
      generationName: GENERATION_NAMES[targetGenerationId],
      selfNullifierPreview: selfNullifier.slice(0, 20) + '...',
    }, 'Step 4 complete: Public signals extracted');

    // Step 5: Check circuit output isMember flag
    logger.info('Step 5: Checking if circuit says user is member of target generation');
    if (isMember !== '1') {
      logger.warn({ isMember, targetGenerationId }, 'REJECTED: Circuit says birth year NOT in range');
      return res.status(400).json({ error: 'Birth year not in target generation range' });
    }
    logger.info('Step 5 complete: Circuit confirms membership (isMember=1)');

    // Step 6: Fetch user from database
    logger.info('Step 6: Fetching user from database to cross-check birth year');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      logger.error({ userId }, 'REJECTED: User not found in database');
      return res.status(404).json({ error: 'User not found' });
    }
    logger.info({
      userId,
      storedBirthYear: user.birthYear,
      storedNullifier: user.selfNullifier?.slice(0, 20) + '...',
    }, 'Step 6 complete: User fetched from database');

    // Step 7: Cross-check stored birth year matches claimed generation
    logger.info('Step 7: Cross-checking stored birth year against claimed generation');
    if (user.birthYear) {
      const GENERATION_RANGES = [
        [1997, 2012], // Gen Z
        [1981, 1996], // Millennial
        [1965, 1980], // Gen X
        [1946, 1964], // Boomer
        [1928, 1945], // Silent
      ];
      const [minYear, maxYear] = GENERATION_RANGES[targetGenerationId] || [0, 0];
      const isInRange = user.birthYear >= minYear && user.birthYear <= maxYear;

      logger.info({
        storedBirthYear: user.birthYear,
        targetGeneration: GENERATION_NAMES[targetGenerationId],
        rangeMin: minYear,
        rangeMax: maxYear,
        isInRange,
      }, 'Step 7 complete: Birth year cross-check result');

      if (!isInRange) {
        logger.warn({
          birthYear: user.birthYear,
          targetGen: GENERATION_NAMES[targetGenerationId],
          range: `${minYear}-${maxYear}`,
        }, 'REJECTED: Stored birth year does NOT match claimed generation');
        return res.status(400).json({
          error: `Your birth year ${user.birthYear} is not in ${GENERATION_NAMES[targetGenerationId]} range (${minYear}-${maxYear})`,
        });
      }
    } else {
      logger.warn('WARNING: No birth year stored, skipping cross-check (should not happen)');
    }

    // Step 8: Update user with verified generation
    logger.info('Step 8: Updating user record with verified generation');
    await prisma.user.update({
      where: { id: userId },
      data: {
        generationId: targetGenerationId,
        generationProofHash: claimHash,
      },
    });
    logger.info({ userId, generationId: targetGenerationId }, 'Step 8 complete: User updated');

    // Step 9: Return success response
    logger.info({
      userId,
      generationId: targetGenerationId,
      generationName: GENERATION_NAMES[targetGenerationId],
    }, 'Step 9 complete: SUCCESS - Generation proof verified');
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
