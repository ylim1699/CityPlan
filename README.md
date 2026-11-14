# Rexburg Growth Atlas

3D map of Rexburg that shows how approved growth changes traffic, hour by hour and year by year.
React + TypeScript + Vite, three.js, trip routing in a Web Worker, and an AI agent that reads city minutes.

**Start with [plan.html](plan.html)** (open it in a browser): what's built, what still needs work, commands, keys and data sources.

```
pnpm install
pnpm dev          # http://localhost:5173  (old atlas: /legacy/index.html)
pnpm test:run
```

Keys go in a local `.env` (never committed): `GEMINI_API_KEY` for the AI agent, `CENSUS_API_KEY` only to re-download Census data. The app runs without them.
