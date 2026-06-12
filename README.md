# @replenishradar/mcp-server

Connect AI agents to live [ReplenishRadar](https://replenishradar.com) inventory data. Works with Claude Desktop, OpenClaw, and any MCP-compatible client.

## Setup

1. Get your API key from **ReplenishRadar > Settings > API Keys**.
2. Add this server to your MCP client config. In Claude Desktop, open **Settings > Developer > Edit Config**:

```json
{
  "mcpServers": {
    "replenishradar": {
      "command": "npx",
      "args": ["-y", "@replenishradar/mcp-server"],
      "env": {
        "REPLENISHRADAR_API_KEY": "rr_sk_your_key_here"
      }
    }
  }
}
```

3. Restart Claude Desktop and ask: "What are my top stockout risks?"

No ReplenishRadar account yet? Use the public agent intake endpoint to request a short-lived, read-only sandbox key before configuring the server:

```text
POST https://api.replenishradar.com/api/public/agent-intake
```

## Available Tools

### Read

Standard includes limited read API access. Growth adds diagnosis/status read tools.

| Tool | Description |
|------|-------------|
| `rr_get_stockout_risk` | Stockout risk levels for SKUs |
| `rr_get_inventory_position` | Stock-by-location for an item |
| `rr_get_demand_forecast` | Demand forecast stats |
| `rr_get_suggested_purchase_orders` | Suggested POs |
| `rr_get_replenishment_actions` | Canonical buyer replenishment actions |
| `rr_get_replenishment_action` | One replenishment action with event history |
| `rr_get_alerts` | Active alerts |
| `rr_list_items` | List inventory items |
| `rr_get_sync_status` | Recent sync history |
| `rr_list_suppliers` | List vendors/suppliers |
| `rr_list_purchase_orders` | List purchase orders |
| `rr_get_purchase_order` | Single PO with line items |
| `rr_get_po_pdf` | PO PDF info |
| `rr_get_po_documents` | Documents attached to a PO |
| `rr_get_po_notes` | Notes attached to a PO |
| `rr_get_sales_history` | Sales history |
| `rr_get_top_sellers` | Top-selling SKUs |
| `rr_get_slow_movers` | Slow-moving SKUs |
| `rr_get_inventory_value` | Inventory value breakdown |
| `rr_get_sku_health` | SKU-level health summary |
| `rr_get_lost_sales` | Estimated lost sales from stockouts |
| `rr_get_store_health` | Store connection and sync health |
| `rr_get_data_freshness` | Freshness status by data dimension |
| `rr_get_setup_status` | Setup milestones and next step |
| `rr_get_recent_activity` | Recent alerts, POs, and sync rollup |
| `search_knowledge` | ReplenishRadar product knowledge search |
| `rr_evaluate_fit` | Deterministic ICP + tier fit verdict (no org data) |

### Basic write (Standard tier and up)

Safe, low-blast-radius writes - no money or stock mutation.

| Tool | Description |
|------|-------------|
| `rr_acknowledge_alert` | Acknowledge an alert |
| `rr_add_po_note` | Add a note to a PO |
| `rr_request_approval` | Request human approval for a PO |
| `rr_add_replenishment_action_note` | Add a note to a replenishment action |
| `rr_dismiss_replenishment_action` | Dismiss a replenishment action |
| `rr_prepare_replenishment_action` | Preview an action and get its current `updated_at` before execute |
| `rr_execute_replenishment_action` | Execute an action. `mode="draft"` (default) creates a draft PO and/or transfer; `mode="autonomous"` also sends the PO / commits the transfer when the key has sensitive_write + the operation tool group + an enabled budget and all guardrails pass (else draft-fallback or hard-refuse). Idempotent, stale-state protected |
| `rr_resolve_replenishment_action` | Resolve an action as no-action with a reason; idempotent, stale-state protected |
| `rr_retry_replenishment_action` | Retry a blocked or failed action via the draft execution path; idempotent, stale-state protected |
| `rr_get_document_upload_url` | Get upload URL for a PO document |
| `rr_record_pi_review` | Record proforma invoice details |

### Sensitive write (Growth tier and up)

Money / stock mutation.

| Tool | Description |
|------|-------------|
| `rr_trigger_sync` | Trigger inventory sync |
| `rr_create_purchase_order` | Create a draft PO |
| `rr_update_purchase_order` | Update a draft PO |
| `rr_send_purchase_order` | Send an approved PO |
| `rr_cancel_purchase_order` | Cancel a PO |
| `rr_create_location` | Create a manual inventory location |
| `rr_set_stock_at_location` | Set stock at a manual location |

PO creation always starts as a **draft**. `rr_send_purchase_order` only sends a PO that was already human-approved.

Action execution has two modes. `rr_execute_replenishment_action` with `mode="draft"` (the default) creates a draft PO and/or draft transfer for an action's items and never auto-sends to a supplier or commits stock. With `mode="autonomous"` it additionally sends the PO or commits the transfer, but only when the key has `sensitive_write` + the operation's tool group + an enabled per-key budget (`autonomous_enabled=true`) and every guardrail passes; otherwise it leaves a draft and returns an `rr_request_approval` hint (`draft_fallback`) or refuses without mutating (`hard_refuse`). Call `rr_prepare_replenishment_action` first to get the action's current `updated_at`, then pass it as `expected_updated_at` so a stale action is rejected before any write. Pass a stable `idempotency_key` so a retried call replays the original result instead of double-creating artifacts or double-sending.

### Agent context store

A small, org-scoped, auditable key/value memory so an agent can remember bounded workflow state. `rr_get_agent_context` / `rr_list_agent_context` are read-capability; `rr_set_agent_context` / `rr_delete_agent_context` are basic-write. All four are in the `agent_context` tool group.

| Tool | Description |
|------|-------------|
| `rr_get_agent_context` | Get one entry by `namespace` + `key`; expired entries are omitted |
| `rr_set_agent_context` | Store a bounded JSON object under `namespace` + `key` (optional `scope_ref`, `ttl_seconds`) |
| `rr_list_agent_context` | List live entries for ONE `namespace` (required), bounded `limit` (max 200) |
| `rr_delete_agent_context` | Delete one entry by `namespace` + `key`; records actor provenance |

Rules and limits:

- **Namespaces are code-owned and per-key allowlisted.** A human admin must grant your API key read/write/delete on each namespace in Settings > API Keys. Same-organization access alone is **not** sufficient.
- **No secrets, no raw PII.** Writes that look like tokens, passwords, private keys, credentials, or raw emails/phones/addresses are rejected.
- `value` must be a **JSON object** (not a scalar or array), capped at **16 KiB** serialized.
- `ttl_seconds` is optional and capped at **90 days**; with no TTL the entry persists while the organization exists.
- `rr_list_agent_context` **requires** `namespace` and never lists across namespaces.
- `scope_ref` is descriptive metadata only and is **not** part of uniqueness - encode per-scope entries into the `key` (for example `supplier_rules/sku:ABC123`).
- Sensitive namespaces (for example `sourcing_economics`) additionally require the key to hold the sensitive economics read capability + tool group.

## Spend budgets (admin-managed, no MCP tool)

Per-API-key spend budgets - per-PO value cap, rolling-24h daily cap, max transfer quantity delta, an `autonomous_enabled` flag, and vendor / destination / transfer-source (or route-pair) allowlists - constrain what an autonomous key may buy or move. They are managed **only** by a human admin in Settings > API Keys (a JWT-admin Settings API); there is no MCP tool to read or change a budget, and an API key cannot reach the budget routes, not even for its own caps. Budgets are consumed only by autonomous send/commit, autonomous mode is off by default, and a denied autonomous action receives only a short decision reason - never the cap amounts, the allowlists, or another key's ledger.

## Rate Limits

- **Standard** ($99/mo): 10 calls/hour, read + basic-write tools
- **Growth** ($199/mo): 100 calls/hour, read + basic + sensitive read/write + diagnosis/status tools
- **Scale** ($499/mo): 1,000 calls/hour, full read + write capability set

## Learn More

- [MCP Setup Guide](https://replenishradar.com/blog/connect-ai-agent-amazon-shopify-inventory)
- [ReplenishRadar](https://replenishradar.com)
