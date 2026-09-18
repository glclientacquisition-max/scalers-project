import { InboxWorkspace } from "@/components/InboxWorkspace";

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    purpose?: string;
    q?: string;
    view?: string;
    week?: string;
    day?: string;
  }>;
}) {
  const sp = await searchParams;
  return <InboxWorkspace searchParams={sp} />;
}
