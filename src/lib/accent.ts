import type { CSSProperties } from "react";

/** Sets the --persona CSS variable that drives glows, rings and accents. */
export const accent = (c: string) => ({ "--persona": c }) as CSSProperties;
