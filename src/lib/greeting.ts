/** Time-of-day greeting, personalised when a name is available. */
export function getGreeting(hour: number, name = ""): string {
  const base =
    hour < 5
      ? "Burning the midnight oil"
      : hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";
  const n = name.trim();
  return n ? `${base}, ${n}` : base;
}
