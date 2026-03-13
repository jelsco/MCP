#!/usr/bin/env node
/**
 * ReplenishRadar MCP Server — stdio bridge to REST API.
 * Claude Desktop launches this via npx; talks MCP over stdin/stdout.
 * All tool calls are dispatched to POST https://api.replenishradar.com/api/mcp/call
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_KEY = process.env.REPLENISHRADAR_API_KEY;
const BASE_URL = process.env.REPLENISHRADAR_API_URL || 'https://api.replenishradar.com';

if (!API_KEY) {
  console.error('Missing required environment variable: REPLENISHRADAR_API_KEY');
  process.exit(1);
}

// Tool definitions with input schemas
const TOOLS = [
  // Read tools (18)
  { name: 'rr_get_stockout_risk', description: 'Get stockout risk levels for SKUs', inputSchema: { type: 'object' as const, properties: { risk_level: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, sku: { type: 'string' }, store_id: { type: 'string' }, limit: { type: 'number', default: 100 } } } },
  { name: 'rr_get_inventory_position', description: 'Get stock-by-location for an item', inputSchema: { type: 'object' as const, properties: { item_id: { type: 'string' }, sku: { type: 'string' } } } },
  { name: 'rr_get_demand_forecast', description: 'Get demand forecast stats for an item', inputSchema: { type: 'object' as const, properties: { sku: { type: 'string' }, item_id: { type: 'string' }, window_days: { type: 'number' }, store_id: { type: 'string' } } } },
  { name: 'rr_get_suggested_purchase_orders', description: 'Get suggested purchase orders', inputSchema: { type: 'object' as const, properties: { status: { type: 'string' }, vendor_id: { type: 'string' }, store_id: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'rr_get_alerts', description: 'Get active alerts', inputSchema: { type: 'object' as const, properties: { status: { type: 'string' }, alert_type: { type: 'string' }, severity: { type: 'string' }, sku: { type: 'string' }, store_id: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' } } } },
  { name: 'rr_list_items', description: 'List inventory items', inputSchema: { type: 'object' as const, properties: { vendor_id: { type: 'string' }, search: { type: 'string' }, needs_review: { type: 'boolean' }, limit: { type: 'number' }, offset: { type: 'number' } } } },
  { name: 'rr_get_sync_status', description: 'Get recent sync run history', inputSchema: { type: 'object' as const, properties: { connector_type: { type: 'string' }, store_id: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'rr_list_suppliers', description: 'List vendors/suppliers', inputSchema: { type: 'object' as const, properties: { include_skus: { type: 'boolean' } } } },
  { name: 'rr_list_purchase_orders', description: 'List purchase orders', inputSchema: { type: 'object' as const, properties: { status: { type: 'string' }, vendor_id: { type: 'string' }, search: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' } } } },
  { name: 'rr_get_purchase_order', description: 'Get a single purchase order with line items', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' } }, required: ['po_id'] } },
  { name: 'rr_get_po_pdf', description: 'Get info for generating a PO PDF', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' } }, required: ['po_id'] } },
  { name: 'rr_get_po_documents', description: 'List documents attached to a PO', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' } }, required: ['po_id'] } },
  { name: 'rr_get_sales_history', description: 'Get sales history', inputSchema: { type: 'object' as const, properties: { sku: { type: 'string' }, store_id: { type: 'string' }, days: { type: 'number', default: 30 }, limit: { type: 'number' } } } },
  { name: 'rr_get_top_sellers', description: 'Get top-selling SKUs', inputSchema: { type: 'object' as const, properties: { days: { type: 'number', default: 30 }, limit: { type: 'number', default: 20 }, store_id: { type: 'string' } } } },
  { name: 'rr_get_slow_movers', description: 'Get slow-moving SKUs', inputSchema: { type: 'object' as const, properties: { days: { type: 'number', default: 30 }, limit: { type: 'number', default: 20 }, store_id: { type: 'string' } } } },
  { name: 'rr_get_inventory_value', description: 'Get total inventory value breakdown', inputSchema: { type: 'object' as const, properties: { store_id: { type: 'string' } } } },
  { name: 'rr_get_sku_health', description: 'Quick SKU-level health summary (risk counts, alert counts)', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'rr_get_lost_sales', description: 'Estimate lost sales from stockouts', inputSchema: { type: 'object' as const, properties: { days: { type: 'number', default: 30 } } } },
  // Write tools (10)
  { name: 'rr_trigger_sync', description: 'Trigger an inventory sync', inputSchema: { type: 'object' as const, properties: { connector_type: { type: 'string', enum: ['shopify', 'amazon'] }, store_id: { type: 'string' } }, required: ['connector_type'] } },
  { name: 'rr_acknowledge_alert', description: 'Acknowledge an alert', inputSchema: { type: 'object' as const, properties: { alert_id: { type: 'string' }, note: { type: 'string' } }, required: ['alert_id'] } },
  { name: 'rr_create_purchase_order', description: 'Create a draft purchase order', inputSchema: { type: 'object' as const, properties: { vendor_id: { type: 'string' }, po_number: { type: 'string' }, notes: { type: 'string' }, expected_delivery_date: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'number' }, unit_cost: { type: 'number' } } } } }, required: ['vendor_id'] } },
  { name: 'rr_update_purchase_order', description: 'Update a draft purchase order', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' }, notes: { type: 'string' }, expected_delivery_date: { type: 'string' }, vendor_id: { type: 'string' } }, required: ['po_id'] } },
  { name: 'rr_add_po_note', description: 'Add a note to a purchase order', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' }, content: { type: 'string' } }, required: ['po_id', 'content'] } },
  { name: 'rr_request_approval', description: 'Request human approval for a PO (returns a link)', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' }, message: { type: 'string' } }, required: ['po_id'] } },
  { name: 'rr_send_purchase_order', description: 'Send an approved PO to the supplier', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' } }, required: ['po_id'] } },
  { name: 'rr_cancel_purchase_order', description: 'Cancel a purchase order', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' } }, required: ['po_id'] } },
  { name: 'rr_get_document_upload_url', description: 'Get upload URL for a PO document', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' }, filename: { type: 'string' }, document_type: { type: 'string' }, description: { type: 'string' } }, required: ['po_id', 'filename'] } },
  { name: 'rr_record_pi_review', description: 'Record proforma invoice details on a PO', inputSchema: { type: 'object' as const, properties: { po_id: { type: 'string' }, pi_number: { type: 'string' }, pi_date: { type: 'string' }, pi_total: { type: 'number' }, pi_terms: { type: 'string' } }, required: ['po_id'] } },
];

async function callApi(toolName: string, input: Record<string, unknown>): Promise<unknown> {
  const resp = await fetch(`${BASE_URL}/api/mcp/call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ tool: toolName, input }),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`API error ${resp.status}: ${errorBody}`);
  }

  const data = await resp.json();
  return data.result;
}

async function main() {
  const server = new Server(
    { name: 'replenishradar', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await callApi(name, (args as Record<string, unknown>) || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server fatal error:', error);
  process.exit(1);
});
