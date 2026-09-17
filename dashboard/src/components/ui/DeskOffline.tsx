"use client";

import { useEffect, useState } from "react";

export function DeskOffline() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="border-b border-warn/40 bg-warn-soft">
      <p
        className="mx-auto max-w-desk px-4 py-3 text-sm text-warn sm:px-6"
        role="status"
      >
        No connection.
      </p>
    </div>
  );
}
