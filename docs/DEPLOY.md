# Deploy Hinge Relay

## Wrangler

```powershell
npm install
npx wrangler r2 bucket create hinge-relay
npx wrangler secret put RELAY_ADMIN_TOKEN
npm run check
npm run deploy
```

The `BUCKET` binding in `wrangler.jsonc` must point to the private bucket. Keep account-specific bucket names, custom domains, and secrets in the user's Cloudflare project settings; do not bake them into upstream source files.

## Cloudflare dashboard / GitHub

Import the fork as a Worker project, select the repository's `main` branch, add the R2 binding named `BUCKET`, and add `RELAY_ADMIN_TOKEN` as a secret. A Pages upload can serve the same Worker source only when the deployment is configured as a Worker/Functions project; a static Pages asset upload alone cannot execute this API.

Before exposing a deployment, call `/v1/health`, register one test device, and verify that the response does not expose the admin token or the raw R2 key.
