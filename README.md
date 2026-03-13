# ReplenishRadar MCP Server

> Agent-ready inventory intelligence for Shopify and Amazon sellers. Stockout risk, demand forecasts, purchase order recommendations, and real-time alerts — all accessible to AI agents via the Model Context Protocol.

[![npm](https://img.shields.io/npm/v/@replenishradar/mcp-server)](https://www.npmjs.com/package/@replenishradar/mcp-server)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io/)

## What is it?

The ReplenishRadar MCP server lets AI agents (Claude Desktop, custom agents, n8n workflows) query live multi-channel inventory data, request purchase order recommendations, create and manage POs, and trigger inventory syncs — with full human-in-the-loop safeguards.

All write operations create **drafts only**. No agent can send a PO to a supplier without explicit human approval.

## Quick Start (Claude Desktop)

1. Get an API key from **ReplenishRadar > Settings > API Keys**
2. Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "replenishradar": {
      "command": "npx",
      "args": ["-y", "@replenishradar/mcp-server"],
      "env": {
        "REPLENISHRADAR_API_KEY": "rr_sk_live_your_key_here"
      }
    }
  }
}
```

3. Restart Claude Desktop
4. Ask: *"What are my top stockout risks?"* or *"Draft POs for everything critical"*

## Tools (28)

### Read Tools (18) — Growth+ tier

| Tool | Description |
|------|-------------|
| `rr_list_items` | Searchable SKU catalog with stock status |
| `rr_get_inventory_position` | On-hand, in-transit, reserved quantities by location |
| `rr_get_stockout_risk` | Risk levels, days of stock, recommended order quantities |
| `rr_get_demand_forecast` | Demand forecast stats for any period |
| `rr_get_suggested_purchase_orders` | AI-generated PO recommendations with costs |
| `rr_get_alerts` | Active inventory and operational alerts |
| `rr_get_sync_status` | Inventory sync history and status |
| `rr_list_suppliers` | Vendor/supplier catalog with lead times |
| `rr_list_purchase_orders` | Browse all POs with filtering |
| `rr_get_purchase_order` | Detailed PO with line items and history |
| `rr_get_po_pdf` | PO PDF document info |
| `rr_get_po_documents` | Documents attached to a PO |
| `rr_get_sales_history` | Historical sales data by SKU and channel |
| `rr_get_top_sellers` | Ranked by units/revenue/growth |
| `rr_get_slow_movers` | Dead stock and carrying cost estimates |
| `rr_get_inventory_value` | On-hand + in-transit value breakdown |
| `rr_get_sku_health` | Velocity, margin, stock score, lifecycle |
| `rr_get_lost_sales` | Revenue lost to stockout events |

### Write Tools (10) — Growth+ creation, Scale operations

| Tool | Description |
|------|-------------|
| `rr_trigger_sync` | Manually trigger inventory sync |
| `rr_acknowledge_alert` | Mark alert as seen + add agent note |
| `rr_create_purchase_order` | Create draft PO (always draft-only, no auto-send) |
| `rr_update_purchase_order` | Modify draft PO details |
| `rr_add_po_note` | Add internal notes to PO |
| `rr_request_approval` | Request human approval (generates signed approval URL) |
| `rr_send_purchase_order` | Send approved PO to supplier |
| `rr_cancel_purchase_order` | Cancel draft or sent PO |
| `rr_get_document_upload_url` | S3 presigned URL for PI/invoice upload |
| `rr_record_pi_review` | Log proforma invoice details and variances |

## Setup Patterns

### Claude Desktop (5 minutes)

See [Quick Start](#quick-start-claude-desktop) above.

### Custom Agent (Python + Claude API)

```python
import anthropic
from replenishradar import ReplenishRadarMCPClient

rr = ReplenishRadarMCPClient(api_key="rr_sk_live_...")
client = anthropic.Anthropic()
tools = rr.get_tools()

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    tools=tools,
    messages=[{"role": "user", "content": "Draft POs for my critical SKUs"}],
    system="You are an inventory operations agent. Create draft POs only."
)
```

### OpenClaw + Slack/Discord

1. In ReplenishRadar: Settings > API Keys > Create (scope: write)
2. In OpenClaw: Tools > Add MCP Server > URL: `https://api.replenishradar.com/mcp`, Auth: `Bearer rr_sk_live_...`
3. Configure webhook: Settings > API & Webhooks > Subscribe to events
4. Agent receives stockout alerts and can act on them in Slack/Discord

### n8n / Make (No-Code)

Call the REST API directly at `https://api.replenishradar.com/api/mcp/call` with your API key in the `Authorization` header.

For detailed setup guides and system prompt templates, see [docs/SETUP.md](docs/SETUP.md).

## Rate Limits

| Tier | Price | API Calls/Hour | Read Tools | Write Tools |
|------|-------|----------------|------------|-------------|
| Growth | $199/mo | 100 | All 18 | Draft POs only |
| Scale | $499/mo | 1,000 | All 18 | Full PO lifecycle |
| Enterprise | Custom | Unlimited | All 18 | Full + custom SLAs |

## Security

- **Org-scoped API keys** — cross-org access impossible at the query layer
- **Draft-only enforcement** — server-side, not client-side
- **Circuit breaker** — suspends keys exceeding 200% of hourly limit
- **Audit logging** — every tool call logged with 7-year retention
- **Amazon BSA compliant** — identification headers, kill switch, no training on Amazon data
- **OWASP LLM Top 10** — controls for prompt injection, excessive agency, sensitive data exposure

For full security documentation, see [docs/SECURITY.md](docs/SECURITY.md).

## Architecture

```
Your agent (Claude, GPT, Gemini, custom)
         |
         v
@replenishradar/mcp-server (stdio bridge)
         |
         v
POST https://api.replenishradar.com/api/mcp/call
         |
         v
ReplenishRadar backend (rate limiting, audit, org-scoping)
         |
         v
Your inventory data (Shopify + Amazon)
```

The MCP server is a thin stdio bridge that dispatches all tool calls to the ReplenishRadar REST API. Authentication is via `REPLENISHRADAR_API_KEY` environment variable.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REPLENISHRADAR_API_KEY` | Yes | — | Your API key (`rr_sk_live_...`) |
| `REPLENISHRADAR_API_URL` | No | `https://api.replenishradar.com` | API base URL (for self-hosted/testing) |

## Documentation

- [Setup Guide & Agent Patterns](docs/SETUP.md)
- [Security & Compliance](docs/SECURITY.md)
- [MCP Setup Blog Post](https://replenishradar.com/blog/connect-ai-agent-amazon-shopify-inventory)
- [API Docs](https://replenishradar.com/docs/api)
- [Website](https://replenishradar.com)

## License

Proprietary — see [LICENSE](LICENSE)
