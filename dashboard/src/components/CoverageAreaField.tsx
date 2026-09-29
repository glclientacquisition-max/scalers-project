"use client";

import { useMemo, useState } from "react";
import {
  coverageAreaLabel,
  searchCoverageAreas,
  COVERAGE_AREA_MAX,
} from "@/lib/coverageAreas";
import { settingsDenseFieldClass } from "@/components/settingsUi";

export function CoverageAreaField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(
    () => searchCoverageAreas(query, value),
    [query, value]
  );
  const listId = `${id}-list`;
  const activeIndex = results.length ? Math.min(active, results.length - 1) : 0;

  function addArea(areaId: string) {
    if (value.includes(areaId) || value.length >= COVERAGE_AREA_MAX) return;
    onChange([...value, areaId]);
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function removeArea(areaId: string) {
    onChange(value.filter((id) => id !== areaId));
  }

  return (
    <div className="min-w-0 space-y-2">
      {value.length ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((areaId) => {
            const label = coverageAreaLabel(areaId);
            return (
              <li key={areaId}>
                <button
                  type="button"
                  onClick={() => removeArea(areaId)}
                  className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
                  aria-label={`Remove ${label}`}
                >
                  <span className="min-w-0 truncate">{label}</span>
                  <span aria-hidden="true" className="text-ink-soft">
                    ×
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && results[activeIndex] ? `${id}-opt-${activeIndex}` : undefined
        }
        value={query}
        placeholder="Nairobi"
        autoComplete="off"
        className={settingsDenseFieldClass}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((prev) => Math.max(prev - 1, 0));
          } else if (event.key === "Enter" && open && results[activeIndex]) {
            event.preventDefault();
            addArea(results[activeIndex].id);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && results.length ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Coverage"
          className="max-h-60 overflow-y-auto rounded-lg border border-line bg-surface"
        >
          {results.map((area, index) => {
            const showCounty =
              area.kind === "county" &&
              (index === 0 || results[index - 1]?.kind !== "county");
            const showPlace =
              area.kind === "place" &&
              (index === 0 || results[index - 1]?.kind !== "place");
            return (
              <li key={area.id}>
                {showCounty ? (
                  <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Counties
                  </p>
                ) : null}
                {showPlace ? (
                  <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Estates
                  </p>
                ) : null}
                <button
                  id={`${id}-opt-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addArea(area.id)}
                  className={`flex min-h-11 w-full items-center px-3 text-left text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] ${
                    index === activeIndex ? "bg-line" : ""
                  }`}
                >
                  {area.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
