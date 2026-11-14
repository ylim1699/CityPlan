/* Live city records for the start screen's "Check for new records" (Vercel function; vite.config.ts serves the same handler
   under pnpm dev). POST JSON:
   { action: 'list' }                      -> { records }  the newest council minutes, P&Z minutes and P&Z agendas in the archive
   { action: 'read', id, edoc, label, url } -> { projects, source, model }  the same answer as /api/agent for that record
   Reading uses the AI agent (GEMINI_API_KEY or ANTHROPIC_API_KEY); listing needs no key. AGENT_TOKEN guards both, as in
   api/agent.ts. Nothing is saved: found projects go to the planner's review list and a person confirms each one. */
import { extractProjects, provider, providerReady } from '../agent/extract.js';
import { ArchiveBusy, latestRecords, recordContent } from '../agent/laserfiche.js';
import { pdfText } from '../agent/pdftext.js';
import { categoryOf, checkQuote } from '../src/model/review.js';

export async function POST(request: Request) {
  const token = process.env.AGENT_TOKEN;
  if (token && request.headers.get('x-agent-token') !== token) return Response.json({ error: 'Wrong or missing agent passcode' }, { status: 401 });
  let body: { action?: string; id?: number; edoc?: boolean; label?: string; url?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'Send JSON' }, { status: 400 }); }
  try {
    if (body.action === 'list') return Response.json({ records: await latestRecords(), checked: new Date().toISOString() });
    if (body.action === 'read' && Number.isInteger(body.id)) {
      if (!providerReady()) return Response.json({ error: (provider() === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY') + ' is not set on the server' }, { status: 500 });
      const c = await recordContent(body.id!, !!body.edoc);
      const text = c.pdf ? await pdfText(c.pdf) : c.text;
      if (!c.pdf && text.trim().length < 200) return Response.json({ error: 'This record has no readable text yet (it may still be a scan without OCR)' }, { status: 422 });
      const label = (body.label || 'City record ' + body.id).slice(0, 200);
      const r = await extractProjects(c.pdf ? { pdf: c.pdf, label } : { text, label });
      const projects = r.projects.map(p => ({ ...p, category: categoryOf(p), check: checkQuote(p.quote, text) }));
      return Response.json({ projects, source: { label, url: body.url || '' }, model: r.model, tried: r.tried });
    }
    return Response.json({ error: "Send { action: 'list' } or { action: 'read', id }" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: e instanceof ArchiveBusy ? 503 : 502 });
  }
}
