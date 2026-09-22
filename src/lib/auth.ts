import type { DeviceRecord, Env } from "../types";

export function bearerToken(request: Request): string | null {
  const value = request.headers.get("Authorization") ?? "";
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function deviceHeader(request: Request): string | null {
  const value = request.headers.get("X-Hinge-Relay-Device")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  const input = bytes.slice().buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  const provided = bearerToken(request);
  const configured = env.RELAY_ADMIN_TOKEN?.trim() ?? "";
  return configured.length >= 32 && provided !== null && constantTimeEqual(provided, configured);
}

export async function readDevice(env: Env, relayDeviceId: string): Promise<DeviceRecord | null> {
  const object = await env.BUCKET.get(`devices/${relayDeviceId}.json`);
  if (!object) return null;
  try {
    return await object.json<DeviceRecord>();
  } catch {
    return null;
  }
}

export async function authenticateDevice(
  request: Request,
  env: Env,
): Promise<DeviceRecord | null> {
  const relayDeviceId = deviceHeader(request);
  const token = bearerToken(request);
  if (!relayDeviceId || !token) return null;
  const device = await readDevice(env, relayDeviceId);
  if (!device) return null;
  const tokenHash = await sha256Hex(token);
  return constantTimeEqual(tokenHash, device.tokenHash) ? device : null;
}
