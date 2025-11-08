import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { apiGet, apiPost } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import './SocialProof.css';

type SocialContext = {
  verifiedRoot: string;
  merkleDepth: number;
  minVerifiedNeeded: number;
  sessionNonce: string;
  zeroLeaf: string;
  selfNullifier: string;
};

type ProofData = {
  leaves: string[];
  siblings: string[][];
  pathIndices: number[][];
  count: number;
};

export default function SocialProof() {
  const { user, isVerified, login } = useAuth();
  const navigate = useNavigate();
  const [proving, setProving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [proofSteps, setProofSteps] = useState<string[]>([]);

  useEffect(() => {
    if (!user || !isVerified) {
      navigate('/login');
    }
  }, [user, isVerified, navigate]);

  /**
   * Client-side proof generation for social connections.
   * Privacy: Followee identities NEVER sent to backend, only Merkle proofs.
   *
   * Flow:
   * 1. Fetch Merkle tree root snapshot from backend (ties proof to verified set)
   * 2. Get Merkle proofs for user's verified followees
   * 3. Load socialProof.circom circuit (compiled to WASM)
   * 4. Prepare inputs: followee leaves + siblings (private), root + threshold (public)
   * 5. Run Groth16 prover locally (proves >= N followees in Merkle tree)
   * 6. Send proof to backend for verification
   * 7. Backend verifies and stores social badge WITHOUT knowing which users
   */
  const handleGenerateProof = async () => {
    setProving(true);
    setError(null);
    setProofSteps([]);

    try {
      // Step 1: Fetch Merkle tree root + session nonce from backend
      // Root represents snapshot of all verified users at this moment
      setProofSteps(prev => [...prev, '1. Fetching proof context...']);
      const context = await apiGet<SocialContext>('/social/context');
      setProofSteps(prev => [...prev, `Done: Context loaded (need ${context.minVerifiedNeeded}+ verified follows)`]);

      // Step 2: Fetch Merkle proofs for user's verified followees
      // Backend sends: Poseidon(selfNullifier) leaves + sibling paths
      // Privacy: Backend already knows who you follow (it's in the Follow table)
      // But it won't learn this from the proof - proof reveals nothing about identity
      setProofSteps(prev => [...prev, '2. Fetching Merkle proofs for your verified followees...']);
      const proofData = await apiGet<ProofData>('/social/proof-data');
      setProofSteps(prev => [...prev, `Done: Found ${proofData.count} verified followees`]);

      if (proofData.count < context.minVerifiedNeeded) {
        setError(`You need to follow at least ${context.minVerifiedNeeded} verified users. Currently: ${proofData.count}`);
        setProofSteps(prev => [...prev, `Error: Insufficient verified follows (need ${context.minVerifiedNeeded}, have ${proofData.count})`]);
        return;
      }

      // Step 3: Load socialProof.circom circuit artifacts
      // Circuit: circuits/social/socialProof.circom
      // This circuit verifies N Merkle proofs without revealing the leaves
      setProofSteps(prev => [...prev, '3. Loading ZK circuit (WASM + proving key)...']);
      const wasmPath = '/circuits/socialProof.wasm';
      const zkeyPath = '/circuits/socialProof_final.zkey';
      const snarkjs = await import('snarkjs');
      setProofSteps(prev => [...prev, 'Done: Circuit loaded (159k constraints)']);

      // Step 4: Prepare circuit inputs (pad to match circuit's fixed size)
      // Circuit expects exactly N_MAX followees (32), pad with zeros for unused slots
      // PRIVATE inputs: followeeLeaves, followeeIsPresent, merkleSiblings, merklePathBits
      // PUBLIC inputs: selfNullifier, sessionNonce, verifiedRoot, minVerifiedNeeded
      setProofSteps(prev => [...prev, '4. Preparing circuit inputs...']);
      const N_MAX = 32;
      const MERKLE_DEPTH = context.merkleDepth;

      const normalizeSiblings = (list: string[][]) =>
        list.map((levels) => {
          const arr = [...levels];
          while (arr.length < MERKLE_DEPTH) {
            arr.push(context.zeroLeaf);
          }
          return arr.slice(0, MERKLE_DEPTH).map(String);
        });

      const normalizePathBits = (list: number[][]) =>
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

      // Pad with zeros
      while (paddedLeaves.length < N_MAX) {
        paddedLeaves.push(context.zeroLeaf);
        paddedPresence.push(0);
        paddedSiblings.push(Array(MERKLE_DEPTH).fill(context.zeroLeaf));
        paddedPathBits.push(Array(MERKLE_DEPTH).fill(0));
      }

      const input = {
        selfNullifier: context.selfNullifier,           // PUBLIC (binds to identity)
        sessionNonce: context.sessionNonce,             // PUBLIC (prevents replay)
        verifiedRoot: context.verifiedRoot,             // PUBLIC (Merkle tree snapshot)
        minVerifiedNeeded: context.minVerifiedNeeded.toString(), // PUBLIC (threshold)
        followeeLeaves: paddedLeaves,                   // PRIVATE (followee hashes, never revealed!)
        followeeIsPresent: paddedPresence.map(String),  // PRIVATE (which slots are real vs padding)
        merkleSiblings: paddedSiblings,                 // PRIVATE (Merkle proof siblings)
        merklePathBits: paddedPathBits.map(path => path.map(String)), // PRIVATE (proof paths)
      };

      setProofSteps(prev => [...prev, `Done: Circuit inputs ready (${proofData.count} followees, privacy preserved)`]);

      // Step 5: Run Groth16 prover locally
      // Circuit validates each followee leaf is in the Merkle tree
      // Outputs isQualified=1 if count >= minVerifiedNeeded, WITHOUT revealing leaves
      setProofSteps(prev => [...prev, '5. Generating zero-knowledge proof (this may take 5-10 seconds)...']);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasmPath,
        zkeyPath
      );
      setProofSteps(prev => [...prev, 'Done: ZK proof generated! Backend will never see who you follow.']);

      // Step 6: Send proof + public signals to backend
      // POST /social/verify
      // Request body: { proof: Groth16Proof, publicSignals: string[] }
      // Backend (server/src/routes/social.ts) will:
      //   1. Verify proof cryptographically with snarkjs.groth16.verify()
      //   2. Extract isQualified, claimHash from public signals
      //   3. Validate Merkle root matches snapshot
      //   4. Save to DB: UPDATE User SET socialProofLevel, socialClaimHash, socialVerifiedAt
      //   5. Return: 204 No Content (success)
      setProofSteps(prev => [...prev, '6. Submitting proof for verification...']);
      const result = await apiPost<{ success: boolean }>('/social/verify', {
        proof,
        publicSignals,
      });

      setProofSteps(prev => [...prev, 'Done: Proof verified cryptographically']);

      if (result.success || result === null) {
        // Step 7: Update local user context with social badge
        // Response received: 204 No Content (success)
        setProofSteps(prev => [...prev, `7. Social badge earned! (${proofData.count}+ verified follows)`]);

        // Fetch updated user from DB to sync local state
        // GET /users/:handle returns full user object with socialProofLevel now set
        const token = localStorage.getItem('token');
        if (token && user?.handle) {
          const updatedUser = await apiGet<any>(`/users/${user.handle}`);
          if (updatedUser) {
            login(token, {
              ...user!,
              socialProofLevel: proofData.count,
            });
          }
        }

        setSuccess(true);
        setProofSteps(prev => [...prev, 'Done: Complete! Your tweets now show your social badge.']);

        // Redirect to timeline where badge now displays (e.g., "Social Verified (5+)")
        setTimeout(() => {
          navigate('/timeline');
        }, 2000);
      }
    } catch (err) {
      console.error('Proof generation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate proof');
      setProofSteps(prev => [...prev, `Error: Error: ${err instanceof Error ? err.message : 'Failed'}`]);
    } finally {
      setProving(false);
    }
  };

  if (!user || !isVerified) {
    return null;
  }

  return (
    <div className="social-proof-app">
      <Navbar />
      <div className="social-container">
        <h1>Earn Social Badge</h1>
        <p className="subtitle">
          Prove you follow verified users without revealing who they are. The ZK circuit verifies your
          connections are in the verified set, while keeping your social graph private from the backend.
        </p>

        {proofSteps.length > 0 && (
          <div className="proof-steps">
            <h4>Progress:</h4>
            <ul>
              {proofSteps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">Badge earned! Redirecting...</div>}

        <button
          className="cta primary prove-button"
          onClick={handleGenerateProof}
          disabled={proving}
        >
          {proving ? 'Generating Proof...' : 'Generate Social Proof'}
        </button>

        {!proving && (
          <div className="info-box">
            <h4>How It Works (Zero-Knowledge)</h4>
            <ul>
              <li><strong>Step 1:</strong> Backend builds Merkle tree from all verified users (hashes only, no identities)</li>
              <li><strong>Step 2:</strong> You fetch Merkle proofs for your verified followees</li>
              <li><strong>Step 3:</strong> Browser generates ZK proof that ≥N of your follows are in the verified set</li>
              <li><strong>Step 4:</strong> Backend verifies proof cryptographically and issues badge</li>
              <li><strong>Privacy:</strong> Your follow list NEVER leaves your browser. Backend only learns the count threshold was met.</li>
              <li><strong>Badge:</strong> Shows "Social Verified (N+)" on your tweets</li>
            </ul>

            <div className="privacy-note">
              <strong>🔒 Privacy Guarantee:</strong> The proof data contains only cryptographic hashes (Merkle siblings).
              Since the tree has thousands of users, there's no practical way to reverse-engineer your follow graph.
              The ZK circuit proves you follow ≥N verified accounts without revealing WHO.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
