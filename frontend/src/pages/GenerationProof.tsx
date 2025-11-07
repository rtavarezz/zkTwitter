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
    const yy = parseInt(dob.slice(-2), 10);
    if (isNaN(yy)) return null;
    return (yy <= 24 ? 2000 : 1900) + yy;
  };

  const birthYear = getBirthYear();

  const handleGenerateProof = async () => {
    if (selectedGen === null || !birthYear) return;

    setProving(true);
    setError(null);
    setProofSteps([]);

    try {
      // Step 1: Load the circuit artifacts (matches server verification key).
      setProofSteps(prev => [...prev, '1. Loading circuit artifacts (WASM + proving key)...']);
      const wasmPath = '/circuits/generationMembership.wasm';
      const zkeyPath = '/circuits/generationMembership_final.zkey';
      const snarkjs = await import('snarkjs');
      setProofSteps(prev => [...prev, '✓ Circuit artifacts loaded']);

      // Step 2: Derive a deterministic salt so the server can re-check the commitment later.
      setProofSteps(prev => [...prev, '2. Generating salt for birthYear commitment (ZK privacy)...']);
      const saltInput = `${user?.id ?? 'anon'}-${user?.selfNullifier ?? '0'}-birthyear-salt`;
      const encoder = new TextEncoder();
      const saltBytes = encoder.encode(saltInput);
      let saltBigInt = BigInt(0);
      for (let i = 0; i < Math.min(saltBytes.length, 31); i++) {
        saltBigInt = (saltBigInt << BigInt(8)) | BigInt(saltBytes[i]);
      }
      const birthYearSalt = saltBigInt.toString();
      setProofSteps(prev => [...prev, '✓ Salt generated (deterministic from user identity)']);

      // Step 3: Assemble the inputs exactly as the circuit expects.
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
        selfNullifier: user?.selfNullifier || '0',
        sessionNonce: Math.floor(Math.random() * 1000000).toString(),
        generationConfigHash: configHash,
        targetGenerationId: selectedGen.toString(),
        generationConfig: generationConfig.map(String),
        birthYear: birthYear.toString(),
        birthYearSalt,
      };
      setProofSteps(prev => [...prev, `✓ Inputs prepared (target=${GENERATIONS[selectedGen].name}, age hidden via Poseidon commitment)`]);

      // Step 4: Run the Groth16 prover in-browser.
      setProofSteps(prev => [...prev, '4. Generating zero-knowledge proof (this may take a few seconds)...']);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        wasmPath,
        zkeyPath
      );
      setProofSteps(prev => [...prev, '✓ ZK proof generated successfully']);

      // Step 5: Send proof to `/generation/verify-generation` for verification + badge persistence.
      setProofSteps(prev => [...prev, '5. Submitting proof to backend for verification...']);
      const result = await apiPost<{
        success: boolean;
        generationId: number;
        generationName: string;
      }>('/generation/verify-generation', {
        proof,
        publicSignals,
      });
      setProofSteps(prev => [...prev, '✓ Backend verified proof cryptographically']);

      if (result.success) {
        // Step 6: Update local user context
        setProofSteps(prev => [...prev, `6. Generation verified: ${result.generationName}`]);

        // Fetch updated user to get generationId
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
        setProofSteps(prev => [...prev, '✓ Complete! Your tweets will now show your generation badge.']);

        // Redirect to timeline
        setTimeout(() => {
          navigate('/timeline');
          window.location.reload(); // Force reload to update user context
        }, 2000);
      }
    } catch (err) {
      console.error('Proof generation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate proof');
      setProofSteps(prev => [...prev, `✗ Error: ${err instanceof Error ? err.message : 'Failed'}`]);
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
