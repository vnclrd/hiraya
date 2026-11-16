import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel, type LanguageModel } from "ai";

const openRouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

const groq = createOpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY || "",
});

export interface ModelCandidate {
  id: string;
  provider: "google" | "openrouter" | "groq";
  model: LanguageModel;
}

const WINDOW_MS = 60_000;
const MAX_WAIT_MS = 20_000; // if the queue would wait longer, treat as rate-limited

// Just under each provider's free-tier RPM
const LIMITS: Record<string, number> = {
  "gemini-3.5-flash-lite": 12, // free tier: 15
  "gemini-2.5-flash": 8,
  "deepseek/deepseek-chat:free": 12,
  "llama-3.3-70b-versatile": 20,
};

type Gate = { stamps: number[]; pending: number; tail: Promise<void> };
// globalThis so Next dev hot-reload doesn't reset the counters
const g0 = globalThis as unknown as { __hirayaGates?: Map<string, Gate> };
const gates: Map<string, Gate> = (g0.__hirayaGates ??= new Map());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gateFor(id: string): Gate {
  let g = gates.get(id);
  if (!g) gates.set(id, (g = { stamps: [], pending: 0, tail: Promise.resolve() }));
  return g;
}

export function hasCapacity(id: string) {
  const g = gateFor(id);
  const now = Date.now();
  g.stamps = g.stamps.filter((t) => now - t < WINDOW_MS);
  return g.stamps.length + g.pending < (LIMITS[id] ?? 10);
}

async function acquire(id: string) {
  const g = gateFor(id);
  const limit = LIMITS[id] ?? 10;
  const deadline = Date.now() + MAX_WAIT_MS;
  g.pending++;
  const run = g.tail.then(async () => {
    try {
      for (;;) {
        const now = Date.now();
        g.stamps = g.stamps.filter((t) => now - t < WINDOW_MS);
        if (g.stamps.length < limit) {
          g.stamps.push(now);
          return;
        }
        const wait = g.stamps[0] + WINDOW_MS - now + 50;
        if (Date.now() + wait > deadline)
          throw Object.assign(new Error("429 rate limit: local gate saturated"), { status: 429 });
        await sleep(wait);
      }
    } finally {
      g.pending--;
    }
  });
  g.tail = run.catch(() => {});
  return run;
}

function gated(id: string, model: Parameters<typeof wrapLanguageModel>[0]["model"]): LanguageModel {
  return wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        await acquire(id);
        return doGenerate();
      },
      wrapStream: async ({ doStream }) => {
        await acquire(id);
        return doStream();
      },
    },
  });
}

export function getFallbackChain(preferredModel: string = "gemini-3.5-flash-lite"): ModelCandidate[] {
  // Enforce gemini-3.5-flash-lite as the primary model for all requests
  const primaryModel = preferredModel === "gemini-3.5-flash-lite" ? preferredModel : "gemini-3.5-flash-lite";

  return [
    { id: primaryModel, provider: "google", model: gated(primaryModel, google(primaryModel)) },
    { id: "gemini-2.5-flash", provider: "google", model: gated("gemini-2.5-flash", google("gemini-2.5-flash")) },
    ...(process.env.OPENROUTER_API_KEY ? [{
      id: "deepseek/deepseek-chat:free",
      provider: "openrouter" as const,
      model: gated("deepseek/deepseek-chat:free", openRouter("deepseek/deepseek-chat:free")),
    }] : []),
    ...(process.env.GROQ_API_KEY ? [{
      id: "llama-3.3-70b-versatile",
      provider: "groq" as const,
      model: gated("llama-3.3-70b-versatile", groq("llama-3.3-70b-versatile")),
    }] : []),
  ];
}

export function pickCandidate(preferred?: string): ModelCandidate {
  const chain = getFallbackChain(preferred);
  return chain.find((c) => hasCapacity(c.id)) ?? chain[0]; // chain[0] will queue
}

export function describeError(err: unknown) {
  return isRateLimitError(err)
    ? "All providers are at their rate limit. Wait a few seconds and try again."
    : err instanceof Error ? err.message : String(err);
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate limit");
}