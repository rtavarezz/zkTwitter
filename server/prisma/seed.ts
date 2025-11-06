import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Verified humans
  const alice = await prisma.user.upsert({
    where: { handle: 'alice' },
    update: {},
    create: {
      handle: 'alice',
      avatarUrl: 'https://i.pravatar.cc/150?img=1',
      humanStatus: 'verified',
      disclosed: JSON.stringify({ country: 'United States', is21: true }),
      verifiedAt: new Date(),
    },
  });

  const bob = await prisma.user.upsert({
    where: { handle: 'bob' },
    update: {},
    create: {
      handle: 'bob',
      avatarUrl: 'https://i.pravatar.cc/150?img=2',
      humanStatus: 'verified',
      disclosed: JSON.stringify({ country: 'Canada', is21: true }),
      verifiedAt: new Date(),
    },
  });

  const carol = await prisma.user.upsert({
    where: { handle: 'carol' },
    update: {},
    create: {
      handle: 'carol',
      avatarUrl: 'https://i.pravatar.cc/150?img=3',
      humanStatus: 'verified',
      disclosed: JSON.stringify({ country: 'United Kingdom', is21: true }),
      verifiedAt: new Date(),
    },
  });

  // Bots
  const bot1 = await prisma.user.upsert({
    where: { handle: 'bot_trader' },
    update: {},
    create: {
      handle: 'bot_trader',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=bot1',
      humanStatus: 'bot',
      disclosed: JSON.stringify({}),
      verifiedAt: null,
    },
  });

  const bot2 = await prisma.user.upsert({
    where: { handle: 'bot_news' },
    update: {},
    create: {
      handle: 'bot_news',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=bot2',
      humanStatus: 'bot',
      disclosed: JSON.stringify({}),
      verifiedAt: null,
    },
  });

  const everyone = [alice, bob, carol, bot1, bot2];

  await prisma.follow.deleteMany();
  await prisma.follow.createMany({
    data: everyone.flatMap((user) =>
      everyone
        .filter((other) => other.id !== user.id)
        .map((other) => ({ followerId: user.id, followingId: other.id }))
    ),
  });

  // Tweets
  await prisma.tweet.deleteMany();
  await prisma.tweet.createMany({
    data: [
      { body: 'Just verified my humanity! Privacy is awesome.', authorId: alice.id },
      { body: 'Building on zkTwitter is so cool', authorId: alice.id },
      { body: 'Hello from Canada 🍁', authorId: bob.id },
      { body: 'Zero-knowledge proofs are the future', authorId: bob.id },
      { body: 'Love the selective disclosure feature', authorId: carol.id },
      { body: 'BTC price alert: $45,000', authorId: bot1.id },
      { body: 'Market analysis: bullish trends detected', authorId: bot1.id },
      { body: 'Breaking: new tech protocol launched', authorId: bot2.id },
    ],
  });

  await prisma.message.deleteMany();
  await prisma.message.createMany({
    data: [
      {
        senderId: alice.id,
        recipientId: bob.id,
        body: 'Hey Bob! Want to jam on the next zkTwitter release?'
      },
      {
        senderId: bob.id,
        recipientId: alice.id,
        body: 'Absolutely. I will send over a design doc tonight.'
      },
      {
        senderId: carol.id,
        recipientId: alice.id,
        body: 'Just verified my proof. The onboarding was buttery smooth!'
      },
      {
        senderId: bot1.id,
        recipientId: alice.id,
        body: 'Automated alert: Market volatility rising in the last hour.'
      },
    ],
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
