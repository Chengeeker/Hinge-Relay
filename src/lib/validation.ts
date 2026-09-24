import type { ClipboardEnvelope, RelayManifest, UploadedPart } from "../types";

export const API_VERSION = 1;
export const CONFIG_SCHEMA_VERSION = 1;
export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_PART_COUNT = 65536;
export const MAX_TTL_HOURS = 24 * 30;
export const MAX_CLIPBOARD_CIPHERTEXT_LENGTH = 22000;

export function isClipboardEnvelope(value: unknown): value is ClipboardEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<ClipboardEnvelope>;
  return item.version === 1 && isTransferId(item.eventId) &&
    isSafeId(item.senderRelayDeviceId) && isSafeId(item.receiverRelayDeviceId) &&
    isFiniteInteger(item.createdAt, 0, Number.MAX_SAFE_INTEGER) &&
    isFiniteInteger(item.createdAtMs, 0, Number.MAX_SAFE_INTEGER) &&
    Math.floor(item.createdAtMs / 1000) === item.createdAt &&
    isFiniteInteger(item.expiresAt, 1, Number.MAX_SAFE_INTEGER) &&
    isBase64Url(item.ciphertext) && item.ciphertext.length <= MAX_CLIPBOARD_CIPHERTEXT_LENGTH &&
    isBase64Url(item.nonce) && item.nonce.length === 16 &&
    isBase64Url(item.tag) && item.tag.length === 22;
}

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

export function isTransferId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isFiniteInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function isUploadedPart(value: unknown): value is UploadedPart {
  return typeof value === "object" && value !== null &&
    isFiniteInteger((value as UploadedPart).partNumber, 1, MAX_PART_COUNT) &&
    typeof (value as UploadedPart).etag === "string" &&
    (value as UploadedPart).etag.length > 0 && (value as UploadedPart).etag.length <= 256;
}

export function isManifest(value: unknown): value is RelayManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<RelayManifest>;
  const metadataNonce = manifest.metadataNonce;
  const metadataTag = manifest.metadataTag;
  return manifest.version === 1 &&
    isTransferId(manifest.transferId) &&
    isSafeId(manifest.senderRelayDeviceId) &&
    isSafeId(manifest.receiverRelayDeviceId) &&
    isFiniteInteger(manifest.createdAt, 0, Number.MAX_SAFE_INTEGER) &&
    isFiniteInteger(manifest.expiresAt, 1, Number.MAX_SAFE_INTEGER) &&
    manifest.partSize === PART_SIZE &&
    isFiniteInteger(manifest.partCount, 1, MAX_PART_COUNT) &&
    isFiniteInteger(manifest.ciphertextSize, 16, Number.MAX_SAFE_INTEGER) &&
    manifest.ciphertextSize >= manifest.partCount * 16 &&
    manifest.ciphertextSize <= manifest.partCount * (PART_SIZE + 16) &&
    manifest.encryption === "AES-256-GCM" &&
    isBase64Url(manifest.metadataCiphertext) &&
    typeof metadataNonce === "string" &&
    metadataNonce.length === 16 &&
    typeof metadataTag === "string" &&
    metadataTag.length === 22 &&
    isBase64Url(metadataNonce) &&
    isBase64Url(metadataTag);
}

export function isBase64Url(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function ttlHours(envValue: string | undefined): number {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), MAX_TTL_HOURS)
    : 168;
}

export function safeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.length > 0 ? normalized.slice(0, 160) : fallback;
}
