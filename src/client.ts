/**
 * BTCP Client - Tool provider for Browser Tool Calling Protocol
 *
 * BTCPClient is the tool PROVIDER (browser side):
 * - Registers tool handlers
 * - Executes tools when called
 * - Connects to server via pluggable transport
 *
 * For the tool CONSUMER (agent side), use ToolConsumer.
 *
 * @example Local mode (no transport):
 * ```typescript
 * const client = new BTCPClient({ debug: true });
 * client.registerHandler('greet', async (args) => `Hello, ${args.name}!`);
 * const result = await client.execute('greet', { name: 'World' });
 * ```
 *
 * @example Remote mode with WebSocket:
 * ```typescript
 * import { BTCPClient, WebSocketTransport } from 'btcp-client';
 *
 * const client = new BTCPClient({
 *   transport: new WebSocketTransport({ url: 'ws://localhost:8765' }),
 *   debug: true,
 * });
 * await client.connect();
 * ```
 *
 * @example Remote mode with HTTP Streaming:
 * ```typescript
 * import { BTCPClient, HttpStreamingTransport } from 'btcp-client';
 *
 * const client = new BTCPClient({
 *   transport: new HttpStreamingTransport({ url: 'http://localhost:8765' }),
 *   debug: true,
 * });
 * await client.connect();
 * ```
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
import type { Transport } from './transport/types.js';

/**
 * Extended client configuration with transport support
 */
export interface BTCPClientOptions extends Omit<BTCPClientConfig, 'serverUrl' | 'local'> {
  /** Transport to use for remote communication (omit for local mode) */
  transport?: Transport;
}

const DEFAULT_CONFIG = {
  sessionId: '',
  version: '1.0.0',
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
  connectionTimeout: 10000,
  debug: false,
};

export class BTCPClient {
  private config: typeof DEFAULT_CONFIG & { sessionId: string };
  private transport: Transport | null;
  private eventHandlers: Map<keyof BTCPClientEvents, Set<Function>> = new Map();
  private pendingRequests: Map<string | number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private reconnectAttempts = 0;
  private executor: ToolExecutor;
  private registeredTools: BTCPToolDefinition[] = [];

  constructor(config: BTCPClientOptions = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      sessionId: config.sessionId || generateMessageId(),
    };
    this.transport = config.transport || null;
    this.executor = new ToolExecutor();

    // Setup transport event handlers
    if (this.transport) {
      this.setupTransportHandlers();
    }
  }

  /**
   * Setup event handlers for the transport
   */
  private setupTransportHandlers(): void {
    if (!this.transport) return;

    this.transport.on('connect', () => {
      this.reconnectAttempts = 0;
      this.log('Connected to server');
      this.emit('connect');
    });

    this.transport.on('disconnect', (code, reason) => {
      this.log(`Disconnected: ${code} ${reason}`);
      this.emit('disconnect', code, reason);

      // Clear pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new BTCPConnectionError('Connection lost'));
      }
      this.pendingRequests.clear();

      // Auto-reconnect if enabled
      if (this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
        this.handleReconnect();
      }
    });

    this.transport.on('error', (error) => {
      this.log('Transport error:', error);
      this.emit('error', error);
    });

    this.transport.on('message', (data) => {
      this.handleMessage(data);
    });
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
   * Get a ToolConsumer for this client (local mode)
   */
  async getConsumer(): Promise<ToolConsumer> {
    // Dynamic import to avoid circular dependency
    const { ToolConsumer } = await import('./consumer.js');
    return new ToolConsumer({ client: this });
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Check if client is connected (always true in local mode)
   */
  isConnected(): boolean {
    if (this.isLocal()) {
      return true;
    }
    return this.transport?.isConnected() ?? false;
  }

  /**
   * Check if running in local mode (no transport)
   */
  isLocal(): boolean {
    return this.transport === null;
  }

  /**
   * Connect to the server (no-op in local mode)
   */
  async connect(): Promise<void> {
    // Local mode: no connection needed
    if (this.isLocal()) {
      this.log('Running in local mode, no server connection needed');
      this.emit('connect');
      return;
    }

    if (this.isConnected()) {
      return;
    }

    await this.transport!.connect();
  }

  /**
   * Execute a tool directly (for local mode or direct invocation)
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
   * Disconnect from the server
   */
  disconnect(): void {
    this.config.autoReconnect = false;

    if (this.transport) {
      this.transport.disconnect();
    }

    // Clear pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new BTCPConnectionError('Client disconnected'));
    }
    this.pendingRequests.clear();
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

      this.sendRaw(request).catch((err) => {
        this.pendingRequests.delete(request.id);
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  /**
   * Send a message (no response expected)
   */
  async send(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): Promise<void> {
    await this.sendRaw(message);
  }

  /**
   * Send raw message via transport
   */
  private async sendRaw(
    message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
  ): Promise<void> {
    if (!this.transport) {
      throw new BTCPConnectionError('No transport configured (local mode)');
    }

    const data = serializeMessage(message);
    this.log('Sending:', data);
    await this.transport.send(data);
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

    if (this.isConnected() && !this.isLocal()) {
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
   * Handle incoming message from transport
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
        await this.send(createResponse(request.id, { pong: true }));
        break;

      default:
        this.log(`Unknown method: ${request.method}`);
        await this.send(createResponse(request.id, undefined, {
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
    await this.send(createResponse(request.id, { tools }));
  }

  /**
   * Handle tools/call request
   */
  private async handleToolCall(request: BTCPToolCallRequest): Promise<void> {
    this.emit('toolCall', request);

    const { name, arguments: args } = request.params;

    try {
      const result = await this.executor.execute(name, args);
      await this.send(createToolCallResponse(request.id, result));
    } catch (err) {
      this.log(`Tool execution error for ${name}:`, err);
      await this.send(createToolCallErrorResponse(request.id, err as Error));
    }
  }

  /**
   * Handle auto-reconnection
   */
  private handleReconnect(): void {
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
      console.log('[BTCP]', ...args);
    }
  }
}
