import type { Env, RelayManifest, TransferRecord } from "../types";

export const deviceKey = (id: string) => `devices/${id}.json`;
export const transferKey = (sender: string, id: string) => `transfers/${sender}/${id}.json`;
export const blobKey = (receiver: string, id: string) => `blobs/${receiver}/${id}.bin`;
export const inboxKey = (receiver: string, id: string) => `inbox/${receiver}/${id}.json`;
export const receiptKey = (sender: string, id: string) => `receipts/${sender}/${id}.json`;

export async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.BUCKET.get(key);
  if (!object) return null;
  try {
    return await object.json<T>();
  } catch {
    return null;
  }
}

export async function writeJson(env: Env, key: string, value: unknown): Promise<void> {
  await env.BUCKET.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

export async function readTransfer(env: Env, sender: string, id: string): Promise<TransferRecord | null> {
  return readJson<TransferRecord>(env, transferKey(sender, id));
}

export async function readManifest(env: Env, receiver: string, id: string): Promise<RelayManifest | null> {
  return readJson<RelayManifest>(env, inboxKey(receiver, id));
}
