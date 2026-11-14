/* The agent endpoint behind the planner panel's "Read city records" box (Vercel function; vite.config.ts serves the same
   handler under pnpm dev). POST JSON { label?, name?: file name, pdf?: base64, text?: string, url?: string } -> { projects, source, model }.
   A url may be a Laserfiche viewer link from the city's archive; the PDF behind it is downloaded.
   Each project comes back with its quote checked against the record's own text (check) and a category, so the reviewer
   sees at once whether the quote is really there. Nothing is saved here: a person confirms each project in the app.
   Needs GEMINI_API_KEY (default provider, with model fallbacks) or ANTHROPIC_API_KEY with AGENT_PROVIDER=claude. If AGENT_TOKEN is set, callers must send it in x-agent-token, so strangers can't spend the API budget. */
import { extractProjects, provider, providerReady } from '../agent/extract.js';
import { guessLabel, laserficheFile, pdfText } from '../agent/pdftext.js';
import { categoryOf, checkQuote } from '../src/model/review.js';

export async function POST(request: Request) {
  const token = process.env.AGENT_TOKEN;
  if (token && request.headers.get('x-agent-token') !== token) return Response.json({ error: 'Wrong or missing agent passcode' }, { status: 401 });
  if (!providerReady()) return Response.json({ error: (provider() === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY') + ' is not set on the server' }, { status: 500 });
  let body: { label?: string; name?: string; pdf?: string; text?: string; url?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'Send JSON' }, { status: 400 }); }
  try {
    let pdf: Uint8Array | undefined, text = '', url = '';
    if (body.pdf) pdf = Uint8Array.from(Buffer.from(body.pdf, 'base64'));
    else if (body.text) { text = body.text; url = (text.match(/^Source: (https?:\/\/\S+)/) || [])[1] || ''; }  // scripts/fetch_minutes.ts writes this first line
    else if (/^https:\/\//.test(body.url || '')) {
      const lf = laserficheFile(body.url!);
      const r = await fetch(lf ? lf.file : body.url!);
      if (!r.ok) return Response.json({ error: 'Could not download the record (HTTP ' + r.status + ')' }, { status: 502 });
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes[0] === 0x25 && bytes[1] === 0x50) pdf = bytes; else text = new TextDecoder().decode(bytes);
      url = lf ? lf.page : body.url!;
    } else return Response.json({ error: 'Send a pdf, text or https url' }, { status: 400 });
    if (pdf) text = await pdfText(pdf);
    const label = (body.label?.trim() || guessLabel(text) || body.name?.trim() || (url ? 'City record ' + (url.match(/id=(\d+)/) || ['', ''])[1] : 'Uploaded city record')).slice(0, 200);
    const r = await extractProjects(pdf ? { pdf, label } : { text, label });
    const projects = r.projects.map(p => ({ ...p, category: categoryOf(p), check: checkQuote(p.quote, text) }));
    return Response.json({ projects, source: { label, url }, model: r.model, tried: r.tried });
  } catch (e) {
    /* Node's fetch says only "fetch failed"; the cause names the real problem (timeout, refused, certificate) */
    const cause = e instanceof Error && e.cause ? ' (' + String((e.cause as any).code || (e.cause as any).message || e.cause) + ')' : '';
    return Response.json({ error: String(e instanceof Error ? e.message : e) + cause }, { status: 502 });
  }
}
