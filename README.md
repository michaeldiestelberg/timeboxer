# Timeboxer

Timeboxer is a shared meeting timer for team check-ins, demos, and standups. Every new session gets a shareable link, so everyone in the room can open the same timer view in their own browser instead of relying on one person to screen-share it.

Live app: [https://timeboxer.productized.tech](https://timeboxer.productized.tech)

## What It Does

- Creates a shareable session URL by default
- Syncs participant setup and live timer state across browsers
- Randomly selects the next participant from the remaining roster
- Keeps the countdown server-authoritative with shared timestamps
- Supports start, pause, resume, reset, next participant, and end session controls
- Flashes and plays a sound when time is up
- Uses Upstash Redis on Vercel for short-lived shared session state

## Stack

- Next.js 16 App Router
- React 19
- Upstash Redis (`@upstash/redis`)
- Vercel Functions + Server-Sent Events for live sync
- Vitest for unit/service tests
- Playwright for end-to-end multi-browser tests

## Local Development

1. Clone the repo:

   ```sh
   git clone git@github.com:michaeldiestelberg/timeboxer.git
   cd timeboxer
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Choose one local mode:

   Memory-backed dev mode:

   ```sh
   TIMEBOXER_STORE=memory npm run dev
   ```

   Vercel-linked dev mode:

   ```sh
   vercel env pull .env.development.local --environment development
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Shared-session mode expects these variables:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_URL`
- `NEXT_PUBLIC_APP_URL`

For tests and quick local work, `TIMEBOXER_STORE=memory` skips Redis entirely.

Set `NEXT_PUBLIC_APP_URL` to the public URL for the environment you are deploying. For local-only work, the app falls back to `http://localhost:3000`.

## Available Scripts

```sh
npm run dev
npm run build
npm run typecheck
npm test
npm run test:e2e
```

## Testing

- `npm test` runs the Vitest suite for session state and service logic
- `npm run test:e2e` runs the Playwright shared-session flow against a memory-backed local server
- `npm run build` verifies the production Next.js build

## Deployment

Timeboxer is designed to run on Vercel with Redis-backed shared session state. Keep the app runtime and Redis region aligned in `vercel.json`, configure the required environment variables, and deploy through the Vercel CLI or a connected Git integration.

For local work against your own Vercel project, pull your environment into `.env.development.local`:

```sh
vercel env pull .env.development.local --environment development
```
