import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { safeParseDisclosed } from '../utils/disclosure.js';

const router = Router();

router.get('/threads', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: req.auth.sub },
        { recipientId: req.auth.sub },
      ],
    },
    include: {
      sender: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
          humanStatus: true,
          disclosed: true,
        },
      },
      recipient: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
          humanStatus: true,
          disclosed: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const threadsMap = new Map<string, {
    partner: {
      id: string;
      handle: string;
      avatarUrl: string | null;
      humanStatus: string;
      disclosed: Record<string, unknown>;
    };
    lastMessage: {
      body: string;
      createdAt: Date;
      direction: 'outbound' | 'inbound';
    };
  }>();

  messages.forEach((message: typeof messages[0]) => {
    const isOutbound = message.senderId === req.auth!.sub;
    const partner = isOutbound ? message.recipient : message.sender;
    const key = partner.id;

    if (!threadsMap.has(key)) {
      threadsMap.set(key, {
        partner: {
          id: partner.id,
          handle: partner.handle,
          avatarUrl: partner.avatarUrl,
          humanStatus: partner.humanStatus,
          disclosed: safeParseDisclosed(partner.disclosed),
        },
        lastMessage: {
          body: message.body,
          createdAt: message.createdAt,
          direction: isOutbound ? 'outbound' : 'inbound',
        },
      });
    }
  });

  const threads = Array.from(threadsMap.values()).sort((a, b) =>
    b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime()
  );

  return res.json({ threads });
});

router.get('/with/:handle', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const target = await prisma.user.findUnique({
    where: { handle: req.params.handle.toLowerCase() },
    select: {
      id: true,
      handle: true,
      avatarUrl: true,
      humanStatus: true,
      disclosed: true,
    },
  });

  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        {
          senderId: req.auth.sub,
          recipientId: target.id,
        },
        {
          senderId: target.id,
          recipientId: req.auth.sub,
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  return res.json({
    partner: {
      id: target.id,
      handle: target.handle,
      avatarUrl: target.avatarUrl,
      humanStatus: target.humanStatus,
      disclosed: safeParseDisclosed(target.disclosed),
    },
    messages: messages.map((message: typeof messages[0]) => ({
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      direction: message.senderId === req.auth!.sub ? 'outbound' : 'inbound',
    })),
  });
});

const MessagePayload = z.object({
  body: z.string().min(1).max(500),
});

router.post('/with/:handle', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const target = await prisma.user.findUnique({
    where: { handle: req.params.handle.toLowerCase() },
  });

  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { body } = MessagePayload.parse(req.body);

  const message = await prisma.message.create({
    data: {
      senderId: req.auth.sub,
      recipientId: target.id,
      body,
    },
  });

  return res.status(201).json({
    message: {
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      direction: 'outbound',
    },
  });
});

export default router;