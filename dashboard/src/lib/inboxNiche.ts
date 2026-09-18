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
  todayEmpty: string;
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
    jobEmpty: "No visits",
    todayEmpty: "Nothing today",
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
    jobEmpty: "No visits",
    todayEmpty: "Nothing today",
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
    jobEmpty: "No bookings",
    todayEmpty: "Nothing today",
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
    jobEmpty: "No visits",
    todayEmpty: "Nothing today",
    searchPlaceholder: "Name, number, job",
    jobColumn: "Visit",
  },
};

export function nicheCopy(vertical?: string | null): InboxNicheCopy {
  return NICHE[parseVertical(vertical)];
}

/** Act, tape, book, closed. 08:00 owner, live watcher, visit confirmer. */
export function purposeFilters(vertical?: string | null): {
  id: InboxPurposeFilterId;
  label: string;
  divide?: boolean;
}[] {
  const copy = nicheCopy(vertical);
  return [
    { id: "needs", label: "Needs you" },
    { id: "all", label: "All" },
    { id: "job", label: copy.jobFilter, divide: true },
    { id: "hold", label: copy.holdFilter },
    { id: "human", label: "Human", divide: true },
    { id: "answered", label: "Answered" },
    { id: "archived", label: "Archived" },
  ];
}
