/* The AI site review behind Planner > AI recommendations (Vercel function; vite.config.ts serves it under pnpm dev).
   POST JSON { project, year, hour, sites: [measured facts per site] } -> { pick: { best, ranking, why, notes }, model }.
   Needs GEMINI_API_KEY. If AGENT_TOKEN is set, callers must send it in x-agent-token, like /api/agent. */
import { SitesInput, pickSite } from '../agent/sites.js';

export async function POST(request: Request) {
  const token = process.env.AGENT_TOKEN;
  if (token && request.headers.get('x-agent-token') !== token) return Response.json({ error: 'Wrong or missing agent passcode' }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: 'GEMINI_API_KEY is not set on the server' }, { status: 500 });
  let body: SitesInput;
  try { body = SitesInput.parse(await request.json()); } catch { return Response.json({ error: 'Send the measured sites as JSON' }, { status: 400 }); }
  try {
    const r = await pickSite(body);
    return Response.json({ pick: r.pick, model: r.model, tried: r.tried });
  } catch (e) {
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}
