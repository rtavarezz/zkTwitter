import path from 'path';
import { fileURLToPath } from 'url';
import { groth16 } from 'snarkjs';
import { prisma } from '../dist/lib/prisma.js';
import { getSocialConfig } from '../dist/services/configService.js';
import { getVerifiedUserTree } from '../dist/services/merkleTree.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

async function main() {
  const userId = process.argv[2] ?? '6f822820-6e6c-4470-83de-ad3939dfafcf';

  const config = await getSocialConfig();
  const tree = await getVerifiedUserTree();

  const followRelations = await prisma.follow.findMany({
    where: { followerId: userId },
    include: {
      following: {
        select: {
          selfNullifier: true,
          humanStatus: true,
        },
      },
    },
  });

  const verifiedFollowees = followRelations
    .filter((f) => f.following.humanStatus === 'verified' && f.following.selfNullifier)
    .map((f) => f.following.selfNullifier);

  console.log('Verified followees', verifiedFollowees.length);

  const proofData = await tree.getProofsForFollowees(verifiedFollowees);

  console.log('Proof data lengths', {
    leaves: proofData.leaves.length,
    siblings: proofData.siblings.map((s) => s.length),
    pathIndices: proofData.pathIndices.map((p) => p.length),
  });

  const N_MAX = 32;
  const MERKLE_DEPTH = config.merkleDepth;
  const zeroLeaf = tree.getZeroLeaf();

  const normalizeSiblings = (list) =>
    list.map((levels) => {
      const arr = [...levels];
      while (arr.length < MERKLE_DEPTH) {
        arr.push(zeroLeaf);
      }
      return arr.slice(0, MERKLE_DEPTH).map(String);
    });

  const normalizePathBits = (list) =>
    list.map((levels) => {
      const arr = [...levels];
      while (arr.length < MERKLE_DEPTH) {
        arr.push(0);
      }
      return arr.slice(0, MERKLE_DEPTH);
    });

  const paddedLeaves = proofData.leaves.map(String);
  const paddedPresence = Array(proofData.leaves.length).fill(1);
  const paddedSiblings = normalizeSiblings(proofData.siblings);
  const paddedPathBits = normalizePathBits(proofData.pathIndices);

  while (paddedLeaves.length < N_MAX) {
    paddedLeaves.push(zeroLeaf);
    paddedPresence.push(0);
    paddedSiblings.push(Array(MERKLE_DEPTH).fill(zeroLeaf).map(String));
    paddedPathBits.push(Array(MERKLE_DEPTH).fill(0));
  }

  const input = {
    selfNullifier: verifiedFollowees[0] ?? '0',
    sessionNonce: '123',
    verifiedRoot: config.verifiedRoot,
    minVerifiedNeeded: config.minVerifiedNeeded.toString(),
    followeeLeaves: paddedLeaves,
    followeeIsPresent: paddedPresence.map(String),
    merkleSiblings: paddedSiblings,
    merklePathBits: paddedPathBits.map((path) => path.map(String)),
  };

  console.log('Sample leaf', input.followeeLeaves[0]);
  console.log('Sample siblings[0]', input.merkleSiblings[0]);
  console.log('Sample path[0]', input.merklePathBits[0]);
  console.log('Zero leaf used for padding', zeroLeaf);

  const wasmPath = path.resolve(repoRoot, 'frontend/public/circuits/socialProof.wasm');
  const zkeyPath = path.resolve(repoRoot, 'frontend/public/circuits/socialProof_final.zkey');
  console.log('Artifacts', { wasmPath, zkeyPath });

  console.log('Running fullProve...');
  await groth16.fullProve(input, wasmPath, zkeyPath);
  console.log('Proof succeeded');
}

main()
  .catch((err) => {
    console.error('Debug script failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
