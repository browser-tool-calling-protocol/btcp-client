/**
 * BTCP Client - Browser Tool Calling Protocol
 *
 * Two main classes:
 * - BTCPClient: Tool PROVIDER (browser side) - registers and executes tools
 * - ToolConsumer: Tool CONSUMER (agent side) - lists and calls tools
 *
 * ## Local Mode (same process - Chrome Extension)
 *
 * @example
 * ```typescript
 * import { BTCPClient } from 'btcp-client';
 *
 * // Provider: register tools
 * const client = new BTCPClient();
 * client.registerHandler('click', async (args) => {
 *   document.querySelector(args.selector as string)?.click();
 *   return 'clicked';
 * });
 *
 * // Consumer: get from client
 * const consumer = await client.getConsumer();
 * const tools = await consumer.listTools();
 * const result = await consumer.callTool('click', { selector: '.btn' });
 * ```
 *
 * ## Remote Mode (separate processes)
 *
 * @example
 * ```typescript
 * // Browser side (tool provider)
 * const client = new BTCPClient({ serverUrl: 'http://localhost:8765' });
 * client.registerHandler('click', async (args) => { ... });
 * await client.connect();
 *
 * // Agent side (tool consumer) - separate process
 * const consumer = new ToolConsumer({ serverUrl: 'http://localhost:8765' });
 * const tools = await consumer.listTools();
 * const result = await consumer.callTool('click', { selector: '.btn' });
 * ```
 */

// Tool provider (browser side)
export { BTCPClient } from './client.js';

// Tool consumer (agent side)
export { ToolConsumer, type ToolConsumerConfig } from './consumer.js';

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
