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
      },
    });
  } catch (error) {
    next(error);
  }
});

const loginInitSchema = z.object({
  handle: handleSchema,
});

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
          }
        : null,
    };

    logger.info({ sessionId, status: session.status }, 'Login status polled');

    return res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post('/self/verify', verifyLimiter, async (req, res) => {
  try {
    const proofPayload = SelfProofSchema.parse(req.body);

    const result = await verifyProof(proofPayload);
    const { isValid, isMinimumAgeValid, isOfacValid } = result.isValidDetails;

    if (!isValid || !isMinimumAgeValid || isOfacValid) {
      const reason = !isValid
        ? 'Invalid proof'
        : !isMinimumAgeValid
        ? 'Minimum age requirement not met'
        : 'OFAC screening failed';

      logger.warn({ reason }, 'Self verification rejected');

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

function deriveBirthYear(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth || dateOfBirth.length < 6) return null;
  const yearFragment = dateOfBirth.slice(-2);
  const yy = Number.parseInt(yearFragment, 10);
  if (Number.isNaN(yy)) return null;
  const cutoff = 24; // assume passports <= 2124 use 20xx
  return (yy <= cutoff ? 2000 : 1900) + yy;
}

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
  const birthYear = deriveBirthYear(result.discloseOutput?.dateOfBirth);

  if (!nullifier) {
    throw new Error('Self nullifier missing from verification result');
  }

  logger.info(
    {
      handle: normalizedHandle,
      nullifierPreview: `${nullifier.slice(0, 12)}...`,
      dobRaw: result.discloseOutput?.dateOfBirth ?? null,
      birthYear,
    },
    'Derived birth year + nullifier from Self verification payload'
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

  await prisma.user.upsert({
    where: { id: userId },
    update: {
      handle: normalizedHandle,
      selfNullifier: nullifier,
      avatarUrl: avatarUrl ?? conflictingHandle?.avatarUrl,
      humanStatus: 'verified',
      disclosed: JSON.stringify(disclosed),
      verifiedAt: new Date(),
      ...(birthYear ? { birthYear } : {}),
    },
    create: {
      id: userId,
      handle: normalizedHandle,
      selfNullifier: nullifier,
      avatarUrl: avatarUrl ?? defaultAvatar,
      humanStatus: 'verified',
      disclosed: JSON.stringify(disclosed),
      verifiedAt: new Date(),
      birthYear,
    },
  });

  logger.info({ handle: normalizedHandle, userId }, 'User verified via Self');
  await ensureMutualFollows(userId);
}

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

  const birthYear = deriveBirthYear(result.discloseOutput?.dateOfBirth);
  logger.info(
    {
      sessionId,
      userId,
      dobRaw: result.discloseOutput?.dateOfBirth ?? null,
      birthYear,
    },
    'Login verification extracted birth year from Self disclosure'
  );

  const disclosed = buildDisclosedPayload(result.discloseOutput, isMinimumAgeValid);
  const mergedDisclosed = { ...safeParseDisclosed(session.user.disclosed), ...disclosed };

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      humanStatus: 'verified',
      verifiedAt: new Date(),
      disclosed: JSON.stringify(mergedDisclosed),
      ...(birthYear ? { birthYear } : {}),
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
