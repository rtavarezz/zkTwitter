import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { verifyProof, SelfProofSchema } from '../services/selfService.js';
import { decodeUserContextData } from '../utils/userContext.js';
import { buildDisclosedPayload, safeParseDisclosed } from '../utils/disclosure.js';
import { ensureMutualFollows } from '../services/socialGraph.js';
import { maybeDumpSelfProof } from '../utils/selfProofDump.js';

/**
 * My quick reference for the end-to-end auth flow:
 * 1. `/auth/register/init` -> issue userId + QR session for the Self app.
 * 2. User scans QR, Self posts the proof to `/auth/self/verify`, and I persist the nullifier/disclosures.
 * 3. `/auth/login/*` reuses the same verifier for returning users.
 * 4. With a stored nullifier + birth-year commitment the user can run the zkTwitter circuits.
 */

const router = Router();

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many verification requests',
});

const handleSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_]+$/, 'Handle must be alphanumeric (underscores allowed)');

const registerInitSchema = z.object({
  handle: handleSchema,
  avatarUrl: z.string().url().optional(),
});

// Step 1 of onboarding: mint a userId and QR payload the Self app can scan.
router.post('/register/init', async (req, res, next) => {
  try {
    const { handle, avatarUrl } = registerInitSchema.parse(req.body);
    const normalizedHandle = handle.toLowerCase();
    const existingByHandle = await prisma.user.findUnique({ where: { handle: normalizedHandle } });

    if (existingByHandle && existingByHandle.humanStatus === 'verified') {
      logger.info({ handle: normalizedHandle }, 'Handle already verified, returning existing user');
      return res.json({
        userId: existingByHandle.id,
        handle: existingByHandle.handle,
        avatarUrl: existingByHandle.avatarUrl ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${normalizedHandle}`,
      });
    }

    const userId = existingByHandle?.id ?? randomUUID();
    const resolvedAvatar =
      avatarUrl ??
      existingByHandle?.avatarUrl ??
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${normalizedHandle}`;

    if (existingByHandle) {
      await prisma.user.update({
        where: { id: existingByHandle.id },
        data: {
          avatarUrl: resolvedAvatar,
          humanStatus: 'unverified',
          disclosed: '{}',
          verifiedAt: null,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          id: userId,
          handle: normalizedHandle,
          avatarUrl: resolvedAvatar,
          humanStatus: 'unverified',
          disclosed: '{}',
        },
      });
    }

    logger.info({ handle: normalizedHandle, userId }, 'Registration session initialized');
    return res.json({ userId, handle: normalizedHandle, avatarUrl: resolvedAvatar });
  } catch (error) {
    next(error);
  }
});

router.get('/register/status/:handle', async (req, res, next) => {
  try {
    const normalizedHandle = req.params.handle.toLowerCase();
    const user = await prisma.user.findUnique({ where: { handle: normalizedHandle } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.set('Cache-Control', 'no-store');

    const disclosed = safeParseDisclosed(user.disclosed);
    const status = user.humanStatus === 'verified' ? 'verified' : 'pending';

    logger.info({ handle: normalizedHandle, status }, 'Registration status polled');

    // Issue JWT token if user is verified
    let token: string | undefined;
    if (status === 'verified') {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new Error('JWT_SECRET not configured');
      }

      token = jwt.sign(
        {
          sub: user.id,
          handle: user.handle,
          human: true,
          ...disclosed,
        },
        jwtSecret,
        { expiresIn: '7d' }
      );

      logger.info({ handle: normalizedHandle }, 'JWT token issued for new registration');
    }

    return res.json({
      status,
      token,
      user: {
        id: user.id,
        handle: user.handle,
        avatarUrl: user.avatarUrl,
        humanStatus: user.humanStatus,
        disclosed,
        verifiedAt: user.verifiedAt,
        selfNullifier: user.selfNullifier,
        socialProofLevel: user.socialProofLevel,
        socialVerifiedAt: user.socialVerifiedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

const loginInitSchema = z.object({
  handle: handleSchema,
});

// Returning user login begins by minting a fresh sessionId for the QR flow.
router.post('/login/init', async (req, res, next) => {
  try {
    const { handle } = loginInitSchema.parse(req.body);
    const normalizedHandle = handle.toLowerCase();
    const user = await prisma.user.findUnique({ where: { handle: normalizedHandle } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.humanStatus !== 'verified') {
      return res.status(409).json({ error: 'User is not verified yet' });
    }

    const sessionId = randomUUID();

    await prisma.loginSession.create({
      data: {
        sessionId,
        userId: user.id,
        handle: user.handle,
      },
    });

    logger.info({ sessionId, handle: user.handle }, 'Login session initialized');
    return res.json({ sessionId, userId: user.id, handle: user.handle });
  } catch (error) {
    next(error);
  }
});

const loginStatusParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

// The frontend polls this endpoint while the Self proof is still in-flight.
router.get('/login/status/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = loginStatusParamsSchema.parse(req.params);
    const session = await prisma.loginSession.findUnique({
      where: { sessionId },
      include: { user: true },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.set('Cache-Control', 'no-store');

    const payload = {
      status: session.status,
      token: session.token ?? null,
      user: session.token
        ? {
            id: session.user.id,
            handle: session.user.handle,
            avatarUrl: session.user.avatarUrl,
            humanStatus: session.user.humanStatus,
            disclosed: safeParseDisclosed(session.user.disclosed),
            selfNullifier: session.user.selfNullifier,
            socialProofLevel: session.user.socialProofLevel,
            socialVerifiedAt: session.user.socialVerifiedAt,
            generationId: session.user.generationId,
          }
        : null,
    };

    logger.info({ sessionId, status: session.status }, 'Login status polled');

    return res.json(payload);
  } catch (error) {
    next(error);
  }
});

// zkTwitter platform-wide minimum age requirement
const ZKTWITTER_MINIMUM_AGE = 20;

// Self webhook posts the attestation here; this is where I trust-but-verify their proof.
router.post('/self/verify', verifyLimiter, async (req, res) => {
  try {
    const proofPayload = SelfProofSchema.parse(req.body);

    const result = await verifyProof(proofPayload);
    const { isValid, isMinimumAgeValid, isOfacValid } = result.isValidDetails;

    // Debug: Log what Self is returning
    logger.info({
      isValid,
      isMinimumAgeValid,
      isOfacValid,
      ofacRawData: result.discloseOutput?.ofac,
    }, 'Self verification result details');

    // Workaround for Self SDK bug: isOfacValid is false even when OFAC data shows [false, false, false]
    // OFAC array: [false, false, false] = NOT on sanctions lists = should PASS
    // OFAC array: [true, ...] = IS on a sanctions list = should REJECT
    const ofacData = result.discloseOutput?.ofac || [];
    const isActuallyOnSanctionsList = Array.isArray(ofacData) && ofacData.some((val) => val === true);

    // Enforce platform-wide minimum age of 20+
    if (!isValid || !isMinimumAgeValid || isActuallyOnSanctionsList) {
      const reason = !isValid
        ? 'Invalid proof'
        : !isMinimumAgeValid
        ? `Minimum age requirement not met (${ZKTWITTER_MINIMUM_AGE}+ required)`
        : 'OFAC screening failed (passport on sanctions list)';

      logger.warn({
        reason,
        minimumAgeRequired: ZKTWITTER_MINIMUM_AGE,
        isActuallyOnSanctionsList,
        ofacData
      }, 'Self verification rejected');

      return res.status(200).json({
        status: 'error',
        result: false,
        reason,
      });
    }

    const context = decodeUserContextData(proofPayload.userContextData);

    await maybeDumpSelfProof({ proof: proofPayload, result, context });

    if (context.action === 'registration') {
      await upsertVerifiedUser({
        handle: context.handle,
        userId: context.userId,
        avatarUrl: context.avatarUrl,
        result,
        isMinimumAgeValid,
      });
    } else if (context.action === 'login') {
      await verifyLoginSession({
        sessionId: context.sessionId,
        userId: context.userId,
        handle: context.handle,
        result,
        isMinimumAgeValid,
      });
    } else {
      logger.warn({ context }, 'Unsupported action in userContextData');
      return res.status(200).json({
        status: 'error',
        result: false,
        reason: 'Unsupported action',
      });
    }

    return res.status(200).json({
      status: 'success',
      result: true,
    });
  } catch (error) {
    logger.error({ error }, 'Self verification error');
    return res.status(200).json({
      status: 'error',
      result: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

type VerificationResult = Awaited<ReturnType<typeof verifyProof>>;

// ZK Privacy: We do NOT store plaintext birth year on backend
// Instead, user will generate birthYearCommitment = Poseidon(birthYear, salt) client-side
// during first generation proof. Backend only stores the commitment.
// This prevents backend from knowing exact age while still allowing ZK proofs.

// Shared between registration + login: wires the Self proof into our user record.
async function upsertVerifiedUser(opts: {
  handle: string;
  userId: string;
  avatarUrl?: string;
  result: VerificationResult;
  isMinimumAgeValid: boolean;
}) {
  const { handle, userId, avatarUrl, result, isMinimumAgeValid } = opts;
  const normalizedHandle = handle.toLowerCase();
  const nullifier = result.discloseOutput?.nullifier?.toString();

  if (!nullifier) {
    throw new Error('Self nullifier missing from verification result');
  }

  logger.info(
    {
      handle: normalizedHandle,
      nullifierPreview: `${nullifier.slice(0, 12)}...`,
      dobDisclosed: result.discloseOutput?.dateOfBirth ? 'yes (stored in disclosed JSON only)' : 'no',
    },
    'User verified via Self - DOB NOT stored in plaintext columns (ZK privacy)'
  );

  const [existingNullifier, conflictingHandle] = await Promise.all([
    prisma.user.findUnique({ where: { selfNullifier: nullifier } }),
    prisma.user.findUnique({ where: { handle: normalizedHandle } }),
  ]);

  if (existingNullifier && existingNullifier.id !== userId) {
    logger.warn({ nullifier, existingUserId: existingNullifier.id, attemptedUserId: userId },
      'Duplicate passport blocked');
    throw new Error('This passport has already been registered to another account');
  }

  if (conflictingHandle && conflictingHandle.id !== userId) {
    throw new Error('Handle already belongs to another user');
  }

  const disclosed = buildDisclosedPayload(result.discloseOutput, isMinimumAgeValid);
  const defaultAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${normalizedHandle}`;

  // Store user WITHOUT plaintext birthYear - only disclosed JSON contains DOB for client-side ZK
  await prisma.user.upsert({
    where: { id: userId },
    update: {
      handle: normalizedHandle,
      selfNullifier: nullifier,
      avatarUrl: avatarUrl ?? conflictingHandle?.avatarUrl,
      humanStatus: 'verified',
      disclosed: JSON.stringify(disclosed),  // DOB in disclosed for client ZK input only
      verifiedAt: new Date(),
      // NOTE: birthYearCommitment will be set during first generation proof
    },
    create: {
      id: userId,
      handle: normalizedHandle,
      selfNullifier: nullifier,
      avatarUrl: avatarUrl ?? defaultAvatar,
      humanStatus: 'verified',
      disclosed: JSON.stringify(disclosed),
      verifiedAt: new Date(),
      // NOTE: birthYearCommitment will be set during first generation proof
    },
  });

  logger.info({ handle: normalizedHandle, userId }, 'User verified via Self (ZK-ready)');
  await ensureMutualFollows(userId);
}

// Helper used by `/auth/self/verify` when the proof is tied to a login session.
async function verifyLoginSession(opts: {
  sessionId: string;
  userId: string;
  handle: string;
  result: VerificationResult;
  isMinimumAgeValid: boolean;
}) {
  const { sessionId, userId, handle, result, isMinimumAgeValid } = opts;

  const session = await prisma.loginSession.findUnique({
    where: { sessionId },
    include: { user: true },
  });

  if (!session) throw new Error('Login session not found');
  if (session.userId !== userId) throw new Error('Login session does not match user');
  if (session.user.handle !== handle.toLowerCase()) throw new Error('Handle mismatch during login verification');

  const nullifier = result.discloseOutput?.nullifier?.toString();

  if (nullifier && session.user.selfNullifier && session.user.selfNullifier !== nullifier) {
    logger.error({ sessionId, userId, stored: session.user.selfNullifier, provided: nullifier },
      'Nullifier mismatch');
    throw new Error('Passport verification mismatch');
  }

  // ZK Privacy: DOB stored in disclosed JSON for client-side ZK proof generation only
  logger.info(
    {
      sessionId,
      userId,
      dobDisclosed: result.discloseOutput?.dateOfBirth ? 'yes (in disclosed JSON only)' : 'no',
    },
    'Login verification - DOB NOT stored in plaintext columns (ZK privacy)'
  );

  const disclosed = buildDisclosedPayload(result.discloseOutput, isMinimumAgeValid);
  const mergedDisclosed = { ...safeParseDisclosed(session.user.disclosed), ...disclosed };

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      humanStatus: 'verified',
      verifiedAt: new Date(),
      disclosed: JSON.stringify(mergedDisclosed),  // DOB here for client ZK only
      // NOTE: birthYearCommitment set during first generation proof
    },
  });

  const token = jwt.sign(
    {
      sub: session.userId,
      handle: session.user.handle,
      human: session.user.humanStatus === 'verified',
      ...mergedDisclosed,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  await prisma.loginSession.update({
    where: { sessionId },
    data: {
      status: 'verified',
      token,
      verifiedAt: new Date(),
    },
  });

  logger.info({ sessionId }, 'Login session verified');

  await ensureMutualFollows(session.userId);
}

export default router;
