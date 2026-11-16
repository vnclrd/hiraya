"use client";

import { useEffect, useState, useRef, type RefObject } from "react";
import { ArrowUp, Square, Paperclip, X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

export type Attachment = {
  name: string;
  mediaType: string; // image/webp or image/jpeg after compression
  url: string; // data: URL sent to the model
  originalBytes: number;
  bytes: number; // size after compression
};

// --- Compression settings -------------------------------------------------
const TARGET_BYTES = 100 * 1024; // aim for ~100 KB per image
const MAX_EDGE = 1280; // longest side, px (Gemini bills images by 768px tiles, so 1280x720 = 2 tiles)
const MIN_EDGE = 640; // never shrink below this; stop and accept the smallest result
const QUALITIES = [0.82, 0.72, 0.62, 0.52];
const MAX_INPUT_BYTES = 25 * 1024 * 1024; // refuse to decode absurdly large originals
const MAX_IMAGES = 4;

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

let webpSupported: boolean | null = null;
async function supportsWebp() {
  if (webpSupported === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const b = await toBlob(c, "image/webp", 0.8);
    webpSupported = b?.type === "image/webp";
  }
  return webpSupported;
}

/** Downscale + re-encode an image until it is under TARGET_BYTES (or can't shrink further). */
async function compressImage(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const outType = (await supportsWebp()) ? "image/webp" : "image/jpeg";

  // Already small enough? Keep the original bytes untouched.
  if (file.size <= TARGET_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_EDGE) {
    bitmap.close();
    return { name: file.name, mediaType: file.type, url: await blobToDataUrl(file), originalBytes: file.size, bytes: file.size };
  }

  let edge = Math.min(MAX_EDGE, Math.max(bitmap.width, bitmap.height));
  let best: Blob | null = null;

  for (;;) {
    const scale = edge / Math.max(bitmap.width, bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // PNG transparency has no meaning in lossy formats
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    for (const q of QUALITIES) {
      const blob = await toBlob(canvas, outType, q);
      if (!blob) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= TARGET_BYTES) {
        bitmap.close();
        return finish(file, blob);
      }
    }
    if (edge <= MIN_EDGE) break;
    edge = Math.max(MIN_EDGE, Math.round(edge * 0.8));
  }

  bitmap.close();
  if (!best) throw new Error("encode failed");
  return finish(file, best);
}

async function finish(file: File, blob: Blob): Promise<Attachment> {
  const base = file.name.replace(/\.[^.]+$/, "");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return { name: `${base}.${ext}`, mediaType: blob.type, url: await blobToDataUrl(blob), originalBytes: file.size, bytes: blob.size };
}

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
  const [processing, setProcessing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the textarea height in sync with its content (also resets after send / prefill)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, landing, inputRef]);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const rejected: string[] = [];
    const room = MAX_IMAGES - attachments.length;
    const accepted: File[] = [];
    for (const f of files) {
      if (f.type !== "image/png" && f.type !== "image/jpeg") rejected.push(`${f.name} (only PNG/JPG)`);
      else if (f.size > MAX_INPUT_BYTES) rejected.push(`${f.name} (over 25 MB)`);
      else if (accepted.length >= room) rejected.push(`${f.name} (max ${MAX_IMAGES} images)`);
      else accepted.push(f);
    }
    setProcessing((n) => n + accepted.length);
    const done: Attachment[] = [];
    for (const f of accepted) {
      try {
        done.push(await compressImage(f));
      } catch {
        rejected.push(`${f.name} (couldn't process)`);
      } finally {
        setProcessing((n) => n - 1);
      }
    }
    if (done.length) setAttachments((prev) => [...prev, ...done]);
    setError(rejected.length ? `Skipped: ${rejected.join(", ")}` : null);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (busy || processing > 0) return; // don't drop images that are still compressing
    onSubmit(attachments);
    setAttachments([]);
    setError(null);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className={landing ? "w-full" : "mx-auto w-full max-w-3xl shrink-0 px-4 pb-4"}
    >
      {(attachments.length > 0 || processing > 0 || error) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          {attachments.map((att, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-line-strong bg-surface py-1.5 pr-3 pl-1.5 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={att.url} alt="" className="size-8 rounded-md object-cover" />
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="max-w-37.5 truncate font-medium">{att.name}</span>
                <span className="text-fg-subtle">
                  {att.bytes < att.originalBytes ? `${kb(att.originalBytes)} → ${kb(att.bytes)}` : kb(att.bytes)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${att.name}`}
                className="text-fg-subtle hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {processing > 0 && <span className="text-xs text-fg-subtle">Compressing {processing} image{processing > 1 ? "s" : ""}…</span>}
          {error && <span className="text-xs text-rose-300">{error}</span>}
        </div>
      )}
      <div
        className={`flex items-center gap-2 rounded-2xl border border-line-strong bg-surface p-2 transition focus-within:border-(--persona)/60 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--persona)_14%,transparent)] ${
          landing ? "shadow-2xl" : "shadow-lg"
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addFiles(files);
          }}
          multiple
          accept="image/png,image/jpeg"
          className="hidden"
        />
        <Tooltip label="Attach images (PNG, JPG) — or paste a screenshot" side="top">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach image"
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
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
            if (imgs.length) {
              e.preventDefault(); // pasted screenshot -> attachment, not text
              void addFiles(imgs);
            }
          }}
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
        <div className="flex shrink-0 items-center">
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
              disabled={(!value.trim() && attachments.length === 0) || processing > 0}
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