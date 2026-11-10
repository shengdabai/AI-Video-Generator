import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db/database';
import { sendVerificationCode, verifyCode } from '../src/services/smsService';
import Database from 'better-sqlite3';
const loadTypescript = require('../../tests/helpers/load-typescript.cjs');

if (process.env.DB_PATH !== ':memory:') throw new Error('SMS tests require DB_PATH=:memory:');
afterEach(() => db.exec('DELETE FROM verification_codes'));
after(() => db.close());

function send(type: 'register' | 'login' = 'login') {
  // The simulated provider intentionally logs development codes; keep fixtures out of logs.
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof write;
  try { return sendVerificationCode('13800000000', type).code; }
  finally { process.stdout.write = write; }
}

test('codes use cryptographic randomness and can only be consumed once for their purpose', (t) => {
  t.mock.method(Math, 'random', () => { throw new Error('insecure RNG used'); });
  const code = send();
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyCode('13800000000', code, 'register'), false);
  assert.equal(verifyCode('13800000000', code, 'login'), true);
  assert.equal(verifyCode('13800000000', code, 'login'), false);
});

test('five wrong guesses exhaust a code, and resending resets the guess budget', () => {
  const code = send();
  const wrong = code === '100000' ? '100001' : '100000';
  for (let i = 0; i < 5; i++) assert.equal(verifyCode('13800000000', wrong, 'login'), false);
  assert.equal(verifyCode('13800000000', code, 'login'), false);
  const next = send();
  assert.equal(verifyCode('13800000000', next, 'login'), true);
});

test('expiration rejects the correct code', () => {
  const code = send();
  db.exec("UPDATE verification_codes SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal(verifyCode('13800000000', code, 'login'), false);
});

test('failed resend preserves the previous code and guess count', () => {
  const code = send();
  db.exec("CREATE TRIGGER fail_sms BEFORE INSERT ON verification_codes BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  try {
    assert.throws(() => send(), /fixture failure/);
    assert.equal(verifyCode('13800000000', code, 'login'), true);
  } finally { db.exec('DROP TRIGGER fail_sms'); }
});

test('existing verification tables gain guess limits without losing active codes', () => {
  const legacy = new Database(':memory:');
  legacy.exec(`CREATE TABLE verification_codes (
    id TEXT PRIMARY KEY, phone TEXT, code TEXT, type TEXT, expires_at TEXT,
    used INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  ); INSERT INTO verification_codes (id, phone, code, type, expires_at)
    VALUES ('fixture', '13800000000', '123456', 'login', '2099-01-01');`);
  try {
    const migrated = loadTypescript('server/src/db/database.ts', {
      '../config/env': { env: { DB_PATH: ':memory:' } },
      'better-sqlite3': function () { return legacy; },
    }).default;
    assert.equal(migrated, legacy);
    assert.deepEqual(legacy.prepare('SELECT code, used, attempts FROM verification_codes').get(), {
      code: '123456', used: 0, attempts: 0,
    });
  } finally { legacy.close(); }
});
