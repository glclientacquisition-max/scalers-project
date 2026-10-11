"use client";

import { Switch } from "@/components/ui/Switch";
import { PHONE_COUNTRIES, dialCode, type AlertsStep as Value, type FieldErrors } from "@/lib/setupFlow";
import { FieldError, inputClass } from "./ui";

export function AlertsStep({ value, onChange, errors }: { value: Value; onChange: (v: Value) => void; errors: FieldErrors }) {
  const channels: Array<{ key: "whatsapp" | "sms" | "emailOn"; title: string; detail: string }> = [
    { key: "whatsapp", title: "WhatsApp", detail: "To your mobile number." },
    { key: "sms", title: "SMS", detail: "Text messages to your mobile number." },
    { key: "emailOn", title: "Email", detail: "Used when WhatsApp and SMS don't get through." },
  ];
  return (
    <>
      <section className="mt-6 rounded-2xl bg-surface p-4">
        <label htmlFor="alert-phone" className="mb-1.5 block text-meta font-medium text-ink">
          Mobile number
        </label>
        <div className="flex gap-2">
        <label htmlFor="alert-country" className="sr-only">Country</label>
        <select
          id="alert-country"
          data-field="country"
          value={value.country}
          onChange={(e) => onChange({ ...value, country: e.target.value })}
          autoComplete="tel-country-code"
          className={`${inputClass} w-auto shrink-0 pr-8`}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({dialCode(c.code)})
            </option>
          ))}
        </select>
        <input
          id="alert-phone"
          data-field="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value.phone}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
          placeholder={PHONE_COUNTRIES.find((c) => c.code === value.country)?.example ?? "0712 345 678"}
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={errors.phone ? "alert-phone-err" : undefined}
          className={`${inputClass} min-w-0 flex-1`}
        />
        </div>
        <FieldError id="alert-phone-err" message={errors.phone} />
        <label htmlFor="alert-email" className="mb-1.5 mt-4 block text-meta font-medium text-ink">
          Email
        </label>
        <input
          id="alert-email"
          data-field="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "alert-email-err" : undefined}
          className={inputClass}
        />
        <FieldError id="alert-email-err" message={errors.email} />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 px-4 text-meta font-medium text-ink-2">Send alerts by</h2>
        <ul className="divide-y divide-hairline overflow-hidden rounded-2xl bg-surface">
          {channels.map((c) => (
            <li key={c.key} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 py-1">
                <span className="block text-body font-medium text-ink">{c.title}</span>
                <span className="block text-meta text-ink-2">{c.detail}</span>
              </span>
              <Switch checked={value[c.key]} label={`${c.title} alerts`} onCheckedChange={(on) => onChange({ ...value, [c.key]: on })} />
            </li>
          ))}
        </ul>
        <p className="mt-2 px-4 text-meta text-ink-2">
          You&apos;ll get an alert when a caller asks for you, leaves a message or books. Add teammates later in Settings.
        </p>
      </section>
    </>
  );
}
