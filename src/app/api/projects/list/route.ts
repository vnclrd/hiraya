import { NextResponse, connection } from "next/server";
import fs from "fs/promises";
import path from "path";

// Lists project folders in workspace-projects/, most recently touched first.
// "general" is the scratch folder used by General chat, so it's hidden here.
export async function GET() {
  await connection(); // run per request, not at build time
  const root = path.join(process.cwd(), "workspace-projects");
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs = (
      await Promise.all(
        entries
          .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "general")
          .map(async (e) => {
            const dirPath = path.join(root, e.name);
            const subEntries = await fs.readdir(dirPath);
            // Exclude directories that have no files/folders inside them
            if (subEntries.length === 0) return null;

            const stat = await fs.stat(dirPath);
            return { slug: e.name, mtime: stat.mtimeMs };
          }),
      )
    ).filter((d): d is { slug: string; mtime: number } => d !== null);
    dirs.sort((a, b) => b.mtime - a.mtime);
    return NextResponse.json({ projects: dirs.map((d) => d.slug) });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}