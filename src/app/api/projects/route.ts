import { NextResponse } from "next/server";
import { readProjectMarkdown } from "@/lib/server/markdown-fs";
import fs from "fs/promises";
import path from "path";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let projectSlug = searchParams.get("project");

  // If no project parameter was provided, find the first available valid project on disk
  if (!projectSlug) {
    try {
      const root = path.join(process.cwd(), "workspace-projects");
      const entries = await fs.readdir(root, { withFileTypes: true });
      const validDirs = entries.filter(
        (e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "general"
      );
      if (validDirs.length > 0) {
        projectSlug = validDirs[0].name;
      } else {
        projectSlug = "general";
      }
    } catch {
      projectSlug = "general";
    }
  }

  const data = await readProjectMarkdown(projectSlug);
  return NextResponse.json(data);
}