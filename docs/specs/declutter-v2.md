<cursor_untrusted_data_1337 source="ReadCanvas">

Canvas "Desk + Admin v2: declutter and reporting dashboard" (https://cursor.com/canvas/store-0678ce0c-7e80-4b32-b90c-c0e5287e9dc9/9278d89a-ca83-4728-92d3-d5ee87398356):

import { Page, Section, Text, BulletList, NumberedList, Table, Callout, TableOfContents, LinkCards, useGrokTheme } from "grok/canvas";

const C = {
  bg: "#F3F6FA", card: "#FFFFFF", line: "#E2E8F0", ink: "#0F172A", ink2: "#4A5B73", ink3: "#94A3B8",
  blue: "#005CCC", blueBg: "#E3EEFF", green: "#146C34", greenBg: "#E8F5EE", amber: "#8A5A00", amberBg: "#FFF5D6", red: "#B42318", redBg: "#FEF3F2",
};

function Wire({ lines }: { lines: string }) {
  const t = useGrokTheme();
  return (
    <pre style={{ fontFamily: t.font.mono, fontSize: 12, lineHeight: "16px", color: t.text.primary, background: t.bg.subtle, border: `1px solid ${t.border.default}`, borderRadius: 12, padding: 12, margin: 0, maxWidth: 380, overflowX: "auto", whiteSpace: "pre" }}>
      {lines}
    </pre>
  );
}

function Box({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={16} fill={C.card} stroke={C.line} />;
}

function Chip({ x, y, label, fg, bg }: { x: number; y: number; label: string; fg: string; bg: string }) {
  const w = 22 + label.length * 6.4;
  return (
    <g>
      <rect x={x} y={y} width={w} height={22} rx={11} fill={bg} />
      <circle cx={x + 11} cy={y + 11} r={4} fill={fg} />
      <text x={x + 19} y={y + 15} fontSize={11} fontWeight={600} fill={fg}>{label}</text>
    </g>
  );
}

function T({ x, y, s = 13, w = 400, c = C.ink, children, mono }: { x: number; y: number; s?: number; w?: number; c?: string; children: string; mono?: boolean }) {
  return <text x={x} y={y} fontSize={s} fontWeight={w} fill={c} fontFamily={mono ? "ui-monospace, monospace" : undefined}>{children}</text>;
}

function CallerCard({ y, initials, chip, fg, bg, line }: { y: number; initials: string; chip: string; fg: string; bg: string; line: string }) {
  return (
    <g>
      <Box x={16} y={y} w={358} h={76} />
      <circle cx={46} cy={y + 38} r={18} fill={C.blueBg} />
      <T x={36} y={y + 43} s={12} w={600} c={C.blue}>{initials}</T>
      <T x={74} y={y + 28} s={14} w={600}>Caller name</T>
      <T x={300} y={y + 28} s={11} c={C.ink2}>hh:mm</T>
      <Chip x={74} y={y + 38} label={chip} fg={fg} bg={bg} />
      <T x={74 + 30 + chip.length * 6.4} y={y + 53} s={11} c={C.ink2}>{line}</T>
      <circle cx={344} cy={y + 50} r={16} fill={C.card} stroke={C.line} />
      <path d={`M${338} ${y + 50} h12 M${344} ${y + 44} v12`} stroke={C.ink2} strokeWidth={0} />
      <path d={`M${337} ${y + 46} l4 -3 l3 6 l-2 2 a8 8 0 0 0 4 4 l2 -2 l6 3 l-3 4 a12 12 0 0 1 -14 -14 z`} fill={C.ink2} transform={`translate(1 1)`} />
    </g>
  );
}

function DeskMock() {
  const ringR = 26;
  const circ = 2 * Math.PI * ringR;
  return (
    <svg width="100%" viewBox="0 0 390 880" role="img" aria-label="Desk Overview v2 layout mock" style={{ maxWidth: 390, display: "block" }}>
      <rect x={0} y={0} width={390} height={880} rx={24} fill={C.bg} />
      <rect x={16} y={18} width={24} height={24} rx={6} fill={C.blue} />
      <T x={50} y={36} s={18} w={600}>Overview</T>
      <T x={300} y={36} s={12} c={C.ink2}>Sat 31 Oct</T>
      <Box x={16} y={58} w={358} h={196} />
      <Chip x={32} y={74} label="Live" fg={C.green} bg={C.greenBg} />
      <T x={32} y={122} s={15} w={500} mono>+254 7xx xxx xxx</T>
      {["Calls", "Need you", "Visits"].map((l, i) => (
        <g key={l}>
          <rect x={32 + i * 112} y={136} width={102} height={52} rx={12} fill={C.bg} />
          <T x={44 + i * 112} y={160} s={20} w={700}>n</T>
          <T x={44 + i * 112} y={178} s={11} c={C.ink2}>{l}</T>
        </g>
      ))}
      <rect x={32} y={200} width={326} height={44} rx={12} fill={C.blue} />
      <T x={140} y={227} s={14} w={600} c="#FFFFFF">Return n calls</T>
      <T x={16} y={284} s={15} w={600}>Callers</T>
      <T x={318} y={284} s={12} w={600} c={C.blue}>See all</T>
      <CallerCard y={296} initials="AB" chip="Call back" fg={C.amber} bg={C.amberBg} line="Asked about price" />
      <CallerCard y={380} initials="CD" chip="Visit" fg={C.blue} bg={C.blueBg} line="Wants Tue morning" />
      <CallerCard y={464} initials="EF" chip="Answered" fg={C.green} bg={C.greenBg} line="Opening hours" />
      <Box x={16} y={556} w={173} h={150} />
      <circle cx={64} cy={612} r={ringR} fill="none" stroke={C.line} strokeWidth={8} />
      <circle cx={64} cy={612} r={ringR} fill="none" stroke={C.blue} strokeWidth={8} strokeDasharray={`${circ * 0.62} ${circ}`} transform="rotate(-90 64 612)" strokeLinecap="round" />
      <T x={32} y={664} s={16} w={700}>n min left</T>
      <T x={32} y={684} s={11} c={C.ink2}>Package · ends dd Mmm</T>
      <Box x={201} y={556} w={173} h={150} />
      <T x={215} y={580} s={12} w={600}>Top asks · 30d</T>
      {[0.9, 0.6, 0.35].map((f, i) => (
        <g key={i}>
          <rect x={215} y={596 + i * 34} width={145 * f} height={10} rx={5} fill={C.blue} opacity={1 - i * 0.25} />
          <T x={215} y={622 + i * 34} s={10} c={C.ink2}>{["Topic", "Topic", "Topic"][i] + " · n calls"}</T>
        </g>
      ))}
      <Box x={16} y={718} w={358} h={56} />
      <Chip x={32} y={735} label="Callers hear" fg={C.blue} bg={C.blueBg} />
      <T x={150} y={750} s={12} c={C.ink2}>Only if an update is on</T>
      <rect x={0} y={800} width={390} height={80} rx={0} fill="#FFFFFF" opacity={0.78} />
      <line x1={0} y1={800} x2={390} y2={800} stroke={C.line} />
      {["Overview", "Inbox", "Contacts", "Usage", "Settings"].map((l, i) => (
        <T key={l} x={14 + i * 76} y={850} s={11} w={i === 0 ? 600 : 400} c={i === 0 ? C.blue : C.ink2}>{l}</T>
      ))}
    </svg>
  );
}

function AdminMock() {
  const spark = [6, 9, 7, 12, 10, 14, 11, 15, 13, 16];
  const pts = spark.map((v, i) => `${200 + i * 16},${232 - v * 3}`).join(" ");
  return (
    <svg width="100%" viewBox="0 0 390 960" role="img" aria-label="Admin Overview v2 dashboard layout mock" style={{ maxWidth: 390, display: "block" }}>
      <rect x={0} y={0} width={390} height={960} rx={24} fill={C.bg} />
      <T x={16} y={38} s={18} w={600}>Overview</T>
      <rect x={262} y={20} width={112} height={30} rx={10} fill={C.card} stroke={C.line} />
      <rect x={264} y={22} width={54} height={26} rx={8} fill={C.blueBg} />
      <T x={279} y={40} s={12} w={600} c={C.blue}>7d</T>
      <T x={333} y={40} s={12} c={C.ink2}>30d</T>
      <Box x={16} y={62} w={358} h={44} />
      {["Speech", "Reason", "Phone", "Money", "Nums", "Beta"].map((l, i) => (
        <g key={l}>
          <circle cx={34 + i * 58} cy={84} r={5} fill={i === 3 ? C.amber : C.green} />
          <T x={42 + i * 58} y={88} s={10} c={C.ink2}>{l}</T>
        </g>
      ))}
      <Box x={16} y={118} w={358} h={150} />
      <T x={32} y={142} s={12} w={600} c={C.ink2}>Needs attention</T>
      <T x={32} y={176} s={28} w={700}>n</T>
      <rect x={32} y={188} width={326} height={10} rx={5} fill={C.line} />
      <rect x={32} y={188} width={150} height={10} rx={5} fill={C.red} />
      <rect x={182} y={188} width={110} height={10} fill={C.amber} />
      {["Overdue · n", "Near limit · n", "No number · n"].map((l, i) => (
        <T key={l} x={32 + i * 110} y={222} s={11} c={C.ink2}>{l}</T>
      ))}
      <T x={32} y={252} s={12} w={600} c={C.blue}>Open queue</T>
      <Box x={16} y={280} w={358} h={150} />
      <T x={32} y={304} s={12} w={600} c={C.ink2}>Calls · 7 days</T>
      <T x={32} y={338} s={28} w={700}>n</T>
      <T x={32} y={358} s={11} c={C.ink2}>vs prior 7d, only if real</T>
      <polyline points={pts} fill="none" stroke={C.ink2} strokeWidth={2} transform="translate(0 100)" />
      <rect x={32} y={378} width={326} height={10} rx={5} fill={C.line} />
      <rect x={32} y={378} width={210} height={10} rx={5} fill={C.blue} />
      <rect x={242} y={378} width={60} height={10} fill={C.amber} />
      <T x={32} y={408} s={11} c={C.ink2}>Assistant · Handed off · Missed</T>
      <Box x={16} y={442} w={173} h={170} />
      <T x={32} y={466} s={12} w={600} c={C.ink2}>Money · Oct</T>
      <T x={32} y={498} s={20} w={700}>KSh n</T>
      <T x={32} y={516} s={11} c={C.ink2}>collected of KSh n</T>
      <rect x={32} y={528} width={141} height={8} rx={4} fill={C.line} />
      <rect x={32} y={528} width={70} height={8} rx={4} fill={C.blue} />
      <Chip x={32} y={550} label="n overdue" fg={C.red} bg={C.redBg} />
      <Box x={201} y={442} w={173} h={170} />
      <T x={217} y={466} s={12} w={600} c={C.ink2}>Businesses</T>
      <T x={217} y={498} s={20} w={700}>n live</T>
      <rect x={217} y={512} width={141} height={8} rx={4} fill={C.line} />
      <rect x={217} y={512} width={110} height={8} rx={4} fill={C.green} />
      <rect x={327} y={512} width={14} height={8} fill={C.amber} />
      <T x={217} y={538} s={11} c={C.ink2}>n waiting · n paused</T>
      <T x={217} y={556} s={11} c={C.ink2}>n free numbers</T>
      <Box x={16} y={624} w={358} h={150} />
      <T x={32} y={648} s={12} w={600} c={C.ink2}>Quality · 7 days</T>
      <T x={32} y={680} s={20} w={700}>n dropping</T>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <T x={32} y={710 + i * 22} s={12}>Business</T>
          <Chip x={300} y={696 + i * 22} label="n" fg={i === 0 ? C.red : C.amber} bg={i === 0 ? C.redBg : C.amberBg} />
        </g>
      ))}
      <rect x={0} y={880} width={390} height={80} fill="#FFFFFF" opacity={0.78} />
      <line x1={0} y1={880} x2={390} y2={880} stroke={C.line} />
      {["Overview", "Businesses", "Billing", "Numbers", "More"].map((l, i) => (
        <T key={l} x={10 + i * 78} y={930} s={11} w={i === 0 ? 600 : 400} c={i === 0 ? C.blue : C.ink2}>{l}</T>
      ))}
    </svg>
  );
}

const adminDesk = `1440: 12-col grid, 3 cards per row
┌ Health strip (full width, 1 line) ─────────┐
┌ Needs attention ┐┌ Calls (chart) ────────┐
│ n + kind bar    ││ n · weekly bars · split │
└─────────────────┘└─────────────────────────┘
┌ Money ─────────┐┌ Businesses ──┐┌ Quality ─────┐
│ collected bar  ││ status bar  ││ worst 3     │
└────────────────┘└─────────────┘└─────────────┘
hover a bar: day + value tooltip
click a card: its page, same range`;

export default function App() {
  return (
    <Page
      title="Desk + Admin v2: declutter and reporting dashboard"
      summary="Built from Alvin's review of the 31 Oct redesign shots (#1054–#1068). The Desk Overview drops from 10 blocks to 5, with caller cards in place of text. Admin's first screen becomes a reporting dashboard of 5 cards plus a health strip, and Needs attention becomes one of those cards. Every number comes from a field or loader that exists today. Planning only: no code, PRs or contact."
      width="column"
    >
      <TableOfContents
        items={[
          { label: "Verdict in one minute" },
          { label: "The laws, as rules we can test" },
          { label: "What top-tier products do" },
          { label: "Shot-by-shot audit" },
          { label: "Admin Overview v2: reporting dashboard" },
          { label: "Desk Overview v2: caller cards" },
          { label: "Motion spec" },
          { label: "Admin pages: what to copy" },
          { label: "Ticket deltas on #1054–#1068" },
          { label: "Questions for Alvin" },
          { label: "Sources" },
        ]}
      />

      <Section heading="Verdict in one minute">
        <BulletList
          items={[
            "Alvin is right. The stack fixed status visuals but kept the old page structure. The Desk Overview has 10 stacked blocks (about 2.4 phone screens), and Admin opens on a 25-row list of red pills.",
            "The clutter is mostly duplicated facts and inline tools. Examples: the Work header repeats the row counts, the minutes card says 0 left four times, three always-on capability rows carry identical Live pills, and the whole Updates composer sits inside Overview.",
            "Choice overload is real: Needs attention shows 6 filter chips wrapping onto 3 lines, Numbers shows 5, and the business sheet has 6 tabs that overflow the screen.",
            "Fix: Desk Overview becomes 5 blocks (Line card, Callers, Minutes, Top asks, Update status). Admin Overview becomes 5 tappable cards under one 7d/30d switch, with the full queue one tap away.",
            "Ticket plan: 4 new PRs, rework of #1060, and small amendments to 10 PRs. #1054 and #1068 stay as they are.",
          ]}
        />
      </Section>

      <Section heading="The laws, as rules we can test">
        <Table
          columns={["Law", "What the research says", "Scalers rule (pass/fail)"]}
          rows={[
            ["Hick–Hyman", "Decision time grows with the number of equally likely choices. NN/g: fewer options make choosing easier. CHI 2020 review: the bigger win is making the likely choice stand out, not just cutting options.", "No more than 5 visible choices per view. One filled blue button per screen. The most likely action comes first and is largest."],
            ["Jakob's law", "Users expect your product to work like the ones they already use. Breaking the pattern costs them.", "Use known shapes: chat-list rows for callers (WhatsApp, M-PESA), a range switch at top right (Stripe), list → sheet detail, and a 5-tab bottom bar."],
            ["Fitts's law", "Bigger, closer targets are faster to hit. NN/g sets a 1×1 cm touch minimum; Android asks for 48dp with 8dp gaps.", "The whole card is the target. Actions are at least 48dp. The main button sits low, in thumb reach. No 20px text links as the only way in."],
            ["Miller / Cowan", "Miller's 7±2 was a rough estimate. Cowan finds about 4 chunks is the real working-memory limit.", "The first phone screen holds no more than 4–5 chunks. A card holds 1 headline number plus no more than 3 supporting facts."],
            ["Progressive disclosure", "Show the frequent things first and the rest on request. Bottom sheets keep context.", "Overview shows summaries only. Detail, forms and settings open in a sheet or their own page."],
            ["Motion timing", "NN/g: most UI motion runs 100–500 ms, around 100 ms for feedback, and should respect reduced motion.", "Our lock is tighter: 120–200 ms, transform and opacity only, nothing loops."],
          ]}
        />
      </Section>

      <Section heading="What top-tier products do">
        <Table
          columns={["Product", "Pattern (from their docs)", "What we copy"]}
          rows={[
            ["Stripe Dashboard Home", "Widgets on Home, one date range, granularity and a comparison period. Important notifications such as disputes sit on Home.", "One range switch drives every card. Comparisons only from real prior data. Attention items appear as a card."],
            ["Shopify Home (after 2023)", "Four metrics with a chart preview (tap to expand, View report). Order tasks are grouped with counts. Insight cards can be dismissed and are capped per day.", "Group Needs attention by kind with counts. Each card has a full report one tap away."],
            ["Linear Dashboards", "Purpose-built and few. Ops dashboards flag the unexpected. Pair each number with trend context. Clicking a chart opens the underlying issues.", "One Admin dashboard with an ops purpose. Every number has a trend or comparison. Every segment taps through to its rows."],
            ["Vercel Observability", "An overview page aggregates key metrics, and each metric opens its dedicated dashboard in one click.", "Each card is a doorway: Calls → Insights, Money → Billing, Quality → Quality."],
            ["PostHog Dashboards", "A shared dashboard date range that a tile can override.", "The Money card is pinned to the billing month and labelled so, while other cards follow 7d/30d."],
            ["Intercom Overview report", "Volume split by AI agent, teammate and no reply. Side-by-side AI and human performance. Drill-in on every chart.", "Calls card bar: assistant handled, handed off, missed, with drill-in to Insights."],
            ["Mercury", "One total on Home, toggled between a graph and a breakdown table.", "Money and usage cards: one headline number with a chart/table toggle on the detail page."],
            ["Ramp reporting", "Real-time spend views, drill into transactions, saved dashboards.", "Money card drills straight into the invoices behind each bar."],
            ["Aircall Workspace", "Calls view with categories (Missed, Callback requests, All). Click a call to see details, notes and AI insights. Call timeline for routing.", "Desk caller cards sorted by need, opening a sheet with the summary, outcome and actions."],
            ["Dialpad", "AI Recap per call from Recents and the Inbox Calls tab.", "The caller card's one line is the existing call headline. It's never newly generated text."],
          ]}
        />
      </Section>

      <Section heading="Shot-by-shot audit">
        <Text>Shots read: fixcheck/home-long_390w (signed-in staging), 1058 attention-live, 1062 businesses-live, 1063 business-sheet-live, 1065 billing-home-live, 1066 numbers-live, 1067 quality-live and insights-live, and 1059 admin-usage. All are 390w glass.</Text>
        <Table
          columns={["Screen", "Clutter and law broken", "Cut or merge"]}
          rows={[
            ["Desk Overview (fixcheck)", "10 blocks in about 2.4 screens (Miller). There's no main button on the first screen (Fitts, Hick). Calls today 0 takes a whole row. The Work header text repeats the row counts. The rows read “63oldest” and “22 to confi…”.", "Merge Calls, Need you and Visits into 3 tiles inside the Line card with one blue button. Drop the Work header sentence. Fix the spacing bug."],
            ["Desk: What callers told us", "6 text rows, 3 visible plus See all 6. It reads as a paragraph list, not a chart.", "Replace with a half-width Top asks card: 3 bars plus n calls each."],
            ["Desk: Today's calls", "“No calls yet today.” sits next to “The list is cut off, so this is not every call.”, which contradict each other. There are no callers as cards.", "Replace with caller cards. When today is empty, show the latest 3 callers under a day label."],
            ["Desk: What your Business Assistant can do", "3 rows with truncated sample replies and 3 identical green Live pills. A status that's always fine is noise (GOV.UK).", "Move to Settings › Assistant. Overview shows one amber card only when a capability is off."],
            ["Desk: settings nudge", "“Add what's missing, then save.” appears with Open settings and Dismiss, and doesn't say what's missing.", "Fold into Get ready (n of m bar), shown only while setup is incomplete."],
            ["Desk: minutes card", "In beta, a red “No minutes left” appears while the copy says calls keep working, which is a false alarm. 0 left is said four times.", "Ring, one number and one line. Beta shows a blue Beta pill, never red."],
            ["Desk: Updates", "A full composer on Overview: input, Post, 2 audience chips and 3 duration chips, about 7 choices (Hick). Also unusual on a home screen (Jakob).", "Overview shows a one-line status (“Callers hear: … until tonight” or nothing). Posting opens a sheet."],
            ["Admin Needs attention (1058)", "An orphan line “Nothing was reported.” sits above the heading. 6 chips wrap onto 3 lines, including Missed demand 0 (Hick). 25 identical red pills. No total KSh. It is a queue, not an overview.", "Becomes a card on the new Overview, and the queue moves to its own page. Hide zero chips, show at most 4 plus More, and add a total owed."],
            ["Businesses (1062)", "Defaults to Waiting for a number (2) instead of Live (20), against list conventions (Jakob). 4 tabs wrap. “None yet” is unclear.", "Default to All, sorted by attention first. Use one segmented row of 4. Drop “None yet”."],
            ["Business sheet (1063)", "6 tabs overflow (“His…”). The Summary tab repeats the Usage and Money tabs as key–value text. An uppercase SUMMARY eyebrow repeats the tab name. Archive sits in the footer next to Unlock.", "Visual header (meter, owed, quality sparkline) and 4 tabs. Archive goes into the … menu with a ConfirmSheet."],
            ["Billing home (1065)", "“October 2026 so far” wraps onto 3 lines. Navigation mixes 2 tonal buttons and a text link. 4 “Open” links and 4 “As of 12:00” stamps. Outstanding = Overdue, the same KSh shown twice. The bars have no numbers and the aging bar has no legend.", "A Segmented tab row, one as-of stamp in the page footer, whole cards tappable. Merge Outstanding and Overdue when they're equal. Label each bar segment."],
            ["Numbers (1066)", "5 chips wrap. Every row repeats an “Available” pill under the Available filter. Each row has an empty “—” line.", "4 segments (Free, Assigned, On hold, All). Hide a pill that matches the filter, and drop the dash line."],
            ["Quality (1067)", "Mostly good: sorted, one score chip, 2 ranges. No trend in the row.", "Add a 7-point sparkline per row. Keep the rest."],
            ["Insights (1067)", "A 9-row, 4-column table with “<10” cells. Two navigation buttons sit in the content. A paragraph explains what missed means.", "Headline plus split bar plus horizontal bars per reason. Definitions go in an info sheet. Drop the in-content nav buttons."],
            ["Business usage (1059)", "Two statuses for one fact: a red “126% used” and an amber “132 min over”. The Invoices and Calls buttons split the headline from its meter. A 3-line footnote under the chart.", "One amber Over pill. Buttons move below the chart. The footnote goes in an info tap."],
          ]}
        />
      </Section>

      <Section heading="Admin Overview v2: reporting dashboard">
        <Text>Route `/admin` becomes the dashboard and the queue moves to `/admin/attention`. The phone order is Health, Needs attention, Calls, Money and Businesses side by side, then Quality. That's 5 cards and a strip, each one tap from its page.</Text>
        <AdminMock />
        <Text>Layout mock with placeholder values (n), not data.</Text>
        <Table
          columns={["Card", "Real source (exists today)", "Visual", "Tap / interaction"]}
          rows={[
            ["Health strip", "`readPlatformOps().signals` (6 kinds, active, critical)", "One line of 6 dots and words. “All clear” when nothing is active. Replaces “Nothing was reported.”", "Tap a dot to open the signal sheet (from #1058)"],
            ["Needs attention", "`buildAttention` + `attentionCounts`; owed from `loadOverdueForAttention`", "Total n, a stacked bar by kind, the top 3 kinds with counts, total KSh owed", "Tap a kind to open `/admin/attention?view=kind`"],
            ["Calls (7d/30d)", "`loadInsightFacts(days)`: `outcomeCounts`, weekly `WeekCount` (calls, missed)", "Reviewed calls n, a weekly sparkline, a split bar (assistant / handed off / missed)", "Tap to open Insights with `?days=`. Hover (1440) or press-and-hold (phone) shows week + value"],
            ["Money (billing month)", "`loadInvoicesV2` totals, as on Billing home", "Collected of billed bar, an overdue pill with KSh and count", "Tap to open Billing home. Labelled with the month and ignores 7d/30d (PostHog tile override)"],
            ["Businesses", "`getAdminOverview`: activeBusinesses, waitingForNumber, withoutPackage, availableDids", "Live count, a status bar, waiting and paused, free numbers", "Tap a segment to open the filtered Businesses list or Numbers"],
            ["Quality (7d/30d)", "`listBusinessQuality(range)` (`parseQualityRange`: 7d or 30d only)", "n dropping, the worst 3 with score chips", "Tap a row to open that business's quality sheet"],
          ]}
        />
        <Wire lines={adminDesk} />
        <NumberedList
          items={[
            "Range switch: 7d and 30d only, because both Insights and Quality support them. Insights also has 90d, but adding it to the global switch would break Quality.",
            "Comparison text (“vs prior 7d”) appears only when a second `loadInsightFacts(days * 2)` read returns prior-period rows. Otherwise it's omitted, never zero-filled.",
            "Each card has its own state trio (skeleton, empty with a next step, error with Retry) so one failed loader never blanks the page. One as-of stamp sits in the page footer.",
            "No glass on cards. Cards are solid white with a 1px border and no shadow stacks. The glow stays behind the chrome only.",
          ]}
        />
      </Section>

      <Section heading="Desk Overview v2: caller cards">
        <DeskMock />
        <Text>Layout mock with placeholder values (n, Caller name), not data. 5 blocks: Line card, Callers, Minutes, Top asks, Update status.</Text>
        <Table
          columns={["Block", "Real fields", "Rules"]}
          rows={[
            ["Line card (primary)", "`resolveLineStatus`, `sautikit_virtual_number`; calls since `nairobiDayStartIso()`; `summarizeInboxWork` (toReturn, toConfirm)", "3 count tiles (Calls, Need you, Visits), each tappable. One blue button from the existing CTA logic. Not live: the tiles hide and the button becomes Train or Test line."],
            ["Callers (cards)", "`InboxItem`: callerName or callerPhone, createdAt, purpose (job, hold, human, missed, answered), headline, needsYou, urgent, unread, redials", "Up to 3 cards, needs-you first, then newest. Each card shows initials, name, time, a purpose chip, the headline (1 line) and a 48dp WhatsApp or Call button. Tap opens the call sheet. See all goes to Inbox."],
            ["Callers: empty today", "Same items, latest 3 before today", "Label “Latest” plus the day. No “list is cut off” line."],
            ["Minutes (half card)", "`OwnerBillingView`: minutesLeft, minutesIncluded, mode, periodEndLabel, lowNotice, minutesOverLabel", "Ring plus one number plus one line. Beta = blue Beta pill. Low = amber. Over = amber with KSh. Red only for a hard limit reached."],
            ["Top asks (half card)", "`loadCallInsights` (30 days, MIN_CALLS 5)", "3 bars with n calls each. Fewer than 5 calls shows “After 5 calls”. Tap opens the full insights."],
            ["Update status (one line)", "`daily_bulletin` active row", "Shows only when an update is on. Posting moves to a sheet opened from this row or Settings."],
            ["Moved off Overview", "CapabilityGatesPanel, HomeReviewSettingsNudge, DailyBulletin composer", "To Settings › Assistant, Get ready, and a sheet. A gate that's off returns as one amber card."],
          ]}
        />
        <Wire lines={`Caller card anatomy (358 × 76)
┌───────────────────────────┐
│ (AB) Caller name   10:40 │
│      (▲ Call back) price │
│                    [ ☎ ]│
└───────────────────────────┘
chips: Call back ▲ amber · Visit □ blue
Hold ○ blue · Answered ✓ green
Missed ✕ red · x2 redial badge
unread = bold name, no dot spam`} />
      </Section>

      <Section heading="Motion spec">
        <Table
          columns={["Moment", "Motion", "Duration"]}
          rows={[
            ["Cards enter (first paint)", "opacity 0→1, translateY 8px→0, staggered 30 ms, at most 5 items", "160 ms ease-out"],
            ["New caller arrives (LivePing)", "The new card slides in from translateY −8px with opacity; cards below shift by transform", "160 ms"],
            ["Press on a card or button", "scale 0.98 then back", "120 ms"],
            ["Minutes ring and bars", "Drawn at their final value; the card fades and scales 0.96→1. No stroke animation, which isn't transform or opacity.", "160 ms"],
            ["Range switch 7d ↔ 30d", "Card values cross-fade (opacity); the segmented thumb moves by translateX", "120 ms"],
            ["Sheet open and close", "translateY 100%→0 with scrim opacity", "200 ms (down from 240)"],
            ["Reduced motion or Reduce effects", "Everything appears instantly. No count-up numbers, loops or pulses anywhere.", "0 ms"],
          ]}
        />
      </Section>

      <Section heading="Admin pages: what to copy">
        <Table
          columns={["Page", "Copy from", "How"]}
          rows={[
            ["Overview", "Stripe Home, Vercel Observability, Linear Dashboards", "5 cards, one range, tap-through, comparison only if real"],
            ["Needs attention (queue)", "Shopify order tasks, Aircall call categories", "Grouped by kind with counts. Each group shows its top 3 with View all. Rows swipe or tap to act."],
            ["Businesses + sheet", "Stripe Customers list and detail", "Search plus 4 segments. Sheet header = status, meter, owed, quality trend. 4 tabs."],
            ["Business usage", "Vercel Usage, Mercury graph/table toggle", "Headline meter, daily bars, a table toggle in place of the 3-line footnote"],
            ["Billing home and lists", "Stripe Billing, Ramp drill-in", "KPI cards, labelled bars, tap a bar segment to filter invoices"],
            ["Numbers", "Mercury balance breakdown (one total, then parts)", "Pool bar with counts on the segments, 4 segments, waiting chip"],
            ["Quality", "Intercom CX score with reasons and drill-in", "Score chip plus sparkline plus top failure reason. Drill into the worst call."],
            ["Insights", "Intercom Overview volume split", "Assistant / handed off / missed bar, then reason bars, then by business"],
            ["Settings, Security, Voices, Audit", "Android Settings grouped lists (Jakob)", "Grouped rows with a value on the right, one pill where state matters. No charts."],
          ]}
        />
      </Section>

      <Section heading="Ticket deltas on #1054–#1068">
        <Table
          columns={["Rank", "PR", "Delta", "Size"]}
          rows={[
            ["1", "New N1", "Desk Overview declutter: move CapabilityGatesPanel to Settings (amber card only when a gate is off), fold the review nudge into Get ready, swap the Updates composer for a status line plus sheet.", "M"],
            ["2", "#1060 rework", "Today's calls list becomes caller cards (InboxItem). Latest-3 fallback. Remove the “cut off” line.", "M"],
            ["3", "#1057 amend", "Line card gets 3 count tiles plus the one blue button. Remove the separate Calls today row.", "S"],
            ["4", "#1064 amend", "Work rows fold into the Line card tiles. Next to return becomes the first caller card. Fix the “63oldest” spacing.", "S"],
            ["5", "New N2", "Admin Overview dashboard at `/admin`: 5 cards plus the 7d/30d switch. The queue moves to `/admin/attention`.", "L"],
            ["6", "#1058 amend", "HealthStrip becomes a one-line dot strip with “All clear” (no orphan text), shown inside N2. Zero-count chips hidden; at most 4 chips plus More.", "S"],
            ["7", "#1059 amend", "Beta never shows red, and the copy drops to 2 lines. Admin usage: one Over pill, buttons below the chart, footnote in an info tap.", "S"],
            ["8", "#1063 amend", "Sheet header becomes visual. Tabs go from 6 to 4. The Summary key–value duplicates go. Archive moves into … with a ConfirmSheet.", "M"],
            ["9", "#1061 + #1065 amend", "Segmented Billing tabs, whole-card tap, one as-of per page, merge Outstanding and Overdue when equal, labelled bar segments, aging legend with KSh.", "S"],
            ["10", "#1062 + #1066 amend", "Businesses defaults to All. 4 segments on both pages. Hide pills that match the filter. Drop “None yet” and “—”.", "S"],
            ["11", "New N3", "Motion tokens: --motion-press 120, --motion-enter 160, --motion-sheet 200; stagger helper; reduced-motion zero.", "S"],
            ["12", "#1067 amend", "Insights table becomes bars with a headline. Definitions go in an info sheet. Remove the in-content nav buttons. Quality rows get a sparkline.", "M"],
            ["13", "New N4", "Calls card loader: weekly counts and the outcome split from `loadInsightFacts`; prior period only when rows exist.", "S"],
            ["14", "#1056 amend", "Pill rule: no pill when the state is the default (always Live or Active). Pills mark exceptions.", "S"],
            ["—", "#1054, #1068", "No change (glass chrome and sunlight contrast are fine).", "—"],
          ]}
        />
        <Text>Each PR goes to staging with 360/390/1440 shots and passes the antislop-dashboard checklist. Each must have no more than 5 visible choices per view. Merges wait for Alvin's own GO.</Text>
      </Section>

      <Section heading="Questions for Alvin">
        <NumberedList
          items={[
            "Admin opens on the new dashboard, with Needs attention as a card and a separate queue page. OK?",
            "Move the Updates composer off Desk Overview into a sheet, keeping only a one-line status?",
            "Move “What your Business Assistant can do” to Settings, showing it on Overview only when something is off?",
            "Caller card quick action: WhatsApp, Call, or both? Both makes 2 targets per card.",
            "Is 7d/30d enough for the Admin range, or should Quality learn 90d so the switch can offer it?",
            "The Admin Calls card counts reviewed calls (`call_facts`), not every call. Fine for v2, or do you want a raw call count query?",
          ]}
        />
        <Callout tone="info">Read-only review of local shots and the stack branches (cursor/v1…v13-bd1f, glass-glow-effects-6a7b). Nothing was built, pushed or sent.</Callout>
      </Section>

      <Section heading="Sources">
        <LinkCards
          links={[
            { title: "Hick's Law: designing long menu lists", site: "NN/g", href: "https://www.nngroup.com/videos/hicks-law-long-menus/" },
            { title: "Simplicity wins over abundance of choice", site: "NN/g", href: "https://www.nngroup.com/articles/simplicity-vs-choice/" },
            { title: "How relevant is Hick's law for HCI? (CHI 2020)", site: "ACM", href: "https://dl.acm.org/doi/10.1145/3313831.3376878" },
            { title: "Jakob's Law of the Internet User Experience", site: "Jakob Nielsen", href: "https://jakobnielsenphd.substack.com/p/jakobs-law" },
            { title: "Jakob's Law (video)", site: "NN/g", href: "https://www.nngroup.com/videos/jakobs-law-internet-ux/" },
            { title: "Fitts's law and its applications in UX", site: "NN/g", href: "https://www.nngroup.com/articles/fitts-law/" },
            { title: "Touch targets on touchscreens", site: "NN/g", href: "https://www.nngroup.com/articles/touch-target-size/" },
            { title: "Touch target size", site: "Android Accessibility", href: "https://support.google.com/accessibility/android/answer/7101858" },
            { title: "The magical number seven (Miller 1956)", site: "Psychological Review", href: "https://doi.org/10.1037/h0043158" },
            { title: "The magical number 4 (Cowan 2001)", site: "Behavioral and Brain Sciences", href: "https://doi.org/10.1017/s0140525x01003922" },
            { title: "Progressive disclosure", site: "NN/g", href: "https://www.nngroup.com/articles/progressive-disclosure/" },
            { title: "Bottom sheets", site: "NN/g", href: "https://www.nngroup.com/articles/bottom-sheet/" },
            { title: "Animation duration and motion", site: "NN/g", href: "https://www.nngroup.com/articles/animation-duration/" },
            { title: "Web Dashboard basics", site: "Stripe", href: "https://docs.stripe.com/dashboard/basics" },
            { title: "Dashboard home page charts", site: "Stripe Support", href: "https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights" },
            { title: "Shopify Home page", site: "Shopify Help", href: "https://help.shopify.com/en/manual/shopify-admin/shopify-home" },
            { title: "Customize metrics on Home (2023)", site: "Shopify Changelog", href: "https://changelog.shopify.com/posts/customize-the-metrics-displayed-in-shopify" },
            { title: "Custom dates for metrics on Home", site: "Shopify Changelog", href: "https://changelog.shopify.com/posts/select-custom-dates-for-metrics-on-home" },
            { title: "Best practices for Linear Dashboards", site: "Linear", href: "https://linear.app/now/dashboards-best-practices" },
            { title: "Dashboards", site: "Linear Docs", href: "https://linear.app/docs/dashboards" },
            { title: "Overview page in Observability", site: "Vercel", href: "https://vercel.com/changelog/overview-page-in-observability" },
            { title: "Dashboards", site: "PostHog Docs", href: "https://posthog.com/docs/product-analytics/dashboards" },
            { title: "Understanding your Mercury balances", site: "Mercury", href: "https://support.mercury.com/hc/en-us/articles/28767842120852-Understanding-your-Mercury-balances" },
            { title: "Real-time reporting", site: "Ramp", href: "https://ramp.com/reporting" },
            { title: "Holistic overview report", site: "Intercom Help", href: "https://www.intercom.com/help/en/articles/3008200-holistic-overview-report" },
            { title: "Conversations, Messages and Calls views", site: "Aircall Help", href: "https://support.aircall.io/en-gb/articles/21534390904093" },
            { title: "Analytics: Call Timeline", site: "Aircall Help", href: "https://support.aircall.io/en-gb/articles/16582448402077" },
            { title: "AI Recaps", site: "Dialpad Help", href: "https://help.dialpad.com/hc/en-us/articles/55028030876187-AI-Recaps" },
            { title: "antislop-dashboard skill", site: "muris11/anti-ai-slop", href: "https://github.com/muris11/anti-ai-slop/blob/main/skills/antislop-dashboard/SKILL.md" },
            { title: "v1 spec: Desk Overview + Admin visual rebuild", site: "Grok Bot", href: "https://cursor.com/canvas/store-0678ce0c-7e80-4b32-b90c-c0e5287e9dc9/ac3a93a8-2dc7-4324-b709-0e712eadb856" },
          ]}
        />
      </Section>
    </Page>
  );
}


</cursor_untrusted_data_1337>