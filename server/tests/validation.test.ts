import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db/database';
import aiRouter from '../src/routes/ai';
import authRouter from '../src/routes/auth';
import usersRouter from '../src/routes/users';
import videosRouter from '../src/routes/videos';

// Validation failures return before any query; still refuse a file-backed DB.
if (process.env.DB_PATH !== ':memory:') throw new Error('validation tests require DB_PATH=:memory: (run `npm test`)');
after(() => db.close());

// Call the final route handler (after auth/rate-limit middleware) with a fixture request; no socket.
async function call(router: any, method: string, path: string, body: unknown) {
  const handle = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method])!.route!.stack.at(-1)!.handle;
  let code = 200; let payload: any;
  const res = { status: (n: number) => { code = n; return res; }, json: (data: unknown) => { payload = data; } };
  await handle({ body, user: { userId: 'fixture-user' } } as any, res as any, () => {});
  return { code, payload };
}

function assertValidationError(result: { code: number; payload: any }, message?: string) {
  assert.equal(result.code, 400);
  assert.deepEqual(Object.keys(result.payload).sort(), ['code', 'data', 'message', 'timestamp']);
  assert.equal(result.payload.code, 400);
  assert.equal(result.payload.data, null);
  assert.equal(typeof result.payload.timestamp, 'number');
  assert.equal(typeof result.payload.message, 'string');
  assert.ok(result.payload.message.length > 0);
  if (message !== undefined) assert.equal(result.payload.message, message);
}

test('validation errors return 400 with the first schema message', async () => {
  assertValidationError(await call(videosRouter, 'post', '/', { originalPrompt: 'abc' }), '描述至少5个字符');
  assertValidationError(await call(authRouter, 'post', '/send-code', { phone: '123', type: 'login' }), '手机号格式不正确');
  assertValidationError(await call(authRouter, 'post', '/register', { phone: '13800000000', code: '12', password: 'fixture-password' }), '验证码为6位数字');
  assertValidationError(await call(authRouter, 'post', '/refresh', { refreshToken: '' }), 'refreshToken 不能为空');
  assertValidationError(await call(aiRouter, 'post', '/enhance', { prompt: 'abc' }), '描述至少5个字符');
  assertValidationError(await call(aiRouter, 'post', '/storyboard', { enhancedPrompt: 'short' }), '增强描述至少10个字符');
});

test('validation errors without a custom message still return a 400 message', async () => {
  // Missing body fields and bad formats fall back to zod's default message instead of a 500.
  assertValidationError(await call(videosRouter, 'post', '/', {}));
  assertValidationError(await call(authRouter, 'post', '/login', {}));
  assertValidationError(await call(usersRouter, 'put', '/me', { avatarUrl: 'not a url' }));
});

test('AI request boundaries reject oversized prompts, styles and fractional scene counts', async () => {
  assertValidationError(await call(aiRouter, 'post', '/enhance', { prompt: 'valid prompt', style: 'x'.repeat(101) }));
  assertValidationError(await call(aiRouter, 'post', '/storyboard', { enhancedPrompt: 'x'.repeat(20001) }));
  assertValidationError(await call(aiRouter, 'post', '/storyboard', { enhancedPrompt: 'valid enhanced prompt', sceneCount: 2.5 }));
});
