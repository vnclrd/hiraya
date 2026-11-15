import fs from "fs/promises";
import path from "path";

const WORKSPACE_ROOT = path.join(process.cwd(), "workspace-projects");

function resolveSafeProjectPath(projectSlug: string, fileName: "CONTEXT.md" | "PROGRESS.md") {
  const safeSlug = projectSlug.replace(/[^a-zA-Z0-9-_]/g, "");
  return path.join(WORKSPACE_ROOT, safeSlug, fileName);
}

export async function readProjectMarkdown(projectSlug: string) {
  const contextPath = resolveSafeProjectPath(projectSlug, "CONTEXT.md");
  const progressPath = resolveSafeProjectPath(projectSlug, "PROGRESS.md");

  const [context, progress] = await Promise.all([
    fs.readFile(contextPath, "utf-8").catch(() => "# CONTEXT.md\nNo context yet."),
    fs.readFile(progressPath, "utf-8").catch(() => "# PROGRESS.md\nNo progress logged yet."),
  ]);

  return { context, progress };
}

export async function appendProjectMarkdown(
  projectSlug: string,
  fileName: "CONTEXT.md" | "PROGRESS.md",
  entry: string
) {
  const targetPath = resolveSafeProjectPath(projectSlug, fileName);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const timestamp = new Date().toISOString().split("T")[0];
  // Indent subsequent lines so nested handoff bullets render cleanly in Markdown
  const indentedEntry = entry
    .trim()
    .split("\n")
    .map((line, idx) => (idx === 0 ? line : `  ${line}`))
    .join("\n");

  const formattedBlock = `\n- **[${timestamp}]** ${indentedEntry}\n`;

  await fs.appendFile(targetPath, formattedBlock, "utf-8");
  return { success: true, fileName, appended: formattedBlock };
}

/**
 * Saves a completed chat session transcript into a markdown file under workspace-projects/[slug]/chats/
 */
export async function saveChatTranscript(
  projectSlug: string,
  personaName: string,
  messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>
) {
  const projectDir = path.join(process.cwd(), 'workspace-projects', projectSlug, 'chats');
  await fs.mkdir(projectDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}_${personaName.toLowerCase().replace(/\s+/g, '-')}.md`;
  const filePath = path.join(projectDir, filename);

  // Format the messages array into readable Markdown
  let markdownContent = `# Chat Session: ${personaName}\n`;
  markdownContent += `**Date:** ${new Date().toLocaleString()}\n`;
  markdownContent += `**Project:** ${projectSlug}\n\n---\n\n`;

  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? '### You' : `### ${personaName}`;
    markdownContent += `${roleLabel}\n`;
    
    for (const part of msg.parts) {
      if (part.type === 'text' && part.text) {
        markdownContent += `${part.text}\n\n`;
      }
    }
    markdownContent += '\n';
  }

  await fs.writeFile(filePath, markdownContent, 'utf-8');
  return filename;
}