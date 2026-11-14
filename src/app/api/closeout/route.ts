import { NextResponse } from "next/server";
import { generateText, convertToModelMessages } from "ai";
import { getFallbackChain, isRateLimitError } from "@/lib/llm-router";
import { appendProjectMarkdown } from "@/lib/markdown-fs";

export async function POST(req: Request) {
  const { messages, projectSlug = "sample-project", personaName = "J.A.R.V.I.S." } = await req.json();

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "No messages to summarize." }, { status: 400 });
  }

  const modelMessages = await convertToModelMessages(messages);

  const closeoutPrompt = `You are generating a concise engineering handoff log for a developer's PROGRESS.md file based on the conversation above (assisted by ${personaName}).

Summarize the session into clean Markdown bullet points using ONLY these sections (omit any section that doesn't apply):
- **Completed:** What was built, fixed, or decided.
- **Decisions & Context:** Key architectural choices or constraints agreed upon.
- **Next Steps:** Immediate action items for the next coding session.

Keep it crisp, technical, and under 120 words. Do not include conversational filler or wrap the output in a markdown code block.`;

  // Default to Flash-Lite first to save your primary Flash quota for active coding
  const candidates = getFallbackChain("gemini-3.5-flash-lite");

  for (const candidate of candidates) {
    try {
      const { text } = await generateText({
        model: candidate.model,
        system: closeoutPrompt,
        messages: modelMessages,
      });

      const result = await appendProjectMarkdown(
        projectSlug,
        "PROGRESS.md",
        `Session Handoff (${personaName}):\n${text}`
      );

      return NextResponse.json({
        success: true,
        summary: text,
        modelUsed: candidate.id,
        result,
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        console.warn(`[Hiraya Closeout] 429 on ${candidate.id}, failing over...`);
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json({ error: "All LLM providers rate-limited." }, { status: 429 });
}