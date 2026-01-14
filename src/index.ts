/**
 * BTCP Client - Browser Tool Calling Protocol Client
 *
 * A TypeScript/JavaScript client for connecting browser extensions to AI agents
 * via the Browser Tool Calling Protocol (BTCP).
 *
 * @example
 * ```typescript
 * import { BTCPClient } from 'btcp-client';
 *
 * const client = new BTCPClient({
 *   serverUrl: 'ws://localhost:8765',
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
 */

// Main client
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
