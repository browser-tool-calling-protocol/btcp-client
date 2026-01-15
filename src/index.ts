/**
 * BTCP Client - Browser Tool Calling Protocol Client
 *
 * A TypeScript/JavaScript client for connecting browser extensions to AI agents
 * via the Browser Tool Calling Protocol (BTCP).
 *
 * ## Local Mode (default - Chrome Extension)
 *
 * @example
 * ```typescript
 * import { BTCPClient } from 'btcp-client';
 *
 * // Create client (local mode by default)
 * const client = new BTCPClient();
 *
 * // Register tool handlers
 * client.registerHandler('searchPage', async (args) => {
 *   const results = document.querySelectorAll(args.selector as string);
 *   return `Found ${results.length} elements`;
 * });
 *
 * // Execute tools directly (agent calls this via its own interface)
 * const result = await client.execute('searchPage', { selector: '.button' });
 * console.log(result.content); // [{ type: 'text', text: 'Found 5 elements' }]
 * ```
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
 * // Register tool handler
 * client.registerHandler('myTool', async (args) => {
 *   return `Result: ${args.value}`;
 * });
 *
 * // Connect to server (required for remote mode)
 * await client.connect();
 *
 * // Register tools with server
 * await client.registerTools([...]);
 * ```
 */

// Main client (local by default, remote with serverUrl)
export { BTCPClient } from './client.js';

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
  // Local client types
  BTCPToolCallResult,
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
