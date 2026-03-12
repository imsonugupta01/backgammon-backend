# Backgammon Backend (Node.js)

## Setup
1. Open terminal in `backend`
2. Install dependencies:
   - `npm install`
3. Start dev server:
   - `npm run dev`

Server runs on `http://localhost:5000` by default.

## Environment
Configured in `.env`:
- `PORT`
- `JWT_SECRET`
- `MONGODB_URI` (uses DB name `backgammon`)
- `PAYPAL_MODE` (`sandbox` or `live`)
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_CURRENCY` (default `USD`)
- `COINS_PER_USD` (default `100`)
- `MIN_TOPUP_COINS` (default `100`)
- `MAX_TOPUP_COINS` (default `100000`)
- `MIN_WITHDRAW_COINS` (default `1000`)
- `MAX_WITHDRAW_COINS` (default `1000000`)
- `PAYPAL_AUTO_PAYOUTS` (`true` to send payout immediately, otherwise manual review)

## APIs
### Health
- `GET /api/health`

### Signup
- `POST /api/auth/signup`
- Body:
```json
{
  "name": "Sonu",
  "email": "sonu@example.com",
  "password": "password123"
}
```

### Login
- `POST /api/auth/login`
- Body:
```json
{
  "email": "sonu@example.com",
  "password": "password123"
}
```

### Wallet
- `GET /api/wallet/me`
- `GET /api/wallet/paypal/config`
- `POST /api/wallet/paypal/create-order`
- `POST /api/wallet/paypal/capture-order`
- `POST /api/wallet/withdraw/request`

### External Platform Session
- `POST /api/auth/external/session`
- Body:
```json
{
  "platform": "partner-app",
  "externalUserId": "u_123",
  "name": "Guest Player",
  "email": "guest@example.com",
  "coins": 1500,
  "returnUrl": "https://partner.example.com/game-result",
  "signature": "hmac_sha256_hex"
}
```
- Signature payload uses:
```json
{
  "platform": "partner-app",
  "externalUserId": "u_123",
  "name": "Guest Player",
  "email": "guest@example.com",
  "coins": 1500,
  "returnUrl": "https://partner.example.com/game-result"
}
```
- Sign with `EXTERNAL_PLATFORM_SHARED_SECRET` using HMAC SHA-256 hex.

### Frontend External Redirect Contract
- Redirect the player to the frontend with query params:
  - `platform`
  - `externalUserId`
  - `name`
  - `email`
  - `coins`
  - `returnUrl`
  - `signature`
- On match completion, external players are returned to `returnUrl` with:
  - `status`
  - `result`
  - `reason`
  - `stake`
  - `coinChange`
  - `opponentId`
  - `opponentName`
