"use client";

import type { BusinessStep as Value, FieldErrors } from "@/lib/setupFlow";
import { LIMITS } from "@/lib/setupFlow";
import { ChoiceList, Group, inputClass } from "./ui";

export function BusinessStep({ value, onChange }: { value: Value; onChange: (v: Value) => void; errors: FieldErrors }) {
  return (
    <>
      <div className="mt-6">
        <h2 id="vertical-label" className="mb-2 px-4 text-meta font-medium text-ink-2">
          Type of business
        </h2>
        <ChoiceList
          label="Type of business"
          value={value.vertical}
          onChange={(vertical) => onChange({ ...value, vertical })}
          options={[
            { value: "retail", title: "Shop", detail: "Callers ask about stock, prices and pickup." },
            { value: "home_services", title: "Home services", detail: "Callers book jobs, quotes and site visits." },
          ]}
        />
      </div>
      <Group title="Where to find you" footer="Optional. Your receptionist reads this to callers who ask for directions.">
        <div className="p-4">
          <label htmlFor="landmark" className="mb-1.5 block text-meta font-medium text-ink">
            Landmark
          </label>
          <input
            id="landmark"
            data-field="landmark"
            value={value.landmark}
            maxLength={LIMITS.landmark}
            onChange={(e) => onChange({ ...value, landmark: e.target.value })}
            placeholder="Opposite Naivas, Westlands"
            autoComplete="street-address"
            className={inputClass}
          />
          <label htmlFor="directions" className="mb-1.5 mt-4 block text-meta font-medium text-ink">
            Directions
          </label>
          <textarea
            id="directions"
            data-field="directions"
            value={value.directions}
            maxLength={LIMITS.directions}
            rows={3}
            onChange={(e) => onChange({ ...value, directions: e.target.value })}
            placeholder="From Waiyaki Way, turn at the Shell station. We're on the left."
            className={`${inputClass} [field-sizing:content] max-h-48 leading-relaxed`}
          />
        </div>
      </Group>
    </>
  );
}
