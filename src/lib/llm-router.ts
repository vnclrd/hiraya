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

export function getFallbackChain(preferredModel: string = "gemini-3.8-flash"): ModelCandidate[] {
  return [
    // 1. User's preferred primary model (e.g., Gemini 3.8 Flash)
    { id: preferredModel, provider: "google", model: google(preferredModel) },
    
    // 2. Secondary Flash Tier (Gemini 3.6 / Gemini 3.5 Flash Lite)
    { id: "gemini-3.6-flash", provider: "google", model: google("gemini-3.6-flash") },
    { id: "gemini-3.5-flash-lite", provider: "google", model: google("gemini-3.5-flash-lite") },
    
    // 3. Alternative Gemini Text-out Architecture (Gemini 4 Hydrogen)
    { id: "gemini-4-hydrogen", provider: "google", model: google("gemini-4-hydrogen") },
    
    // 4. Cross-Provider Free Pool (DeepSeek Free via OpenRouter)
    ...(process.env.OPENROUTER_API_KEY ? [{
      id: "deepseek/deepseek-chat:free",
      provider: "openrouter" as const,
      model: openRouter("deepseek/deepseek-chat:free"),
    }] : []),
    
    // 5. Ultra-Fast Llama Backup via Groq
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