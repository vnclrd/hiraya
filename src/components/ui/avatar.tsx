import type { PersonaConfig } from "@/config/personas";
import { accent } from "@/lib/accent";

export function Avatar({ bot, size = "md" }: { bot: PersonaConfig; size?: "sm" | "md" | "lg" }) {
  const dim = { sm: "size-6 text-[11px]", md: "size-8 text-sm", lg: "size-14 text-xl" }[size];
  return (
    <span
      style={accent(bot.accent)}
      className={`grid ${dim} shrink-0 place-items-center rounded-lg bg-(--persona)/15 font-semibold text-(--persona) ring-1 ring-(--persona)/30`}
    >
      {bot.name[0]}
    </span>
  );
}
