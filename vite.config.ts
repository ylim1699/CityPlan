/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/* Under pnpm dev, answer /api/agent with the same handler Vercel runs (api/agent.ts), using keys from .env */
function agentApi(env: Record<string, string>): Plugin {
  return {
    name: 'agent-api',
    configureServer(server) {
      for (const k of ['GEMINI_API_KEY', 'GEMINI_MODELS', 'AGENT_PROVIDER', 'ANTHROPIC_API_KEY', 'AGENT_TOKEN']) if (env[k] && !process.env[k]) process.env[k] = env[k];
      server.middlewares.use('/api/agent', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule('/api/agent.ts');
        const r: Response = await mod.POST(new Request('http://localhost/api/agent', { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
        res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.end(await r.text());
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), agentApi(loadEnv(mode, process.cwd(), ''))],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 }
}));
