"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type AdminBillingClientDetail } from "@/lib/adminBilling";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { btnGhost } from "@/components/ui/deskChrome";
import { AdminShopMoneyPanel } from "@/components/AdminShopMoneyPanel";
import { requestErrorText } from "@/lib/adminBillingCopy";

/** Dev fixture and legacy embed: shop Money rows plus checkout review when present. */
export function AdminBillingDetailPanel({ detail }: { detail: AdminBillingClientDetail }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reviewRef, setReviewRef] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewChoice, setReviewChoice] = useState<"" | "book" | "nothing">("");
  const [savingReview, setSavingReview] = useState(false);

  async function post(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(requestErrorText(json));
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  async function confirmReview() {
    if (!reviewRef || (reviewChoice !== "book" && reviewChoice !== "nothing") || reviewNote.trim().length < 3) return;
    setSavingReview(true);
    const ok = await post(
      {
        action: "resolve_checkout_review",
        business_id: detail.row.id,
        provider_ref: reviewRef,
        note: reviewNote.trim(),
        choice: reviewChoice,
      },
    );
    setSavingReview(false);
    if (ok) {
      setReviewRef(null);
      setReviewNote("");
      setReviewChoice("");
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3 px-4">
        <Link href={`/admin/businesses/${detail.row.id}?money=1`} className={btnGhost}>
          Open shop
        </Link>
        <Link href="/admin/billing" className={btnGhost}>
          Billing queue
        </Link>
      </div>

      {error ? (
        <p className="px-4 text-body text-attention" role="alert">
          {error}
        </p>
      ) : null}

      {detail.checkoutReviews.length > 0 ? (
        <section className="border-b border-hairline/70 pb-6">
          <h2 className="px-4 text-title font-medium text-ink">Checkout review</h2>
          <ul className="mt-2 divide-y divide-hairline">
            {detail.checkoutReviews.map((review) => (
              <ListRow
                key={review.providerRef}
                title="Checkout total"
                preview={
                  <span className="tabular-nums">
                    Reading KSh {review.getKes}. Books show KSh {review.seenKes}.
                  </span>
                }
                actions={
                  <Button
                    type="button"
                    size="sm"
                    variant="tonal"
                    onClick={() => {
                      setError(null);
                      setReviewNote("");
                      setReviewChoice("");
                      setReviewRef(review.providerRef);
                    }}
                  >
                    Resolve
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Money</h2>
        <ul className="divide-y divide-hairline">
          <AdminShopMoneyPanel detail={detail} />
        </ul>
      </section>

      <ConfirmSheet
        open={reviewRef != null}
        theme="admin"
        pending={savingReview}
        title="Resolve checkout review"
        confirmLabel={
          reviewChoice === "book"
            ? "Book collected amount"
            : reviewChoice === "nothing"
              ? "Confirm nothing collected"
              : "Resolve"
        }
        confirmDisabled={!reviewChoice || reviewNote.trim().length < 3}
        onClose={() => {
          if (!savingReview) setReviewRef(null);
        }}
        onConfirm={() => void confirmReview()}
      >
        <div className="space-y-3">
          <p>A new checkout stays closed until you book this reading or confirm nothing was collected.</p>
          <Segmented
            label="Resolve choice"
            items={[
              { key: "book", label: "Book collected amount", active: reviewChoice === "book" },
              { key: "nothing", label: "Nothing collected", active: reviewChoice === "nothing" },
            ]}
            onSelect={(key) => setReviewChoice(key === "nothing" ? "nothing" : "book")}
          />
          {reviewChoice === "book" ? (
            <p>Books the reading up to what is still due. Anything over that is a credit.</p>
          ) : null}
          {reviewChoice === "nothing" ? (
            <p>Leaves the books as they are. A new checkout can then start for what is still due.</p>
          ) : null}
          <Field id="bill-review-note" label="Reason" required>
            {(props) => <Input {...props} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />}
          </Field>
        </div>
      </ConfirmSheet>
    </div>
  );
}
