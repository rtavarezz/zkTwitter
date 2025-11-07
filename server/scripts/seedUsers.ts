import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GENERATIONS = [
  { id: 0, name: 'Gen Z', minYear: 1997, maxYear: 2012 },
  { id: 1, name: 'Millennial', minYear: 1981, maxYear: 1996 },
  { id: 2, name: 'Gen X', minYear: 1965, maxYear: 1980 },
  { id: 3, name: 'Boomer', minYear: 1946, maxYear: 1964 },
  { id: 4, name: 'Silent', minYear: 1928, maxYear: 1945 },
];

const BIRTH_YEARS = [
  1930, 1935, 1940, 1945, 1950, 1955, 1960, 1965, 1970, 1975,
  1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015
];

const TWEET_TEMPLATES = [
  "Just verified my humanity with my passport!",
  "Zero-knowledge proofs are the future of privacy.",
  "Loving the zkTwitter community so far.",
  "My generation remembers when social media was different.",
  "Privacy and verification can coexist.",
  "This is what the internet should have been.",
  "No bots, just humans. Feels refreshing.",
  "Passport verification without giving up my data? Perfect.",
  "Finally, a social network that respects privacy.",
  "The green badge hits different when it's real.",
  "Web3 social done right.",
  "Can't believe how smooth the Self verification was.",
  "This is peak privacy tech.",
  "Love that I can prove things without revealing everything.",
  "zkTwitter showing how it should be done.",
  "My passport stays with me, proof goes on-chain.",
  "Generation-based filtering is such a cool feature.",
  "Verified human checking in.",
  "No surveillance, just verification.",
  "This is what decentralized identity looks like.",
];

function getGenerationId(birthYear: number): number | null {
  const gen = GENERATIONS.find(g => birthYear >= g.minYear && birthYear <= g.maxYear);
  return gen ? gen.id : null;
}

function getGenerationName(birthYear: number): string {
  const gen = GENERATIONS.find(g => birthYear >= g.minYear && birthYear <= g.maxYear);
  return gen ? gen.name : 'Unknown';
}

async function main() {
  console.log('Seeding database with test users...');

  // Clear existing data
  await prisma.tweet.deleteMany({});
  await prisma.user.deleteMany({});

  const users = [];

  for (const birthYear of BIRTH_YEARS) {
    const handle = `user${birthYear}`;
    const generationId = getGenerationId(birthYear);
    const genName = getGenerationName(birthYear);

    console.log(`Creating ${handle} (born ${birthYear}, ${genName})`);

    const user = await prisma.user.create({
      data: {
        handle,
        selfNullifier: `nullifier_${birthYear}_${Math.random().toString(36).slice(2)}`,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${handle}`,
        humanStatus: 'verified',
        birthYear,
        generationId,
        disclosed: JSON.stringify({
          country: ['USA', 'CAN', 'GBR', 'DEU', 'FRA'][Math.floor(Math.random() * 5)],
          is21: birthYear <= 2003,
        }),
        verifiedAt: new Date(),
      },
    });

    users.push(user);

    // Create 3 tweets per user
    const numTweets = 3;
    for (let i = 0; i < numTweets; i++) {
      const template = TWEET_TEMPLATES[Math.floor(Math.random() * TWEET_TEMPLATES.length)];
      await prisma.tweet.create({
        data: {
          body: template,
          authorId: user.id,
        },
      });
    }
  }

  console.log(`\nSeeding complete!`);
  console.log(`Created ${users.length} users`);
  console.log(`Created ${users.length * 3} tweets`);
  console.log('\nGeneration breakdown:');
  for (const gen of GENERATIONS) {
    const count = users.filter(u => u.generationId === gen.id).length;
    console.log(`  ${gen.name}: ${count} users`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
