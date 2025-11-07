import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { safeParseDisclosed } from '../utils/disclosure.js';
import { getSocialSnapshot, toggleFollow } from '../services/socialGraph.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.get('/:handle', async (req, res) => {
  const originalHandle = req.params.handle;

  try {
    const normalizedHandle = originalHandle.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { handle: normalizedHandle },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const viewerId = extractViewerId(req.headers.authorization);
    const social = await getSocialSnapshot(viewerId, user.id);

    logger.info({ handle: normalizedHandle }, 'User profile fetched');

    res.json({
      user: {
        id: user.id,
        handle: user.handle,
        avatarUrl: user.avatarUrl,
        humanStatus: user.humanStatus,
        disclosed: safeParseDisclosed(user.disclosed),
        verifiedAt: user.verifiedAt,
        socialProofLevel: user.socialProofLevel,
        socialVerifiedAt: user.socialVerifiedAt,
        createdAt: user.createdAt,
        social,
      },
    });
  } catch (error) {
    logger.error({ error, handle: originalHandle }, 'Failed to fetch user');
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.post('/:handle/follow', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const target = await prisma.user.findUnique({
      where: { handle: req.params.handle.toLowerCase() },
    });

    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await toggleFollow(req.auth.sub, target.id, 'follow');

    const social = await getSocialSnapshot(req.auth.sub, target.id);

    return res.status(200).json({ status: 'follow', social });
  } catch (error) {
    logger.error({ error }, 'Failed to follow user');
    return res.status(500).json({ error: 'Failed to follow user' });
  }
});

router.delete('/:handle/follow', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const target = await prisma.user.findUnique({
      where: { handle: req.params.handle.toLowerCase() },
    });

    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await toggleFollow(req.auth.sub, target.id, 'unfollow');

    const social = await getSocialSnapshot(req.auth.sub, target.id);

    return res.status(200).json({ status: 'unfollow', social });
  } catch (error) {
    logger.error({ error }, 'Failed to unfollow user');
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

function extractViewerId(header?: string) {
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export default router;
