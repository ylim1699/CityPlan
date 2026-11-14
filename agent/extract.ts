/* The AI agent's core: read one city record (council or P&Z minutes, agenda, permit list) and return the approved
   development projects in it, each with a verbatim quote, in the atlas project format. Node only: never imported by src/,
   so API keys never reach the browser. Used by scripts/run_agent.ts and api/agent.ts.
   Provider: AGENT_PROVIDER=gemini (default when GEMINI_API_KEY is set; see agent/gemini.ts for the fallback chain) or claude. */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CATEGORIES } from '../src/model/review.js';

export const CLAUDE_MODEL = 'claude-opus-5-5';

export const Found = z.object({
  projects: z.array(z.object({
    name: z.string().describe('Project name as the record gives it'),
    type: z.string().describe('Short type, e.g. "Student housing", "Grocery store", "Road work", "Subdivision"'),
    category: z.enum(CATEGORIES).describe('housing / commercial / mixed use / public building = a building is planned; subdivision = new lots, use not stated; road or trail, utility (sewer, water, cell tower), zoning only (rezone, annexation, plat vacation, no building named), study or plan; other'),
    status: z.enum(['construction', 'approved', 'planned']).describe('approved = approved by council or P&Z; planned = proposed or under review; construction = the record says work has started'),
    stage: z.enum(['new', 'under construction', 'already built']).describe('new = not built yet; under construction = the record says work has started; already built = it exists now (remodel, sign, license, naming or anything else about an existing building or road)'),
    worth: z.boolean().describe('true only if this item puts something new at a specific place: a new building, a new or widened road, or new zoning on a specific parcel. false for votes or decisions that build nothing there (naming, historic designation, bond or ballot votes, budgets, agreements, fee changes), studies, and anything already built'),
    why: z.string().describe('One short reason for worth, e.g. "New 120-unit apartments on a vacant lot" or "Vote to name the existing library; nothing new is built"'),
    where: z.string().describe('Location as stated: address, cross streets or parcel description'),
    units: z.number().nullable().describe('Homes or apartment units, if stated'),
    beds: z.number().nullable().describe('Student or care beds, if stated'),
    sqft: z.number().nullable().describe('Commercial square feet, if stated'),
    acres: z.number().nullable(),
    startYear: z.number().nullable().describe('Decimal year work starts, only if stated or clearly implied'),
    endYear: z.number().nullable().describe('Decimal year of completion, only if stated or clearly implied'),
    plain: z.string().describe('One plain sentence a resident would understand'),
    quote: z.string().describe('Verbatim sentence(s) from the document that support this entry, copied exactly'),
    page: z.number().nullable(),
    confidence: z.enum(['high', 'medium', 'low']).describe('high = approval and size stated; medium = some detail inferred; low = key detail missing'),
    flags: z.array(z.string()).describe('What a person should check before relying on it, e.g. "No completion date in the record"')
  }))
});
export type FoundProject = z.infer<typeof Found>['projects'][number];
export type { Candidate } from '../src/model/candidates';
export type ExtractInput = { pdf?: Uint8Array; text?: string; label: string };
export type ExtractResult = { model: string; tried: string[]; projects: FoundProject[] };

export const SYSTEM = `You read city government records for Rexburg, Idaho and list development projects that will change how many people live, work or shop somewhere, or change a road: new housing (homes, apartments, student housing), commercial buildings, schools, churches, subdivisions, rezonings of a specific parcel, and road widenings or new roads.
The question for each item is: will something new stand at a specific place that is not there today? A vote is only a project when it approves building, road work or rezoning at a place. Votes that build nothing there (naming or renaming a building, historic designation, a bond or ballot measure, a purchase or lease, an agreement, fees) are not projects; if you list one, set worth to false and say why.
Things already built (remodels, signs, business or liquor licenses, conditional uses inside an existing building, ribbon cuttings) get stage "already built" and worth false. Work the record says has started gets stage "under construction".
Leave out routine items (minutes approval, budgets, personnel, sewer repairs, proclamations) and anything denied, tabled or withdrawn.
List each project once per record, even when it comes up several times (e.g. a rezone and a plat for the same site): use the most advanced action and one quote.
Only report what the document says. Copy each quote exactly from the document. Use null for any number the document does not state, and say in flags what is missing or assumed. An empty list is a valid answer.`;
export const TASK = 'List the development projects in this record.';

/* every entry must point at the record: items without a real quote are dropped */
export function keepQuoted(list: FoundProject[]) { return list.filter(p => p.quote && p.quote.trim().length > 20); }

export async function extractWithClaude(input: ExtractInput, client = new Anthropic()): Promise<ExtractResult> {
  const doc: Anthropic.Beta.BetaContentBlockParam = input.pdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(input.pdf).toString('base64') }, title: input.label }
    : { type: 'document', source: { type: 'text', media_type: 'text/plain', data: input.text || '' }, title: input.label };
  const res = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',  // if a safety classifier declines, the API reruns on a fallback model in the same call
    system: SYSTEM,
    output_config: { effort: 'medium', format: betaZodOutputFormat(Found) },
    messages: [{ role: 'user', content: [doc, { type: 'text', text: TASK }] }]
  });
  if (res.stop_reason === 'refusal') throw new Error('The model declined this document' + (res.stop_details?.category ? ' (' + res.stop_details.category + ')' : ''));
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off (max_tokens); split the document and run again');
  const out = res.parsed_output;
  if (!out) throw new Error('No structured answer came back');
  return { model: res.model || CLAUDE_MODEL, tried: [], projects: keepQuoted(out.projects) };
}

export function provider() {
  const p = (process.env.AGENT_PROVIDER || '').toLowerCase();
  return p === 'claude' || p === 'gemini' ? p : process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY ? 'claude' : 'gemini';
}
export function providerReady() {
  return provider() === 'gemini' ? !!process.env.GEMINI_API_KEY : !!process.env.ANTHROPIC_API_KEY;
}
export async function extractProjects(input: ExtractInput): Promise<ExtractResult> {
  if (provider() === 'gemini') { const { extractWithGemini } = await import('./gemini.js'); return extractWithGemini(input); }
  return extractWithClaude(input);
}
