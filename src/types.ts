export interface Env {
  BUCKET: R2Bucket;
  RELAY_ADMIN_TOKEN: string;
  RELAY_VERSION?: string;
  DEFAULT_TTL_HOURS?: string;
}

export interface DeviceRecord {
  version: 1;
  relayDeviceId: string;
  tokenHash: string;
  name: string;
  platform: string;
  clientVersion: string;
  registeredAt: number;
  lastSeen: number;
}

export interface TransferRecord {
  version: 1;
  transferId: string;
  senderRelayDeviceId: string;
  receiverRelayDeviceId: string;
  objectKey: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  expiresAt: number;
  createdAt: number;
  parts: Record<string, string>;
}

export interface RelayManifest {
  version: 1;
  transferId: string;
  senderRelayDeviceId: string;
  receiverRelayDeviceId: string;
  createdAt: number;
  expiresAt: number;
  partSize: number;
  partCount: number;
  ciphertextSize: number;
  encryption: "AES-256-GCM";
  metadataCiphertext: string;
  metadataNonce: string;
  metadataTag: string;
}

export interface Receipt {
  version: 1;
  transferId: string;
  senderRelayDeviceId: string;
  receiverRelayDeviceId: string;
  status: "delivered";
  deliveredAt: number;
}

export interface ClipboardEnvelope {
  version: 1;
  eventId: string;
  senderRelayDeviceId: string;
  receiverRelayDeviceId: string;
  createdAt: number;
  createdAtMs: number;
  expiresAt: number;
  ciphertext: string;
  nonce: string;
  tag: string;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}
