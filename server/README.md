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
