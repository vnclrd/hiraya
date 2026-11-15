"use client";

import { useEffect, useState, useRef, type RefObject } from "react";
import { ArrowUp, Square, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

export type Attachment = {
  name: string;
  type: string;
  url: string;
  data: string; // base64 or text content
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (attachments?: Attachment[]) => void;
  onStop: () => void;
  busy: boolean;
  landing: boolean;
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({ value, onChange, onSubmit, onStop, busy, landing, placeholder, inputRef }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the textarea height in sync with its content (also resets after send / prefill)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, landing, inputRef]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filePromises = Array.from(files).map((file) => {
      return new Promise<Attachment>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result as string;
          resolve({
            name: file.name,
            type: file.type || 'application/octet-stream',
            url: file.type.startsWith('image/') ? result : '',
            data: result,
          });
        };
        if (file.type.startsWith('image/')) {
          reader.readAsDataURL(file);
        } else {
          reader.readAsText(file);
        }
      });
    });

    const newAttachments = await Promise.all(filePromises);
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    onSubmit(attachments);
    setAttachments([]);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className={landing ? "w-full" : "mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"}
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {attachments.map((att, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-line-strong bg-surface px-3 py-1.5 text-xs">
              {att.type.startsWith('image/') ? (
                <ImageIcon className="size-3.5 text-(--persona)" />
              ) : (
                <FileText className="size-3.5 text-(--persona)" />
              )}
              <span className="max-w-37.5 truncate font-medium">{att.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="text-fg-subtle hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={`flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 transition focus-within:border-(--persona)/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--persona)_14%,transparent)] ${
          landing ? "shadow-2xl" : "shadow-lg"
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          accept=".zip,.pdf,.jpg,.jpeg,.png,.txt,.md,.ts,.tsx,.js,.json"
          className="hidden"
        />
        <Tooltip label="Attach files (.zip, .pdf, .jpg, .png)" side="top">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl text-fg-subtle transition hover:bg-raised hover:text-fg"
          >
            <Paperclip className="size-4" />
          </button>
        </Tooltip>
        <textarea
          ref={inputRef}
          value={value}
          rows={landing ? 2 : 1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className={`block max-h-52 w-full resize-none bg-transparent px-3 py-2 outline-hidden placeholder:text-fg-subtle ${landing ? "text-base" : "text-sm"}`}
        />
        <div className="flex shrink-0 pr-0.5 pb-0.5">
          {busy ? (
            <Tooltip label="Stop generating" hint="Esc" side="top">
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop"
                className="grid size-8 cursor-pointer place-items-center rounded-xl border border-line-strong text-fg transition hover:bg-raised"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            </Tooltip>
          ) : (
            <button
              type="submit"
              disabled={!value.trim() && attachments.length === 0}
              aria-label="Send"
              className="grid size-8 cursor-pointer place-items-center rounded-xl bg-(--persona) text-canvas transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
