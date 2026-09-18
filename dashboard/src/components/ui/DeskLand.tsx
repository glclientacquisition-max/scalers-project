"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
  type Ref,
} from "react";
import {
  DESK_LAND_MS,
  deskJustLandedClass,
  nextLandedIds,
} from "@/lib/deskMotion";

const DeskLandCtx = createContext<ReadonlySet<string>>(new Set());

/**
 * Marks rows that appeared after first paint. Remount or change `scopeKey`
 * when the pile is a different filter, page, or query so those swaps do not flash.
 */
export function DeskLandScope({
  ids,
  scopeKey,
  children,
}: {
  ids: readonly string[];
  scopeKey: string;
  children: ReactNode;
}) {
  const seen = useRef<Set<string> | null>(null);
  const scopeRef = useRef(scopeKey);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [landed, setLanded] = useState<Set<string>>(() => new Set());
  const idKey = ids.join("\0");

  useEffect(() => {
    return () => {
      for (const t of timers.current) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const incoming = idKey === "" ? [] : idKey.split("\0");
    const reset = scopeRef.current !== scopeKey;
    scopeRef.current = scopeKey;
    if (reset) {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
      setLanded(new Set());
    }
    const result = nextLandedIds(seen.current, incoming, reset);
    seen.current = result.seen;
    if (!result.landed.length) return;
    setLanded((prev) => {
      const next = new Set(prev);
      for (const id of result.landed) next.add(id);
      return next;
    });
    const batch = result.landed;
    const t = setTimeout(() => {
      setLanded((prev) => {
        const next = new Set(prev);
        for (const id of batch) next.delete(id);
        return next;
      });
    }, DESK_LAND_MS);
    timers.current.push(t);
  }, [idKey, scopeKey]);

  return <DeskLandCtx.Provider value={landed}>{children}</DeskLandCtx.Provider>;
}

export function DeskLandSurface({
  id,
  as: Tag = "div",
  className,
  children,
  rowRef,
  ...rest
}: {
  id: string;
  as?: ElementType;
  className?: string;
  children: ReactNode;
  rowRef?: Ref<HTMLElement>;
} & Record<string, unknown>) {
  const landed = useContext(DeskLandCtx).has(id);
  return (
    <Tag
      ref={rowRef}
      className={[className, landed ? deskJustLandedClass : ""]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}
