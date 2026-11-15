import { GENERAL, PERSONAS } from "@/config/modes";
import { accent } from "@/lib/accent";

/** Horizontal persona switcher shown below md, where the sidebar is hidden. */
export function PersonaStrip({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b border-line p-2 md:hidden">
      {[GENERAL, ...PERSONAS].map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          style={accent(p.accent)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
            p.id === activeId ? "border-(--persona)/50 bg-(--persona)/10 text-fg" : "border-line text-fg-muted"
          }`}
        >
          {p.id === "general" ? "General" : p.name}
        </button>
      ))}
    </div>
  );
}
