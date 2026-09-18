import Link from "next/link";
import { btnPrimary, pageTitleClass } from "@/components/ui/deskChrome";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className={pageTitleClass}>Page not found</h1>
        <p className="mt-3 text-sm text-ink-soft">That address is not a Scalers page.</p>
        <Link href="/home" className={`${btnPrimary} mt-6`}>
          Overview
        </Link>
      </div>
    </main>
  );
}
