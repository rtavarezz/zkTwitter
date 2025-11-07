import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type UserSeed = {
  handle: string;
  avatarUrl: string;
  humanStatus: string;
  disclosed?: Record<string, unknown>;
  generationId?: number | null;
  socialProofLevel?: number;
  socialVerified?: boolean;
  verified?: boolean;
  selfNullifier?: string | null;
};

async function seedUsers() {
  const now = new Date();
  const seeds: UserSeed[] = [
    {
      handle: 'alice',
      avatarUrl: 'https://i.pravatar.cc/150?img=1',
      humanStatus: 'verified',
      disclosed: { country: 'United States', is21: true },
      generationId: 0,
      socialProofLevel: 3,
      socialVerified: true,
      verified: true,
      selfNullifier: '1111111111111111111111111111111111111111111111111111111111111111111111111111',
    },
    {
      handle: 'bob',
      avatarUrl: 'https://i.pravatar.cc/150?img=2',
      humanStatus: 'verified',
      disclosed: { country: 'Canada', is21: true },
      generationId: 1,
      socialProofLevel: 2,
      socialVerified: true,
      verified: true,
      selfNullifier: '2222222222222222222222222222222222222222222222222222222222222222222222222222',
    },
    {
      handle: 'carol',
      avatarUrl: 'https://i.pravatar.cc/150?img=3',
      humanStatus: 'verified',
      disclosed: { country: 'United Kingdom', is21: true },
      generationId: 2,
      socialProofLevel: 4,
      socialVerified: true,
      verified: true,
      selfNullifier: '3333333333333333333333333333333333333333333333333333333333333333333333333333',
    },
    {
      handle: 'diego',
      avatarUrl: 'https://i.pravatar.cc/150?img=12',
      humanStatus: 'verified',
      disclosed: { country: 'Spain', is18: true },
      generationId: 0,
      socialProofLevel: 0,
      socialVerified: false,
      verified: true,
    },
    {
      handle: 'miya',
      avatarUrl: 'https://i.pravatar.cc/150?img=17',
      humanStatus: 'pending',
      disclosed: { country: 'Japan' },
      generationId: null,
      socialProofLevel: 0,
      socialVerified: false,
      verified: false,
    },
    {
      handle: 'omar',
      avatarUrl: 'https://i.pravatar.cc/150?img=22',
      humanStatus: 'verified',
      disclosed: { country: 'UAE', is21: true },
      generationId: 3,
      socialProofLevel: 1,
      socialVerified: true,
      verified: true,
    },
    {
      handle: 'sofia',
      avatarUrl: 'https://i.pravatar.cc/150?img=28',
      humanStatus: 'verified',
      disclosed: { country: 'Brazil', is21: false },
      generationId: 1,
      socialProofLevel: 0,
      socialVerified: false,
      verified: true,
    },
    {
      handle: 'raj',
      avatarUrl: 'https://i.pravatar.cc/150?img=31',
      humanStatus: 'verified',
      disclosed: { country: 'India', is21: true },
      generationId: 4,
      socialProofLevel: 2,
      socialVerified: true,
      verified: true,
    },
    {
      handle: 'bot_trader',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=alpha',
      humanStatus: 'bot',
      generationId: 3,
      socialProofLevel: 1,
      socialVerified: true,
    },
    {
      handle: 'bot_news',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=beta',
      humanStatus: 'bot',
      generationId: 4,
      socialProofLevel: 0,
      socialVerified: false,
    },
    {
      handle: 'bot_memes',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=gamma',
      humanStatus: 'bot',
      generationId: null,
      socialProofLevel: 0,
      socialVerified: false,
    },
  ];

  const users: Record<string, any> = {};

  for (const seed of seeds) {
    const data = {
      handle: seed.handle,
      avatarUrl: seed.avatarUrl,
      humanStatus: seed.humanStatus,
      disclosed: JSON.stringify(seed.disclosed ?? {}),
      generationId: seed.generationId ?? null,
      socialProofLevel: seed.socialProofLevel ?? 0,
      socialVerifiedAt: seed.socialProofLevel && seed.socialProofLevel > 0 && seed.socialVerified ? now : null,
      verifiedAt: seed.verified ? now : null,
      selfNullifier: seed.selfNullifier ?? null,
    };

    users[seed.handle] = await prisma.user.upsert({
      where: { handle: seed.handle },
      update: data,
      create: data,
    });
  }

  return users;
}

async function seedFollows(users: Record<string, { id: string }>) {
  const pairs: Array<[string, string]> = [
    ['alice', 'bob'],
    ['alice', 'carol'],
    ['alice', 'raj'],
    ['bob', 'alice'],
    ['bob', 'diego'],
    ['carol', 'alice'],
    ['carol', 'omar'],
    ['diego', 'alice'],
    ['diego', 'miya'],
    ['miya', 'alice'],
    ['miya', 'sofia'],
    ['omar', 'alice'],
    ['omar', 'bob'],
    ['sofia', 'alice'],
    ['sofia', 'raj'],
    ['raj', 'carol'],
    ['bot_trader', 'alice'],
    ['bot_trader', 'bob'],
    ['bot_news', 'bot_trader'],
    ['bot_memes', 'alice'],
    ['bot_memes', 'sofia'],
  ];

  await prisma.follow.deleteMany();
  await prisma.follow.createMany({
    data: pairs
      .filter(([from, to]) => from !== to && users[from] && users[to])
      .map(([from, to]) => ({
        followerId: users[from].id,
        followingId: users[to].id,
      })),
  });
}

async function seedTweets(users: Record<string, { id: string }>) {
  await prisma.tweet.deleteMany();
  await prisma.tweet.createMany({
    data: [
      { body: 'Just verified my humanity! Privacy is awesome.', authorId: users.alice.id },
      { body: 'Building on zkTwitter is so cool', authorId: users.alice.id },
      { body: 'Hello from Canada 🍁', authorId: users.bob.id },
      { body: 'Zero-knowledge proofs are the future', authorId: users.bob.id },
      { body: 'Love the selective disclosure feature', authorId: users.carol.id },
      { body: 'Gen Z badge unlocked. Feels futuristic.', authorId: users.diego.id },
      { body: 'Still waiting on verification, but lurking anyway.', authorId: users.miya.id },
      { body: 'Desert sunsets + zk proofs = perfect combo.', authorId: users.omar.id },
      { body: 'Brazilian crypto meetup notes go brrr.', authorId: users.sofia.id },
      { body: 'Research drop: recursive proofs on mobile.', authorId: users.raj.id },
      { body: 'BTC price alert: $45,000', authorId: users.bot_trader.id },
      { body: 'Market analysis: bullish trends detected', authorId: users.bot_trader.id },
      { body: 'Breaking: new tech protocol launched', authorId: users.bot_news.id },
      { body: 'Posting memes about privacy budgets 🤖', authorId: users.bot_memes.id },
    ],
  });
}

async function seedMessages(users: Record<string, { id: string }>) {
  await prisma.message.deleteMany();
  await prisma.message.createMany({
    data: [
      {
        senderId: users.alice.id,
        recipientId: users.bob.id,
        body: 'Hey Bob! Want to jam on the next zkTwitter release?',
      },
      {
        senderId: users.bob.id,
        recipientId: users.alice.id,
        body: 'Absolutely. I will send over a design doc tonight.',
      },
      {
        senderId: users.carol.id,
        recipientId: users.alice.id,
        body: 'Just verified my proof. The onboarding was buttery smooth!',
      },
      {
        senderId: users.diego.id,
        recipientId: users.sofia.id,
        body: 'Your onboarding thread helped me get verified.',
      },
      {
        senderId: users.omar.id,
        recipientId: users.raj.id,
        body: 'Let’s compare social badge strategies tomorrow.',
      },
      {
        senderId: users.bot_trader.id,
        recipientId: users.alice.id,
        body: 'Automated alert: Market volatility rising in the last hour.',
      },
    ],
  });
}

async function main() {
  const users = await seedUsers();
  await seedFollows(users);
  await seedTweets(users);
  await seedMessages(users);

  await prisma.config.upsert({
    where: { key: 'SOCIAL_VERIFIED_ROOT' },
    update: { value: '0' },
    create: { key: 'SOCIAL_VERIFIED_ROOT', value: '0' },
  });

  await prisma.config.upsert({
    where: { key: 'SOCIAL_MERKLE_DEPTH' },
    update: { value: '20' },
    create: { key: 'SOCIAL_MERKLE_DEPTH', value: '20' },
  });

  await prisma.config.upsert({
    where: { key: 'SOCIAL_MIN_VERIFIED_NEEDED' },
    update: { value: '2' },
    create: { key: 'SOCIAL_MIN_VERIFIED_NEEDED', value: '2' },
  });

  console.log('Seed complete: users, follows, tweets, and starter messages');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
