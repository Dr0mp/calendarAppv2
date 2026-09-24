import '../setup.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../server/config.js';
import { createApp } from '../../server/app.js';
import { createHttpApp } from '../../server/http/app.js';
import { hashPassword } from '../../server/auth/passwords.js';
import { insertUser } from '../../server/services/users.js';
import pino from 'pino';

export const ORIGIN = 'http://localhost:3000';
export const TEST_TOKEN = 'test-reset-token-value';

/**
 * Start an isolated app (temporary DATA_DIR) and return helpers.
 * @param {Record<string,string>} [env]
 */
export async function startApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_URL: ORIGIN,
    DATA_DIR: dataDir,
    ASSETS: 'cdn',
    SMTP_URL: 'test://outbox',
    HIBP_CHECK: '0',
    TRUST_PROXY: '1',
    TEST_RESET_TOKEN: TEST_TOKEN,
    ...env,
  });
  const log = pino({ level: 'silent' });
  const origLog = console.log;
  /** @type {string[]} */ const printed = [];
  console.log = (...a) => printed.push(a.join(' '));
  const app = await createApp(config, log);
  console.log = origLog;
  const setupLink = printed.join('\n').match(/https?:\/\/\S+\/invite\/\S+/)?.[0] ?? null;
  const http = createHttpApp(app);
  return {
    app,
    http,
    dataDir,
    setupLink,
    /** Emails captured by the test SMTP sink. */
    outbox: () => /** @type {{to: string, subject: string, text: string}[]} */ (app.mailer.outbox ?? []),
    /** @param {string} [ip] */
    client: (ip) => new Client(http, ip),
    /**
     * Create an active user with a password.
     * @param {{username: string, role?: 'user'|'moderator'|'admin', password?: string, name?: string, email?: string}} p
     */
    async user(p) {
      const hash = await hashPassword(p.password ?? 'correct horse battery staple');
      return insertUser(app.authDb, {
        username: p.username,
        name: p.name ?? p.username,
        email: p.email ?? `${p.username}@example.com`,
        role: p.role ?? 'user',
        status: 'active',
        passwordHash: hash,
      });
    },
    /** Sign a new client in as a fresh user of `role`. @param {'user'|'moderator'|'admin'} role @param {string} [username] */
    async as(role, username) {
      const name = username ?? `${role}${Math.random().toString(36).slice(2, 7)}`;
      const user = await this.user({ username: name, role });
      const c = new Client(http, `10.0.0.${Math.floor(Math.random() * 200) + 2}`);
      await c.login(name, 'correct horse battery staple');
      return Object.assign(c, { user });
    },
    close() {
      app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export class Client {
  /** @param {import('hono').Hono<any>} http @param {string} [ip] */
  constructor(http, ip = '10.0.0.1') {
    this.http = http;
    this.ip = ip;
    /** @type {Map<string,string>} */ this.cookies = new Map();
    /** @type {string|null} */ this.csrf = null;
  }

  /**
   * @param {string} method @param {string} path
   * @param {{body?: any, headers?: Record<string,string>, version?: number, raw?: BodyInit, origin?: string|null, csrf?: string|null}} [o]
   */
  async req(method, path, o = {}) {
    /** @type {Record<string,string>} */
    const headers = { 'x-forwarded-for': this.ip, ...o.headers };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && method !== 'HEAD') {
      if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
      const token = o.csrf === undefined ? this.csrf : o.csrf;
      if (token) headers['x-csrf-token'] = token;
    }
    if (o.version !== undefined) headers['if-match'] = `W/"${o.version}"`;
    let body = o.raw;
    if (o.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(o.body);
    }
    const res = await this.http.request(path.startsWith('/') && !path.startsWith('/api') && !path.startsWith('/media') ? `/api/v1${path}` : path, { method, headers, body });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      const value = v.join('=');
      if (!value || /Max-Age=0/i.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, value);
    }
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    if (data && typeof data === 'object' && 'csrfToken' in data && (data.csrfToken || data.user === null)) this.csrf = data.csrfToken;
    return { status: res.status, data: /** @type {any} */ (data), headers: res.headers };
  }

  get = (/** @type {string} */ p, o) => this.req('GET', p, o);
  post = (/** @type {string} */ p, body, o = {}) => this.req('POST', p, { ...o, body });
  patch = (/** @type {string} */ p, body, version, o = {}) => this.req('PATCH', p, { ...o, body, version });
  put = (/** @type {string} */ p, body, version, o = {}) => this.req('PUT', p, { ...o, body, version });
  del = (/** @type {string} */ p, version, o = {}) => this.req('DELETE', p, { ...o, version });

  /** @param {string} username @param {string} password */
  async login(username, password) {
    const r = await this.post('/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r;
  }

  /** @param {'demo'|'demo_admin'} account */
  async demo(account) {
    const r = await this.post('/auth/demo', { account });
    if (r.status !== 200) throw new Error(`demo login failed: ${r.status}`);
    return r;
  }
}
