/* The agent endpoint behind the planner panel's "Upload minutes" box (Vercel function; vite.config.ts serves the same
   handler under pnpm dev). POST JSON { label, pdf?: base64, text?: string, url?: string } -> { projects: Candidate[] }.
   Nothing is saved here: a person confirms each project in the app.
   Needs GEMINI_API_KEY (default provider, with model fallbacks) or ANTHROPIC_API_KEY with AGENT_PROVIDER=claude. If AGENT_TOKEN is set, callers must send it in x-agent-token, so strangers can't spend the API budget. */
import { extractProjects, provider, providerReady } from '../agent/extract';

export async function POST(request: Request) {
  const token = process.env.AGENT_TOKEN;
  if (token && request.headers.get('x-agent-token') !== token) return Response.json({ error: 'Wrong or missing agent passcode' }, { status: 401 });
  if (!providerReady()) return Response.json({ error: (provider() === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY') + ' is not set on the server' }, { status: 500 });
  let body: { label?: string; pdf?: string; text?: string; url?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'Send JSON' }, { status: 400 }); }
  const label = (body.label || 'Uploaded city record').slice(0, 200);
  try {
    let input: { pdf?: Uint8Array; text?: string; label: string };
    if (body.pdf) input = { pdf: Uint8Array.from(Buffer.from(body.pdf, 'base64')), label };
    else if (body.text) input = { text: body.text, label };
    else if (/^https:\/\//.test(body.url || '')) {
      const bytes = new Uint8Array(await (await fetch(body.url!)).arrayBuffer());
      input = bytes[0] === 0x25 ? { pdf: bytes, label } : { text: new TextDecoder().decode(bytes), label };
    } else return Response.json({ error: 'Send a pdf, text or https url' }, { status: 400 });
    const r = await extractProjects(input);
    return Response.json({ projects: r.projects, model: r.model, tried: r.tried });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
