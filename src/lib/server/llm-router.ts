import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

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

// Rate limit pacing state (~13.3 RPM ceiling to stay safely under 15 RPM)
const MIN_INTERVAL_MS = 4500;
let lastCallAt = 0;

export async function paceRequest() {
  const now = Date.now();
  const wait = lastCallAt + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastCallAt = Date.now();
}

export function getFallbackChain(preferredModel: string = "gemini-3.5-flash-lite"): ModelCandidate[] {
  // Enforce gemini-3.5-flash-lite as the primary model for all requests
  const primaryModel = preferredModel === "gemini-3.5-flash-lite" ? preferredModel : "gemini-3.5-flash-lite";

  return [
    // 1. Primary Model: Gemini 3.5 Flash Lite
    { id: primaryModel, provider: "google", model: google(primaryModel) },
    
    // 2. Light Backups / Fallbacks only if primary encounters limits
    { id: "gemini-2.5-flash", provider: "google", model: google("gemini-2.5-flash") },
    
    // 3. Cross-Provider Free Pool (OpenRouter / Groq backups)
    ...(process.env.OPENROUTER_API_KEY ? [{
      id: "deepseek/deepseek-chat:free",
      provider: "openrouter" as const,
      model: openRouter("deepseek/deepseek-chat:free"),
    }] : []),
    
    ...(process.env.GROQ_API_KEY ? [{
      id: "llama-3.3-70b-versatile",
      provider: "groq" as const,
      model: groq("llama-3.3-70b-versatile"),
    }] : []),
  ];
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate limit");
}