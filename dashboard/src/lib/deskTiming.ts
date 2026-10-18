export type DeskMark = { name: string; ms: number };

// First desk-timing line from this server instance. A cold start shows as
// cold=1 with a small up= (ms since the process started), so a slow first load
// can be told apart from slow data in the Vercel logs.
let warm = false;

function instanceTag(): string {
  const cold = !warm;
  warm = true;
  const up =
    typeof process !== "undefined" && typeof process.uptime === "function"
      ? Math.round(process.uptime() * 1000)
      : -1;
  return `cold=${cold ? 1 : 0} up=${up}`;
}

/** Phase marks for one server render. Logged as `desk-timing` for Vercel. */
export function createDeskTimer() {
  const start = performance.now();
  const marks: DeskMark[] = [];
  return {
    mark(name: string) {
      marks.push({ name, ms: Math.round(performance.now() - start) });
    },
    line(route: string) {
      const body = marks.map((mark) => `${mark.name};dur=${mark.ms}`).join(",");
      return `desk-timing route=${route} ${body} ${instanceTag()}`;
    },
  };
}
