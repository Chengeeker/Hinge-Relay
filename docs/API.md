# Hinge Cloud Relay API v1

All authenticated calls use:

```http
Authorization: Bearer <deviceToken>
X-Hinge-Relay-Device: <opaqueRelayDeviceId>
```

`GET /v1/health` is unauthenticated. `POST /v1/register` uses the deployment-only admin bearer token and returns a device token once.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/health` | health and schema versions |
| POST | `/v1/register` | register/rotate one device token |
| GET | `/v1/devices/:relayDeviceId` | check that a trusted peer is registered |
| POST | `/v1/transfers` | create or resume an R2 multipart upload |
| PUT | `/v1/transfers/:transferId/parts/:partNumber?uploadId=...` | upload one encrypted part |
| POST | `/v1/transfers/:transferId/complete` | commit all parts and publish the inbox manifest |
| GET | `/v1/inbox` | list complete manifests for the authenticated receiver |
| GET | `/v1/transfers/:transferId/parts/:partNumber` | download one encrypted part |
| POST | `/v1/transfers/:transferId/ack` | delete the blob after local verification |
| GET | `/v1/receipts` | list sender delivery receipts |
| DELETE | `/v1/receipts/:transferId` | remove one consumed receipt |

The fixed plaintext part size is 8 MiB. Each encrypted part is the plaintext plus a 16-byte AES-GCM tag. Object keys are derived from opaque IDs; original file names never become object keys.

The outer inbox manifest contains only routing, expiry, part geometry, ciphertext size, and encrypted metadata. Hinge decrypts the metadata and verifies the final plaintext SHA-256 before acknowledging.
