/**
 * VidCraft AI - SMS Verification Service
 * Simulated SMS service for development
 * In production, replace with real SMS provider (e.g., Aliyun SMS)
 */

import { randomUUID as uuidv4, randomInt } from 'node:crypto';
import db from '../db/database';

interface VerificationRecord {
  id: string;
  phone: string;
  code: string;
  type: string;
  expires_at: string;
  used: number;
  attempts: number;
}

function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

function getExpiresAt(): string {
  const expires = new Date(Date.now() + 5 * 60 * 1000);
  return expires.toISOString();
}

export function sendVerificationCode(
  phone: string,
  type: 'register' | 'login' | 'reset'
): { code: string } {
  const code = generateCode();
  const id = uuidv4();

  db.transaction(() => {
    db.prepare(`
      UPDATE verification_codes
      SET used = 1
      WHERE phone = ? AND type = ? AND used = 0
    `).run(phone, type);

    db.prepare(`
      INSERT INTO verification_codes (id, phone, code, type, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, phone, code, type, getExpiresAt());
  })();

  // In development, log the code to console for testing
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    process.stdout.write(`[SMS] Verification code for ${phone}: ${code}\n`);
  }

  return { code };
}

export function verifyCode(
  phone: string,
  code: string,
  type: 'register' | 'login' | 'reset'
): boolean {
  // Development shortcut: code "888888" always passes (requires explicit opt-in)
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.ALLOW_DEV_BYPASS === 'true' &&
    code === '888888'
  ) {
    return true;
  }

  const record = db
    .prepare(`
      SELECT * FROM verification_codes
      WHERE phone = ? AND type = ? AND used = 0
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(phone, type) as VerificationRecord | undefined;

  if (!record) {
    return false;
  }

  const isExpired = new Date(record.expires_at) < new Date();
  if (isExpired || record.attempts >= 5) {
    return false;
  }

  if (record.code !== code) {
    db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
    return false;
  }

  db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(
    record.id
  );

  return true;
}
