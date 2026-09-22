# Security notes

- Keep the R2 bucket private. Do not enable `r2.dev` public access.
- Keep `RELAY_ADMIN_TOKEN` in a Cloudflare secret, never in source control.
- Hinge derives an opaque relay device ID from its local device ID and the shared relay encryption key. The original Hinge device ID is not sent to this Worker.
- Every file part and the encrypted metadata manifest use AES-256-GCM. The Worker only sees opaque IDs, encrypted metadata, ciphertext sizes, and multipart ETags.
- A transfer is visible in the receiver inbox only after the multipart upload is committed.
- The receiver acknowledges only after each part's GCM tag and the final plaintext SHA-256 have been verified.
- The Worker deletes the inbox manifest and blob after acknowledgement; expired transfers are cleaned by the scheduled trigger.
- Treat device tokens and the relay encryption key as secrets. Re-registering a device rotates its device token.
- Cloud Relay does not authenticate a new Hinge relationship. The two devices must already be trusted locally and the user must intentionally share the relay key.
