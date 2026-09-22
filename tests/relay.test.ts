import { describe, expect, it } from "vitest";
import worker from "../src/index";

const adminToken = "A".repeat(32);
const senderId = "sender-device-01";
const receiverId = "receiver-device-01";
const transferId = "123e4567-e89b-42d3-a456-426614174000";

type StoredObject = {
  bytes: Uint8Array;
  contentType?: string;
};

class MemoryBucket {
  private readonly objects = new Map<string, StoredObject>();
  private readonly uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>();
  private nextUpload = 1;

  async get(key: string, options?: { range?: { offset: number; length: number } }): Promise<any> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const bytes = options?.range
      ? stored.bytes.slice(options.range.offset, options.range.offset + options.range.length)
      : stored.bytes;
    return objectBody(key, bytes, stored.contentType);
  }

  async head(key: string): Promise<any> {
    const stored = this.objects.get(key);
    return stored ? { key, size: stored.bytes.length } : null;
  }

  async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    this.objects.set(key, {
      bytes: await bodyBytes(value),
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options: { prefix?: string; limit?: number }): Promise<any> {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ""))
      .sort()
      .slice(0, options.limit ?? 1000);
    return { objects: keys.map((key) => ({ key })), truncated: false, cursor: undefined };
  }

  createMultipartUpload(key: string): any {
    const uploadId = `upload-${this.nextUpload++}`;
    const upload = { key, parts: new Map<number, Uint8Array>() };
    this.uploads.set(uploadId, upload);
    return this.multipart(uploadId, upload);
  }

  resumeMultipartUpload(key: string, uploadId: string): any {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new Error("upload not found");
    return this.multipart(uploadId, upload);
  }

  private multipart(uploadId: string, upload: { key: string; parts: Map<number, Uint8Array> }): any {
    return {
      uploadId,
      uploadPart: async (partNumber: number, body: ReadableStream<Uint8Array>) => {
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        upload.parts.set(partNumber, bytes);
        return { partNumber, etag: `etag-${partNumber}` };
      },
      complete: async (parts: Array<{ partNumber: number }>) => {
        const bytes = parts.flatMap((part) => [...(upload.parts.get(part.partNumber) ?? [])]);
        this.objects.set(upload.key, { bytes: Uint8Array.from(bytes) });
        this.uploads.delete(uploadId);
      },
      abort: async () => this.uploads.delete(uploadId),
    };
  }
}

function objectBody(key: string, bytes: Uint8Array, contentType = "application/octet-stream"): any {
  return {
    key,
    size: bytes.length,
    body: new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).body,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    async json<T>() { return JSON.parse(new TextDecoder().decode(bytes)) as T; },
    httpMetadata: { contentType },
  };
}

async function bodyBytes(value: unknown): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  return new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
}

function env(bucket: MemoryBucket) {
  return {
    BUCKET: bucket,
    RELAY_ADMIN_TOKEN: adminToken,
    RELAY_VERSION: "test",
    DEFAULT_TTL_HOURS: "24",
  } as any;
}

function auth(token: string, deviceId: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-Hinge-Relay-Device": deviceId,
  };
}

function metadata(value: string): string {
  return btoa(value);
}

async function call(bucket: MemoryBucket, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://relay.test${path}`, init), env(bucket), {} as ExecutionContext);
}

describe("Hinge Relay API", () => {
  it("registers devices, stores encrypted multipart data, and emits a receipt", async () => {
    const bucket = new MemoryBucket();
    const senderResponse = await call(bucket, "/v1/register", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ relayDeviceId: senderId, name: "Sender", platform: "windows", clientVersion: "test" }),
    });
    const receiverResponse = await call(bucket, "/v1/register", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ relayDeviceId: receiverId, name: "Receiver", platform: "android", clientVersion: "test" }),
    });
    expect(senderResponse.status).toBe(200);
    expect(receiverResponse.status).toBe(200);
    const sender = await senderResponse.json() as { deviceToken: string };
    const receiver = await receiverResponse.json() as { deviceToken: string };

    const health = await call(bucket, "/v1/health");
    expect(health.status).toBe(200);
    expect((await health.json() as { apiVersion: number }).apiVersion).toBe(1);

    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const create = await call(bucket, "/v1/transfers", {
      method: "POST",
      headers: { ...auth(sender.deviceToken, senderId), "Content-Type": "application/json" },
      body: JSON.stringify({
        transferId,
        receiverRelayDeviceId: receiverId,
        partSize: 8 * 1024 * 1024,
        partCount: 1,
        expiresAt,
      }),
    });
    expect(create.status).toBe(200);
    const session = await create.json() as { uploadId: string };

    const encryptedPart = new Uint8Array(16).fill(7);
    const upload = await call(bucket, `/v1/transfers/${transferId}/parts/1?uploadId=${session.uploadId}`, {
      method: "PUT",
      headers: { ...auth(sender.deviceToken, senderId), "Content-Length": String(encryptedPart.length) },
      body: encryptedPart,
    });
    expect(upload.status).toBe(200);
    const uploaded = await upload.json() as { etag: string };

    const manifest = {
      version: 1,
      transferId,
      senderRelayDeviceId: senderId,
      receiverRelayDeviceId: receiverId,
      createdAt: expiresAt - 3600,
      expiresAt,
      partSize: 8 * 1024 * 1024,
      partCount: 1,
      ciphertextSize: encryptedPart.length,
      encryption: "AES-256-GCM",
      metadataCiphertext: metadata("opaque"),
      metadataNonce: "AAAAAAAAAAAAAAAA",
      metadataTag: "AAAAAAAAAAAAAAAAAAAAAA",
    };
    const complete = await call(bucket, `/v1/transfers/${transferId}/complete`, {
      method: "POST",
      headers: { ...auth(sender.deviceToken, senderId), "Content-Type": "application/json" },
      body: JSON.stringify({ manifest, parts: [{ partNumber: 1, etag: uploaded.etag }] }),
    });
    expect(complete.status).toBe(200);

    const inbox = await call(bucket, "/v1/inbox", { headers: auth(receiver.deviceToken, receiverId) });
    expect(inbox.status).toBe(200);
    expect((await inbox.json() as { items: unknown[] }).items).toHaveLength(1);

    const download = await call(bucket, `/v1/transfers/${transferId}/parts/1`, {
      headers: auth(receiver.deviceToken, receiverId),
    });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(encryptedPart);

    const ack = await call(bucket, `/v1/transfers/${transferId}/ack`, {
      method: "POST",
      headers: { ...auth(receiver.deviceToken, receiverId), "Content-Type": "application/json" },
      body: "{}",
    });
    expect(ack.status).toBe(200);

    const receipts = await call(bucket, "/v1/receipts", { headers: auth(sender.deviceToken, senderId) });
    expect((await receipts.json() as { items: Array<{ transferId: string }> }).items[0].transferId).toBe(transferId);
    const deleteReceipt = await call(bucket, `/v1/receipts/${transferId}`, {
      method: "DELETE",
      headers: auth(sender.deviceToken, senderId),
    });
    expect(deleteReceipt.status).toBe(204);
  });

  it("rejects device requests with a missing or invalid token", async () => {
    const bucket = new MemoryBucket();
    const response = await call(bucket, `/v1/devices/${receiverId}`, {
      headers: auth("wrong-token", senderId),
    });
    expect(response.status).toBe(401);
  });
});
