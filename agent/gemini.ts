/* Gemini version of the agent, with fallbacks: the first model in GEMINI_MODELS is tried, and if it fails
   (free-tier limit, model unavailable, server error, or an answer that doesn't match the schema) the next one runs.
   Default chain: a primary plus 3 fallbacks. Override in .env, e.g. GEMINI_MODELS=gemini-3.5-flash-lite,gemini-3.6-flash */
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { Found, SYSTEM, TASK, keepQuoted, type ExtractInput, type ExtractResult } from './extract.js';

export const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];  // hydrogen last: most capable but about a minute per request
export function geminiModels() { return (process.env.GEMINI_MODELS || GEMINI_MODELS.join(',')).split(',').map(s => s.trim()).filter(Boolean); }

/* The schema Gemini decodes against, from the same zod schema the Claude version uses */
const SCHEMA = (() => { const s: any = z.toJSONSchema(Found); delete s.$schema; return s; })();

export async function extractWithGemini(input: ExtractInput, ai: any = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: 'v1beta' })  /* typed input parts need v1beta */, models = geminiModels()): Promise<ExtractResult> {
  const doc = input.pdf
    ? { type: 'document', data: Buffer.from(input.pdf).toString('base64'), mime_type: 'application/pdf' }
    : { type: 'text', text: 'Document: ' + input.label + '\n\n' + (input.text || '') };
  const errors: string[] = [];
  for (const model of models) {
    try {
      const it = await ai.interactions.create({
        model,
        system_instruction: SYSTEM,
        input: [doc, { type: 'text', text: TASK }],
        response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA }
      });
      const out = Found.parse(JSON.parse(it.output_text || ''));  /* a malformed answer also moves on to the next model */
      return { model, tried: errors, projects: keepQuoted(out.projects) };
    } catch (e: any) {
      errors.push(model + ': ' + String(e?.status || '') + ' ' + String(e?.message || e).slice(0, 160));
    }
  }
  throw new Error('Every Gemini model failed. ' + errors.join(' | '));
}
