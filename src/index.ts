/**
 * BTCP Client - Browser Tool Calling Protocol Client
 *
 * A TypeScript/JavaScript client for connecting browser extensions to AI agents
 * via the Browser Tool Calling Protocol (BTCP).
 *
 * ## Remote Server Mode (separate processes)
 *
 * @example
 * ```typescript
 * import { BTCPClient } from 'btcp-client';
 *
 * const client = new BTCPClient({
 *   serverUrl: 'http://localhost:8765',
 *   debug: true,
 * });
 *
 * // Register custom tool handler
 * client.getExecutor().registerHandler('myTool', async (args) => {
 *   return `Result: ${args.value}`;
 * });
 *
 * // Connect to server
 * await client.connect();
 *
 * // Register tools with server
 * await client.registerTools([
 *   {
 *     name: 'myTool',
 *     description: 'A custom tool',
 *     inputSchema: {
 *       type: 'object',
 *       properties: { value: { type: 'string' } },
 *     },
 *   },
 * ]);
 * ```
 *
 * ## Local Bridge Mode (same context - Chrome Extension)
 *
 * @example
 * ```typescript
 * import { BTCPLocalBridge } from 'btcp-client';
 *
 * // Create a bridge for in-process communication
 * const bridge = new BTCPLocalBridge({ debug: true });
 *
 * // Client side: Register tools
 * const client = bridge.createClient();
 * client.getExecutor().registerHandler('searchPage', async (args) => {
 *   const results = document.querySelectorAll(args.selector as string);
 *   return `Found ${results.length} elements`;
 * });
 * client.registerTools([{
 *   name: 'searchPage',
 *   description: 'Search for elements on the page',
 *   inputSchema: { type: 'object', properties: { selector: { type: 'string' } } }
 * }]);
 *
 * // Agent side: Call tools directly
 * const agent = bridge.createAgentAdapter();
 * const tools = await agent.listTools();
 * const result = await agent.callTool('searchPage', { selector: '.button' });
 * console.log(result.content); // [{ type: 'text', text: 'Found 5 elements' }]
 * ```
 */

// Main client (server-based)
export { BTCPClient } from './client.js';

// Local bridge (in-process, no server)
export { BTCPLocalBridge, BTCPLocalClient, BTCPAgentAdapter } from './local-bridge.js';

// Tool executor
export { ToolExecutor } from './executor.js';

// Protocol utilities
export {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  createTextContent,
  createImageContent,
  createResourceContent,
  createToolCallResponse,
  createToolCallErrorResponse,
  parseMessage,
  serializeMessage,
  isRequest,
  isResponse,
  isNotification,
  generateMessageId,
} from './protocol.js';

// Types
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  BTCPToolDefinition,
  BTCPToolExample,
  JsonSchema,
  BTCPMessageType,
  BTCPHelloMessage,
  BTCPToolsListRequest,
  BTCPToolsListResponse,
  BTCPToolCallRequest,
  BTCPToolCallResponse,
  BTCPContent,
  BTCPToolRegisterRequest,
  BTCPSessionJoinRequest,
  BTCPClientConfig,
  BTCPClientEvents,
  BTCPClientEventHandler,
  ToolHandler,
  ToolExecutorConfig,
  // Local bridge types
  BTCPLocalBridgeConfig,
  BTCPToolCallResult,
  BTCPLocalBridgeEvents,
  IBTCPLocalClient,
  IBTCPAgentAdapter,
} from './types.js';

// Errors
export {
  BTCPError,
  BTCPConnectionError,
  BTCPValidationError,
  BTCPExecutionError,
  BTCPToolNotFoundError,
} from './types.js';

// Re-export default for convenience
export { BTCPClient as default } from './client.js';
