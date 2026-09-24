# Casa Artis Calendar v2

The team events calendar, social media planner and administration for Casa Artis,
rebuilt from [`docs/rebuild-spec.md`](docs/rebuild-spec.md). v1 was the approved
mockup; v2 is a clean implementation with a new design system, phone-first layouts
and a hardened backend.

## Stack

- **Server:** Node.js 24 (built-in `node:sqlite`), Hono, argon2id, SimpleWebAuthn, Zod, sharp, pino, croner.
- **Front end:** no build step. Native ES modules, Preact + htm + signals, preact-iso routing,
  loaded through an import map (CDN with pinned versions, or self-hosted with `ASSETS=local`).
- **Shared:** `shared/schemas` (Zod) and `shared/rules` (pure logic: time zone, conflicts,
  recurrence, media rules) run unchanged in the browser and on the server.

## Quick start

```bash
nvm use            # Node 24 (see .nvmrc)
npm ci
npm run vendor     # optional: self-host the front-end libraries (ASSETS=local)
cp .env.example .env
APP_URL=http://localhost:3000 npm start
```

On first start the server prints a one-time **setup link** for the root admin
(`/invite/<token>`). Open it to choose the password and, optionally, add a passkey.
No password is ever read from the environment.

Demo accounts (`ENABLE_DEMO_ACCOUNTS=1`, the default) sign in from the chips on the
login page into a sandbox that is rebuilt on every start and nightly.

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with `--watch` |
| `npm run vendor` | Copy front-end libraries to `public/vendor/` and write `importmap.local.json` |
| `npm run icons` | Rebuild `public/icons.svg` from `lucide-static` |
| `npm run lint` | ESLint (bans `innerHTML`/`dangerouslySetInnerHTML`) and stylelint (bans `!important`) |
| `npm run typecheck` | `tsc --checkJs` over the JSDoc types |
| `npm run check:i18n` | RO/EN keys identical, none unused, every `t('…')` exists |
| `npm run check:importmap` | CDN map, vendor list and package.json pin the same versions |
| `npm test` | Unit (with coverage gate) and API tests (`node --test`) |
| `npm run test:e2e` | Playwright (Chromium, WebKit, Firefox × desktop and phone) |
| `npm run import-v1` | Import v1 data into a fresh v2 install (`--dry-run` prints the report only) |
| `npm run restore -- <backup.zip>` | Restore a backup (server stopped); signs everyone out |
| `npm run lighthouse` | Lighthouse budgets for the calendar and the scheduling form (mobile, HTTP/2) |

Locally, `E2E_BROWSERS=chromium npm run test:e2e` runs just Chromium.

## Layout

```
server/   config, HTTP (Hono), auth, db (migrations + repos), services, jobs, seed
shared/   schemas/ (Zod) and rules/ (pure logic) — used by browser and server
public/   index.html, app/ (Preact pages and components), styles/ (cascade layers), icons, fonts
tests/    unit/, api/, e2e/
docs/     rebuild-spec.md, deploy.md (Linux/Caddy, Windows/NSSM, backups, v1 import)
```

See [`docs/deploy.md`](docs/deploy.md) for Linux (systemd + Caddy) and Windows deployment,
backups and restore.

## Licence

GPL-3.0-only, as v1.
