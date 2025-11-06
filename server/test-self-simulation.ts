/**
 * Simulated Self Protocol proof test
 * This simulates what the Self relayers would POST to our /auth/self/verify endpoint
 * Since we can't use real passports in testing, this validates backend logic
 */

// Simulated proof payload structure matching Self SDK format
const simulatedContext = {
  action: 'registration' as const,
  handle: 'alice_test',
  userId: '550e8400-e29b-41d4-a716-446655440000',
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice_test',
};

const simulatedProof = {
  attestationId: 1, // 1 = Passport attestation
  proof: {
    a: ['0x123', '0x456'],
    b: [
      ['0x789', '0xabc'],
      ['0xdef', '0x012'],
    ],
    c: ['0x345', '0x678'],
  },
  pubSignals: [
    '0x1234567890abcdef', // nullifier
    '0xabcdef1234567890', // merkle root
    '21', // minimum age check result
    '840', // country code (USA)
    '0', // OFAC check result
  ],
  userContextData: Buffer.from(JSON.stringify(simulatedContext), 'utf8').toString('hex'),
};

async function testSelfVerifyEndpoint() {
  console.log('🧪 Testing Self verification endpoint...\n');

  try {
    const response = await fetch('http://localhost:3001/auth/self/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(simulatedProof),
    });

    const data = (await response.json()) as any;

    console.log('📊 Response Status:', response.status);
    console.log('📋 Response Body:', JSON.stringify(data, null, 2));

    // Expected behavior:
    // - Backend should receive the payload
    // - Validation should run
    // - Response should match Self docs format: { status, result, reason? }
    // - Even if proof is invalid, we confirm the flow works

    if (response.status === 200) {
      console.log('\n✅ Endpoint responded correctly (status 200)');

      if (data.status && typeof data.result === 'boolean') {
        console.log('✅ Response format matches Self docs spec');

        if (data.status === 'error') {
          console.log(`⚠️  Verification failed (expected with simulated proof): ${data.reason}`);
        } else {
          console.log('🎉 Verification succeeded!');
        }
      } else {
        console.log('❌ Response format does not match Self docs spec');
      }
    } else {
      console.log(`\n❌ Unexpected status code: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : error);
    console.log('\nℹ️  Make sure the backend is running on port 3001');
  }
}

// Run test
testSelfVerifyEndpoint();
