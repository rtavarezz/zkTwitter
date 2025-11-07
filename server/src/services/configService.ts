import { prisma } from '../lib/prisma.js';

export type ConfigKey =
  | 'SOCIAL_VERIFIED_ROOT'
  | 'SOCIAL_MERKLE_DEPTH'
  | 'SOCIAL_MIN_VERIFIED_NEEDED';

export async function getConfigValue(key: ConfigKey): Promise<string | null> {
  const record = await prisma.config.findUnique({ where: { key } });
  return record?.value ?? null;
}

export async function requireConfigValue(key: ConfigKey): Promise<string> {
  const value = await getConfigValue(key);
  if (value === null) {
    throw new Error(`Missing config value for ${key}`);
  }
  return value;
}

export async function setConfigValue(key: ConfigKey, value: string): Promise<void> {
  await prisma.config.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getSocialConfig(): Promise<{
  verifiedRoot: string;
  merkleDepth: number;
  minVerifiedNeeded: number;
}> {
  const [root, depth, minNeeded] = await Promise.all([
    requireConfigValue('SOCIAL_VERIFIED_ROOT'),
    requireConfigValue('SOCIAL_MERKLE_DEPTH'),
    requireConfigValue('SOCIAL_MIN_VERIFIED_NEEDED'),
  ]);

  const merkleDepth = Number.parseInt(depth, 10);
  const minVerifiedNeeded = Number.parseInt(minNeeded, 10);

  if (!Number.isFinite(merkleDepth) || merkleDepth <= 0) {
    throw new Error(`Invalid SOCIAL_MERKLE_DEPTH value: ${depth}`);
  }

  if (!Number.isFinite(minVerifiedNeeded) || minVerifiedNeeded <= 0) {
    throw new Error(`Invalid SOCIAL_MIN_VERIFIED_NEEDED value: ${minNeeded}`);
  }

  return {
    verifiedRoot: root,
    merkleDepth,
    minVerifiedNeeded,
  };
}
