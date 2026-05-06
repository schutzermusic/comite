# eSocial Automatic Sync Service

Reference: https://github.com/nfephp-org/sped-esocial

`nfephp-org/sped-esocial` is PHP-based and is designed around XML event construction, batch sending and SOAP consultations using an A1 PKCS#12 certificate. The Next.js application must not expose certificate secrets to the browser and should not claim production SOAP success until the internal PHP bridge is deployed.

## Runtime Shape

- Next.js owns UI, safe configuration status, BI consumers and normalized read APIs.
- PHP worker/service owns `.pfx/.p12`, certificate password, SOAP, XML signing, protocol consultation and secure XML storage.
- Next.js receives only safe metadata, normalized JSON and storage keys.

## Files

- `types.ts`: service contracts, schedule and bridge mode types.
- `esocial-config.ts`: safe config validation and masked config projection.
- `esocial-service.ts`: automatic sync/certificate service facade. Current implementation is a safe stub.
- `esocial-sync-scheduler.ts`: automatic sync frequency and next-run calculation.
- `esocial-normalizer.ts`: event support list and normalizer exports.
- `payroll-aggregator.ts`: consumer payloads for Pessoas & Custos and Financeiro.
- `mock-esocial-data.ts`: temporary mock data backing the UI.

## API Contract

- `GET /api/integrations/esocial/health`
- `POST /api/integrations/esocial/validate-certificate`
- `POST /api/integrations/esocial/sync-now`
- `GET /api/integrations/esocial/sync-runs`
- `GET /api/integrations/esocial/events`
- `GET /api/integrations/esocial/workforce-summary`
- `GET /api/integrations/esocial/payroll-summary`
- `PATCH /api/integrations/esocial/schedule`

All endpoints return safe metadata only while the PHP bridge is pending.
