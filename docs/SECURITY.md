# Security & Compliance

## Overview

ReplenishRadar's MCP server is designed with defense-in-depth. Every tool call passes through authentication, authorization, rate limiting, and audit logging before reaching inventory data.

Three frameworks govern this work:

1. **Amazon BSA Agent Policy (March 2026)** — binding for all features touching Amazon data
2. **OWASP LLM Top 10** — security risks specific to AI agent integrations
3. **Org-scoped RLS model** — all queries are scoped to the authenticated organization

## Amazon BSA Agent Policy Compliance

ReplenishRadar is registered as an Agent under Amazon's March 2026 Business Solutions Agreement.

| Requirement | Implementation |
|---|---|
| Agents must identify themselves as automated | `X-RR-Agent-Identity: mcp-tool-call` header on all SP-API calls |
| Must comply with Amazon's Agent Policy | Compliance checklist maintained and reviewed quarterly |
| Must cease access immediately if Amazon demands | Kill switch: org-level flag checked before every SP-API call |
| Amazon data cannot be used to train AI/ML models | Prohibited in API Terms of Service; not sent to LLM providers as training data |
| Agents must not violate Amazon's policies | MCP tools are read/draft only; no auto-sending without human confirmation |

## OWASP LLM Top 10 Controls

### LLM01: Prompt Injection

- All MCP tool outputs are structured JSON — never raw text flowing into LLM prompts
- String fields are sanitized before returning in tool responses

### LLM02: Insecure Output Handling

- `rr_create_purchase_order` always creates `draft` status — enforced server-side
- No MCP tool can change order status from draft to sent without human approval
- Review URLs are included in write-action responses

### LLM06: Sensitive Information Disclosure

- API keys are org-scoped; cross-org data access is impossible
- `unit_cost` fields are only returned for write-scope API keys
- PII is excluded from all MCP tool responses
- Internal IDs and debug fields are stripped

### LLM08: Excessive Agency

- Write tools require Scale+ tier and buyer role minimum
- No MCP tool can delete items, merge SKUs, send POs, or modify prices without approval
- Restrictions are enforced server-side; cannot be overridden by prompt engineering

### LLM09: Overreliance

- Suggested PO responses include `as_of` timestamp and confidence metadata
- PO creation responses include a `review_url` deep link
- Stale forecast data (>24 hours) is flagged with `data_freshness: stale`

## API Key Security

### Storage
- Keys are stored as `sha256(key)` — plaintext is shown once at creation
- Keys are prefixed `rr_sk_live_` to enable automatic secret scanning in GitHub, GitLab, and CI systems

### Scope

| Scope | Tools Available |
|---|---|
| `read` | All 18 read-only tools |
| `write` | Read + 10 write tools (requires buyer role) |

Read-only keys cannot be escalated to write scope by an agent.

### Rotation
- Keys can be revoked instantly from Settings > API Keys
- Revoked keys fail immediately on the next request (no caching)
- Admins can see all active keys and their last-used timestamp

## Rate Limiting

| Tier | Per Hour | Per Minute Burst |
|---|---|---|
| Growth | 100 | 10 |
| Scale | 1,000 | 60 |
| Enterprise | Unlimited | 200 |

### Circuit Breaker

If a key exceeds 200% of its hourly limit in a 5-minute window, it is automatically suspended for 60 minutes and an email alert is sent to the org owner.

## Audit Logging

Every MCP tool call is logged:

```json
{
  "event": "mcp_tool_call",
  "org_id": "...",
  "api_key_id": "...",
  "tool": "rr_get_suggested_purchase_orders",
  "duration_ms": 143,
  "timestamp": "2026-03-08T14:32:01Z"
}
```

Write actions additionally log the full input and output for audit reconstruction.

**Retention:** 7 years. Logs are immutable — no update or delete operations.

## Data Minimization

MCP tool responses do not include:

- Internal user IDs or emails
- Raw Shopify/Amazon tokens or credentials
- Supabase row IDs that expose internal DB structure
- Debug fields or ML feature vectors
- Other organizations' data

## Privacy

- Agent audit logs containing IP addresses are subject to GDPR/CCPA deletion requests
- MCP tool responses do not contain end-customer PII
- ReplenishRadar's API Terms of Service prohibit using inventory data for training third-party AI models

## Incident Response

If a compromised API key is detected:

1. Revoke the key immediately from Settings > API Keys
2. Review the audit log for all actions taken by the key
3. Review any draft POs created by the key — do not send them
4. If Amazon SP-API calls were triggered: review for policy violations
5. Notify the org owner via email within 24 hours
