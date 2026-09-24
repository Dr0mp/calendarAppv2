import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordPolicyError, passwordStrength, codePoints } from '../../shared/rules/password.js';
import { checkPassword, needsRehash, verifyPassword, hashPassword } from '../../server/auth/passwords.js';
import bcrypt from 'bcryptjs';

test('length is counted in code points', () => {
  assert.equal(codePoints('🙂🙂'), 2);
  assert.equal(passwordPolicyError('🙂'.repeat(11)), 'password_too_short');
  assert.equal(passwordPolicyError('🙂'.repeat(12)), null);
  assert.equal(passwordPolicyError('a'.repeat(129)), 'password_too_long');
  assert.equal(passwordPolicyError('a'.repeat(128)), null);
});

test('no composition rules', () => {
  assert.equal(passwordPolicyError('all lowercase words'), null);
});

test('must not contain the username, email local part or app name', () => {
  assert.equal(passwordPolicyError('hello anca.p world', { username: 'anca.p' }), 'password_contains_personal');
  assert.equal(passwordPolicyError('I am Maria.Ion here', { email: 'maria.ion@x.ro' }), 'password_contains_personal');
  assert.equal(passwordPolicyError('love CasaArtis forever'), 'password_contains_personal');
  assert.equal(passwordPolicyError('love casa artis forever'), 'password_contains_personal');
  assert.equal(passwordPolicyError('something else entirely', { username: 'ab' }), null, 'very short usernames are ignored');
});

test('strength meter', () => {
  assert.equal(passwordStrength(''), 0);
  assert.equal(passwordStrength('short'), 1);
  assert.equal(passwordStrength('aaaaaaaaaaaaaaa'), 1);
  assert.equal(passwordStrength('twelve chars'), 2);
  assert.equal(passwordStrength('Twelve chars1'), 3);
  assert.equal(passwordStrength('correct horse battery staple'), 4);
});

test('server policy adds the common-password list (case-insensitive)', async () => {
  assert.equal(await checkPassword('UNBELIEVABLE', {}, { hibp: false }), 'password_common');
  assert.equal(await checkPassword('a totally fine phrase', {}, { hibp: false }), null);
});

test('argon2id hashing, rehash detection and legacy bcrypt', async () => {
  const h = await hashPassword('a totally fine phrase');
  assert.match(h, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(needsRehash(h), false);
  assert.equal(needsRehash('$argon2id$v=19$m=19456,t=2,p=1$abc$def'), true);
  assert.deepEqual(await verifyPassword(h, 'a totally fine phrase'), { ok: true, rehash: false });
  assert.deepEqual(await verifyPassword(h, 'wrong'), { ok: false, rehash: false });
  const legacy = `legacy-bcrypt:${bcrypt.hashSync('old v1 password', 4)}`;
  assert.deepEqual(await verifyPassword(legacy, 'old v1 password'), { ok: true, rehash: true });
  assert.deepEqual(await verifyPassword(legacy, 'nope'), { ok: false, rehash: false });
  assert.deepEqual(await verifyPassword(null, 'x'), { ok: false, rehash: false });
});
