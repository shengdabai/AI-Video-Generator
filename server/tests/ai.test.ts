import test from 'node:test';
import assert from 'node:assert/strict';
const loadTypescript = require('../../tests/helpers/load-typescript.cjs');

function service(response: unknown, upstreamError?: Error) {
  return loadTypescript('server/src/services/aiService.ts', {
    '../config/env': { env: { GEMINI_API_KEY: 'fixture-only', NODE_ENV: 'production' } },
    '@google/generative-ai': { GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { generateContent: async () => {
          if (upstreamError) throw upstreamError;
          return { response: { text: () => typeof response === 'string' ? response : JSON.stringify(response) } };
        } };
      }
    } },
  });
}

test('enhancement rejects malformed, oversized and wrongly typed model responses', async () => {
  for (const response of ['private malformed text', 'x'.repeat(100001), null, {}, {
    enhancedPrompt: { unexpected: 'object' }, styleSuggestions: [], mood: 'calm', durationSuggestion: 30,
  }]) {
    await assert.rejects(service(response).enhancePrompt('fixture prompt'), { message: 'AI enhancement failed' });
  }
});

test('enhancement strips unexpected model fields and accepts fenced JSON', async () => {
  const expected = { enhancedPrompt: 'A scene', styleSuggestions: ['cinematic'], mood: 'calm', durationSuggestion: 30 };
  const result = await service('```json\n' + JSON.stringify({ ...expected, unexpected: 'discard' }) + '\n```').enhancePrompt('fixture prompt');
  assert.deepEqual(result, expected);
});

test('storyboards reject missing scenes, excessive counts, invalid prompts and non-finite durations', async () => {
  const scene = { prompt: 'A scene', duration: 5, camera: 'wide', movement: 'pan' };
  for (const response of [null, {}, { scenes: [] }, { scenes: Array(9).fill(scene) },
    { scenes: [{ ...scene, prompt: {} }, scene] },
  ]) {
    await assert.rejects(service(response).generateStoryboard('fixture prompt'), { message: 'Storyboard generation failed' });
  }
});

test('storyboards default bad secondary fields instead of failing the whole response', async () => {
  for (const response of [
    { scenes: [{ prompt: 'A', duration: null }, { prompt: 'B', duration: '5', camera: 42 }] },
    '{"scenes":[{"prompt":"A","duration":1e999,"camera":null,"movement":null},{"prompt":"B","duration":5}]}',
  ]) {
    const result = await service(response).generateStoryboard('fixture prompt');
    assert.equal(result.scenes.length, 2);
    for (const scene of result.scenes) {
      assert.ok(Number.isFinite(scene.duration) && scene.duration >= 1);
      assert.equal(scene.camera, null);
    }
  }
});

test('enhancement defaults missing secondary fields', async () => {
  const result = await service({ enhancedPrompt: 'A scene' }).enhancePrompt('fixture prompt');
  assert.deepEqual(result, { enhancedPrompt: 'A scene', styleSuggestions: [], mood: '', durationSuggestion: 30 });
});

test('storyboards derive order and totals and strip unexpected fields', async () => {
  const scene = { index: -999, prompt: 'A scene', duration: 5.5, camera: 'unknown', movement: 'pan', unexpected: 'discard' };
  const result = await service({ scenes: [scene, scene], totalDuration: 'untrusted' }).generateStoryboard('fixture prompt');
  assert.deepEqual(result, { totalDuration: 12, scenes: [1, 2].map(index => ({
    index, prompt: 'A scene', duration: 6, camera: null, movement: 'pan',
  })) });
});

test('upstream errors and JSON parse errors never expose credentials or prompts in errors or logs', async (t) => {
  const logs: unknown[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  for (const ai of [service('private prompt'), service(null, new Error('https://provider.invalid?key=private-key'))]) {
    await assert.rejects(ai.enhancePrompt('fixture prompt'), { message: 'AI enhancement failed' });
    await assert.rejects(ai.generateStoryboard('fixture prompt'), { message: 'Storyboard generation failed' });
  }
  assert.deepEqual(logs, []);
});

test('AI routes log a fixed message even when an upstream error contains sensitive data', async (t) => {
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string) => { logs.push(chunk); return true; });
  const fail = async () => { throw new Error('private-prompt https://provider.invalid?key=private-key'); };
  const router = loadTypescript('server/src/routes/ai.ts', {
    '../middleware/auth': { authMiddleware: () => {} },
    '../middleware/rateLimit': { aiLimiter: () => {} },
    '../services/aiService': { enhancePrompt: fail, generateStoryboard: fail },
    '../db/database': {},
  }).default;
  for (const [path, body] of [['/enhance', { prompt: 'fixture prompt' }], ['/storyboard', { enhancedPrompt: 'fixture enhanced prompt' }]]) {
    const handler = router.stack.find((layer: any) => layer.route?.path === path).route.stack.at(-1).handle;
    let status = 200;
    const res = { status: (value: number) => { status = value; return res; }, json: () => {} };
    await handler({ body }, res);
    assert.equal(status, 500);
  }
  assert.deepEqual(logs, [
    '[AI Enhance Error] Upstream request or response failed\n',
    '[AI Storyboard Error] Upstream request or response failed\n',
  ]);
});
