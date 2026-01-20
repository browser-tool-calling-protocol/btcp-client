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
 * ## Remote Mode with WebSocket
 *
 * @example
 * ```typescript
 * import { BTCPClient, WebSocketTransport } from 'btcp-client';
 *
 * const client = new BTCPClient({
 *   transport: new WebSocketTransport({ url: 'ws://localhost:8765' }),
 *   debug: true,
 * });
 *
 * client.registerHandler('greet', async (args) => `Hello, ${args.name}!`);
 * await client.connect();
 * await client.registerTools([
 *   { name: 'greet', description: 'Greet a person', inputSchema: { type: 'object' } }
 * ]);
 * ```
 *
 * ## Remote Mode with HTTP Streaming (SSE + POST)
 *
 * @example
 * ```typescript
 * import { BTCPClient, HttpStreamingTransport } from 'btcp-client';
 *
 * const client = new BTCPClient({
 *   transport: new HttpStreamingTransport({ url: 'http://localhost:8765' }),
 *   debug: true,
 * });
 *
 * await client.connect();
 * ```
 */

// Tool provider (browser side)
export { BTCPClient, type BTCPClientOptions } from './client.js';

// Tool consumer (agent side)
export { ToolConsumer, type ToolConsumerConfig } from './consumer.js';

// Tool executor
export { ToolExecutor } from './executor.js';

// Transport layer
export {
  // Types
  type Transport,
  type TransportConfig,
  type TransportEvents,
  type TransportEventHandler,
  type WebSocketTransportConfig,
  type HttpStreamingTransportConfig,
  // Base class (for custom implementations)
  BaseTransport,
  // Transport implementations
  WebSocketTransport,
  HttpStreamingTransport,
} from './transport/index.js';

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
