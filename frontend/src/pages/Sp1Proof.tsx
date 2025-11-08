import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../lib/api';
import './Sp1Proof.css';

type Sp1Context = {
  selfNullifier: string;
  generationConfig: number[];
  generationConfigHash: string;
  socialConfig: {
    verifiedRoot: string;
    merkleDepth: number;
    minVerifiedNeeded: number;
    zeroLeaf: string;
  };
  sessionNonce: string;
};

type ProofData = {
  leaves: string[];
  siblings: string[][];
  pathIndices: number[][];
  count: number;
};

type AggregationResult = {
  proof: string;
  public_values: string;
  vk_hash: string;
  metadata?: {
    self_nullifier: string;
    generation_id: number;
    social_level: number;
    claim_hash: string;
  };
};

export default function Sp1Proof() {
  const { user, isVerified } = useAuth();
  const navigate = useNavigate();
  const [proving, setProving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    if (!user || !isVerified) {
      navigate('/login');
    }
  }, [user, isVerified, navigate]);

  const runSp1Flow = async () => {
    if (!user) return;
    setProving(true);
    setError(null);
    setSteps([]);

    try {
      setSteps((prev) => [...prev, '1. Requesting SP1 context (nonce + configs)...']);
      const context = await apiGet<Sp1Context>('/sp1/context');
      console.log('[SP1 DEBUG] Context received:', {
        sessionNonce: context.sessionNonce,
        sessionNonceLength: context.sessionNonce.length,
        selfNullifier: context.selfNullifier.slice(0, 20) + '...',
      });
      setSteps((prev) => [...prev, 'Context received']);

      setSteps((prev) => [...prev, '2. Recomputing generation proof bound to SP1 session...']);
      const generationProof = await buildGenerationProof(context, user);
      setSteps((prev) => [...prev, `Generation proof ready (claim hash ${generationProof.claimHash.slice(0, 12)}…)`]);

      setSteps((prev) => [...prev, '3. Recomputing social proof bound to SP1 session...']);
      const socialProof = await buildSocialProof(context);
      setSteps((prev) => [...prev, `Social proof ready (${socialProof.verifiedCount} verified follows)`]);

      setSteps((prev) => [...prev, '4. Requesting SP1 aggregated proof (this may use the prover network)...']);
      const aggregationPayload = {
        generation: {
          proof: generationProof.proof,
          publicSignals: generationProof.publicSignals,
        },
        social: {
          proof: socialProof.proof,
          publicSignals: socialProof.publicSignals,
        },
        sessionNonce: context.sessionNonce,
        targetGenerationId: generationProof.targetGenerationId,
        generationClaimHash: generationProof.claimHash,
        socialClaimHash: socialProof.claimHash,
      };

      const aggregated = await apiPost<AggregationResult>('/sp1/prove', aggregationPayload);
      setSteps((prev) => [...prev, 'SP1 proof aggregated']);

      setSteps((prev) => [...prev, '5. Persisting aggregated badge (verifies SP1 metadata server-side)...']);
      await apiPost('/sp1/verify', {
        proof: aggregated.proof,
        publicValues: aggregated.public_values,
        vkHash: aggregated.vk_hash,
        sessionNonce: context.sessionNonce,
        metadata: aggregated.metadata ?? {
          self_nullifier: context.selfNullifier,
          generation_id: generationProof.targetGenerationId,
          social_level: context.socialConfig.minVerifiedNeeded,
          claim_hash: generationProof.claimHash,
        },
      });

      setSteps((prev) => [...prev, 'Aggregated badge stored successfully!']);
      setSteps((prev) => [...prev, 'Your profile now shows "SP1" badge indicating both proofs are aggregated.']);
      setSuccess(true);
      setTimeout(() => navigate(`/profile/${user.handle}`), 3000);
    } catch (err) {
      console.error('[SP1] error', err);
      setError(err instanceof Error ? err.message : 'Failed to build SP1 proof');
      setSteps((prev) => [...prev, `Error: ${err instanceof Error ? err.message : 'Unknown error'}`]);
    } finally {
      setProving(false);
    }
  };

  if (!user || !isVerified) {
    return null;
  }

  return (
    <div className="sp1-proof-app">
      <Navbar />

      <div className="sp1-container">
        <h1>Aggregate with SP1</h1>
        <p className="subtitle">
          Collapse the generation + social proofs into a single SP1 zkVM proof. This replays both Groth16 proofs
          locally, binds them to a fresh nonce, and shells out to the SP1 prover (local or network) via the CLI.
        </p>

        {steps.length > 0 && (
          <div className="proof-steps">
            <h4>Progress:</h4>
            <ul>
              {steps.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && (
          <div className="success-message">
            <strong>Success!</strong> SP1 aggregation complete. Your profile now displays the SP1 badge.
            <br />
            Redirecting to your profile...
          </div>
        )}

        <button className="cta primary prove-button" onClick={runSp1Flow} disabled={proving}>
          {proving ? 'Generating SP1 Proof...' : 'Generate SP1 Proof'}
        </button>

        <div className="info-box">
          <h4>How it works</h4>
          <ul>
            <li>Fetches a single nonce + config snapshot from `/sp1/context`.</li>
            <li>Reuses the existing Groth16 circuits client-side (no backend data leakage).</li>
            <li>Shells out to the SP1 CLI (configured via `SP1_PROVER_BIN`) to request a proof.</li>
            <li>Stores `{`selfNullifier, generationId, socialProofLevel, claimHash`}` if the proof succeeds.</li>
            <li>When the CLI is not configured the endpoint returns HTTP 503 so the UI can explain the missing prover.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

async function buildGenerationProof(context: Sp1Context, user: { disclosed: Record<string, unknown> }) {
  const snarkjs = await import('snarkjs');
  const birthYear = extractBirthYear(user.disclosed);
  if (!birthYear) {
    throw new Error('Birth year missing from disclosed data. Please re-run Self verification with DOB disclosure.');
  }

  const ranges = chunkGenerationConfig(context.generationConfig);
  const target = ranges.find((entry) => birthYear >= entry.min && birthYear <= entry.max);
  if (!target) {
    throw new Error('Unable to determine generation for disclosed birth year.');
  }

  const saltBytes = new TextEncoder().encode(`${context.selfNullifier}-${context.sessionNonce}-sp1`);
  let saltBigInt = BigInt(0);
  for (let i = 0; i < Math.min(saltBytes.length, 31); i += 1) {
    saltBigInt = (saltBigInt << BigInt(8)) | BigInt(saltBytes[i]!);
  }

  const input = {
    selfNullifier: context.selfNullifier,
    sessionNonce: context.sessionNonce,
    generationConfigHash: context.generationConfigHash,
    targetGenerationId: target.id.toString(),
    generationConfig: context.generationConfig.map(String),
    birthYear: birthYear.toString(),
    birthYearSalt: saltBigInt.toString(),
  };

  console.log('[SP1 DEBUG] Generation circuit inputs:', {
    selfNullifier: input.selfNullifier.slice(0, 20) + '...',
    sessionNonce: input.sessionNonce.slice(0, 20) + '...',
    targetGenerationId: input.targetGenerationId,
  });

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    '/circuits/generationMembership.wasm',
    '/circuits/generationMembership_final.zkey'
  );

  console.log('[SP1 DEBUG] Generated proof public signals:', publicSignals);

  return {
    proof,
    publicSignals,
    claimHash: publicSignals[1],
    targetGenerationId: target.id,
  };
}

async function buildSocialProof(context: Sp1Context) {
  const proofData = await apiGet<ProofData>('/social/proof-data');
  if (proofData.count < context.socialConfig.minVerifiedNeeded) {
    throw new Error(`Need ${context.socialConfig.minVerifiedNeeded}+ verified follows before running SP1 aggregation.`);
  }

  const snarkjs = await import('snarkjs');
  const { merkleDepth, minVerifiedNeeded, verifiedRoot, zeroLeaf } = context.socialConfig;
  const N_MAX = 32;

  const normalize = (list: string[][]) =>
    list.map((levels) => {
      const arr = [...levels];
      while (arr.length < merkleDepth) {
        arr.push(zeroLeaf);
      }
      return arr.slice(0, merkleDepth).map(String);
    });

  const normalizeIndices = (list: number[][]) =>
    list.map((levels) => {
      const arr = [...levels];
      while (arr.length < merkleDepth) {
        arr.push(0);
      }
      return arr.slice(0, merkleDepth);
    });

  const leaves = proofData.leaves.map(String);
  const presence = Array(proofData.leaves.length).fill(1);
  const siblings = normalize(proofData.siblings);
  const pathBits = normalizeIndices(proofData.pathIndices);

  while (leaves.length < N_MAX) {
    leaves.push(zeroLeaf);
    presence.push(0);
    siblings.push(Array(merkleDepth).fill(zeroLeaf));
    pathBits.push(Array(merkleDepth).fill(0));
  }

  const input = {
    selfNullifier: context.selfNullifier,
    sessionNonce: context.sessionNonce,
    verifiedRoot,
    minVerifiedNeeded: minVerifiedNeeded.toString(),
    followeeLeaves: leaves,
    followeeIsPresent: presence.map(String),
    merkleSiblings: siblings,
    merklePathBits: pathBits.map((levels) => levels.map(String)),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    '/circuits/socialProof.wasm',
    '/circuits/socialProof_final.zkey'
  );

  return {
    proof,
    publicSignals,
    claimHash: publicSignals[1],
    verifiedCount: proofData.count,
  };
}

function extractBirthYear(disclosed: Record<string, unknown>): number | null {
  const dob = disclosed?.dateOfBirth;
  if (typeof dob !== 'string' || dob.length < 6) {
    return null;
  }
  const yy = parseInt(dob.slice(-2), 10);
  if (Number.isNaN(yy)) {
    return null;
  }
  return (yy <= 24 ? 2000 : 1900) + yy;
}

function chunkGenerationConfig(config: number[]) {
  const ranges: Array<{ id: number; min: number; max: number }> = [];
  for (let i = 0; i < config.length; i += 3) {
    ranges.push({
      id: config[i]!,
      min: config[i + 1]!,
      max: config[i + 2]!,
    });
  }
  return ranges;
}
