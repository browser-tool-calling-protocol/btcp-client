/**
 * BTCP Protocol Types
 * Based on https://github.com/browser-tool-calling-protocol/btcp-specification
 */

// ============================================================================
// JSON-RPC Types (base protocol)
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ============================================================================
// BTCP Tool Types
// ============================================================================

export interface BTCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  capabilities?: string[];
  timeout?: number;
  examples?: BTCPToolExample[];
  deprecated?: boolean;
  tags?: string[];
}

export interface BTCPToolExample {
  name?: string;
  description?: string;
  input: Record<string, unknown>;
  output?: unknown;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  [key: string]: unknown;
}

// ============================================================================
// BTCP Message Types
// ============================================================================

export type BTCPMessageType =
  | 'hello'
  | 'tools/list'
  | 'tools/call'
  | 'tools/register'
  | 'session/join'
  | 'session/leave'
  | 'capabilities/request'
  | 'capabilities/grant'
  | 'ping'
  | 'pong';

// Hello message (client -> server)
export interface BTCPHelloMessage extends JsonRpcRequest {
  method: 'hello';
  params: {
    clientType: 'browser' | 'agent';
    version: string;
    capabilities?: string[];
    sessionId?: string;
  };
}

// Tools list request (agent -> server -> client)
export interface BTCPToolsListRequest extends JsonRpcRequest {
  method: 'tools/list';
  params?: {
    filter?: {
      capabilities?: string[];
      tags?: string[];
    };
  };
}

// Tools list response
export interface BTCPToolsListResponse extends JsonRpcResponse {
  result: {
    tools: BTCPToolDefinition[];
  };
}

// Tool call request (agent -> server -> client)
export interface BTCPToolCallRequest extends JsonRpcRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
    timeout?: number;
  };
}

// Tool call response
export interface BTCPToolCallResponse extends JsonRpcResponse {
  result?: {
    content: BTCPContent[];
    isError?: boolean;
  };
}

export interface BTCPContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

// Tool registration (client -> server)
export interface BTCPToolRegisterRequest extends JsonRpcRequest {
  method: 'tools/register';
  params: {
    tools: BTCPToolDefinition[];
  };
}

// Session messages
export interface BTCPSessionJoinRequest extends JsonRpcRequest {
  method: 'session/join';
  params: {
    sessionId: string;
  };
}

// ============================================================================
// BTCP Client Types
// ============================================================================

export interface BTCPClientConfig {
  /** Server URL for remote mode (omit for local mode) */
  serverUrl?: string;
  /** Run in local mode (no server, default: true if no serverUrl) */
  local?: boolean;
  /** Client session ID (auto-generated if not provided) */
  sessionId?: string;
  /** Client version string */
  version?: string;
  /** Auto-reconnect on disconnect (remote mode only) */
  autoReconnect?: boolean;
  /** Reconnection delay in ms (remote mode only) */
  reconnectDelay?: number;
  /** Max reconnection attempts (remote mode only) */
  maxReconnectAttempts?: number;
  /** Connection timeout in ms (remote mode only) */
  connectionTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface BTCPClientEvents {
  connect: () => void;
  disconnect: (code: number, reason: string) => void;
  error: (error: Error) => void;
  message: (message: JsonRpcRequest | JsonRpcNotification) => void;
  toolCall: (request: BTCPToolCallRequest) => void;
  toolsList: (request: BTCPToolsListRequest) => void;
}

export type BTCPClientEventHandler<K extends keyof BTCPClientEvents> = BTCPClientEvents[K];

// ============================================================================
// Tool Executor Types
// ============================================================================

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<BTCPContent[] | string | unknown>;

export interface ToolExecutorConfig {
  /** Custom tool handlers */
  handlers?: Map<string, ToolHandler>;
  /** Browser agent instance (optional, for browser automation tools) */
  browserAgent?: unknown;
  /** Enable default browser tools */
  enableBrowserTools?: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

export class BTCPError extends Error {
  constructor(
    message: string,
    public code: number,
    public data?: unknown
  ) {
    super(message);
    this.name = 'BTCPError';
  }
}

export class BTCPConnectionError extends BTCPError {
  constructor(message: string, data?: unknown) {
    super(message, -32000, data);
    this.name = 'BTCPConnectionError';
  }
}

export class BTCPValidationError extends BTCPError {
  constructor(message: string, data?: unknown) {
    super(message, -32602, data);
    this.name = 'BTCPValidationError';
  }
}

export class BTCPExecutionError extends BTCPError {
  constructor(message: string, data?: unknown) {
    super(message, -32603, data);
    this.name = 'BTCPExecutionError';
  }
}

export class BTCPToolNotFoundError extends BTCPError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, -32601);
    this.name = 'BTCPToolNotFoundError';
  }
}

// ============================================================================
// Local Client Types
// ============================================================================

/**
 * Tool execution result
 */
export interface BTCPToolCallResult {
  /** Content returned by the tool */
  content: BTCPContent[];
  /** Whether the result is an error */
  isError?: boolean;
}
