import { parseVertical, type BusinessVertical } from "@/lib/vertical";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";

/**
 * Hospitality reservations are not a product. Gate Confirm booking until they exist.
 * Home-services Confirm visit is never gated.
 */
export const HOSPITALITY_RESERVATIONS_EXIST = false;

const HOSPITALITY_RESERVATION_AFFORDANCES = {
  jobCtaOne: "Confirm booking",
  jobCtaMany: "Confirm bookings",
  confirmStamp: "Confirm booking",
  visitGhostStamp: "Booking not booked",
} as const;

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
  visitGhostStamp: string;
  holdGhostStamp: string;
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
    holdUnit: "Hold Done",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Hold Done",
    holdCtaMany: "Hold Done",
    jobCtaOne: "Confirm visit",
    jobCtaMany: "Confirm visits",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm visit",
    visitStamp: "Visit",
    visitDoneStamp: "Visit done",
    visitGhostStamp: "Visit not booked",
    holdGhostStamp: "Hold not saved",
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
    holdUnit: "Hold Done",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Hold Done",
    holdCtaMany: "Hold Done",
    jobCtaOne: "Confirm visit",
    jobCtaMany: "Confirm visits",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm visit",
    visitStamp: "Visit",
    visitDoneStamp: "Visit done",
    visitGhostStamp: "Visit not booked",
    holdGhostStamp: "Hold not saved",
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
    holdUnit: "Hold Done",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Hold Done",
    holdCtaMany: "Hold Done",
    jobCtaOne: "Confirm visit",
    jobCtaMany: "Confirm visits",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm visit",
    visitStamp: "Booking",
    visitDoneStamp: "Booking done",
    visitGhostStamp: "Visit not booked",
    holdGhostStamp: "Hold not saved",
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
    holdUnit: "Hold Done",
    jobUnit: "to confirm",
    returnUnit: "to return",
    holdCtaOne: "Hold Done",
    holdCtaMany: "Hold Done",
    jobCtaOne: "Confirm visit",
    jobCtaMany: "Confirm visits",
    returnCtaOne: "Return call",
    returnCtaMany: "Return calls",
    confirmStamp: "Confirm visit",
    visitStamp: "Visit",
    visitDoneStamp: "Visit done",
    visitGhostStamp: "Visit not booked",
    holdGhostStamp: "Hold not saved",
    pickupStamp: "Hold",
    holdEmpty: "Nothing to fulfill",
    jobEmpty: "No visits",
    todayEmpty: "Nothing today",
    searchPlaceholder: "Name, number, job",
    jobColumn: "Visit",
  },
};

export function nicheCopy(vertical?: string | null): InboxNicheCopy {
  const parsed = parseVertical(vertical);
  const copy = NICHE[parsed];
  if (parsed !== "hospitality") return copy;
  return HOSPITALITY_RESERVATIONS_EXIST
    ? { ...copy, ...HOSPITALITY_RESERVATION_AFFORDANCES }
    : copy;
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
  ];
}
