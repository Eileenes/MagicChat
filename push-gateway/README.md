# Push Gateway

Public, capability-based push notification gateway for the MagicChat mobile app and privately deployed MagicChat servers.

The gateway stores no MagicChat account, conversation, server URL, or message content. A mobile installation creates a short capability (`grant_id` + `send_token`) and delegates it to the private server it is currently signed in to. The private server can only enqueue fixed-template notifications for that installation.

## Current milestone

Implemented:

- PostgreSQL migrations embedded in the binary
- versioned provider-token encryption with rolling keyring rotation
- installation registration and provider-token rotation
- one active grant per installation
- grant renewal, revocation, and expiration
- idempotent fixed-template notification jobs
- database-backed per-IP, global, grant-rotation, and per-grant rate limiting
- PostgreSQL-backed retry worker
- bounded retention for jobs, grants, and abandoned installations
- invalid-device revocation behavior
- APNs HTTP/2 provider with token authentication, sandbox/production routing, collapse IDs, and error classification
- JPush Android REST provider with RegistrationID targeting, fixed anonymous extras, TTL forwarding, and error classification
- fake provider for local and automated testing
- `/api`-scoped health, metrics, OpenAPI, and v1 routes

The private MagicChat server integration is implemented with a fixed production Gateway URL, encrypted delegated grants, durable local jobs, and authenticated notification-route resolution.

Not implemented yet:

- JPush OEM-channel real-device validation and Getui fallback evaluation
- provider delivery-receipt polling
- mobile installation and grant lifecycle integration

## Run locally

Set the variables documented in `.env.example`, create the PostgreSQL database, then run. `PUSH_PROVIDERS` is required explicitly so a production deployment cannot silently fall back to the fake provider. Use `apns,jpush` for the official iOS and Android channels; JPush additionally requires `JPUSH_APP_KEY` and `JPUSH_MASTER_SECRET`:

```sh
go run ./cmd/gateway
```

No development service is started automatically by tests or builds.

Production traffic must terminate TLS at a trusted reverse proxy. Configure that proxy to replace (not append untrusted values to) `X-Forwarded-For`, and list its network in `TRUSTED_PROXY_CIDRS`; otherwise the gateway deliberately derives rate-limit identity from the direct peer address. Never expose the plain HTTP listener directly to the public internet.

To rotate `DATA_ENCRYPTION_KEY`, move the old value into `DATA_ENCRYPTION_PREVIOUS_KEYS` and deploy the new value as the current key. Active installation tokens are lazily re-encrypted by the worker; retain previous keys until old-key ciphertext has drained.

`INSTALLATION_RETENTION` controls how long expired/revoked grants and abandoned installations remain after they are no longer active. It must not be shorter than `JOB_RETENTION`.

## API

- `POST /api/v1/installations`
- `PUT /api/v1/installations/{installation_id}/provider-token`
- `POST /api/v1/installations/{installation_id}/active-grant`
- `POST /api/v1/grants/{grant_id}/renew`
- `DELETE /api/v1/grants/{grant_id}`
- `POST /api/v1/grants/{grant_id}/notifications`
- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/metrics`
- `GET /api/openapi.json`

`GET /api/metrics` exposes only anonymous operational aggregates:

- `push_gateway_jobs{status}`
- `push_gateway_grants{status}`
- `push_gateway_installations{provider,platform,status}`
- `push_gateway_oldest_pending_job_age_seconds`

No installation ID, grant ID, provider token, route token, user identity, private-server address, conversation ID, or message ID is included.
