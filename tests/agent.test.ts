/* Agent wiring with stand-in clients (no key, no cost): structured answer in, quoted projects out; Gemini falls back down its chain. */
import { describe, it, expect } from 'vitest';
import { extractWithClaude } from '../agent/extract';
import { extractWithGemini } from '../agent/gemini';

const item = (quote: string) => ({ name: 'Test Flats', type: 'Student housing', category: 'housing', status: 'approved', where: '300 S 2nd W', units: 120, beds: 480, sqft: null, acres: 2,
  startYear: null, endYear: null, plain: 'New student apartments.', quote, page: 3, confidence: 'medium', flags: ['No completion date in the record'] });
const good = 'Council approved the Test Flats project with 120 units and 480 beds at 300 S 2nd W.';

describe('Claude agent', () => {
  const fake = (out: any, stop = 'end_turn') => { const f: any = { beta: { messages: { parse: async (p: any) => { f.last = p; return { stop_reason: stop, parsed_output: out, model: 'claude-opus-5-5' }; } } } }; return f; };
  it('sends the PDF as a document block and keeps quoted items only', async () => {
    const c = fake({ projects: [item(good), item('ok')] });
    const r = await extractWithClaude({ pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]), label: 'Council minutes' }, c);
    expect(r.projects).toHaveLength(1);
    expect(c.last.messages[0].content[0].source.media_type).toBe('application/pdf');
  });
  it('reports a refusal instead of returning nothing', async () => {
    await expect(extractWithClaude({ text: 'x', label: 'y' }, fake(null, 'refusal'))).rejects.toThrow(/declined/);
  });
});

describe('Gemini agent with fallbacks', () => {
  const ai = (plan: Record<string, 'limit' | 'junk' | 'ok'>) => {
    const calls: string[] = [];
    return { calls, interactions: { create: async (p: any) => {
      calls.push(p.model);
      if (plan[p.model] === 'limit') throw Object.assign(new Error('Resource exhausted'), { status: 429 });
      if (plan[p.model] === 'junk') return { output_text: 'not json' };
      return { output_text: JSON.stringify({ projects: [item(good)] }) };
    } } };
  };
  it('uses the first model when it works', async () => {
    const a = ai({ m1: 'ok' }), r = await extractWithGemini({ text: 'minutes', label: 'P&Z' }, a, ['m1', 'm2', 'm3', 'm4']);
    expect(r.model).toBe('m1'); expect(a.calls).toEqual(['m1']); expect(r.projects).toHaveLength(1);
  });
  it('falls back past a rate limit and a malformed answer', async () => {
    const a = ai({ m1: 'limit', m2: 'junk', m3: 'ok' }), r = await extractWithGemini({ text: 'minutes', label: 'P&Z' }, a, ['m1', 'm2', 'm3', 'm4']);
    expect(r.model).toBe('m3'); expect(r.tried).toHaveLength(2); expect(a.calls).toEqual(['m1', 'm2', 'm3']);
  });
  it('says which models failed when all of them do', async () => {
    const a = ai({ m1: 'limit', m2: 'limit', m3: 'limit', m4: 'junk' });
    await expect(extractWithGemini({ text: 'x', label: 'y' }, a, ['m1', 'm2', 'm3', 'm4'])).rejects.toThrow(/m1.*m2.*m3.*m4/);
  });
  it('sends a PDF as a document block', async () => {
    const seen: any[] = []; const a = { interactions: { create: async (p: any) => { seen.push(p); return { output_text: JSON.stringify({ projects: [] }) }; } } };
    await extractWithGemini({ pdf: new Uint8Array([0x25, 0x50]), label: 'x' }, a, ['m1']);
    expect(seen[0].input[0]).toMatchObject({ type: 'document', mime_type: 'application/pdf' });
    expect(seen[0].response_format.schema.type).toBe('object');
  });
});
