# zkTwitter Backend

Privacy-preserving social app with Self Protocol passport verification.

## Setup

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env

# Run migrations
npm run migrate

# Seed database
npm run seed

# Start dev server
npm run dev
```

### Optional: Dump Self Proof Payloads for Development

Set `SELF_PROOF_DUMP_DIR` in `.env` (e.g. `tmp/self-proofs`) to have the verifier automatically persist every Self proof payload plus the decoded disclosure result after registration/login. Relative paths are resolved from the `server/` directory; use an absolute path if you prefer a different location. The dumper is disabled in production and logs the output path when a file is written.

To convert the latest dump into generation-circuit witness scaffolding, run:

```bash
npm run build-generation-witness
```

The tool writes JSON to `tmp/generation-witness/` containing:

- the raw Self proof + public signals,
- the decoded disclosures (nullifier, nationality, DOB),
- inferred birth year and matching generation bucket (configurable in `scripts/buildGenerationWitness.ts`).

Pass a specific dump or override the detected generation ID:

```bash
npm run build-generation-witness -- server/tmp/self-proofs/<dump>.json
npm run build-generation-witness -- --latest --target=0   # force Gen Z
```

## Environment Variables

Please check .env.example

## API Endpoints

Please check server/src/routes/auth.ts

### GET /timeline
Get all tweets with user verification status.

```bash
curl http://localhost:3001/timeline
```

## Architecture

```
Self App (QR Scan)
       ↓
Frontend (generates QR with userId + disclosures)
       ↓
Self Mobile App (user proves passport)
       ↓
POST /auth/register or /auth/login
       ↓
SelfBackendVerifier.verify()
       ↓
Database (store minimal user data)
       ↓
GET /timeline (returns tweets with humanStatus badges)
```

## Database Schema

Check server/prisma/schema.prisma

## Testing with Mock Passports

1. Set `SELF_MOCK_PASSPORT="true"` in .env
2. Use Self staging app: https://playground.staging.self.xyz/
3. Tap passport button 5x in mobile app to generate mock passport
4. Scan QR code from your frontend
