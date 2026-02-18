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

## Single-file wizard (no setup)

Open **`index.html`** in the project root directly in a browser or host it on any static site (GitHub Pages, Netlify, etc.):

- **Open as file:** Enter your backend API URL in the "Backend API URL" field (e.g. `https://your-app.vercel.app`), click Save, then use the form. The URL is stored in `localStorage`.
- **Same-origin:** If you serve `index.html` from the same host as the Next.js app (e.g. `https://your-app.vercel.app/index.html`), no API URL is needed.
- **Static host + separate backend:** Serve `index.html` from your static host, set "Backend API URL" to your deployed Next.js URL, and ensure the backend allows CORS (this repo’s API routes and middleware are already configured for cross-origin use).

**Testing with the dev server:** Run `npm run dev`, then open [http://localhost:3000/index.html](http://localhost:3000/index.html) (a copy of the root `index.html` in `public/` so it works same-origin with no API URL needed). Or open the root `index.html` in your browser (file) and set Backend API URL to `http://localhost:3000` and click Save.

## API

- `POST /api/searches` -> starts async job, returns `{ jobId, status }`
- `GET /api/searches/:jobId` -> returns job status/progress/results

## Validate

```bash
npm test
npm run build
```
