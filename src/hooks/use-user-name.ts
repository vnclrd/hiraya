"use client";

import { useCallback, useEffect, useState } from "react";
import { getGreeting } from "@/lib/greeting";

const KEY = "hiraya:username";

/** Remembers the user's display name (localStorage) and derives the landing greeting from it. */
export function useUserName() {
  const [userName, setUserName] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [greeting, setGreeting] = useState("Good to see you");

  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(KEY) || "";
    } catch {}
    setUserName(saved);
    setDraft(saved);
    setGreeting(getGreeting(new Date().getHours(), saved));
  }, []);

  const startEditing = useCallback(() => {
    setDraft(userName);
    setEditing(true);
  }, [userName]);

  const save = useCallback(() => {
    const trimmed = draft.trim();
    setUserName(trimmed);
    try {
      if (trimmed) localStorage.setItem(KEY, trimmed);
      else localStorage.removeItem(KEY);
    } catch {}
    setGreeting(getGreeting(new Date().getHours(), trimmed));
    setEditing(false);
  }, [draft]);

  return { greeting, draft, setDraft, editing, startEditing, save };
}
