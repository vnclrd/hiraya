// npx tsx scripts/test-router.ts

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" }); // <--- Add this at the top

import { getFallbackChain, isRateLimitError } from "../src/lib/server/llm-router";
import { generateText } from "ai";

async function testRouter() {
  console.log("Initializing Hiraya Free-Tier Router Test...\n");
  const chain = getFallbackChain("gemini-3.8-flash");

  console.log(`Loaded ${chain.length} model candidates in fallback chain:`);
  chain.forEach((c, idx) => console.log(`  [Tier ${idx + 1}] Provider: ${c.provider} | Model: ${c.id}`));
  console.log("\n--------------------------------------------------\n");

  const activeCandidate = chain[0];
  console.log(`Testing primary model: ${activeCandidate.id} (${activeCandidate.provider})...`);

  try {
    const { text } = await generateText({
      model: activeCandidate.model,
      prompt: "Respond with exactly 5 words: 'Hiraya router test successful now.'",
    });
    console.log(`✅ Success! Response from ${activeCandidate.id}:`);
    console.log(`"${text.trim()}"`);
  } catch (error) {
    if (isRateLimitError(error)) {
      console.warn(`⚠️ Rate limit hit on ${activeCandidate.id}. Fallback loop would engage here.`);
    } else {
      console.error(`❌ Error on ${activeCandidate.id}:`, error);
    }
  }
}

testRouter();