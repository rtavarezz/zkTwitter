import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { apiPost, apiGet } from '../lib/api';
import './GenerationProof.css';

const GENERATIONS = [
  { id: 0, name: 'Gen Z', range: '1997-2012' },
  { id: 1, name: 'Millennial', range: '1981-1996' },
  { id: 2, name: 'Gen X', range: '1965-1980' },
  { id: 3, name: 'Boomer', range: '1946-1964' },
  { id: 4, name: 'Silent', range: '1928-1945' },
];

export default function GenerationProof() {
  const { user, isVerified, login } = useAuth();
  const navigate = useNavigate();
  const [selectedGen, setSelectedGen] = useState<number | null>(null);
  const [proving, setProving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [proofSteps, setProofSteps] = useState<string[]>([]);

  useEffect(() => {
    if (!user || !isVerified) {
      navigate('/login');
    }
  }, [user, isVerified, navigate]);

  const getBirthYear = (): number | null => {
    if (!user?.disclosed) return null;
    const disclosed = user.disclosed as Record<string, unknown>;
    const dob = disclosed.dateOfBirth as string | undefined;
    if (!dob || dob.length < 6) return null;
    const yy = parseInt(dob.slice(0, 2), 10);
    if (isNaN(yy)) return null;
    return (yy <= 24 ? 2000 : 1900) + yy;
  };

  const birthYear = getBirthYear();

  /**
   * Client-side proof generation flow for generation membership.
   * Privacy: birthYear NEVER sent to backend, only a Poseidon commitment.
   *
   * Steps:
   * 1. Load circuit (generationMembership.circom compiled to WASM)
   * 2. Generate deterministic salt for commitment
   * 3. Prepare inputs: birthYear (private), selfNullifier, sessionNonce, config
   * 4. Run Groth16 prover locally in browser (generates ZK proof)
   * 5. Send proof + public signals to backend for verification
   * 6. Backend verifies cryptographically and stores generation badge
   */
  const handleGenerateProof = async () => {
    if (selectedGen === null || !birthYear) return;

    setProving(true);
    setError(null);
    setProofSteps([]);

    try {
      // Step 1: Load the circuit artifacts (matches server verification key)
      // Circuit: circuits/generation/generationMembership.circom
      setProofSteps(prev => [...prev, '1. Loading circuit artifacts (WASM + proving key)...']);
      const wasmPath = '/circuits/generationMembership.wasm';
      const zkeyPath = '/circuits/generationMembership_final.zkey';
      const snarkjs = await import('snarkjs');
      setProofSteps(prev => [...prev, 'Done: Circuit artifacts loaded']);

      // Step 2: Derive a deterministic salt for Poseidon commitment
      // Salt is deterministic so user can re-prove with same commitment
      // birthYearCommitment = Poseidon(birthYear, salt) hides exact age
      setProofSteps(prev => [...prev, '2. Generating salt for birthYear commitment (ZK privacy)...']);
      const saltInput = `${user?.id ?? 'anon'}-${user?.selfNullifier ?? '0'}-birthyear-salt`;
      const encoder = new TextEncoder();
      const saltBytes = encoder.encode(saltInput);
      let saltBigInt = BigInt(0);
      for (let i = 0; i < Math.min(saltBytes.length, 31); i++) {
        saltBigInt = (saltBigInt << BigInt(8)) | BigInt(saltBytes[i]);
      }
      const birthYearSalt = saltBigInt.toString();
      setProofSteps(prev => [...prev, 'Done: Salt generated (deterministic from user identity)']);

      // Step 3: Assemble circuit inputs (public + private)
      // PRIVATE input: birthYear, birthYearSalt (NEVER sent to backend)
      // PUBLIC inputs: selfNullifier, sessionNonce, generationConfigHash, targetGenerationId
      // PUBLIC outputs: isMember, birthYearCommitment, claimHash
      setProofSteps(prev => [...prev, '3. Preparing circuit inputs (birthYear hidden via commitment)...']);
      const generationConfig = [
        0, 1997, 2012,  // Gen Z
        1, 1981, 1996,  // Millennial
        2, 1965, 1980,  // Gen X
        3, 1946, 1964,  // Boomer
        4, 1928, 1945,  // Silent
      ];

      const configHash = '20410492734497820080861672359265859434102176107885102445278438694323581735438';

      const input = {
        selfNullifier: user?.selfNullifier || '0',           // PUBLIC (binds to identity)
        sessionNonce: Math.floor(Math.random() * 1000000).toString(), // PUBLIC (prevents replay)
        generationConfigHash: configHash,                    // PUBLIC (config integrity)
        targetGenerationId: selectedGen.toString(),          // PUBLIC (which generation claiming)
        generationConfig: generationConfig.map(String),      // Used to validate config hash
        birthYear: birthYear.toString(),                     // PRIVATE (never revealed!)
        birthYearSalt,                                       // PRIVATE (for commitment)
      };
      setProofSteps(prev => [...prev, `Inputs prepared (target=${GENERATIONS[selectedGen].name}, age hidden via Poseidon commitment)`]);

      // Step 4: Run Groth16 prover locally in browser
      // This executes the circuit and generates cryptographic proof
      // Proof shows circuit ran correctly WITHOUT revealing private inputs (birthYear)
      setProofSteps(prev => [...prev, '4. Generating zero-knowledge proof (this may take a few seconds)...']);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasmPath,
        zkeyPath
      );
      setProofSteps(prev => [...prev, 'ZK proof generated successfully']);

      // Step 5: Send proof + public signals to backend for cryptographic verification
      // POST /generation/verify-generation
      // Request body: { proof: Groth16Proof, publicSignals: string[] }
      // Backend (server/src/routes/generation.ts) will:
      //   1. Verify proof cryptographically with snarkjs.groth16.verify()
      //   2. Extract generationId from public signals
      //   3. Save to DB: UPDATE User SET generationId, birthYearCommitment, generationProofHash
      //   4. Return: { success: true, generationId: 0-4, generationName: "Gen Z" }
      setProofSteps(prev => [...prev, '5. Submitting proof to backend for verification...']);
      const result = await apiPost<{
        success: boolean;
        generationId: number;
        generationName: string;
      }>('/generation/verify-generation', {
        proof,
        publicSignals,
      });
      setProofSteps(prev => [...prev, 'Done: Backend verified proof cryptographically']);

      if (result.success) {
        // Step 6: Update local user context with generation badge
        // Response received: { success: true, generationId: 0, generationName: "Gen Z" }
        setProofSteps(prev => [...prev, `6. Generation verified: ${result.generationName}`]);

        // Fetch updated user from DB to sync local state
        // GET /users/:handle returns full user object with generationId now set
        const token = localStorage.getItem('token');
        if (token) {
          const updatedUser = await apiGet<any>(`/users/${user?.handle}`);
          if (updatedUser) {
            login(token, {
              ...user!,
              generationId: result.generationId,
            });
          }
        }

        setSuccess(true);
        setProofSteps(prev => [...prev, 'Done: Complete! Your tweets will now show your generation badge.']);

        // Redirect to timeline where badge now displays (e.g., "Verified • Gen Z")
        setTimeout(() => {
          navigate('/timeline');
          window.location.reload(); // Force reload to update user context
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
    <div className="generation-proof-page">
      <Navbar />
      <div className="generation-container">
        <h1>Prove Your Generation</h1>
        <p className="subtitle">
          Generate a zero-knowledge proof to earn your generation badge. The circuit proves your birth year (private input) falls within the generation range. After verification, your tweets will display your generation badge.
        </p>

        {birthYear ? (
          <div className="birth-year-info">
            Birth year from Self verification: <strong>{birthYear}</strong>
          </div>
        ) : (
          <div className="error-banner">
            No birth year found in your disclosed data. Please re-register with age disclosure enabled.
          </div>
        )}

        <div className="generation-selector">
          <h3>Select Your Generation</h3>
          <div className="generation-grid">
            {GENERATIONS.map((gen) => (
              <button
                key={gen.id}
                className={`generation-card ${selectedGen === gen.id ? 'selected' : ''}`}
                onClick={() => setSelectedGen(gen.id)}
                disabled={proving}
              >
                <div className="gen-name">{gen.name}</div>
                <div className="gen-range">{gen.range}</div>
              </button>
            ))}
          </div>
        </div>

        {proofSteps.length > 0 && (
          <div className="proof-steps">
            <h4>Proof Generation Progress:</h4>
            <ul>
              {proofSteps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">Generation verified! Redirecting...</div>}

        <button
          className="cta primary prove-button"
          onClick={handleGenerateProof}
          disabled={selectedGen === null || proving || !birthYear}
        >
          {proving ? 'Generating Proof...' : 'Generate Proof'}
        </button>

        {!proving && (
          <div className="info-box">
            <h4>How it works</h4>
            <ul>
              <li><strong>Privacy:</strong> Birth year stays private - only birthYearCommitment = Poseidon(birthYear, salt) is sent</li>
              <li><strong>Proof:</strong> Circuit proves birth year falls in selected generation range (e.g., 1997-2012 for Gen Z)</li>
              <li><strong>Verification:</strong> Backend verifies Groth16 proof cryptographically and trusts circuit output</li>
              <li><strong>Binding:</strong> Proof is bound to your selfNullifier (prevents proof stealing)</li>
              <li><strong>Consistency:</strong> You cannot change your commitment after first proof (prevents age lying)</li>
              <li><strong>Badge:</strong> Your tweets will display generation badge (e.g., "Verified • Gen Z")</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
