"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { deskErrorClass } from "@/components/ui/deskChrome";
import { SettingsPageHeader, settingsConsoleClass, settingsPanelClass } from "@/components/settingsUi";

type Props = {
  children: ReactNode;
  businessName: string;
  heading?: string | null;
  sidebar?: ReactNode;
};

type State = { failed: boolean };

/** Keeps a Policies render error on the panel instead of the Settings crash screen. */
export class PoliciesSettingsErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("policies settings render failed", error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { businessName, heading, sidebar } = this.props;
    return (
      <PoliciesLoadErrorPanel businessName={businessName} heading={heading} sidebar={sidebar} onRetry={() => this.setState({ failed: false })} />
    );
  }
}

function PoliciesLoadErrorPanel({
  businessName,
  heading,
  sidebar,
  onRetry,
}: {
  businessName: string;
  heading?: string | null;
  sidebar?: ReactNode;
  onRetry: () => void;
}) {
  const router = useRouter();
  return (
    <div className={settingsConsoleClass}>
      {sidebar}
      <div className={settingsPanelClass}>
        <SettingsPageHeader businessName={businessName} lineLive={false} showBack title={heading} />
        <p className={deskErrorClass} role="alert">
          Could not load Policies.
        </p>
        <Button
          type="button"
          variant="tonal"
          size="sm"
          className="mt-3"
          onClick={() => {
            onRetry();
            router.refresh();
          }}
        >
          Retry
        </Button>
      </div>
    </div>
  );
}
