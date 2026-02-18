# Domainname Wizard

Namelix-to-GoDaddy budget domain finder.

## Features

- Collects Namelix-style naming preferences from a web form.
- Uses Playwright to run Namelix generation and scrape generated names.
- Normalizes names into domain candidates (`<name>.<tld>`).
- Checks domain availability in bulk using official GoDaddy Domains API.
- Applies user yearly budget filtering:
  - Shows in-budget available domains first.
  - Hides over-budget domains by default (revealable).
  - Keeps unavailable/unknown domains in a collapsed section.
- Uses async jobs with polling API endpoints and in-memory TTL storage.
- Includes throttling protections:
  - Namelix queue concurrency `1` with cooldown + jitter.
  - GoDaddy queue concurrency `3`, max `30` requests/minute.
- Includes unit tests for normalization, budget classification, and chunking.

## Environment

Copy `.env.example` to `.env.local` and set:

```bash
GODADDY_API_KEY=your_key
GODADDY_API_SECRET=your_secret
GODADDY_ENV=OTE
```

`GODADDY_ENV` supports:

- `OTE` (default)
- `PROD`

## Install

```bash
npm install
npm run playwright:install
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## API

- `POST /api/searches` -> starts async job, returns `{ jobId, status }`
- `GET /api/searches/:jobId` -> returns job status/progress/results

## Validate

```bash
npm test
npm run build
```
