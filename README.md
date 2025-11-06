# zkTwitter

zkTwitter is a privacy-preserving social feed that verifies “proof of humanness” by integrating the Self Protocol’s passport attestation. Users register and log in by scanning a QR code with the Self mobile app; proofs are verified server-side and only minimal disclosure (country + 21+ flag) is stored.

## 1. Getting Started

### Prerequisites
- Node.js 20+
- npm 9+
- ngrok (for exposing `/auth/self/verify` to Self staging)

### Backend Setup
```bash
cd server
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev
```
Backend listens on `http://localhost:3001`.

### Frontend Setup
```bash
cd frontend
npm install
cp .env.example .env          # set VITE_SELF_ENDPOINT to your ngrok URL
npm run dev
```
Frontend serves the SPA on `http://localhost:5173`.

### Environment Variables
| Service | Variable | Description |
| --- | --- | --- |
| Backend | `DATABASE_URL` | SQLite connection string (use Postgres in prod) |
| Backend | `SELF_SCOPE` | Self app scope (`zktwitter`) |
| Backend | `SELF_BACKEND_ENDPOINT` | Public HTTPS URL to `/auth/self/verify` |
| Backend | `SELF_MOCK_PASSPORT` | `true` to enable Self staging environment |
| Backend | `SELF_USER_ID_TYPE` | `uuid` (matches QR builder) |
| Backend | `JWT_SECRET` | Signing secret for login tokens |
| Frontend | `VITE_API_BASE_URL` | Origin of the backend (defaults to `http://localhost:3001`) |
| Frontend | `VITE_SELF_ENDPOINT` | Public HTTPS URL used in the QR payload |

## 2. Key Endpoints
| Method & Path | Purpose |
| --- | --- |
| `POST /auth/register/init` | Reserve a handle and return `{ userId, avatarUrl }` for QR embedding |
| `GET /auth/register/status/:handle` | Poll registration status (`pending` / `verified`) |
| `POST /auth/login/init` | Create a login session and return `{ sessionId, userId }` |
| `GET /auth/login/status/:sessionId` | Poll login status, receive JWT + disclosed fields when verified |
| `POST /auth/self/verify` | Self relayer callback; validates proofs and persists registration/login results |
| `GET /tweets` | Paginated timeline with selective disclosure metadata |
| `POST /tweets` | Create a tweet for a verified handle |
| `GET /users/:handle` | Profile payload with disclosure flags |
| `GET /health` | Service liveness probe |

## 3. Primary Implementation References
- Registration + login lifecycle: `server/src/routes/auth.ts:31-233`
- Proof validation & Self SDK wrapper: `server/src/services/selfService.ts:10-62`
- Self user context decoding helper: `server/src/utils/userContext.ts:3-29`
- Disclosure parsing utilities: `server/src/utils/disclosure.ts:1-23`
- Timeline API (pagination + posting): `server/src/routes/timeline.ts:8-111`
- Prisma data model: `server/prisma/schema.prisma:1-47`
- Frontend registration flow: `frontend/src/App.tsx:1-187`
- Frontend login flow: `frontend/src/pages/Login.tsx:1-162`
- Timeline UI + composer: `frontend/src/pages/Timeline.tsx:1-210`
- Profile disclosures: `frontend/src/pages/Profile.tsx:1-120`

## 4. Running an End-to-End Verification
1. Start backend and frontend locally.
2. Launch ngrok: `npx ngrok http 3001` and update both backend `.env` (`SELF_BACKEND_ENDPOINT`) and frontend `.env` (`VITE_SELF_ENDPOINT`).
3. In the frontend, register a handle to generate the Self QR code.
4. In the Self staging app, enable the mock passport (tap passport button 5x) and scan the QR.
5. The backend processes the callback and the registration screen automatically advances when `/auth/register/status/:handle` reports `verified`.
6. Repeat the process from the login page; once `/auth/login/status/:sessionId` returns a token, the app redirects to the timeline with the verified badge rendered.

## 5. Testing TL;DR
- **Builds** – `npm run build` in `server/` and `frontend/` (TypeScript + bundler).
- **Database reset** – `cd server && npx prisma migrate reset` then `npm run seed`.
- **Simulate Self callback** – `node server/test-self-simulation.ts` to exercise `/auth/self/verify`.
- **API smoke** – `curl http://localhost:3001/tweets` / `curl http://localhost:3001/users/alice`.
- **Manual E2E** – Run ngrok, scan QR with Self staging app, confirm timeline badge + JWT.

## 6. Stretch Goal (Week 2)
- Port Self passport circuit to SP1, generate proofs with `sp1`, and expose an audit endpoint for SP1 proof metadata.

---
Need deeper protocol notes? See `zkCircuits.md` for the circuit exploration scratchpad.
