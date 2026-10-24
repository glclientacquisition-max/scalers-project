/** Minimal NextResponse/NextRequest: JSON bodies, status, and a cookie list the browser would apply. */
class ResCookies {
  constructor() { this.list = []; }
  set(name, value, options = {}) { this.list.push({ name, value, ...options }); }
  get(name) { return [...this.list].reverse().find((c) => c.name === name); }
}
export class NextResponse extends Response {
  constructor(body, init) { super(body, init); this.cookies = new ResCookies(); }
  static json(data, init = {}) {
    return new NextResponse(JSON.stringify(data), { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  }
  static redirect(url, status = 307) {
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
}
export class NextRequest extends Request {
  constructor(input, init = {}) {
    super(input, init);
    const jar = init.cookieJar || new Map();
    this.cookies = {
      get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    };
  }
}
export async function connection() {}
