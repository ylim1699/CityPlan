/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* Under pnpm dev, answer /api/agent with the same handler Vercel runs (api/agent.ts), using keys from .env */
function agentApi(env: Record<string, string>): Plugin {
  return {
    name: 'agent-api',
    configureServer(server) {
      for (const k of ['GEMINI_API_KEY', 'GEMINI_MODELS', 'AGENT_PROVIDER', 'ANTHROPIC_API_KEY', 'AGENT_TOKEN']) if (env[k] && !process.env[k]) process.env[k] = env[k];
      /* /api/agent reads one uploaded or linked record; /api/records finds and reads the newest records in the city archive */
      for (const name of ['agent', 'records']) server.middlewares.use('/api/' + name, async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule('/api/' + name + '.ts');
        const r: Response = await mod.POST(new Request('http://localhost/api/' + name, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
        res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.end(await r.text());
      });
      /* dev only: the planner panel's "Save to projects.json" writes the reviewed projects file into this checkout */
      server.middlewares.use('/api/save-projects', async (req, res) => {
        const fail = (code: number, error: string) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error })); };
        if (req.method !== 'POST') return fail(405, 'POST only');
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        let pf: any;
        try { pf = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(400, 'Send JSON'); }
        if (!pf?.meta || !Array.isArray(pf.projects) || !Array.isArray(pf.unmapped) || pf.projects.some((p: any) => !p.id || !p.name || !p.source)) return fail(400, 'Not a projects file');
        writeFileSync(join(server.config.root, 'public/data/projects.json'), JSON.stringify(pf, null, 1));
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, projects: pf.projects.length }));
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), agentApi(loadEnv(mode, process.cwd(), ''))],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 }
}));
