# Bring Your Own Agent

ReplenishRadar is the **data and action layer** for your inventory. We provide:

- **MCP server** — 28 tools your agent can call (stockout risk, forecasts, PO lifecycle, sales analytics)
- **Webhooks** — real-time events pushed to your agent when inventory state changes
- **Action URLs** — signed links your agent can include in messages to let you approve POs with one click

**We do not provide a bot.** The agent — the LLM, the reasoning, the conversation handling, the Slack/Discord integration — is yours. You bring it. We plug into it.

## How It Works

```
Your agent (Claude, GPT, Gemini, custom)
         |
         v
ReplenishRadar MCP Server (28 tools)
         |
         v
Your inventory data (Shopify + Amazon)

Webhooks push events -> your agent reacts
Your agent calls tools -> ReplenishRadar acts
Notification cards include action URLs -> you approve in one click
purchase_order.approved fires -> your agent continues the workflow
```

## Pattern 1: Claude Desktop (5 minutes)

Best for: operators who want to query their inventory conversationally without writing code.

1. In ReplenishRadar: **Settings > API & Webhooks > Create API Key** > label it "claude-desktop" > scope: read > copy the key

2. Edit `~/.claude/claude_desktop_config.json`:

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

3. Restart Claude Desktop. ReplenishRadar tools appear automatically.

**What you can ask Claude:**
- "What are my top stockout risks right now?"
- "What should I order this week and from which suppliers?"
- "Are there any active alerts I should know about?"
- "What's the 30-day demand forecast for SKU WEP-500-BLK?"

For write actions (creating draft POs), create a second key with `write` scope.

## Pattern 2: OpenClaw + Slack

Best for: operators who want their agent to live in Slack — receive alerts, ask questions, approve POs.

**Architecture:**
```
Slack message -> OpenClaw agent -> RR MCP tools -> response in Slack
RR webhook -> your endpoint -> OpenClaw agent -> Slack message
```

1. **Connect RR to your OpenClaw agent:** In OpenClaw agent settings > Tools > Add MCP Server:
   ```
   URL: https://api.replenishradar.com/mcp
   Auth: Bearer rr_sk_live_your_key_here
   ```

2. **Connect OpenClaw to Slack:** Follow OpenClaw's Slack integration docs.

3. **Set up webhooks:** In ReplenishRadar: Settings > API & Webhooks > Add Webhook:
   ```
   URL: [your OpenClaw inbound webhook URL]
   Events: inventory.reorder_point_crossed, inventory.stockout_risk_changed,
           purchase_order.document_received, sync.failed
   ```

**What this looks like in Slack:**

```
Agent: Reorder Alert — WEP-500-BLK

4.1 days of stock remaining on Amazon.
Nothing currently on order.

I've drafted PO #78 for 950 units from Shenzhen AudioCo
($19,950 - ETA March 29).

Approve: https://replenishradar.com/actions/approve-po?po_id=...#token=...
```

## Pattern 3: Custom Agent (Python + Claude API)

Best for: developers who want full control over agent behaviour, prompting, and conversation flow.

```python
import anthropic
from replenishradar import ReplenishRadarMCPClient

rr = ReplenishRadarMCPClient(api_key="rr_sk_live_...")
client = anthropic.Anthropic()
tools = rr.get_tools()

def run_agent(user_message: str) -> str:
    messages = [{"role": "user", "content": user_message}]

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            tools=tools,
            messages=messages,
            system="""You are an inventory operations agent.
                      Use ReplenishRadar tools to answer questions
                      and manage inventory. Always create POs as drafts."""
        )

        if response.stop_reason == "end_turn":
            return response.content[0].text

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        tool_results = []

        for tool_use in tool_uses:
            result = rr.call_tool(tool_use.name, tool_use.input)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": str(result)
            })

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

print(run_agent("What are my top stockout risks today?"))
```

**Wiring webhook events to the agent:**

```python
from flask import Flask, request
import hmac, hashlib

app = Flask(__name__)

@app.post("/rr-webhook")
def handle_rr_event():
    sig = request.headers.get("X-RR-Webhook-Signature", "")
    delivery_id = request.headers.get("X-RR-Delivery-ID", "")
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        f"{delivery_id}.".encode() + request.data,
        hashlib.sha256
    ).hexdigest()
    assert hmac.compare_digest(f"sha256={expected}", sig)

    event = request.json
    if event["event"] in ("inventory.reorder_point_crossed", "inventory.stockout_risk_changed"):
        sku = event["data"]["sku"]
        days = event["data"]["days_of_stock"]
        response = run_agent(
            f"Webhook: {sku} has {days} days of stock. "
            f"Assess and draft a PO if nothing is on order."
        )
    return {"ok": True}
```

## Pattern 4: n8n / Make (No-Code)

n8n calls the REST API directly (not the MCP server). The MCP server is for LLM agents; for no-code tools, use the REST API at `https://api.replenishradar.com/api/mcp/call`.

```
[RR Webhook Trigger]
        |
[HTTP Request: rr_get_stockout_risk]
        |
[IF: risk_level = "critical"]
        | yes
[HTTP Request: rr_list_purchase_orders]  <- check nothing on order
        |
[HTTP Request: rr_create_purchase_order]
        |
[Slack: post message with approval link]
```

## The Approval Flow

Regardless of which agent pattern you use, PO approval works the same way:

1. Agent creates a draft PO via `rr_create_purchase_order`
2. Agent posts a message with the approval action URL
3. You click the link — opens a confirmation page (you're logged into RR)
4. One click to confirm — PO status changes to `approved`
5. `purchase_order.approved` webhook fires to your agent
6. Agent sends the PO to the supplier via `rr_send_purchase_order`

The action URL token is valid for 15 minutes. After that, approve in the ReplenishRadar UI directly.

## System Prompt Templates

### Minimal (read-only, daily briefing)

```
You are an inventory assistant for [Brand].
You have access to ReplenishRadar tools.

Every morning when invoked:
1. Get all critical and high stockout risks
2. Get active alerts
3. Check what's already on order for at-risk items
4. Return a concise briefing — worst problems first, then context.

Be brief. One sentence per item. Lead with the number.
```

### Full Operator (read + write, reactive)

```
You are an inventory operations agent for [Brand].
You monitor stockout risk, manage purchase orders, and
keep the owner informed. You have access to ReplenishRadar.

When a webhook event arrives:
- Use rr_get_stockout_risk to confirm severity
- Use rr_list_purchase_orders to check if anything is on order
- Use rr_list_suppliers to get lead time and unit cost
- Use rr_get_demand_forecast to calculate correct order quantity
  (round up to nearest casepack, respect MOQ)
- Create a draft PO with rr_create_purchase_order
- Acknowledge the alert with rr_acknowledge_alert and a note
- Post a message with the PO summary and approval link

Rules:
- Never send a PO to a supplier — only create drafts
- Never create duplicate POs — always check rr_list_purchase_orders first
- Always include days_of_stock and lead_time in your reasoning
- If a PI is received, compare to the original PO and flag discrepancies
```

## FAQ

**Does ReplenishRadar read my Slack or Discord messages?**
No. ReplenishRadar has no access to your chat platforms. The connection runs entirely through your agent.

**What if my agent goes rogue and creates hundreds of POs?**
All POs are drafts — they cannot be sent without human approval. API keys are rate-limited with a circuit breaker that suspends the key if it exceeds 200% of its hourly limit.

**Can I use GPT-4 / Gemini / another model?**
Yes. Any model that supports MCP or can make HTTP requests works. The MCP server is model-agnostic.

**Does my agent have access to other organisations' data?**
No. API keys are org-scoped. Cross-org access is impossible at the database query layer.

**How does the agent know when I've approved a PO?**
Subscribe to the `purchase_order.approved` webhook event. When you click the approval URL, ReplenishRadar fires the webhook within seconds.
