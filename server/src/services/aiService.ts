/**
 * VidCraft AI - AI Service
 * Prompt enhancement and storyboard generation using Gemini
 */

import { env } from '../config/env';
import { z } from 'zod';

// Core fields stay strict; secondary fields fall back to defaults so small model
// format drift (a missing mood, "5" instead of 5) does not turn into a 500.
const enhanceResultSchema = z.object({
  enhancedPrompt: z.string().trim().min(1).max(5000),
  styleSuggestions: z.array(z.string().max(100)).max(10).catch([]),
  mood: z.string().max(100).catch(''),
  durationSuggestion: z.coerce.number().min(1).max(300).catch(30),
});

const storyboardResultSchema = z.object({
  scenes: z.array(z.object({
    prompt: z.string().trim().min(1).max(5000),
    duration: z.coerce.number().catch(5),
    camera: z.string().nullable().catch(null),
    movement: z.string().nullable().catch(null),
  })).min(2).max(8),
});

interface EnhanceResult {
  enhancedPrompt: string;
  styleSuggestions: string[];
  mood: string;
  durationSuggestion: number;
}

interface StoryboardScene {
  index: number;
  prompt: string;
  duration: number;
  camera: string | null;
  movement: string | null;
}

interface StoryboardResult {
  totalDuration: number;
  scenes: StoryboardScene[];
}

import { GoogleGenerativeAI } from '@google/generative-ai';

const geminiClient = env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(env.GEMINI_API_KEY)
  : null;

async function callGemini(prompt: string): Promise<string> {
  if (!geminiClient) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent(prompt);
  const response = result.response;
  return response.text();
}

function buildEnhancePrompt(
  userPrompt: string,
  style: string,
  language: string
): string {
  const lang = language === 'zh' ? '中文' : 'English';
  return `You are a professional video director and cinematographer. Enhance the following video scene description to be more vivid, cinematic, and suitable for AI video generation.

User description: "${userPrompt}"
Video style: ${style}
Response language: ${lang}

Please respond in valid JSON format only (no markdown, no code blocks):
{
  "enhancedPrompt": "A detailed, professional description of the video scene with visual details, lighting, camera angles, colors, and atmosphere",
  "styleSuggestions": ["style1", "style2", "style3"],
  "mood": "the overall mood/emotion of the scene",
  "durationSuggestion": 30
}

The enhancedPrompt should be 100-300 words, highly descriptive, and include:
- Detailed visual elements
- Lighting and color palette
- Camera perspective
- Atmosphere and emotion
- Movement and action`;
}

function buildStoryboardPrompt(
  enhancedPrompt: string,
  sceneCount: number
): string {
  return `You are a professional storyboard artist. Break the following video description into ${sceneCount} distinct scenes for a storyboard.

Video description: "${enhancedPrompt}"

Please respond in valid JSON format only (no markdown, no code blocks):
{
  "totalDuration": 45,
  "scenes": [
    {
      "index": 1,
      "prompt": "Detailed description of this specific scene",
      "duration": 10,
      "camera": "wide",
      "movement": "pan"
    }
  ]
}

Rules:
- Each scene should be 5-15 seconds
- camera must be one of: wide, medium, close-up, extreme-close-up
- movement must be one of: static, pan, tilt, zoom, track, push, pull
- Total duration should be 30-60 seconds
- Each scene prompt should be specific and actionable for AI video generation
- Scenes should flow naturally and tell a cohesive story`;
}

function parseJsonResponse(text: string): unknown {
  if (text.length > 100000) throw new Error('AI response exceeds size limit');
  const cleaned = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // JSON.parse messages can contain raw input; upstream errors can contain API keys.
    throw new Error('Invalid AI JSON response');
  }
}

function createFallbackEnhance(userPrompt: string): EnhanceResult {
  return {
    enhancedPrompt: `${userPrompt}. The scene is captured with cinematic quality, featuring natural lighting and smooth camera movements. The color palette is warm and inviting, creating an immersive visual experience. Professional composition with attention to depth and detail.`,
    styleSuggestions: ['cinematic', 'nature', 'minimal'],
    mood: 'cinematic',
    durationSuggestion: 30,
  };
}

function createFallbackStoryboard(
  enhancedPrompt: string,
  sceneCount: number
): StoryboardResult {
  const baseDuration = Math.floor(45 / sceneCount);
  const cameras = ['wide', 'medium', 'close-up', 'wide'];
  const movements = ['pan', 'static', 'push', 'track'];

  // Semantic placeholder beats (intro -> development -> climax -> resolution),
  // not a raw slice of the prompt text. The full prompt is referenced once so
  // the subject is preserved without producing meaningless truncated strings.
  const beats = [
    'Establishing shot that introduces the setting and mood',
    'Develops the action and reveals key details',
    'Rising tension toward the focal moment of the scene',
    'Climactic beat with the strongest visual emphasis',
    'Reaction and consequence following the climax',
    'Wider context that grounds the moment in its world',
    'Transitional beat bridging toward the conclusion',
    'Closing shot that resolves the scene',
  ];

  const subject = enhancedPrompt.trim().split(/[.。!?！？]/)[0] || enhancedPrompt.trim();

  const scenes: StoryboardScene[] = Array.from(
    { length: sceneCount },
    (_, i) => ({
      index: i + 1,
      prompt: `Scene ${i + 1}: ${beats[i % beats.length]} — ${subject}.`,
      duration: baseDuration,
      camera: cameras[i % cameras.length],
      movement: movements[i % movements.length],
    })
  );

  return {
    totalDuration: baseDuration * sceneCount,
    scenes,
  };
}

export async function enhancePrompt(
  userPrompt: string,
  style: string = 'cinematic',
  language: string = 'zh'
): Promise<EnhanceResult> {
  try {
    const prompt = buildEnhancePrompt(userPrompt, style, language);
    const response = await callGemini(prompt);
    return enhanceResultSchema.parse(parseJsonResponse(response));
  } catch (error) {
    if (!env.GEMINI_API_KEY) {
      return createFallbackEnhance(userPrompt);
    }
    throw new Error('AI enhancement failed');
  }
}

export async function generateStoryboard(
  enhancedPrompt: string,
  sceneCount: number = 4
): Promise<StoryboardResult> {
  const clampedCount = Number.isFinite(sceneCount) ? Math.max(2, Math.min(8, Math.round(sceneCount))) : 4;

  try {
    const prompt = buildStoryboardPrompt(enhancedPrompt, clampedCount);
    const response = await callGemini(prompt);
    const result = storyboardResultSchema.parse(parseJsonResponse(response));
    const cameras = ['wide', 'medium', 'close-up', 'extreme-close-up'];
    const movements = ['static', 'pan', 'tilt', 'zoom', 'track', 'push', 'pull'];
    const scenes = result.scenes.map((scene, index) => ({
      ...scene,
      index: index + 1,
      duration: Math.max(1, Math.min(60, Math.round(scene.duration))),
      camera: cameras.includes(scene.camera ?? '') ? scene.camera : null,
      movement: movements.includes(scene.movement ?? '') ? scene.movement : null,
    }));
    return {
      ...result,
      totalDuration: scenes.reduce((sum, scene) => sum + scene.duration, 0),
      scenes,
    };
  } catch (error) {
    if (!env.GEMINI_API_KEY) {
      return createFallbackStoryboard(enhancedPrompt, clampedCount);
    }
    throw new Error('Storyboard generation failed');
  }
}
