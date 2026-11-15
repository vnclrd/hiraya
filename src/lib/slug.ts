export const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_]/g, ""); // mirrors server-side slug cleaning
