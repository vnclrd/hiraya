import type { UIMessage } from "ai";

// Chat threads persist in localStorage so a reload doesn't wipe conversations.
const STORE = (k: string) => `hiraya:thread:${k}`;

export const loadThread = (k: string): UIMessage[] | null => {
  try { const r = localStorage.getItem(STORE(k)); return r ? JSON.parse(r) : null; } catch { return null; }
};
export const saveThread = (k: string, m: UIMessage[]) => {
  try { const s = JSON.stringify(m); if (s.length < 1_500_000) localStorage.setItem(STORE(k), s); } catch {}
};
export const dropThread = (k: string) => { try { localStorage.removeItem(STORE(k)); } catch {} };
