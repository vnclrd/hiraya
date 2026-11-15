"use client";

import type { UIMessage } from "ai";
import { AlertTriangle, ArrowDown } from "lucide-react";
import { HIRAYA_PERSONAS, type PersonaConfig } from "@/config/personas";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { Avatar } from "@/components/ui/avatar";
import { CopyButton } from "@/components/ui/copy-button";
import { Markdown } from "@/components/ui/markdown";
import { ToolBadge } from "./tool-badge";

type Props = {
  messages: UIMessage[];
  status: string;
  error?: Error;
  bot: PersonaConfig;
  onSend: (text: string) => void;
  onRetry: () => void;
};

const textOf = (m: UIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

function PersonaIntro({ bot, onSend }: { bot: PersonaConfig; onSend: (t: string) => void }) {
  return (
    <div className="animate-rise flex flex-col items-center pt-[10vh] text-center">
      <Avatar bot={bot} size="lg" />
      <h2 className="mt-4 text-lg font-semibold tracking-tight">Work with {bot.name}</h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">{bot.description}</p>
      <div className="mt-6 grid w-full max-w-xl gap-2">
        {bot.starters.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSend(s)}
            className="cursor-pointer rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-sm text-fg-muted transition hover:border-(--persona)/40 hover:text-fg hover:shadow-[0_0_24px_-12px_var(--persona)]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: UIMessage }) {
  // Messages handed over by a teammate carry { from } metadata; label them so they don't look typed by Sir
  const from = (message.metadata as { from?: string } | undefined)?.from;
  const body = from ? textOf(message).replace(/^\[Task from [^\]]+\]\n/, "") : textOf(message);
  return (
    <div className="animate-rise flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-(--persona)/25 bg-(--persona)/10 px-4 py-2.5 text-sm whitespace-pre-wrap">
        {from && (
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-(--persona) uppercase">
            Task from {HIRAYA_PERSONAS[from]?.name ?? from}
          </div>
        )}
        {body}
      </div>
    </div>
  );
}

function AssistantMessage({ message, bot, streaming }: { message: UIMessage; bot: PersonaConfig; streaming: boolean }) {
  const text = textOf(message);
  return (
    <div className="group/msg animate-rise flex gap-3">
      <Avatar bot={bot} size="sm" />
      <div className={`min-w-0 flex-1 ${streaming ? "streaming-caret" : ""}`}>
        {message.parts.map((part, i) => {
          if (part.type === "text") return <Markdown key={i}>{part.text}</Markdown>;
          if (part.type.startsWith("tool-")) return <ToolBadge key={i} part={part} />;
          return null;
        })}
        {text && !streaming && (
          <div className="mt-1 flex">
            <CopyButton text={text} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatThread({ messages, status, error, bot, onSend, onRetry }: Props) {
  const { ref, atBottom, onScroll, scrollToBottom } = useStickToBottom([messages, status]);

  return (
    <>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {messages.length === 0 && <PersonaIntro bot={bot} onSend={onSend} />}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserBubble key={m.id} message={m} />
            ) : (
              <AssistantMessage
                key={m.id}
                message={m}
                bot={bot}
                streaming={status === "streaming" && i === messages.length - 1}
              />
            ),
          )}

          {status === "submitted" && (
            <div className="flex items-center gap-3" aria-label={`${bot.name} is thinking`}>
              <Avatar bot={bot} size="sm" />
              <div className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="size-1.5 animate-bounce rounded-full bg-(--persona)"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertTriangle className="size-4 shrink-0" />
              {error.message?.includes("rate-limited")
                ? error.message
                : "Something went wrong (providers may be rate-limited)."}
              <button type="button" onClick={onRetry} className="ml-auto cursor-pointer underline">
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label="Scroll to latest"
          className="animate-rise absolute bottom-28 left-1/2 -translate-x-1/2 cursor-pointer rounded-full border border-line-strong bg-raised p-2 text-fg-muted shadow-lg transition hover:text-fg"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </>
  );
}