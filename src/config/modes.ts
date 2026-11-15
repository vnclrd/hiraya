import { HIRAYA_PERSONAS, type PersonaConfig } from "@/config/personas";

// General chat uses the `general` entry in personas.ts; the fallback only keeps the UI from crashing if it is removed.
export const GENERAL: PersonaConfig = HIRAYA_PERSONAS.general ?? {
  ...HIRAYA_PERSONAS.violet,
  id: "general",
  name: "Hiraya",
  title: "General chat",
  accent: "#60a5fa",
  description: "Ask anything — brainstorm, learn, or think out loud.",
};
export const PERSONAS = Object.values(HIRAYA_PERSONAS).filter((p) => p.id !== "general");
