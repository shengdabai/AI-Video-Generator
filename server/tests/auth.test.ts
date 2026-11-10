import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
const loadTypescript = require('../../tests/helpers/load-typescript.cjs');

test('reported access-token lifetime matches the configured signed token', () => {
  for (const [ttl, seconds] of [['15m', 900], ['7d', 604800]]) {
    const { generateTokens } = loadTypescript('server/src/middleware/auth.ts', {
      '../config/env': { env: {
        JWT_SECRET: 'fixture-access-secret-at-least-32-characters',
        JWT_REFRESH_SECRET: 'fixture-refresh-secret-at-least-32-characters',
        JWT_EXPIRES_IN: ttl, JWT_REFRESH_EXPIRES_IN: '30d',
      } },
      '../db/database': {},
    });
    const tokens = generateTokens({ userId: 'fixture', phone: '13800000000' });
    const payload = jwt.decode(tokens.accessToken) as jwt.JwtPayload;
    assert.equal(tokens.expiresIn, seconds);
    assert.equal(tokens.expiresIn, payload.exp! - payload.iat!);
  }
});
