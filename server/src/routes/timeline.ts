import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { safeParseDisclosed } from '../utils/disclosure.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// GET /tweets with pagination
router.get('/', async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 20;
    const cursor = req.query.cursor as string | undefined;

    const tweets = await prisma.tweet.findMany({
      take: limit + 1, // Fetch one extra to check if there are more
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1, // Skip the cursor itself
      }),
      include: {
        author: {
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
    });

    const hasMore = tweets.length > limit;
    const tweetsToReturn = hasMore ? tweets.slice(0, -1) : tweets;

    // Transform to match frontend contract: { content, user, ... }
    const formattedTweets = tweetsToReturn.map((tweet: typeof tweets[0]) => ({
      id: tweet.id,
      content: tweet.body,
      createdAt: tweet.createdAt,
      user: {
        id: tweet.author.id,
        handle: tweet.author.handle,
        avatarUrl: tweet.author.avatarUrl,
        humanStatus: tweet.author.humanStatus,
        disclosed: safeParseDisclosed(tweet.author.disclosed),
      },
    }));

    res.json({
      tweets: formattedTweets,
      hasMore,
      nextCursor: hasMore ? tweetsToReturn[tweetsToReturn.length - 1].id : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /tweets
const CreateTweetSchema = z.object({
  content: z.string().min(1).max(280),
});

router.post('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { content } = CreateTweetSchema.parse(req.body);

    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.sub },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.humanStatus !== 'verified') {
      return res.status(403).json({ error: 'Only verified humans can post' });
    }

    const tweet = await prisma.tweet.create({
      data: {
        body: content,
        authorId: user.id,
      },
      include: {
        author: {
          select: {
            id: true,
            handle: true,
            avatarUrl: true,
            humanStatus: true,
            disclosed: true,
          },
        },
      },
    });

    logger.info({ tweetId: tweet.id, handle: user.handle }, 'Tweet created');

    const formattedTweet = {
      id: tweet.id,
      content: tweet.body,
      createdAt: tweet.createdAt,
      user: {
        id: tweet.author.id,
        handle: tweet.author.handle,
        avatarUrl: tweet.author.avatarUrl,
        humanStatus: tweet.author.humanStatus,
        disclosed: safeParseDisclosed(tweet.author.disclosed),
      },
    };

    res.status(201).json({ tweet: formattedTweet });
  } catch (err) {
    next(err);
  }
});

export default router;
