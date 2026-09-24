import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoNow, MIN } from '../util.js';

/** @typedef {import('../db/open.js').Db} Db */

const CHALLENGE_TTL = 5 * MIN;

/** @param {Db} db @param {string} challenge @param {'login'|'register'} purpose @param {string|null} userId */
function storeChallenge(db, challenge, purpose, userId) {
  db.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').run(isoNow());
  db.prepare('INSERT INTO webauthn_challenges (challenge, purpose, user_id, expires_at) VALUES (?, ?, ?, ?)').run(
    challenge,
    purpose,
    userId,
    isoNow(Date.now() + CHALLENGE_TTL),
  );
}

/** Consume a stored challenge (single use). @param {Db} db @param {string} challenge @param {'login'|'register'} purpose */
function takeChallenge(db, challenge, purpose) {
  const row = /** @type {any} */ (
    db
      .prepare('DELETE FROM webauthn_challenges WHERE challenge = ? AND purpose = ? AND expires_at > ? RETURNING user_id')
      .get(challenge, purpose, isoNow())
  );
  return row ? { userId: row.user_id } : null;
}

/** Read the challenge echoed in clientDataJSON. @param {any} response */
function challengeOf(response) {
  try {
    const json = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
    return typeof json.challenge === 'string' ? json.challenge : '';
  } catch {
    return '';
  }
}

/**
 * @param {Db} db
 * @param {{rpId: string}} config
 * @param {{id: string, username: string, name: string, webauthn_user_id: string}} user
 */
export async function registrationOptions(db, config, user) {
  const existing = /** @type {any[]} */ (db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id));
  const options = await generateRegistrationOptions({
    rpName: 'Casa Artis',
    rpID: config.rpId,
    userName: user.username,
    userDisplayName: user.name,
    userID: Buffer.from(user.webauthn_user_id, 'base64url'),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  storeChallenge(db, options.challenge, 'register', user.id);
  return options;
}

/**
 * @param {Db} db
 * @param {{rpId: string, origins: string[]}} config
 * @param {string} userId
 * @param {any} response
 * @param {string} name
 */
export async function verifyRegistration(db, config, userId, response, name) {
  const challenge = challengeOf(response);
  const stored = challenge && takeChallenge(db, challenge, 'register');
  if (!stored || stored.userId !== userId) return null;
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
  } catch {
    return null;
  }
  if (!result.verified) return null;
  const cred = result.registrationInfo.credential;
  const row = {
    id: cred.id,
    user_id: userId,
    public_key: Buffer.from(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports ? JSON.stringify(cred.transports) : null,
    name,
    created_at: isoNow(),
  };
  db.prepare(
    'INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (:id, :user_id, :public_key, :counter, :transports, :name, :created_at)',
  ).run(row);
  return { id: row.id, name: row.name, created_at: row.created_at, last_used_at: null };
}

/** Username-less sign-in: a discoverable credential with user verification. @param {Db} db @param {{rpId:string}} config */
export async function authenticationOptions(db, config) {
  const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required', allowCredentials: [] });
  storeChallenge(db, options.challenge, 'login', null);
  return options;
}

/**
 * Verify a sign-in assertion; returns the user id on success.
 * @param {Db} db @param {{rpId: string, origins: string[]}} config @param {any} response
 */
export async function verifyAuthentication(db, config, response) {
  const challenge = challengeOf(response);
  if (!challenge || !takeChallenge(db, challenge, 'login')) return null;
  const pk = /** @type {any} */ (db.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id ?? '')));
  if (!pk) return null;
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: {
        id: pk.id,
        publicKey: new Uint8Array(pk.public_key),
        counter: pk.counter,
        transports: pk.transports ? JSON.parse(pk.transports) : undefined,
      },
    });
  } catch {
    return null;
  }
  if (!result.verified) return null;
  // The user handle, when present, must match the credential's owner.
  const handle = response?.response?.userHandle;
  if (handle) {
    const u = /** @type {any} */ (db.prepare('SELECT webauthn_user_id FROM users WHERE id = ?').get(pk.user_id));
    if (!u || u.webauthn_user_id !== handle) return null;
  }
  db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(
    result.authenticationInfo.newCounter,
    isoNow(),
    pk.id,
  );
  return { userId: /** @type {string} */ (pk.user_id), passkeyId: pk.id };
}
