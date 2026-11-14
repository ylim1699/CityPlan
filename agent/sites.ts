/* The AI site review: Gemini reads the facts the app measured for each open site (the routed traffic it adds, the
   worst street near it, distance to campus, what is next to it) and picks the best place for the project, with reasons.
   It only weighs those facts; it does not see the map or check zoning. Node only, like agent/extract.ts. */
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { geminiModels } from './gemini.js';

export const SiteFacts = z.object({
  site: z.number(), addedDelayVehHours: z.number(), kmToCampus: z.number(), kmToMainStreet: z.number(),
  mainStreet: z.string(), onParkingLot: z.boolean(),
  worstStreetNearby: z.object({ name: z.string(), percentOfCapacity: z.number() }).nullable(),
  biggestJump: z.object({ name: z.string(), points: z.number() }).nullable(),
  nearbyProjects: z.array(z.object({ name: z.string(), type: z.string(), km: z.number() }))
});
export const SitesInput = z.object({
  project: z.object({ type: z.string(), size: z.string(), note: z.string() }),
  year: z.number(), hour: z.string(), sites: z.array(SiteFacts).min(1).max(12)
});
export type SitesInput = z.infer<typeof SitesInput>;

export const SitePick = z.object({
  best: z.number().describe('site number of the best place'),
  ranking: z.array(z.number()).describe('the 5 best site numbers (fewer if fewer were given), best first'),
  why: z.string().describe('2 or 3 plain sentences: why the best site wins, naming the trade-offs against the runner-up'),
  notes: z.array(z.object({ site: z.number(), note: z.string().describe('one short plain sentence about this site: its main strength or drawback') }))
});
export type SitePick = z.infer<typeof SitePick>;

const SYSTEM = `You help a city planner in Rexburg, Idaho (a college town around BYU-Idaho) choose where a new project should go.
You get facts the planning app measured for each candidate site. addedDelayVehHours is the extra vehicle-hours of delay for the whole town at the peak hour once every trip is routed with the project there; lower is better and it is the most reliable number.
Weigh it with what fits the project: student housing belongs within walking distance of campus (under about 1 km); a grocery store should not sit next to another grocery project (nearbyProjects lists only the known new projects, not existing stores, so never claim an area lacks a store); homes and offices need easy main-street access without loading a street that is already near or over capacity; a parking lot is a redevelopment site, not empty land.
Use only the facts given. Do not invent zoning, prices, ownership, existing stores or places. When you choose a site that adds more delay than another, say so and why. Write for residents: plain words, no jargon.`;
const SCHEMA = (() => { const s: any = z.toJSONSchema(SitePick); delete s.$schema; return s; })();

export async function pickSite(input: SitesInput, ai: any = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: 'v1beta' }), models = geminiModels()) {
  const ids = new Set(input.sites.map(s => s.site)), errors: string[] = [];
  for (const model of models) {
    try {
      const it = await ai.interactions.create({
        model, system_instruction: SYSTEM,
        input: [{ type: 'text', text: 'Choose the best site for this project. Facts (JSON):\n' + JSON.stringify(input) }],
        response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA }
      });
      const out = SitePick.parse(JSON.parse(it.output_text || ''));
      /* an answer naming a site it was not given moves on to the next model */
      if (!ids.has(out.best) || out.ranking.some(n => !ids.has(n))) throw new Error('named a site that was not offered');
      if (out.ranking[0] !== out.best) out.ranking = [out.best, ...out.ranking.filter(n => n !== out.best)];
      return { model, tried: errors, pick: out };
    } catch (e: any) {
      errors.push(model + ': ' + String(e?.status || '') + ' ' + String(e?.message || e).slice(0, 160));
    }
  }
  throw new Error('Every Gemini model failed. ' + errors.join(' | '));
}
