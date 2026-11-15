import { NextResponse } from "next/server";
import { readProjectMarkdown } from "@/lib/server/markdown-fs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectSlug = searchParams.get("project") || "sample-project";
  const data = await readProjectMarkdown(projectSlug);
  return NextResponse.json(data);
}