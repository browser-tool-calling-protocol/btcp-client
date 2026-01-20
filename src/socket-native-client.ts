/**
 * BTCP Socket Native Client
 *
 * WebSocket-based client for the Browser Tool Calling Protocol.
 * Provides bidirectional, full-duplex communication with lower latency
 * compared to the SSE+HTTP transport.
 *
 * @see docs/protocols/socket-native.md
 */

import {
  BTCPClientConfig,
  BTCPClientEvents,
  BTCPClientEventHandler,
  BTCPToolDefinition,
  BTCPToolCallRequest,
  BTCPToolsListRequest,
  BTCPToolCallResult,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  BTCPConnectionError,
} from './types.js';

import {
  createRequest,
  createResponse,
  createToolCallResponse,
  createToolCallErrorResponse,
  parseMessage,
  serializeMessage,
  isRequest,
  isResponse,
  generateMessageId,
} from './protocol.js';

import { ToolExecutor } from './executor.js';
import type { ToolConsumer } from './consumer.js';

/**
 * Socket Native client configuration
 */
export interface SocketNativeClientConfig extends BTCPClientConfig {
  /** WebSocket server URL (ws:// or wss://) */
  serverUrl: string;
  /** Keep-alive ping interval in ms (default: 30000) */
  pingInterval?: number;
}

const DEFAULT_CONFIG: Required<Omit<SocketNativeClientConfig, 'serverUrl'>> & { serverUrl: string } = {
  serverUrl: '',
  sessionId: '',
  version: '1.0.0',
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
  connectionTimeout: 10000,
  debug: false,
  local: false,
  pingInterval: 30000,
};

// WebSocket implementation (browser or Node.js)
let WebSocketImpl: typeof WebSocket;

/**
 * BTCP Socket Native Client
 *
 * WebSocket-based tool provider for Browser Tool Calling Protocol.
 *
 * @example
 * ```typescript
 * const client = new SocketNativeClient({
 *   serverUrl: 'ws://localhost:8765',
 *   debug: true,
 * });
 *
 * client.registerHandler('greet', async (args) => {
 *   return `Hello, ${args.name}!`;
 * });
 *
 * await client.connect();
 * await client.registerTools([
 *   {
 *     name: 'greet',
 *     description: 'Greet a person',
 *     inputSchema: { type: 'object', properties: { name: { type: 'string' } } }
 *   }
 * ]);
 * ```
 */
export class SocketNativeClient {
  private config: Required<SocketNativeClientConfig>;
  private ws: WebSocket | null = null;
  private eventHandlers: Map<keyof BTCPClientEvents, Set<Function>> = new Map();
  private pendingRequests: Map<string | number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private reconnectAttempts = 0;
  private isConnecting = false;
  private executor: ToolExecutor;
  private registeredTools: BTCPToolDefinition[] = [];
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: SocketNativeClientConfig) {
    if (!config.serverUrl) {
      throw new BTCPConnectionError('serverUrl is required for SocketNativeClient');
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      local: false, // Socket native is always remote
      sessionId: config.sessionId || generateMessageId(),
    };
    this.executor = new ToolExecutor();
  }

  /**
   * Get the tool executor
   */
  getExecutor(): ToolExecutor {
    return this.executor;
  }

  /**
   * Register a tool handler (convenience method)
   */
  registerHandler(name: string, handler: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.executor.registerHandler(name, handler);
  }

  /**
   * Get a ToolConsumer for this client
   */
  async getConsumer(): Promise<ToolConsumer> {
    const { ToolConsumer } = await import('./consumer.js');
    return new ToolConsumer({ client: this as unknown as import('./client.js').BTCPClient });
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if running in local mode (always false for socket native)
   */
  isLocal(): boolean {
    return false;
  }

  /**
   * Connect to the BTCP server via WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.isConnecting) {
      throw new BTCPConnectionError('Connection already in progress');
    }

    this.isConnecting = true;

    // Ensure WebSocket is available
    await this.ensureWebSocket();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        reject(new BTCPConnectionError('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        // Build WebSocket URL with query parameters
        const wsUrl = this.buildWebSocketUrl();
        this.log(`Connecting to ${wsUrl}`);

        this.ws = new WebSocketImpl(wsUrl);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.log('Connected to BTCP server via WebSocket');

          // Start ping interval
          this.startPingInterval();

          this.emit('connect');
          resolve();
        };

        this.ws.onerror = (event) => {
          clearTimeout(timeout);
          if (this.isConnecting) {
            this.isConnecting = false;
            const error = new BTCPConnectionError('WebSocket connection error');
            this.emit('error', error);
            reject(error);
          }
        };

        this.ws.onclose = (event) => {
          clearTimeout(timeout);
          this.stopPingInterval();

          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new BTCPConnectionError(`WebSocket closed: ${event.code} ${event.reason}`));
          } else {
            this.handleDisconnect(event.code, event.reason);
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };

      } catch (err) {
        clearTimeout(timeout);
        this.isConnecting = false;
        reject(new BTCPConnectionError(`Failed to connect: ${(err as Error).message}`));
      }
    });
  }

  /**
   * Build WebSocket URL with query parameters
   */
  private buildWebSocketUrl(): string {
    const baseUrl = this.config.serverUrl.replace(/\/$/, '');

    // Determine if we need to append /ws endpoint
    const url = new URL(baseUrl);
    if (!url.pathname.endsWith('/ws')) {
      url.pathname = url.pathname + '/ws';
    }

    // Add query parameters
    url.searchParams.set('sessionId', this.config.sessionId);
    url.searchParams.set('clientType', 'browser');
    url.searchParams.set('version', this.config.version);

    return url.toString();
  }

  /**
   * Execute a tool directly
   */
  async execute(name: string, args: Record<string, unknown> = {}): Promise<BTCPToolCallResult> {
    try {
      const content = await this.executor.execute(name, args);
      return { content, isError: false };
    } catch (err) {
      const error = err as Error;
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  /**
   * Ensure WebSocket is available
   */
  private async ensureWebSocket(): Promise<void> {
    if (typeof globalThis.WebSocket !== 'undefined') {
      WebSocketImpl = globalThis.WebSocket;
      return;
    }

    // Node.js environment - use ws package
    try {
      const { default: WS } = await import('ws');
      WebSocketImpl = WS as unknown as typeof WebSocket;
    } catch {
      throw new BTCPConnectionError(
        'WebSocket not available. Install ws package: npm install ws'
      );
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.config.autoReconnect = false;
    this.stopPingInterval();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }

    // Clear pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new BTCPConnectionError('Client disconnected'));
    }
    this.pendingRequests.clear();

    this.emit('disconnect', 1000, 'Client disconnected');
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeout = 30000
  ): Promise<JsonRpcResponse> {
    if (!this.isConnected()) {
      throw new BTCPConnectionError('Not connected to server');
    }

    const request = createRequest(method, params);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new BTCPConnectionError(`Request timeout: ${method}`));
      }, timeout);

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout: timeoutId,
      });

      this.sendRaw(request);
    });
  }

  /**
   * Send a message (no response expected)
   */
  async send(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): Promise<void> {
    this.sendRaw(message);
  }

  /**
   * Send raw message over WebSocket
   */
  private sendRaw(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new BTCPConnectionError('WebSocket not connected');
    }

    const data = serializeMessage(message);
    this.log('Sending:', data);
    this.ws.send(data);
  }

  /**
   * Register tools with the server
   */
  async registerTools(tools: BTCPToolDefinition[]): Promise<void> {
    this.registeredTools = tools;

    // Register handlers with executor
    for (const tool of tools) {
      if (!this.executor.hasHandler(tool.name)) {
        this.log(`Warning: No handler registered for tool: ${tool.name}`);
      }
    }

    if (this.isConnected()) {
      await this.sendRequest('tools/register', { tools });
    }
  }

  /**
   * Get registered tools
   */
  getRegisteredTools(): BTCPToolDefinition[] {
    return this.registeredTools;
  }

  /**
   * Add event listener
   */
  on<K extends keyof BTCPClientEvents>(
    event: K,
    handler: BTCPClientEventHandler<K>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof BTCPClientEvents>(
    event: K,
    handler: BTCPClientEventHandler<K>
  ): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Emit an event
   */
  private emit<K extends keyof BTCPClientEvents>(
    event: K,
    ...args: Parameters<BTCPClientEvents[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as Function)(...args);
        } catch (err) {
          this.log(`Error in event handler for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    this.log('Received:', data);

    const message = parseMessage(data);
    if (!message) {
      this.log('Invalid message received');
      return;
    }

    // Handle response to pending request
    if (isResponse(message)) {
      this.handleResponseMessage(message);
      return;
    }

    // Handle incoming request
    if (isRequest(message)) {
      this.handleRequest(message);
      return;
    }

    // Emit generic message event for notifications
    this.emit('message', message);
  }

  /**
   * Handle response message
   */
  private handleResponseMessage(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  /**
   * Handle incoming request from server
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    this.log(`Handling request: ${request.method}`);

    switch (request.method) {
      case 'tools/list':
        await this.handleToolsList(request as BTCPToolsListRequest);
        break;

      case 'tools/call':
        await this.handleToolCall(request as BTCPToolCallRequest);
        break;

      case 'ping':
        this.sendRaw(createResponse(request.id, { pong: true }));
        break;

      default:
        this.log(`Unknown method: ${request.method}`);
        this.sendRaw(createResponse(request.id, undefined, {
          code: -32601,
          message: `Method not found: ${request.method}`,
        }));
    }
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(request: BTCPToolsListRequest): Promise<void> {
    this.emit('toolsList', request);

    const tools = this.registeredTools;
    this.sendRaw(createResponse(request.id, { tools }));
  }

  /**
   * Handle tools/call request
   */
  private async handleToolCall(request: BTCPToolCallRequest): Promise<void> {
    this.emit('toolCall', request);

    const { name, arguments: args } = request.params;

    try {
      const result = await this.executor.execute(name, args);
      this.sendRaw(createToolCallResponse(request.id, result));
    } catch (err) {
      this.log(`Tool execution error for ${name}:`, err);
      this.sendRaw(createToolCallErrorResponse(request.id, err as Error));
    }
  }

  /**
   * Start keep-alive ping interval
   */
  private startPingInterval(): void {
    if (this.config.pingInterval > 0) {
      this.pingIntervalId = setInterval(() => {
        if (this.isConnected()) {
          this.sendRequest('ping').catch((err) => {
            this.log('Ping failed:', err);
          });
        }
      }, this.config.pingInterval);
    }
  }

  /**
   * Stop keep-alive ping interval
   */
  private stopPingInterval(): void {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  /**
   * Handle disconnect and auto-reconnect
   */
  private handleDisconnect(code: number, reason: string): void {
    this.ws = null;
    this.stopPingInterval();
    this.emit('disconnect', code, reason);

    if (!this.config.autoReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect()
        .then(() => {
          // Re-register tools after reconnection
          if (this.registeredTools.length > 0) {
            return this.registerTools(this.registeredTools);
          }
        })
        .catch((err) => {
          this.log('Reconnection failed:', err);
        });
    }, delay);
  }

  /**
   * Log message if debug is enabled
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[BTCP-WS]', ...args);
    }
  }
}
