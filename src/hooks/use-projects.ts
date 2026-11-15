"use client";

import { useCallback, useEffect, useState } from "react";

/** Project folders found in workspace-projects/ (powers the header dropdown). */
export function useProjects() {
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/projects/list");
      if (r.ok) setProjects((await r.json()).projects ?? []);
    } catch {} finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { projects, loading, reload };
}
