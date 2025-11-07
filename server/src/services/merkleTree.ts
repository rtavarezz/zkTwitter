import { buildPoseidon } from 'circomlibjs';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// Poseidon Merkle tree used by the social proof circuit (verified users only).
export class VerifiedUserTree {
  private depth: number;
  private leaves: string[] = [];
  private tree: string[][] = [];
  private poseidon: any;
  private zeroLeaf: string | null = null;

  constructor(depth: number) {
    this.depth = depth;
  }

  async initialize() {
    this.poseidon = await buildPoseidon();
    const zero = this.poseidon([0n]);
    this.zeroLeaf = this.poseidon.F.toString(zero);
  }

  getZeroLeaf(): string {
    if (!this.zeroLeaf) {
      throw new Error('Poseidon zero leaf not initialized');
    }
    return this.zeroLeaf;
  }

  // Rebuild tree from scratch using every verified user who has a stored nullifier.
  async buildFromDatabase(): Promise<void> {
    if (!this.poseidon) await this.initialize();

    // Get all verified users with selfNullifier
    const users = await prisma.user.findMany({
      where: {
        humanStatus: 'verified',
        selfNullifier: { not: null },
      },
      select: { selfNullifier: true },
    });

    logger.info({ count: users.length }, 'Building Merkle tree from verified users');

    // Leaves are Poseidon(selfNullifier) for each verified user
    const hashedLeaves = users.map(u => {
      const nullifierBigInt = BigInt(u.selfNullifier!);
      const hash = this.poseidon([nullifierBigInt]);
      return this.poseidon.F.toString(hash);
    });

    const zeroLeaf = this.zeroLeaf!;
    let currentLevel = hashedLeaves.length ? [...hashedLeaves] : [zeroLeaf];

    this.tree = [];
    for (let level = 0; level <= this.depth; level++) {
      if (currentLevel.length % 2 === 1) {
        currentLevel = [...currentLevel, zeroLeaf];
      } else {
        currentLevel = [...currentLevel];
      }
      this.tree[level] = currentLevel;
      if (level === 0) {
        this.leaves = currentLevel;
      }
      if (level === this.depth) {
        break;
      }

      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = BigInt(currentLevel[i]);
        const right = BigInt(currentLevel[i + 1] ?? zeroLeaf);
        const parentHash = this.poseidon([left, right]);
        nextLevel.push(this.poseidon.F.toString(parentHash));
      }

      currentLevel = nextLevel.length ? nextLevel : [zeroLeaf];
    }

    logger.info(
      { root: this.getRoot(), leaves: users.length },
      'Merkle tree built successfully'
    );
  }

  getRoot(): string {
    return this.tree[this.depth][0];
  }

  // Get Merkle proof for a specific leaf
  getMerkleProof(leafValue: string): {
    siblings: string[];
    pathIndices: number[];
  } | null {
    const leafIndex = this.leaves.indexOf(leafValue);
    if (leafIndex === -1) return null;

    const siblings: string[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      const siblingValue = this.tree[level][siblingIndex] ?? this.getZeroLeaf();
      siblings.push(siblingValue);
      pathIndices.push(isRightNode ? 1 : 0);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return { siblings, pathIndices };
  }

  // Return batches of Merkle proofs matching the user's verified followees.
  async getProofsForFollowees(
    followeeNullifiers: string[]
  ): Promise<{
    leaves: string[];
    siblings: string[][];
    pathIndices: number[][];
  }> {
    if (!this.poseidon) await this.initialize();

    const leaves: string[] = [];
    const siblings: string[][] = [];
    const pathIndices: number[][] = [];

    for (const nullifier of followeeNullifiers) {
      const nullifierBigInt = BigInt(nullifier);
      const leafHash = this.poseidon([nullifierBigInt]);
      const leafValue = this.poseidon.F.toString(leafHash);

      const proof = this.getMerkleProof(leafValue);
      if (proof) {
        leaves.push(leafValue);
        const siblingPath = [...proof.siblings];
        while (siblingPath.length < this.depth) {
          siblingPath.push(this.getZeroLeaf());
        }
        siblings.push(siblingPath.slice(0, this.depth));

        const pathBits = [...proof.pathIndices];
        while (pathBits.length < this.depth) {
          pathBits.push(0);
        }
        pathIndices.push(pathBits.slice(0, this.depth));
      }
    }

    return { leaves, siblings, pathIndices };
  }
}

// Singleton instance
let treeInstance: VerifiedUserTree | null = null;

export async function getVerifiedUserTree(): Promise<VerifiedUserTree> {
  if (!treeInstance) {
    treeInstance = new VerifiedUserTree(20); // depth from config
    await treeInstance.buildFromDatabase();
  }
  return treeInstance;
}

// Rebuild tree (call after new users verify)
export async function rebuildTree(): Promise<void> {
  treeInstance = new VerifiedUserTree(20);
  await treeInstance.buildFromDatabase();
}
