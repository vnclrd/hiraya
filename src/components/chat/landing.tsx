"use client";

import type { ReactNode } from "react";
import { Check, FolderGit2 } from "lucide-react";

type Props = {
  greeting: string;
  editingName: boolean;
  nameDraft: string;
  onNameDraft: (v: string) => void;
  onStartEditName: () => void;
  onSaveName: () => void;
  composer: ReactNode;
  projects: string[];
  activeProject: string;
  onPickProject: (slug: string) => void;
};

const GRADIENT = "bg-linear-to-r from-(--persona) to-fuchsia-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl";

export function Landing({
  greeting,
  editingName,
  nameDraft,
  onNameDraft,
  onStartEditName,
  onSaveName,
  composer,
  projects,
  activeProject,
  onPickProject,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise m-auto w-full max-w-3xl px-4 py-10">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2">
            {editingName ? (
              <input
                type="text"
                value={nameDraft}
                autoFocus
                placeholder="Enter your name..."
                onChange={(e) => onNameDraft(e.target.value)}
                onBlur={onSaveName}
                onKeyDown={(e) => e.key === "Enter" && onSaveName()}
                className={`${GRADIENT} caret-(--persona) border-b border-(--persona) pb-1 text-center leading-none outline-none placeholder:text-fg-subtle`}
              />
            ) : (
              <h2
                onClick={onStartEditName}
                title="Click to add or change your name"
                className={`${GRADIENT} cursor-pointer transition hover:opacity-80`}
              >
                {greeting}.
              </h2>
            )}
          </div>
          <p className="mt-2 text-xl text-fg-subtle sm:text-2xl">What are we building today?</p>
        </div>

        {composer}

        {projects.length > 0 && (
          <div className="mt-10">
            <p className="mb-2 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">Jump back in</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {projects.slice(0, 3).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPickProject(p)}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                    p === activeProject
                      ? "border-(--persona)/40 bg-(--persona)/8"
                      : "border-line bg-surface/60 hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  <FolderGit2 className="size-4 shrink-0 text-fg-subtle" />
                  <span className="truncate font-mono text-xs">{p}</span>
                  {p === activeProject && <Check className="ml-auto size-3.5 text-(--persona)" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
