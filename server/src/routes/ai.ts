/**
 * VidCraft AI - AI Routes
 * Prompt enhancement and storyboard generation endpoints
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID as uuidv4 } from 'node:crypto';
import { authMiddleware } from '../middleware/auth';
import { aiLimiter } from '../middleware/rateLimit';
import { enhancePrompt, generateStoryboard } from '../services/aiService';
import db from '../db/database';
import { apiResponse } from '../utils/response';

const router = Router();

// ==================== Enhance Prompt ====================

const enhanceSchema = z.object({
  prompt: z.string().min(5, '描述至少5个字符').max(500, '描述最多500个字符'),
  style: z.string().max(100).default('cinematic'),
  language: z.enum(['zh', 'en']).default('zh'),
});

router.post(
  '/enhance',
  authMiddleware,
  aiLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = enhanceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(
          apiResponse(null, parsed.error.issues[0].message, 400)
        );
        return;
      }

      const { prompt, style, language } = parsed.data;
      const result = await enhancePrompt(prompt, style, language);

      res.json(
        apiResponse({
          originalPrompt: prompt,
          enhancedPrompt: result.enhancedPrompt,
          styleSuggestions: result.styleSuggestions,
          mood: result.mood,
          durationSuggestion: result.durationSuggestion,
        })
      );
    } catch (error) {
      process.stderr.write('[AI Enhance Error] Upstream request or response failed\n');
      res.status(500).json(apiResponse(null, 'AI 增强服务暂时不可用，请稍后重试', 500));
    }
  }
);

// ==================== Generate Storyboard ====================

const storyboardSchema = z.object({
  enhancedPrompt: z.string().min(10, '增强描述至少10个字符').max(20000),
  targetDuration: z.number().min(10).max(300).optional(),
  sceneCount: z.number().int().min(2).max(8).default(4),
});

router.post(
  '/storyboard',
  authMiddleware,
  aiLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = storyboardSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(
          apiResponse(null, parsed.error.issues[0].message, 400)
        );
        return;
      }

      const { enhancedPrompt, sceneCount } = parsed.data;
      const result = await generateStoryboard(enhancedPrompt, sceneCount);

      const storyboardId = uuidv4();

      const scenes = result.scenes.map((scene) => ({
        ...scene,
        id: uuidv4(),
      }));

      res.json(
        apiResponse({
          storyboardId,
          totalDuration: result.totalDuration,
          scenes,
        })
      );
    } catch (error) {
      process.stderr.write('[AI Storyboard Error] Upstream request or response failed\n');
      res.status(500).json(apiResponse(null, '分镜生成服务暂时不可用，请稍后重试', 500));
    }
  }
);

export default router;
