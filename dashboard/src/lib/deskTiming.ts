export type DeskMark = { name: string; ms: number };

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
      return `desk-timing route=${route} ${body}`;
    },
  };
}
