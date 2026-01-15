/**
 * BTCP Client - HTTP Streaming client for Browser Tool Calling Protocol
 * Uses SSE for server→client, POST for client→server (more bandwidth efficient than WebSocket)
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

const DEFAULT_CONFIG: Required<BTCPClientConfig> = {
  serverUrl: '',
  sessionId: '',
  version: '1.0.0',
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
  connectionTimeout: 10000,
  debug: false,
  local: true, // Default to local mode
};

// EventSource polyfill for Node.js
let EventSourceImpl: typeof EventSource;

export class BTCPClient {
  private config: Required<BTCPClientConfig>;
  private eventSource: EventSource | null = null;
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
  private abortController: AbortController | null = null;

  constructor(config: BTCPClientConfig = {}) {
    // Determine mode: local if no serverUrl, remote if serverUrl provided
    const isLocal = config.local ?? !config.serverUrl;

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      local: isLocal,
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
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Check if client is connected (always true in local mode)
   */
  isConnected(): boolean {
    if (this.config.local) {
      return true;
    }
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }

  /**
   * Check if running in local mode
   */
  isLocal(): boolean {
    return this.config.local;
  }

  /**
   * Connect to the BTCP server using SSE (no-op in local mode)
   */
  async connect(): Promise<void> {
    // Local mode: no connection needed
    if (this.config.local) {
      this.log('Running in local mode, no server connection needed');
      this.emit('connect');
      return;
    }

    if (this.isConnected()) {
      return;
    }

    if (this.isConnecting) {
      throw new BTCPConnectionError('Connection already in progress');
    }

    this.isConnecting = true;
    this.abortController = new AbortController();

    // Ensure EventSource is available
    await this.ensureEventSource();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        reject(new BTCPConnectionError('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        const sseUrl = `${this.config.serverUrl}/events?sessionId=${encodeURIComponent(this.config.sessionId)}&clientType=browser&version=${this.config.version}`;

        this.eventSource = new EventSourceImpl(sseUrl);

        this.eventSource.onopen = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.log('Connected to BTCP server via SSE');
          this.emit('connect');
          resolve();
        };

        this.eventSource.onerror = (event) => {
          clearTimeout(timeout);
          if (this.isConnecting) {
            this.isConnecting = false;
            const error = new BTCPConnectionError('SSE connection error');
            this.emit('error', error);
            reject(error);
          } else {
            this.handleDisconnect();
          }
        };

        this.eventSource.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        // Listen for specific event types
        this.eventSource.addEventListener('request', (event) => {
          this.handleMessage((event as MessageEvent).data);
        });

        this.eventSource.addEventListener('response', (event) => {
          this.handleMessage((event as MessageEvent).data);
        });

      } catch (err) {
        clearTimeout(timeout);
        this.isConnecting = false;
        reject(new BTCPConnectionError(`Failed to connect: ${(err as Error).message}`));
      }
    });
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
   * Ensure EventSource is available (polyfill for Node.js)
   */
  private async ensureEventSource(): Promise<void> {
    if (typeof globalThis.EventSource !== 'undefined') {
      EventSourceImpl = globalThis.EventSource;
      return;
    }

    // Node.js environment - use eventsource package
    try {
      const { default: EventSource } = await import('eventsource');
      EventSourceImpl = EventSource as unknown as typeof globalThis.EventSource;
    } catch {
      throw new BTCPConnectionError(
        'EventSource not available. Install eventsource package: npm install eventsource'
      );
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.config.autoReconnect = false;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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
   * Send a JSON-RPC request via HTTP POST and wait for response
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

      this.postMessage(request).catch((err) => {
        this.pendingRequests.delete(request.id);
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  /**
   * Send a message via HTTP POST (no response expected)
   */
  async send(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): Promise<void> {
    await this.postMessage(message);
  }

  /**
   * Post a message to the server via HTTP
   */
  private async postMessage(
    message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
  ): Promise<void> {
    const url = `${this.config.serverUrl}/message`;
    const body = serializeMessage(message);

    this.log('Sending:', body);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': this.config.sessionId,
      },
      body,
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new BTCPConnectionError(`HTTP error: ${response.status}`);
    }

    // Check if there's a response body
    const text = await response.text();
    if (text) {
      const parsed = parseMessage(text);
      if (parsed && isResponse(parsed)) {
        this.handleResponseMessage(parsed);
      }
    }
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
   * Handle incoming SSE message
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
   * Handle disconnect and auto-reconnect
   */
  private handleDisconnect(): void {
    this.eventSource = null;
    this.emit('disconnect', 0, 'Connection lost');

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
