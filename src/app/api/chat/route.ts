import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { z } from "zod";
import { HIRAYA_PERSONAS } from "@/config/personas";
import { readProjectMarkdown, appendProjectMarkdown } from "@/lib/markdown-fs";
import { getFallbackChain, isRateLimitError } from "@/lib/llm-router";

export async function POST(req: Request) {
  const { messages, personaId = "violet", projectSlug = "sample-project" } = await req.json();

  const persona = HIRAYA_PERSONAS[personaId] || HIRAYA_PERSONAS.violet;
  const rawMarkdown = await readProjectMarkdown(projectSlug);

  // OPTIMIZATION: Truncate large context files to keep time-to-first-token near zero
  const trimmedContext = rawMarkdown.context.length > 1500 
    ? rawMarkdown.context.slice(0, 1500) + "\n...[truncated for speed]..." 
    : rawMarkdown.context;

  const trimmedProgress = rawMarkdown.progress.length > 1500 
    ? rawMarkdown.progress.slice(0, 1500) + "\n...[truncated for speed]..." 
    : rawMarkdown.progress;

  // Sliding window: keep last 15 messages to prevent heavy token payload spikes
  const trimmedMessages = messages.slice(-15);
  const modelMessages = await convertToModelMessages(trimmedMessages);

  const systemPrompt = `${persona.systemInstruction}

=== ACTIVE PROJECT: ${projectSlug} ===
--- CONTEXT.md (Summary) ---
${trimmedContext}

--- PROGRESS.md (Summary) ---
${trimmedProgress}

INSTRUCTION: Whenever the user completes a task, makes an architectural decision, or asks you to log progress/context, call the 'updateMarkdownFile' tool immediately so the local .md files stay up to date.`;

  const candidates = getFallbackChain(persona.preferredModel);

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const result = streamText({
        model: candidate.model,
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(3),
        tools: {
          updateMarkdownFile: tool({
            description: "Append a progress update to PROGRESS.md or a new spec/decision to CONTEXT.md",
            inputSchema: z.object({
              fileName: z.enum(["PROGRESS.md", "CONTEXT.md"]),
              entry: z.string().describe("Concise markdown bullet entry to append"),
            }),
            execute: async ({ fileName, entry }) => {
              return await appendProjectMarkdown(projectSlug, fileName, entry);
            },
          }),
        },
      });

      return result.toUIMessageStreamResponse({
        headers: { "X-Model-Used": candidate.id },
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        console.warn(`[Hiraya Router] 429 hit on ${candidate.id}, failing over...`);
        continue;
      }
      throw error;
    }
  }

  return new Response("All configured LLM providers and free-tier models are currently rate-limited.", { status: 429 });
}