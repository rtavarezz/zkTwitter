import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

const DEFAULT_SOCIAL_SNAPSHOT = {
  followerCount: 0,
  followingCount: 0,
  isFollowing: false,
  followsYou: false,
};

function isMissingFollowTable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2021' &&
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'modelName' in error.meta &&
    error.meta.modelName === 'Follow'
  );
}

export async function ensureMutualFollows(userId: string) {
  try {
    const others = await prisma.user.findMany({
      where: { id: { not: userId } },
      select: { id: true },
    });

    await Promise.all(
      others.map(async ({ id }: { id: string }) => {
        await prisma.follow.upsert({
          where: {
            followerId_followingId: {
              followerId: userId,
              followingId: id,
            },
          },
          update: {},
          create: {
            followerId: userId,
            followingId: id,
          },
        });

        await prisma.follow.upsert({
          where: {
            followerId_followingId: {
              followerId: id,
              followingId: userId,
            },
          },
          update: {},
          create: {
            followerId: id,
            followingId: userId,
          },
        });
      })
    );
  } catch (error) {
    if (isMissingFollowTable(error)) {
      logger.warn('Follow table missing during ensureMutualFollows; skipping social graph wiring.');
      return;
    }
    throw error;
  }
}

export async function toggleFollow(
  followerId: string,
  targetId: string,
  desiredState: 'follow' | 'unfollow'
): Promise<'follow' | 'unfollow'> {
  if (followerId === targetId) {
    throw new Error('You cannot follow yourself');
  }

  if (desiredState === 'follow') {
    try {
      await prisma.follow.upsert({
        where: {
          followerId_followingId: {
            followerId,
            followingId: targetId,
          },
        },
        update: {},
        create: {
          followerId,
          followingId: targetId,
        },
      });
    } catch (error) {
      if (isMissingFollowTable(error)) {
        logger.warn('Follow table missing during follow toggle; treating as no-op.');
        return 'follow';
      }
      throw error;
    }
    return 'follow';
  }

  try {
    await prisma.follow.deleteMany({
      where: {
        followerId,
        followingId: targetId,
      },
    });
  } catch (error) {
    if (isMissingFollowTable(error)) {
      logger.warn('Follow table missing during unfollow toggle; treating as no-op.');
      return 'unfollow';
    }
    throw error;
  }

  return 'unfollow';
}

export async function getSocialSnapshot(viewerId: string | null, targetId: string) {
  try {
    const [followerCount, followingCount, followRecord, followBackRecord] = await Promise.all([
      prisma.follow.count({ where: { followingId: targetId } }),
      prisma.follow.count({ where: { followerId: targetId } }),
      viewerId
        ? prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewerId,
                followingId: targetId,
              },
            },
          })
        : Promise.resolve(null),
      viewerId
        ? prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: targetId,
                followingId: viewerId,
              },
            },
          })
        : Promise.resolve(null),
    ]);

    return {
      followerCount,
      followingCount,
      isFollowing: Boolean(followRecord),
      followsYou: Boolean(followBackRecord),
    };
  } catch (error) {
    if (isMissingFollowTable(error)) {
      logger.warn({ targetId }, 'Follow table missing when computing social snapshot; returning defaults.');
      return DEFAULT_SOCIAL_SNAPSHOT;
    }
    throw error;
  }
}
