const STORAGE_KEY = "scalers-demo-device";
const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/;

let memoryId: string | null = null;

export function isDemoDeviceId(value: string): boolean {
  return DEVICE_ID.test(value);
}

function mintDeviceId(): string {
  return crypto.randomUUID();
}

/** Adds ?device_id= when the id matches the token charset. */
export function appendDeviceId(url: string, deviceId: string): string {
  if (!isDemoDeviceId(deviceId)) return url;
  const hashAt = url.indexOf("#");
  const bare = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = bare.indexOf("?");
  const path = queryAt === -1 ? bare : bare.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : bare.slice(queryAt + 1));
  params.set("device_id", deviceId);
  return `${path}?${params.toString()}`;
}

export function demoStatusUrl(base = "/demo/status"): string {
  return appendDeviceId(base, demoDeviceId());
}

function readStored(storage: Storage): string | null {
  const existing = storage.getItem(STORAGE_KEY);
  if (existing && isDemoDeviceId(existing)) return existing;
  return null;
}

/**
 * Browser device id for the demo token and status poll.
 * SSR returns "" so a server render never mints a shared id.
 * A storage failure keeps one in-memory id for this page.
 */
export function demoDeviceId(): string {
  if (typeof window === "undefined") return "";
  let storage: Storage | null = null;
  let readable = true;
  try {
    storage = window.localStorage;
    const existing = readStored(storage);
    if (existing) return existing;
  } catch {
    readable = false;
    storage = null;
  }
  if (!readable) {
    if (!memoryId) memoryId = mintDeviceId();
    return memoryId;
  }
  const id = memoryId && isDemoDeviceId(memoryId) ? memoryId : mintDeviceId();
  try {
    storage?.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    memoryId = id;
    return id;
  }
}
