import { parseVertical, type BusinessVertical } from "@/lib/vertical";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";

/** Owner-facing vocabulary for one vertical. Intents stay canonical; copy changes. */
export type InboxNicheCopy = {
  holdFilter: string;
  jobFilter: string;
  holdUnit: string;
  jobUnit: string;
  returnUnit: string;
  holdCtaOne: string;
  holdCtaMany: string;
  jobCtaOne: string;
  jobCtaMany: string;
  returnCtaOne: string;
  returnCtaMany: string;
  confirmStamp: string;
  visitStamp: string;
  visitDoneStamp: string;
  pickupStamp: string;
  holdEmpty: string;
  jobEmpty: string;
  searchPlaceholder: string;
  jobColumn: string;
};

const NICHE: Record<BusinessVertical, InboxNicheCopy> = {
  retail: {
    holdFilter: "Holds",
    jobFilter: "Visits",
    holdUnit: "to fulfill",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Fulfill hold",
    holdCtaMany: "Fulfill holds",
    jobCtaOne: "Confirm visit",
    jobCtaMany: "Confirm visits",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm visit",
    visitStamp: "Visit",
    visitDoneStamp: "Visit done",
    pickupStamp: "Pickup",
    holdEmpty: "Nothing to fulfill",
    jobEmpty: "No visits to confirm",
    searchPlaceholder: "Name, number, hold",
    jobColumn: "Visit",
  },
  home_services: {
    holdFilter: "Holds",
    jobFilter: "Visits",
    holdUnit: "to fulfill",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Fulfill hold",
    holdCtaMany: "Fulfill holds",
    jobCtaOne: "Confirm visit",
    jobCtaMany: "Confirm visits",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm visit",
    visitStamp: "Visit",
    visitDoneStamp: "Visit done",
    pickupStamp: "Hold",
    holdEmpty: "Nothing to fulfill",
    jobEmpty: "No visits to confirm",
    searchPlaceholder: "Name, number, visit",
    jobColumn: "Visit",
  },
  hospitality: {
    holdFilter: "Holds",
    jobFilter: "Bookings",
    holdUnit: "to fulfill",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Fulfill hold",
    holdCtaMany: "Fulfill holds",
    jobCtaOne: "Confirm booking",
    jobCtaMany: "Confirm bookings",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm booking",
    visitStamp: "Booking",
    visitDoneStamp: "Booking done",
    pickupStamp: "Hold",
    holdEmpty: "Nothing to fulfill",
    jobEmpty: "No bookings to confirm",
    searchPlaceholder: "Name, number, booking",
    jobColumn: "Booking",
  },
  general: {
    holdFilter: "Holds",
    jobFilter: "Jobs",
    holdUnit: "to fulfill",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Fulfill hold",
    holdCtaMany: "Fulfill holds",
    jobCtaOne: "Confirm visit",
    jobCtaMany: "Confirm visits",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm visit",
    visitStamp: "Visit",
    visitDoneStamp: "Visit done",
    pickupStamp: "Hold",
    holdEmpty: "Nothing to fulfill",
    jobEmpty: "No visits to confirm",
    searchPlaceholder: "Name, number, job",
    jobColumn: "Visit",
  },
};

export function nicheCopy(vertical?: string | null): InboxNicheCopy {
  return NICHE[parseVertical(vertical)];
}

export function purposeFilters(vertical?: string | null): {
  id: InboxPurposeFilterId;
  label: string;
}[] {
  const copy = nicheCopy(vertical);
  return [
    { id: "needs", label: "Needs you" },
    { id: "hold", label: copy.holdFilter },
    { id: "job", label: copy.jobFilter },
    { id: "human", label: "Human" },
    { id: "answered", label: "Answered" },
    { id: "all", label: "All" },
  ];
}
