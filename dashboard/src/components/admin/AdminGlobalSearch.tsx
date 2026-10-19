"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import type { AdminSearchHit } from "@/lib/adminGlobalSearchModel";

export function AdminGlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AdminSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }

    const handle = window.setTimeout(() => {
      setBusy(true);
      void fetch(`/api/admin/search?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((json: { hits?: AdminSearchHit[] }) => {
          setHits(json.hits || []);
          setOpen(true);
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 200);

    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function go(hit: AdminSearchHit) {
    setOpen(false);
    setQuery("");
    router.push(hit.href);
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <Input
        id="admin-global-search"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Business or call id"
        aria-label="Search businesses and calls"
        aria-expanded={open && hits.length > 0}
        aria-controls={open && hits.length > 0 ? listId : undefined}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          if (hits.length > 0) setOpen(true);
        }}
      />
      {open && hits.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-hairline bg-surface shadow-lg"
        >
          {hits.map((hit) => (
            <li key={hit.key} role="option">
              <ListRow
                title={hit.title}
                preview={hit.preview}
                onOpen={() => go(hit)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {busy && query.trim().length >= 2 ? (
        <p className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-meta text-ink-3">…</p>
      ) : null}
    </div>
  );
}
