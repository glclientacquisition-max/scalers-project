/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { formatDue, formatKsh, nextPart, splitKes, toCents } = require("./money");

function facts(lookup) {
  const parts = splitKes(lookup.totalKes);
  const next = nextPart(parts, lookup.amountPaidKes);
  return {
    businessName: lookup.businessName || "",
    invoiceNumber: lookup.invoiceNumber || "",
    totalLabel: formatKsh(toCents(lookup.totalKes)),
    dueLabel: lookup.dueAt ? `Due ${formatDue(lookup.dueAt)}` : null,
    partLabel: next && next.count > 1 ? `Part ${next.index} of ${next.count}` : null,
    payLabel: next ? `Pay ${formatKsh(toCents(next.amountKes))}` : null,
    checkoutId: null,
    notice: null,
  };
}

/**
 * Page model. Paid, void, and expired are plain. "Payment received" is set
 * only when the invoice itself is paid. A paid part of a split names that
 * part and the amount still due, and keeps the next Pay button. A succeeded
 * checkout with nothing applied stays on Checking payment.
 * @param {{ lookup: object | null, checkout?: { id?: string, status?: string, returning?: boolean } | null }} input
 */
function payView(input) {
  const lookup = input.lookup;
  if (!lookup || !lookup.found) {
    return {
      state: "missing",
      title: "This link is not valid",
      businessName: "",
      invoiceNumber: "",
      totalLabel: null,
      dueLabel: null,
      partLabel: null,
      payLabel: null,
      checkoutId: null,
      notice: null,
    };
  }

  const base = facts(lookup);
  const checkout = input.checkout || null;
  if (checkout && checkout.id) base.checkoutId = checkout.id;

  if (lookup.state === "paid") {
    if (checkout && checkout.returning && checkout.status === "succeeded") {
      return { ...base, state: "received", title: "Payment received", partLabel: null, payLabel: null };
    }
    return { ...base, state: "paid", title: "Paid", partLabel: null, payLabel: null };
  }
  if (lookup.state === "void") {
    return { ...base, state: "void", title: "This invoice is void", partLabel: null, payLabel: null };
  }
  if (lookup.state === "expired") {
    return { ...base, state: "expired", title: "This link has expired", partLabel: null, payLabel: null };
  }
  if (lookup.state === "unavailable") {
    return { ...base, state: "unavailable", title: "This invoice cannot be paid here", partLabel: null, payLabel: null };
  }
  if (lookup.state === "closed") {
    return { ...base, state: "closed", title: "This invoice is closed", partLabel: null, payLabel: null };
  }

  if (checkout && checkout.returning) {
    if (checkout.status === "pending" || checkout.status === "open") {
      return { ...base, state: "checking", title: "Checking payment", payLabel: null };
    }
    if (checkout.status === "succeeded") {
      const paid = toCents(lookup.amountPaidKes) || 0n;
      const total = toCents(lookup.totalKes) || 0n;
      if (paid > 0n && total > paid) {
        const due = formatKsh(total - paid);
        const parts = splitKes(lookup.totalKes);
        const next = nextPart(parts, lookup.amountPaidKes);
        if (next && next.count > 1 && next.index > 1) {
          return {
            ...base,
            state: "received",
            title: `Part ${next.index - 1} of ${next.count} received, ${due} still due`,
          };
        }
        return { ...base, state: "received", title: `${due} still due` };
      }
      return { ...base, state: "checking", title: "Checking payment", payLabel: null };
    }
    if (checkout.status === "issue") {
      return { ...base, state: "issue", title: "This payment needs a check" };
    }
    if (checkout.status === "failed" || checkout.status === "cancelled") {
      return { ...base, state: "payable", title: lookup.businessName, notice: "Payment was not completed." };
    }
  }

  return { ...base, state: "payable", title: lookup.businessName || "Invoice" };
}

module.exports = { payView };
