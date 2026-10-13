"use client";

import { useState, useTransition } from "react";
import { ChoiceSheet } from "@/components/ui/ChoiceSheet";
import { notify } from "@/components/ui/DeskNotice";
import { pendingDotClass } from "@/components/ui/Button";
import { SettingsGroup } from "@/components/settingsUi";
import { categoriesFor } from "@/lib/structuredData";
import type { StructuredResult } from "@/app/(desk)/settings/structuredActions";

/** Typed business category (taxonomy), one tap. */
export function BusinessCategoryPicker({
  businessType,
  initial,
  canEdit,
  save,
}: {
  businessType: string;
  initial: string | null;
  canEdit: boolean;
  save: (category: string) => Promise<StructuredResult>;
}) {
  const [value, setValue] = useState(initial || "");
  const [pending, start] = useTransition();
  const options = categoriesFor(businessType).map((c) => ({ value: c.id, label: c.label }));
  if (!options.length) return null;
  return (
    <SettingsGroup title="What you sell">
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <ChoiceSheet
            title="What you sell"
            label="Business category"
            rowLabel="Category"
            value={value}
            placeholder="Choose"
            options={options}
            onChange={(next) => {
              if (!canEdit || next === value) return;
              const prev = value;
              setValue(next);
              start(async () => {
                const res = await save(next);
                if (!res.ok) setValue(prev);
                notify(res.ok ? res.message : res.error);
              });
            }}
          />
        </div>
        {pending ? (
          <span role="status" className="inline-flex pr-4">
            <span aria-hidden="true" className={pendingDotClass} />
            <span className="sr-only">Saving</span>
          </span>
        ) : null}
      </div>
    </SettingsGroup>
  );
}
