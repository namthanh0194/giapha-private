# Observability

## Scope and privacy

Server telemetry is optional and sends OTLP/HTTP spans only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Browser telemetry is not implemented. The emitter accepts only these dimensions: route template, operation name, role class, status, duration milliseconds, row count, payload bytes, error ID, app version, and truncation state.

Never send person names, birth or death dates, phone numbers, residences, notes, emails, approval tokens, backup contents, session data, database URLs, or secrets. Unknown or invalid dimensions are discarded. Keep collector access restricted and apply the shortest retention period that still supports incident response.

## Configuration

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector base URL or its `/v1/traces` endpoint. The service sends JSON OTLP/HTTP to `/v1/traces`, with a 750 ms best-effort timeout. Export failure never fails or delays the application request. Do not place authentication secrets in this variable; configure collector authentication outside this application.

## Alerts

Use a 10-minute window unless the platform requires a longer evaluation period:

- Restore failures: page after 2 failures; include only error IDs and operation names.
- Readiness failures: page after 3 consecutive failed probes or 2 minutes unavailable.
- Migration failures: page on the first failed execution.
- 5xx rate: alert at 2% of server requests with at least 20 requests; page at 5%.
- Storage compensation failures: alert after 3 failures; create a cleanup ticket with error IDs.

Route templates and operation names make each alert actionable without disclosing family data. Link runbooks to restore validation, deployment rollback, database readiness, and storage cleanup procedures.
