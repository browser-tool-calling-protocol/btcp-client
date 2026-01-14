/**
 * BTCP Protocol Message Handler
 */

import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  BTCPContent,
  BTCPError,
} from './types.js';

let messageIdCounter = 0;

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `btcp-${Date.now()}-${++messageIdCounter}`;
}

/**
 * Create a JSON-RPC request
 */
export function createRequest(
  method: string,
  params?: Record<string, unknown>
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: generateMessageId(),
    method,
    ...(params && { params }),
  };
}

/**
 * Create a JSON-RPC response
 */
export function createResponse(
  id: string | number,
  result?: unknown,
  error?: JsonRpcError
): JsonRpcResponse {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  return response;
}

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return createResponse(id, undefined, { code, message, data });
}

/**
 * Create a JSON-RPC notification (no id, no response expected)
 */
export function createNotification(
  method: string,
  params?: Record<string, unknown>
): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(params && { params }),
  };
}

/**
 * Create a tool result content
 */
export function createTextContent(text: string): BTCPContent {
  return { type: 'text', text };
}

export function createImageContent(data: string, mimeType = 'image/png'): BTCPContent {
  return { type: 'image', data, mimeType };
}

export function createResourceContent(uri: string, text?: string, mimeType?: string): BTCPContent {
  return { type: 'resource', uri, text, mimeType };
}

/**
 * Create a successful tool call response
 */
export function createToolCallResponse(
  id: string | number,
  content: BTCPContent[]
): JsonRpcResponse {
  return createResponse(id, { content, isError: false });
}

/**
 * Create an error tool call response
 */
export function createToolCallErrorResponse(
  id: string | number,
  error: Error | BTCPError | string
): JsonRpcResponse {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorCode = error instanceof BTCPError ? error.code : -32603;

  return createResponse(id, {
    content: [{ type: 'text', text: `Error: ${errorMessage}` }],
    isError: true,
  }, {
    code: errorCode,
    message: errorMessage,
  });
}

/**
 * Parse an incoming message
 */
export function parseMessage(
  data: string
): JsonRpcRequest | JsonRpcResponse | JsonRpcNotification | null {
  try {
    const parsed = JSON.parse(data);

    // Validate JSON-RPC 2.0 format
    if (parsed.jsonrpc !== '2.0') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check if message is a request
 */
export function isRequest(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): message is JsonRpcRequest {
  return 'method' in message && 'id' in message;
}

/**
 * Check if message is a response
 */
export function isResponse(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): message is JsonRpcResponse {
  return !('method' in message) && 'id' in message;
}

/**
 * Check if message is a notification
 */
export function isNotification(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): message is JsonRpcNotification {
  return 'method' in message && !('id' in message);
}

/**
 * Serialize message to string
 */
export function serializeMessage(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): string {
  return JSON.stringify(message);
}
