"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Field, Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { requestErrorText } from "@/lib/adminBillingCopy";
import { reviewPreview, reviewTitle, shopMoneyHref, type ReviewTarget } from "@/lib/adminPayCopy";

/** Book or leave a checkout-total review. Uses the existing billing API. */
export function CheckoutReviewResolve({
  reviews,
  showBusiness = false,
  link = true,
}: {
  reviews: ReviewTarget[];
  showBusiness?: boolean;
  /** Shop Money is already the fix, so the row there is not a link. */
  link?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reviewRef, setReviewRef] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewChoice, setReviewChoice] = useState<"" | "book" | "nothing">("");
  const [savingReview, setSavingReview] = useState(false);

  const active = reviews.find((review) => review.providerRef === reviewRef) ?? null;

  async function confirmReview() {
    if (!active || (reviewChoice !== "book" && reviewChoice !== "nothing") || reviewNote.trim().length < 3) return;
    setSavingReview(true);
    setError(null);
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resolve_checkout_review",
        business_id: active.businessId,
        provider_ref: active.providerRef,
        note: reviewNote.trim(),
        choice: reviewChoice,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSavingReview(false);
    if (!res.ok) {
      setError(requestErrorText(json));
      return;
    }
    setReviewRef(null);
    setReviewNote("");
    setReviewChoice("");
    startTransition(() => router.refresh());
  }

  if (reviews.length === 0) return null;

  return (
    <>
      {reviews.map((review) => (
        <ListRow
          key={review.providerRef}
          href={link ? shopMoneyHref(review.businessId) : undefined}
          title={reviewTitle(review.reason)}
          preview={
            <span className="tabular-nums">
              {reviewPreview(review, showBusiness ? review.businessName : null)}
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
      <ConfirmSheet
        open={active != null}
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
          {error ? (
            <p className="text-body text-attention" role="alert">
              {error}
            </p>
          ) : null}
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
    </>
  );
}
