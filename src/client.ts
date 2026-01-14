/**
 * BTCP Client - WebSocket client for Browser Tool Calling Protocol
 */

import {
  BTCPClientConfig,
  BTCPClientEvents,
  BTCPClientEventHandler,
  BTCPToolDefinition,
  BTCPToolCallRequest,
  BTCPToolsListRequest,
  BTCPContent,
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

const DEFAULT_CONFIG: Required<BTCPClientConfig> = {
  serverUrl: 'ws://localhost:8765',
  sessionId: '',
  version: '1.0.0',
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
  connectionTimeout: 10000,
  debug: false,
};

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
};

export class BTCPClient {
  private config: Required<BTCPClientConfig>;
  private ws: WebSocketLike | null = null;
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

  constructor(config: BTCPClientConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
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
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1; // WebSocket.OPEN
  }

  /**
   * Connect to the BTCP server
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.isConnecting) {
      throw new BTCPConnectionError('Connection already in progress');
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        reject(new BTCPConnectionError('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        // Use dynamic import to support both Node.js and browser
        this.createWebSocket().then((ws) => {
          this.ws = ws;

          ws.onopen = () => {
            clearTimeout(timeout);
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            this.log('Connected to BTCP server');
            this.sendHello();
            this.emit('connect');
            resolve();
          };

          ws.onclose = (event) => {
            clearTimeout(timeout);
            this.isConnecting = false;
            this.ws = null;
            this.log(`Disconnected: ${event.code} - ${event.reason}`);
            this.emit('disconnect', event.code, event.reason);
            this.handleDisconnect();
          };

          ws.onerror = (event) => {
            clearTimeout(timeout);
            this.isConnecting = false;
            const error = new BTCPConnectionError(
              (event as { message?: string }).message || 'WebSocket error'
            );
            this.emit('error', error);
            reject(error);
          };

          ws.onmessage = (event) => {
            this.handleMessage(event.data);
          };
        }).catch((err) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          reject(new BTCPConnectionError(`Failed to create WebSocket: ${err.message}`));
        });
      } catch (err) {
        clearTimeout(timeout);
        this.isConnecting = false;
        reject(new BTCPConnectionError(`Failed to connect: ${(err as Error).message}`));
      }
    });
  }

  /**
   * Create WebSocket instance (supports both Node.js and browser)
   */
  private async createWebSocket(): Promise<WebSocketLike> {
    // Check if we're in a browser environment
    if (typeof globalThis.WebSocket !== 'undefined') {
      return new globalThis.WebSocket(this.config.serverUrl) as unknown as WebSocketLike;
    }

    // Node.js environment - use ws package
    const { default: WebSocket } = await import('ws');
    return new WebSocket(this.config.serverUrl) as unknown as WebSocketLike;
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.ws) {
      this.config.autoReconnect = false; // Prevent auto-reconnect
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
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

      this.send(request);
    });
  }

  /**
   * Send a message without waiting for response
   */
  send(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
    if (!this.isConnected()) {
      throw new BTCPConnectionError('Not connected to server');
    }

    const data = serializeMessage(message);
    this.log('Sending:', data);
    this.ws!.send(data);
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
   * Send hello message to server
   */
  private sendHello(): void {
    const request = createRequest('hello', {
      clientType: 'browser',
      version: this.config.version,
      sessionId: this.config.sessionId,
      capabilities: ['tools/execute', 'browser/automation'],
    });
    this.send(request);

    // Re-register tools if we have any
    if (this.registeredTools.length > 0) {
      this.send(createRequest('tools/register', { tools: this.registeredTools }));
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
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.resolve(message);
      }
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
   * Handle incoming request from server
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    this.log(`Handling request: ${request.method}`);

    switch (request.method) {
      case 'tools/list':
        this.handleToolsList(request as BTCPToolsListRequest);
        break;

      case 'tools/call':
        await this.handleToolCall(request as BTCPToolCallRequest);
        break;

      case 'ping':
        this.send(createResponse(request.id, { pong: true }));
        break;

      default:
        this.log(`Unknown method: ${request.method}`);
        this.send(createResponse(request.id, undefined, {
          code: -32601,
          message: `Method not found: ${request.method}`,
        }));
    }
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(request: BTCPToolsListRequest): void {
    this.emit('toolsList', request);

    const tools = this.registeredTools;
    this.send(createResponse(request.id, { tools }));
  }

  /**
   * Handle tools/call request
   */
  private async handleToolCall(request: BTCPToolCallRequest): Promise<void> {
    this.emit('toolCall', request);

    const { name, arguments: args } = request.params;

    try {
      const result = await this.executor.execute(name, args);
      this.send(createToolCallResponse(request.id, result));
    } catch (err) {
      this.log(`Tool execution error for ${name}:`, err);
      this.send(createToolCallErrorResponse(request.id, err as Error));
    }
  }

  /**
   * Handle disconnect and auto-reconnect
   */
  private handleDisconnect(): void {
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
      this.connect().catch((err) => {
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
