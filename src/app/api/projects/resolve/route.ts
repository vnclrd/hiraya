import { NextResponse } from "next/server";
import { debugResolve, resolveProject } from "@/lib/server/project-files";

const clean = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, "");

export async function POST(req: Request) {
  try {
    const { text = "", current = "" } = await req.json();
    const hit = await resolveProject(String(text), clean(String(current)));
    return NextResponse.json({ switchTo: hit?.slug ?? null, files: hit?.files ?? [] });
  } catch {
    return NextResponse.json({ switchTo: null, files: [] }); // never block sending
  }
}

// Browser-friendly diagnostics: /api/projects/resolve?text=send me personas.ts&current=sample-project
export async function GET(req: Request) {
  const u = new URL(req.url);
  return NextResponse.json(await debugResolve(u.searchParams.get("text") ?? "", clean(u.searchParams.get("current") ?? "")));
}