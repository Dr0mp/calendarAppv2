# Deploying Casa Artis Calendar v2

One Node.js process, one SQLite file per workspace and one media folder. It runs
on any small Linux VPS or on a Windows PC. **Serve it over HTTPS in production**:
passkeys and `__Host-` secure cookies need it.

- [Requirements](#requirements)
- [Configuration](#configuration)
- [Linux: systemd + Caddy](#linux-systemd--caddy)
- [Windows: start.bat and NSSM](#windows-startbat-and-nssm)
- [Render](#render)
- [First start](#first-start)
- [Backups and restore](#backups-and-restore)
- [Moving from v1](#moving-from-v1)
- [Upgrades](#upgrades)
- [Troubleshooting](#troubleshooting)

## Requirements

- **Node.js 24 LTS** (the app uses the built-in `node:sqlite`). Check with `node -v`.
- About 200 MB for the app and its dependencies, plus the storage cap (8 GB by default) for data.
- Outbound network is optional: the server only calls out to send email (SMTP), to check
  new passwords against Have I Been Pwned (`HIBP_CHECK=1`) and to fetch a favicon once when
  an admin adds a custom social platform.
- Front-end libraries load from a CDN by default. For an offline or locked-down network run
  `npm run vendor` once and set `ASSETS=local`.

## Configuration

Settings come from environment variables (or a `.env` file read by your service manager).
They are validated at start: an invalid value stops the server with a clear message.
See `.env.example` for the full list.

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | — | **Required.** Public URL, e.g. `https://calendar.casaartis.ro`. Email links use it; the passkey RP ID is its host name |
| `PORT` | `3000` | |
| `APP_ORIGINS` | `APP_URL` | Extra allowed origins, comma-separated (LAN use). Passkeys still need HTTPS or `localhost` |
| `DATA_DIR` | `./data` | Databases and media |
| `BACKUP_DIR` | `DATA_DIR/backups` | Nightly backups, kept 7 days |
| `TRUST_PROXY` | `0` | Set to `1` behind Caddy or nginx so client IPs come from `X-Forwarded-For` |
| `SMTP_URL` / `MAIL_FROM` | empty | Email is off when empty, e.g. `smtps://user:pass@smtp.host:465` |
| `STORAGE_CAP_GB` | `8` | The most an admin can set in Settings |
| `MAX_UPLOAD_MB` | `100` | |
| `ENABLE_DEMO_ACCOUNTS` | `1` | The demo sandbox, rebuilt nightly at `DEMO_RESET_HOUR` |
| `SEED_SAMPLE_CONTENT` | `1` | Sample events and posts on a new install. Use `0` before importing v1 data |
| `ASSETS` | `cdn` | `cdn` or `local` (after `npm run vendor`) |
| `LOG_LEVEL` | `info` | Structured JSON logs on stdout |

No password is ever read from the environment.

## Linux: systemd + Caddy

Caddy gets and renews the HTTPS certificate automatically.

```bash
# 1. A user and the app
sudo useradd --system --create-home --home-dir /opt/casa-artis casaartis
sudo -u casaartis git clone <repo-url> /opt/casa-artis/app
cd /opt/casa-artis/app
sudo -u casaartis npm ci --omit=dev
sudo -u casaartis npm run vendor        # optional, then ASSETS=local
```

`/etc/casa-artis.env` (readable by `casaartis` only, `chmod 600`):

```ini
NODE_ENV=production
APP_URL=https://calendar.casaartis.ro
PORT=3000
TRUST_PROXY=1
DATA_DIR=/var/lib/casa-artis
BACKUP_DIR=/var/backups/casa-artis
SMTP_URL=smtps://user:password@smtp.example.com:465
MAIL_FROM=Casa Artis <calendar@casaartis.ro>
```

```bash
sudo mkdir -p /var/lib/casa-artis /var/backups/casa-artis
sudo chown casaartis: /var/lib/casa-artis /var/backups/casa-artis
```

`/etc/systemd/system/casa-artis.service`:

```ini
[Unit]
Description=Casa Artis Calendar
After=network-online.target
Wants=network-online.target

[Service]
User=casaartis
WorkingDirectory=/opt/casa-artis/app
EnvironmentFile=/etc/casa-artis.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/casa-artis /var/backups/casa-artis

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now casa-artis
journalctl -u casa-artis -f          # the first start prints the setup link
```

`/etc/caddy/Caddyfile`:

```caddy
calendar.casaartis.ro {
    encode zstd gzip
    request_body {
        max_size 110MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

The app sets its own security headers (CSP, HSTS, `X-Content-Type-Options`, …); Caddy
does not need to add any.

## Windows: start.bat and NSSM

For a small office PC. Install **Node.js 24 LTS** from nodejs.org first.

1. Copy the app folder, e.g. to `C:\CasaArtis\app`.
2. Open a command prompt in that folder and run `npm ci --omit=dev`
   (and `npm run vendor` if the PC has no reliable internet).
3. Try it: double-click `start.bat`. It uses `http://localhost:3000` unless `APP_URL` is set.

To run it as a Windows service that starts with the PC, use [NSSM](https://nssm.cc/):

```bat
nssm install CasaArtis "C:\Program Files\nodejs\node.exe" "server\index.js"
nssm set CasaArtis AppDirectory C:\CasaArtis\app
nssm set CasaArtis AppEnvironmentExtra NODE_ENV=production APP_URL=https://calendar.casaartis.ro DATA_DIR=C:\CasaArtis\data BACKUP_DIR=D:\Backups\CasaArtis TRUST_PROXY=1
nssm set CasaArtis AppStdout C:\CasaArtis\logs\app.log
nssm set CasaArtis AppStderr C:\CasaArtis\logs\app.log
nssm set CasaArtis AppRotateFiles 1
nssm set CasaArtis AppRotateBytes 10485760
nssm start CasaArtis
```

For HTTPS on Windows, run [Caddy for Windows](https://caddyserver.com/download) with the
same Caddyfile (also installable as a service with NSSM), or put the PC behind a router or
tunnel that terminates TLS. On a LAN-only setup without HTTPS, passwords work but passkeys
only work on `localhost`; add the LAN address to `APP_ORIGINS`.

`sharp` and `@node-rs/argon2` ship prebuilt Windows binaries. `ffmpeg-static` and
`ffprobe-static` are optional: if their download is blocked, videos still upload, only
without duration checks and poster frames.

## Render

**Free demo.** The repository has a `render.yaml` blueprint: Render dashboard → **New →
Blueprint** → pick the repository. It builds with `npm ci --include=dev && npm run vendor`,
starts with `npm start` and takes its public URL from Render (`RENDER_EXTERNAL_URL`), so no
settings are needed. Visitors click the demo chips on the sign-in page.

The free plan has no persistent disk and sleeps after ~15 minutes idle (the next visit takes
30–60 s). Every start rebuilds the demo from the sample content; anything else is lost.
Ignore the root-admin setup link in the logs.

**Real use** needs a paid instance (Starter or higher) with a **disk**:

| Setting | Value |
|---|---|
| Plan | Starter or higher, **1 instance** (SQLite) |
| Disk | Mount path `/var/data`, 10 GB |
| `DATA_DIR` / `BACKUP_DIR` | `/var/data` / `/var/data/backups` |
| `APP_URL` | Your custom domain, if any (passkeys are tied to it) |
| `SMTP_URL`, `MAIL_FROM` | For invites and password resets |

Keep `TRUST_PROXY=1`. Render terminates HTTPS; do not set `TLS_CERT_FILE`/`TLS_KEY_FILE`.
The setup link appears in the **Logs** tab; `npm run import-v1` and `npm run restore` can run
from the **Shell** tab (stop traffic first for a restore). Deploys with a disk have a few
seconds of downtime. Download backups regularly: nightly ones sit on the same disk.

## First start

The first start creates the databases and prints a one-time **setup link** to the console
(or the service log):

```
  Casa Artis — first-run setup
  Open this link to set the root admin's password:

  https://calendar.casaartis.ro/invite/…
```

Open it to set the root admin's password and add a passkey. The link is valid for 72 hours;
until the password is set, every restart prints a fresh one. If you are moving from v1,
run the import (below) **before** using the link.

## Backups and restore

**What is backed up.** A backup is a `.zip` with consistent snapshots (`VACUUM INTO`) of
both `auth.db` (accounts) and `main.db` (the workspace), taken together, plus the main
media folder. The demo workspace is never backed up.

- **Download now:** Admin → Setări → **Descarcă backup**.
- **Nightly:** at 02:30 (organisation time zone) into `BACKUP_DIR`, keeping 7 days.
  Copy that folder off the machine (another disk, a NAS or cloud sync): a backup on the
  same disk does not survive a disk failure.

**Restore**, with the server stopped:

```bash
sudo systemctl stop casa-artis
sudo -u casaartis DATA_DIR=/var/lib/casa-artis npm run restore -- /var/backups/casa-artis/backup-2026-09-24-02-30.zip
sudo systemctl start casa-artis
```

On Windows: `nssm stop CasaArtis`, then `set DATA_DIR=C:\CasaArtis\data && npm run restore -- D:\Backups\CasaArtis\backup-….zip`,
then `nssm start CasaArtis`.

The restore checks the zip first, moves the current databases and media to
`DATA_DIR/pre-restore-<time>/` (delete that folder once you have checked the result), and
**purges every session, email token and passkey challenge**, so everyone signs in again.
Passkeys and passwords themselves are restored with the accounts.

## Moving from v1

Import the v1 data into a **fresh** v2 install, before anyone uses it:

```bash
# v1 files: users.json, data/workspace.json and data/uploads/
export SEED_SAMPLE_CONTENT=0
npm run import-v1 -- --users /old/users.json --workspace /old/data/workspace.json --uploads /old/data/uploads --dry-run
npm run import-v1 -- --users /old/users.json --workspace /old/data/workspace.json --uploads /old/data/uploads
```

The dry run prints the full report (counts, skipped items, warnings such as unparseable
prices, missing files or unknown owners) without changing anything. The real run is one
transaction: all of it or nothing.

- Users keep their v1 passwords (bcrypt), rehashed to argon2id on their first sign-in.
  If the root admin has not been set up yet (the setup link was not used), the v1 admin
  with the same user name (`ADMIN_BOOTSTRAP_USERNAME`, `admin` by default) becomes the
  root admin and keeps their v1 password.
- Passkeys cannot be migrated. Users who had one see a banner inviting them to add a new one.
- 90 days after the import, the admin overview lists migrated accounts that never signed
  in, so you can send them reset links.
- Demo users are skipped.

## Upgrades

```bash
cd /opt/casa-artis/app
sudo -u casaartis git pull
sudo -u casaartis npm ci --omit=dev
sudo systemctl restart casa-artis
```

Database migrations run automatically at start. Take a backup first.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The server exits with "Invalid configuration" | The message names the variable; fix it in the env file |
| Passkeys fail ("origin not allowed") | `APP_URL` must match the address in the browser exactly, over HTTPS (or `localhost`) |
| Everyone shares one rate limit | Set `TRUST_PROXY=1` behind Caddy/nginx |
| Uploads fail with "storage full" | Admin → Stocare: use the cleanup tools, or raise the cap in Setări (up to `STORAGE_CAP_GB`) |
| No emails | Admin → Setări → **Trimite email de test** shows the SMTP error; check `SMTP_URL` |
| Videos upload without duration or poster | `ffmpeg-static`/`ffprobe-static` were not installed; run `npm ci` with network access |
