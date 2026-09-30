"use client";

import { useEffect, useState } from "react";
import {
  ArchiveBoxIcon,
  ArrowUpRightIcon,
  ChatBubbleLeftEllipsisIcon,
  CheckIcon,
  EllipsisHorizontalIcon,
  InboxIcon,
  MoonIcon,
  PhoneIcon,
  SunIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { IconButton, IconButtonAnchor } from "@/components/ui/IconButton";
import { ListRow } from "@/components/ui/ListRow";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented, SegmentedControl } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonHeader, SkeletonList } from "@/components/ui/Skeleton";
import { Stamp } from "@/components/ui/Stamp";
import { Table, Tbody, Td, Th, Thead } from "@/components/ui/Table";
import { TooltipProvider } from "@/components/ui/Tooltip";

const rows = [
  { name: "Amina Hassan", when: "09:12", preview: "Wants a cleaning Thursday after 4pm. Asked for the price first.", stamp: "Return", unread: true },
  { name: "Kwame Mensah", when: "Yesterday", preview: "Hold for two at 7. Confirmed by WhatsApp.", stamp: "Done", unread: false },
  { name: "Unknown +233 24 555 0109", when: "Mon", preview: "Missed. No message left.", stamp: "Missed", unread: false },
];

const tableRows = [
  { day: "Mon", calls: 42, answered: 41, returns: 3 },
  { day: "Tue", calls: 38, answered: 38, returns: 1 },
  { day: "Wed", calls: 51, answered: 49, returns: 6 },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-t border-hairline pt-6">
      <h2 id={`${id}-h`} className="text-title text-ink">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function KitShowcase() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [density, setDensity] = useState("comfortable");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    return () => {
      if (previous) root.setAttribute("data-theme", previous);
      else root.removeAttribute("data-theme");
    };
  }, [theme]);

  return (
    <TooltipProvider>
      <div className="desk-theme">
        <div className="min-h-dvh bg-canvas text-ink">
          <div className="mx-auto max-w-desk px-4 py-4 sm:px-6 sm:py-6">
            <PageHeader
              title="Kit"
              meta="System font. Radii 6, 10, 16."
              action={
                <SegmentedControl
                  label="Theme"
                  value={theme}
                  onChange={(value) => setTheme(value as "system" | "light" | "dark")}
                  items={[
                    { value: "system", label: "Auto" },
                    { value: "light", label: "Light", icon: <SunIcon aria-hidden="true" /> },
                    { value: "dark", label: "Dark", icon: <MoonIcon aria-hidden="true" /> },
                  ]}
                />
              }
            />

            <div className="mt-6 flex flex-col gap-8">
              <Section id="type" title="Type">
                <div className="flex flex-col gap-2">
                  <p className="text-display text-ink">Display 28</p>
                  <p className="text-page text-ink">Page 22</p>
                  <p className="text-title text-ink">Title 17</p>
                  <p className="text-body text-ink">Body 15. The receptionist answers every call on the line.</p>
                  <p className="text-meta text-ink-2">Meta 13. Second-line detail, timestamps, hints.</p>
                  <p className="text-caption text-ink-3">CAPTION 11. Tabular numerals 09:12.</p>
                </div>
              </Section>

              <Section id="color" title="Color roles">
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["canvas", "bg-canvas border border-hairline"],
                    ["surface", "bg-surface border border-hairline"],
                    ["surface-2", "bg-surface-2"],
                    ["hairline", "bg-hairline"],
                    ["accent", "bg-accent"],
                    ["accent-tonal", "bg-accent-tonal"],
                    ["brand", "bg-brand"],
                    ["attention", "bg-attention"],
                    ["ok", "bg-ok"],
                    ["ink", "bg-ink"],
                    ["ink-2", "bg-ink-2"],
                    ["ink-3", "bg-ink-3"],
                  ].map(([name, cls]) => (
                    <li key={name} className="flex flex-col gap-1.5">
                      <span className={`block h-12 rounded-lg ${cls}`} aria-hidden="true" />
                      <span className="text-meta font-medium text-ink-2">{name}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section id="button" title="Button">
                <div className="flex flex-wrap items-center gap-3">
                  <Button>Save</Button>
                  <Button variant="tonal">Reply on WhatsApp</Button>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="danger" leading={<TrashIcon className="h-5 w-5" aria-hidden="true" />}>
                    Remove
                  </Button>
                  <Button size="sm">Confirm</Button>
                  <Button size="lg" trailing={<ArrowUpRightIcon className="h-5 w-5" aria-hidden="true" />}>
                    Open record
                  </Button>
                  <Button
                    pending={pending}
                    onClick={() => {
                      setPending(true);
                      window.setTimeout(() => setPending(false), 1200);
                    }}
                  >
                    Send
                  </Button>
                  <Button disabled>Disabled</Button>
                  <ButtonLink href="/dev/kit" variant="tonal" size="sm">
                    Link
                  </ButtonLink>
                </div>
                <div className="mt-3 max-w-sm">
                  <Button block>Block primary</Button>
                </div>
              </Section>

              <Section id="icon-button" title="IconButton">
                <div className="flex flex-wrap items-center gap-2">
                  <IconButton label="Call">
                    <PhoneIcon aria-hidden="true" />
                  </IconButton>
                  <IconButtonAnchor label="WhatsApp" tone="whatsapp" href="https://wa.me/233245550109">
                    <ChatBubbleLeftEllipsisIcon aria-hidden="true" />
                  </IconButtonAnchor>
                  <IconButton label="Done" tone="ok">
                    <CheckIcon aria-hidden="true" />
                  </IconButton>
                  <IconButton label="Archive" tone="accent">
                    <ArchiveBoxIcon aria-hidden="true" />
                  </IconButton>
                  <IconButton label="Delete" tone="attention">
                    <TrashIcon aria-hidden="true" />
                  </IconButton>
                  <IconButton label="Confirm" tone="primary" size="sm">
                    <CheckIcon aria-hidden="true" />
                  </IconButton>
                  <IconButton label="Sending" pending>
                    <CheckIcon aria-hidden="true" />
                  </IconButton>
                  <Menu
                    trigger={
                      <IconButton label="More">
                        <EllipsisHorizontalIcon aria-hidden="true" />
                      </IconButton>
                    }
                  >
                    <MenuItem onClick={() => undefined}>
                      <ArchiveBoxIcon aria-hidden="true" />
                      Archive
                    </MenuItem>
                    <MenuItem onClick={() => undefined}>
                      <CheckIcon aria-hidden="true" />
                      Mark done
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem tone="attention" onClick={() => undefined}>
                      <TrashIcon aria-hidden="true" />
                      Delete
                    </MenuItem>
                  </Menu>
                </div>
              </Section>

              <Section id="field" title="Field">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="kit-name" label="Business name" required hint="Shown to callers.">
                    {(props) => <Input {...props} defaultValue="Chapter One Dental" />}
                  </Field>
                  <Field id="kit-phone" label="Forward to" error="Enter a number with a country code.">
                    {(props) => <Input {...props} type="tel" defaultValue="0245550109" />}
                  </Field>
                  <Field id="kit-voice" label="Voice">
                    {(props) => (
                      <Select {...props} defaultValue="ama">
                        <option value="ama">Ama</option>
                        <option value="kojo">Kojo</option>
                      </Select>
                    )}
                  </Field>
                  <Field id="kit-greeting" label="Greeting" hint="Two lines. Grows as you type." className="sm:col-span-2">
                    {(props) => (
                      <Textarea {...props} defaultValue="Thank you for calling Chapter One Dental. How can I help?" />
                    )}
                  </Field>
                </div>
              </Section>

              <Section id="segmented" title="Segmented">
                <Segmented
                  label="Filter"
                  onSelect={setFilter}
                  items={[
                    { key: "all", label: "All", count: 128, active: filter === "all" },
                    { key: "return", label: "Return", count: 3, active: filter === "return" },
                    { key: "holds", label: "Holds", count: 12, active: filter === "holds" },
                    { key: "missed", label: "Missed", count: 2, active: filter === "missed" },
                    { key: "done", label: "Done", active: filter === "done" },
                  ]}
                />
                <div className="mt-4">
                  <SegmentedControl
                    label="Density"
                    value={density}
                    onChange={setDensity}
                    items={[
                      { value: "comfortable", label: "Comfortable" },
                      { value: "compact", label: "Compact" },
                    ]}
                  />
                </div>
              </Section>

              <Section id="stamp" title="Stamp and Avatar">
                <div className="flex flex-wrap items-center gap-4">
                  <Stamp>Done</Stamp>
                  <Stamp tone="attention">Return</Stamp>
                  <Stamp tone="ok">Confirmed</Stamp>
                  <Stamp tone="live">Live</Stamp>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Avatar name="Amina Hassan" size={32} />
                  <Avatar name="Kwame Mensah" size={40} />
                  <Avatar name="Yaa Asantewaa" size={48} />
                  <Avatar name={null} size={40} />
                </div>
              </Section>

              <Section id="list" title="ListRow">
                <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
                  {rows.map((row) => (
                    <ListRow
                      key={row.name}
                      href="/dev/kit"
                      unread={row.unread}
                      leading={<Avatar name={row.name.startsWith("Unknown") ? null : row.name} />}
                      title={row.name}
                      when={row.when}
                      preview={row.preview}
                      stamp={
                        <Stamp tone={row.stamp === "Return" ? "attention" : row.stamp === "Done" ? "ok" : "neutral"}>
                          {row.stamp}
                        </Stamp>
                      }
                      actions={
                        <>
                          <IconButtonAnchor label="Call" href="tel:+233245550109">
                            <PhoneIcon aria-hidden="true" />
                          </IconButtonAnchor>
                          <IconButtonAnchor label="WhatsApp" tone="whatsapp" href="https://wa.me/233245550109">
                            <ChatBubbleLeftEllipsisIcon aria-hidden="true" />
                          </IconButtonAnchor>
                        </>
                      }
                    />
                  ))}
                </ul>
              </Section>

              <Section id="table" title="Table">
                <Table>
                    <Thead>
                      <tr>
                        <Th>Day</Th>
                        <Th num>Calls</Th>
                        <Th num>Answered</Th>
                        <Th num>Returns</Th>
                      </tr>
                    </Thead>
                    <Tbody>
                      {tableRows.map((row) => (
                        <tr key={row.day}>
                          <Td>{row.day}</Td>
                          <Td num>{row.calls}</Td>
                          <Td num>{row.answered}</Td>
                          <Td num>{row.returns}</Td>
                        </tr>
                      ))}
                    </Tbody>
                </Table>
              </Section>

              <Section id="sheet" title="Sheet">
                <Button variant="tonal" onClick={() => setSheetOpen(true)}>
                  Open sheet
                </Button>
                <Sheet
                  open={sheetOpen}
                  onOpenChange={setSheetOpen}
                  title="Archive this call?"
                  description="It leaves the inbox. You can find it under Done."
                  footer={
                    <>
                      <Button variant="ghost" onClick={() => setSheetOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={() => setSheetOpen(false)}>Archive</Button>
                    </>
                  }
                >
                  <Field id="kit-sheet-note" label="Note" hint="Optional.">
                    {(props) => <Textarea {...props} placeholder="Why it is done" />}
                  </Field>
                </Sheet>
              </Section>

              <Section id="empty" title="Empty and Skeleton">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-hairline bg-surface">
                    <Empty
                      icon={<InboxIcon aria-hidden="true" />}
                      title="No calls yet"
                      line="Calls land here the moment the line rings."
                      action={<Button variant="tonal">Test call</Button>}
                    />
                  </div>
                  <div className="rounded-2xl border border-hairline bg-surface p-4">
                    <SkeletonHeader />
                    <div className="mt-4">
                      <SkeletonList rows={3} withActions />
                    </div>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
