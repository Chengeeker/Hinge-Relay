import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env, Receipt, RelayManifest, TransferRecord, UploadedPart } from "./types";
import {
  authenticateDevice,
  bearerToken,
  constantTimeEqual,
  deviceHeader,
  requireAdmin,
  readDevice,
  sha256Hex,
} from "./lib/auth";
import {
  blobKey,
  deviceKey,
  inboxKey,
  readJson,
  readManifest,
  readTransfer,
  receiptKey,
  transferKey,
  writeJson,
} from "./lib/r2";
import {
  API_VERSION,
  CONFIG_SCHEMA_VERSION,
  isBase64Url,
  isFiniteInteger,
  isManifest,
  isSafeId,
  isTransferId,
  isUploadedPart,
  MAX_PART_COUNT,
  PART_SIZE,
  safeName,
  ttlHours,
} from "./lib/validation";

const app = new Hono<{ Bindings: Env }>();

function json(c: Context<{ Bindings: Env }>, body: unknown, status: ContentfulStatusCode = 200): Response {
  return c.json(body, status);
}

function error(c: Context<{ Bindings: Env }>, message: string, status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 503): Response {
  return json(c, { error: message }, status);
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Hinge-Relay-Device");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  return new Response(response.body, { status: response.status, headers });
}

app.use("/v1/*", async (c, next) => {
  if (c.req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
  await next();
  return withCors(c.res);
});

app.get("/v1/health", (c) => json(c, {
  service: "hinge-relay",
  relayVersion: c.env.RELAY_VERSION ?? "1.0.0",
  apiVersion: API_VERSION,
  configSchemaVersion: CONFIG_SCHEMA_VERSION,
}));

app.post("/v1/register", async (c) => {
  if (!(await requireAdmin(c.req.raw, c.env))) return error(c, "admin authentication failed", 401);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return error(c, "invalid JSON body", 400);
  }
  const relayDeviceId = body.relayDeviceId;
  if (!isSafeId(relayDeviceId)) return error(c, "invalid relayDeviceId", 422);

  const now = Math.floor(Date.now() / 1000);
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(tokenBytes);
  const record = {
    version: 1 as const,
    relayDeviceId,
    tokenHash: await sha256Hex(token),
    name: safeName(body.name, "Hinge device"),
    platform: safeName(body.platform, "unknown"),
    clientVersion: safeName(body.clientVersion, "unknown"),
    registeredAt: now,
    lastSeen: now,
  };
  await writeJson(c.env, deviceKey(relayDeviceId), record);
  return json(c, { relayDeviceId, deviceToken: token, apiVersion: API_VERSION });
});

app.get("/v1/devices/:relayDeviceId", async (c) => {
  const sender = await authenticateDevice(c.req.raw, c.env);
  if (!sender) return error(c, "device authentication failed", 401);
  const relayDeviceId = c.req.param("relayDeviceId");
  if (!isSafeId(relayDeviceId)) return error(c, "invalid relayDeviceId", 422);
  const target = await readDevice(c.env, relayDeviceId);
  return json(c, { registered: target !== null });
});

app.post("/v1/transfers", async (c) => {
  const sender = await authenticateDevice(c.req.raw, c.env);
  if (!sender) return error(c, "device authentication failed", 401);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return error(c, "invalid JSON body", 400);
  }
  const transferId = body.transferId;
  const receiver = body.receiverRelayDeviceId;
  const partCount = body.partCount;
  const expiresAt = body.expiresAt;
  if (!isTransferId(transferId) || !isSafeId(receiver) ||
      body.partSize !== PART_SIZE || !isFiniteInteger(partCount, 1, MAX_PART_COUNT) ||
      !isFiniteInteger(expiresAt, Math.floor(Date.now() / 1000) + 1, Math.floor(Date.now() / 1000) + ttlHours(c.env.DEFAULT_TTL_HOURS) * 3600)) {
    return error(c, "invalid transfer metadata", 422);
  }
  if (!(await readDevice(c.env, receiver))) return error(c, "receiver is not registered", 404);

  const existing = await readTransfer(c.env, sender.relayDeviceId, transferId);
  if (existing) {
    if (existing.receiverRelayDeviceId !== receiver) return error(c, "transfer id collision", 409);
    return json(c, { transferId, uploadId: existing.uploadId, partSize: existing.partSize, partCount: existing.partCount });
  }

  const objectKey = blobKey(receiver, transferId);
  const upload = await c.env.BUCKET.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  const record: TransferRecord = {
    version: 1,
    transferId,
    senderRelayDeviceId: sender.relayDeviceId,
    receiverRelayDeviceId: receiver,
    objectKey,
    uploadId: upload.uploadId,
    partSize: PART_SIZE,
    partCount,
    expiresAt,
    createdAt: Math.floor(Date.now() / 1000),
    parts: {},
  };
  await writeJson(c.env, transferKey(sender.relayDeviceId, transferId), record);
  return json(c, { transferId, uploadId: upload.uploadId, partSize: PART_SIZE, partCount });
});

app.put("/v1/transfers/:transferId/parts/:partNumber", async (c) => {
  const sender = await authenticateDevice(c.req.raw, c.env);
  if (!sender) return error(c, "device authentication failed", 401);
  const transferId = c.req.param("transferId");
  const partNumber = Number(c.req.param("partNumber"));
  if (!isTransferId(transferId) || !isFiniteInteger(partNumber, 1, MAX_PART_COUNT)) return error(c, "invalid part", 422);
  const record = await readTransfer(c.env, sender.relayDeviceId, transferId);
  if (!record) return error(c, "transfer not found", 404);
  if (partNumber > record.partCount) return error(c, "part is outside transfer", 422);
  if (Math.floor(Date.now() / 1000) > record.expiresAt) return error(c, "transfer expired", 410);
  const uploadId = c.req.query("uploadId");
  if (!uploadId || uploadId !== record.uploadId) return error(c, "invalid upload id", 422);
  const length = Number(c.req.header("Content-Length") ?? "0");
  if (length > record.partSize + 16 || length < 16) return error(c, "invalid encrypted part size", 413);
  if (!c.req.raw.body) return error(c, "missing request body", 400);

  try {
    const upload = c.env.BUCKET.resumeMultipartUpload(record.objectKey, record.uploadId);
    const uploaded = await upload.uploadPart(partNumber, c.req.raw.body);
    record.parts[String(partNumber)] = uploaded.etag;
    await writeJson(c.env, transferKey(sender.relayDeviceId, transferId), record);
    return json(c, { partNumber: uploaded.partNumber, etag: uploaded.etag });
  } catch (cause) {
    console.error("upload part failed", cause);
    return error(c, "part upload failed", 500);
  }
});

app.post("/v1/transfers/:transferId/complete", async (c) => {
  const sender = await authenticateDevice(c.req.raw, c.env);
  if (!sender) return error(c, "device authentication failed", 401);
  const transferId = c.req.param("transferId");
  if (!isTransferId(transferId)) return error(c, "invalid transfer id", 422);
  const record = await readTransfer(c.env, sender.relayDeviceId, transferId);
  if (!record) return error(c, "transfer not found", 404);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return error(c, "invalid JSON body", 400);
  }
  const manifest = body.manifest;
  const rawParts = body.parts;
  if (!isManifest(manifest) || manifest.transferId !== transferId ||
      manifest.senderRelayDeviceId !== sender.relayDeviceId ||
      manifest.receiverRelayDeviceId !== record.receiverRelayDeviceId ||
      manifest.partSize !== record.partSize || manifest.partCount !== record.partCount ||
      !Array.isArray(rawParts) || rawParts.length !== record.partCount ||
      manifest.expiresAt !== record.expiresAt) {
    return error(c, "invalid completion manifest", 422);
  }
  const parts = rawParts.filter(isUploadedPart) as UploadedPart[];
  if (parts.length !== rawParts.length || new Set(parts.map((part) => part.partNumber)).size !== parts.length) {
    return error(c, "invalid completed parts", 422);
  }
  for (const part of parts) {
    if (record.parts[String(part.partNumber)] !== part.etag) return error(c, "part etag mismatch", 422);
  }

  try {
    const upload = c.env.BUCKET.resumeMultipartUpload(record.objectKey, record.uploadId);
    await upload.complete(parts);
    const object = await c.env.BUCKET.head(record.objectKey);
    if (!object) return error(c, "completed object is missing", 500);
    await writeJson(c.env, inboxKey(record.receiverRelayDeviceId, transferId), manifest);
    await c.env.BUCKET.delete(transferKey(sender.relayDeviceId, transferId));
    return json(c, { transferId, status: "stored" });
  } catch (cause) {
    console.error("complete transfer failed", cause);
    return error(c, "transfer completion failed", 500);
  }
});

app.get("/v1/inbox", async (c) => {
  const receiver = await authenticateDevice(c.req.raw, c.env);
  if (!receiver) return error(c, "device authentication failed", 401);
  const listed = await c.env.BUCKET.list({ prefix: `inbox/${receiver.relayDeviceId}/`, limit: 20, cursor: c.req.query("cursor") });
  const items: RelayManifest[] = [];
  for (const object of listed.objects) {
    const manifest = await readJson<RelayManifest>(c.env, object.key);
    if (manifest && isManifest(manifest) && manifest.receiverRelayDeviceId === receiver.relayDeviceId) items.push(manifest);
  }
  return json(c, { items, cursor: listed.truncated ? listed.cursor : null });
});

app.get("/v1/transfers/:transferId/parts/:partNumber", async (c) => {
  const receiver = await authenticateDevice(c.req.raw, c.env);
  if (!receiver) return error(c, "device authentication failed", 401);
  const transferId = c.req.param("transferId");
  const partNumber = Number(c.req.param("partNumber"));
  if (!isTransferId(transferId) || !isFiniteInteger(partNumber, 1, MAX_PART_COUNT)) return error(c, "invalid part", 422);
  const manifest = await readManifest(c.env, receiver.relayDeviceId, transferId);
  if (!manifest) return error(c, "transfer not found", 404);
  if (partNumber > manifest.partCount) return error(c, "part is outside transfer", 422);
  const fullPartSize = manifest.partSize + 16;
  const offset = (partNumber - 1) * fullPartSize;
  const length = partNumber === manifest.partCount
    ? manifest.ciphertextSize - offset
    : fullPartSize;
  if (length < 16 || offset < 0 || offset + length > manifest.ciphertextSize) return error(c, "invalid manifest range", 422);
  const object = await c.env.BUCKET.get(blobKey(receiver.relayDeviceId, transferId), { range: { offset, length } });
  if (!object) return error(c, "transfer blob not found", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(length),
      "Cache-Control": "no-store",
    },
  });
});

app.post("/v1/transfers/:transferId/ack", async (c) => {
  const receiver = await authenticateDevice(c.req.raw, c.env);
  if (!receiver) return error(c, "device authentication failed", 401);
  const transferId = c.req.param("transferId");
  if (!isTransferId(transferId)) return error(c, "invalid transfer id", 422);
  const manifest = await readManifest(c.env, receiver.relayDeviceId, transferId);
  if (!manifest) return error(c, "transfer not found", 404);
  const receipt: Receipt = {
    version: 1,
    transferId,
    senderRelayDeviceId: manifest.senderRelayDeviceId,
    receiverRelayDeviceId: receiver.relayDeviceId,
    status: "delivered",
    deliveredAt: Math.floor(Date.now() / 1000),
  };
  await writeJson(c.env, receiptKey(manifest.senderRelayDeviceId, transferId), receipt);
  await c.env.BUCKET.delete(inboxKey(receiver.relayDeviceId, transferId));
  await c.env.BUCKET.delete(blobKey(receiver.relayDeviceId, transferId));
  return json(c, { transferId, status: "delivered" });
});

app.get("/v1/receipts", async (c) => {
  const sender = await authenticateDevice(c.req.raw, c.env);
  if (!sender) return error(c, "device authentication failed", 401);
  const listed = await c.env.BUCKET.list({ prefix: `receipts/${sender.relayDeviceId}/`, limit: 20, cursor: c.req.query("cursor") });
  const items: Receipt[] = [];
  for (const object of listed.objects) {
    const receipt = await readJson<Receipt>(c.env, object.key);
    if (receipt && receipt.senderRelayDeviceId === sender.relayDeviceId) items.push(receipt);
  }
  return json(c, { items, cursor: listed.truncated ? listed.cursor : null });
});

app.delete("/v1/receipts/:transferId", async (c) => {
  const sender = await authenticateDevice(c.req.raw, c.env);
  if (!sender) return error(c, "device authentication failed", 401);
  const transferId = c.req.param("transferId");
  if (!isTransferId(transferId)) return error(c, "invalid transfer id", 422);
  await c.env.BUCKET.delete(receiptKey(sender.relayDeviceId, transferId));
  return new Response(null, { status: 204 });
});

app.notFound((c) => error(c, "not found", 404));

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function cleanupExpired(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const inbox = await env.BUCKET.list({ prefix: "inbox/", limit: 100 });
  for (const object of inbox.objects) {
    const manifest = await readJson<RelayManifest>(env, object.key);
    if (!manifest || !isManifest(manifest) || manifest.expiresAt <= now) {
      await env.BUCKET.delete(object.key);
      if (manifest?.receiverRelayDeviceId && isTransferId(manifest.transferId)) {
        await env.BUCKET.delete(blobKey(manifest.receiverRelayDeviceId, manifest.transferId));
      }
    }
  }

  const transfers = await env.BUCKET.list({ prefix: "transfers/", limit: 100 });
  for (const object of transfers.objects) {
    const transfer = await readJson<TransferRecord>(env, object.key);
    if (!transfer || transfer.expiresAt <= now) {
      if (transfer?.objectKey && transfer.uploadId) {
        try { await env.BUCKET.resumeMultipartUpload(transfer.objectKey, transfer.uploadId).abort(); } catch { /* already gone */ }
        try { await env.BUCKET.delete(transfer.objectKey); } catch { /* best effort orphan cleanup */ }
      }
      await env.BUCKET.delete(object.key);
    }
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: async (_event: ScheduledEvent, env: Env) => cleanupExpired(env),
};
