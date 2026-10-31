"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { REQUEST_ACCESS_COPY, type RequestAccessLang } from "./requestAccessCopy";
import {
  createMockRequestAccessAdapter,
  submitRequestAccess,
  validateRequestAccess,
  type RequestAccessAdapter,
  type RequestAccessError,
} from "./requestAccess";

const EMPTY_ADAPTER = createMockRequestAccessAdapter();

export function RequestAccessForm({
  lang,
  adapter = EMPTY_ADAPTER,
  onDone,
}: {
  lang: RequestAccessLang;
  adapter?: RequestAccessAdapter;
  onDone: () => void;
}) {
  const copy = REQUEST_ACCESS_COPY[lang];
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<RequestAccessError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = validateRequestAccess({ name, contact, consent });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await submitRequestAccess(adapter, parsed.value);
      onDone();
    } finally {
      setPending(false);
    }
  }

  const message =
    error === "name"
      ? copy.needName
      : error === "consent"
        ? copy.needConsent
        : error === "contact"
          ? copy.needContact
          : error === "contact_invalid"
            ? copy.badContact
            : null;

  return (
    <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
      <p className="font-demo text-body">{copy.title}</p>
      <Field id="demo-request-name" label={copy.name}>
        {(field) => (
          <Input
            {...field}
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field id="demo-request-contact" label={copy.contact}>
        {(field) => (
          <Input
            {...field}
            name="contact"
            autoComplete="email"
            inputMode="email"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-3 font-demo text-body">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="h-5 w-5 shrink-0 rounded-md border-hairline text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        <span>{copy.consent}</span>
      </label>
      {message ? (
        <p role="alert" className="font-demo text-meta text-ink-2">
          {message}
        </p>
      ) : null}
      <Button type="submit" variant="primary" block pending={pending}>
        {copy.submit}
      </Button>
    </form>
  );
}
