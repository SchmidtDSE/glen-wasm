/**
 * Bundle entry point for vendor/mcp-server-sdk.js: the server half of the MCP
 * SDK, pre-bundled so the worker imports it by relative path with no module
 * host at runtime (same approach as glen-harness's vendored client bundle).
 *
 * Rebuild with `pnpm run build:vendor`.
 */
export { Server } from '@modelcontextprotocol/sdk/server/index.js';
export { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
