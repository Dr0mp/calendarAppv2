#!/usr/bin/env node
// Lighthouse budgets (§13): the calendar and the scheduling form on the
// mobile profile must score performance ≥ 90, accessibility 100 and best
// practices 100. Starts the test server, signs in with a demo account and
// audits each page.
//
//   CHROMIUM_PATH=/path/to/chrome npm run lighthouse
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const PORT = Number(process.env.LH_PORT ?? 3230);
// Production runs behind HTTPS with HTTP/2 (Caddy); measure the same way, with
// the server's built-in TLS and a throwaway self-signed certificate.
const BASE = `https://localhost:${PORT}`;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // this script's own fetches to the self-signed server
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-lh-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-keyout",
    path.join(certDir, "key.pem"),
    "-out",
    path.join(certDir, "cert.pem"),
  ],
  { stdio: "ignore" },
);
const PAGES = ["/calendar", "/schedule"];
const BUDGET = { performance: 0.9, accessibility: 1, "best-practices": 1 };

/** Wait for the server's health endpoint. */
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/v1/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("The server did not start");
}

const server = spawn(process.execPath, ["tests/e2e/server.mjs"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    APP_URL: BASE,
    ASSETS: process.env.ASSETS ?? "local",
    NODE_ENV: "test",
    TLS_CERT_FILE: path.join(certDir, "cert.pem"),
    TLS_KEY_FILE: path.join(certDir, "key.pem"),
  },
  stdio: ["ignore", "ignore", "inherit"],
});
let failed = false;
try {
  await waitForServer();
  // A session cookie for the demo user (no password needed).
  const login = await fetch(`${BASE}/api/v1/auth/demo`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ account: "demo" }),
  });
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!login.ok || !cookie)
    throw new Error(`Demo sign-in failed: ${login.status}`);

  const chrome = await chromeLauncher.launch({
    chromePath: process.env.CHROMIUM_PATH || undefined,
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--ignore-certificate-errors",
    ],
  });
  try {
    fs.mkdirSync("lighthouse-reports", { recursive: true });
    for (const page of PAGES) {
      const result = await lighthouse(
        `${BASE}${page}`,
        {
          port: chrome.port,
          output: "html",
          logLevel: "error",
          extraHeaders: { Cookie: cookie },
          onlyCategories: Object.keys(BUDGET),
        },
        undefined,
      );
      if (!result) throw new Error(`No result for ${page}`);
      const report = Array.isArray(result.report)
        ? result.report[0]
        : result.report;
      fs.writeFileSync(
        path.join("lighthouse-reports", `${page.slice(1) || "home"}.html`),
        report,
      );
      fs.writeFileSync(
        path.join("lighthouse-reports", `${page.slice(1) || "home"}.json`),
        JSON.stringify(result.lhr),
      );
      const scores = Object.fromEntries(
        Object.keys(BUDGET).map((k) => [
          k,
          result.lhr.categories[k]?.score ?? 0,
        ]),
      );
      const line = Object.entries(scores)
        .map(([k, v]) => `${k} ${Math.round(v * 100)}`)
        .join(" · ");
      const bad = Object.entries(BUDGET).filter(([k, min]) => scores[k] < min);
      console.log(`${bad.length ? "✗" : "✓"} ${page}: ${line}`);
      for (const [k] of bad) {
        failed = true;
        const audits = result.lhr.categories[k].auditRefs
          .map((r) => result.lhr.audits[r.id])
          .filter(
            (a) =>
              a &&
              a.score !== null &&
              a.score < 1 &&
              a.scoreDisplayMode !== "informative",
          )
          .slice(0, 6);
        for (const a of audits)
          console.log(
            `    ${k}: ${a.title} (${a.displayValue ?? Math.round((a.score ?? 0) * 100)})`,
          );
      }
    }
  } finally {
    await chrome.kill();
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  failed = true;
} finally {
  server.kill();
  fs.rmSync(certDir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
