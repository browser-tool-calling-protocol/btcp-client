/**
 * BTCP Local Bridge - In-process communication between client and agent
 *
 * This module provides direct integration for Chrome extensions and other
 * scenarios where the browser client and AI agent run in the same context.
 * No external server is required.
 *
 * @example
 * ```typescript
 * // Create a bridge for in-process communication
 * const bridge = new BTCPLocalBridge();
 *
 * // Client side: Create local client and register tools
 * const client = bridge.createClient();
 * client.getExecutor().registerHandler('myTool', async (args) => {
 *   return `Result: ${args.value}`;
 * });
 * client.registerTools([...]);
 *
 * // Agent side: Create adapter and call tools
 * const agent = bridge.createAgentAdapter();
 * const tools = await agent.listTools();
 * const result = await agent.callTool('myTool', { value: 'test' });
 * ```
 */

import {
  BTCPToolDefinition,
  BTCPContent,
  BTCPLocalBridgeConfig,
  BTCPToolCallResult,
  BTCPLocalBridgeEvents,
  IBTCPLocalClient,
  IBTCPAgentAdapter,
  BTCPExecutionError,
} from './types.js';

import { ToolExecutor } from './executor.js';

/**
 * Event emitter for the local bridge
 */
type EventCallback<K extends keyof BTCPLocalBridgeEvents> = BTCPLocalBridgeEvents[K];

/**
 * BTCPLocalBridge - Enables direct in-process communication between
 * a browser client and an AI agent without requiring an external server.
 *
 * This is ideal for Chrome extensions where both the client (content script
 * or background worker) and the agent run in the same JavaScript context.
 */
export class BTCPLocalBridge {
  private config: Required<BTCPLocalBridgeConfig>;
  private client: BTCPLocalClient | null = null;
  private adapters: Set<BTCPAgentAdapter> = new Set();
  private eventHandlers: Map<keyof BTCPLocalBridgeEvents, Set<Function>> = new Map();

  constructor(config: BTCPLocalBridgeConfig = {}) {
    this.config = {
      debug: config.debug ?? false,
    };
  }

  /**
   * Create a local client for tool registration and execution
   */
  createClient(): BTCPLocalClient {
    if (this.client) {
      this.log('Warning: Client already exists, returning existing client');
      return this.client;
    }

    this.client = new BTCPLocalClient(this);
    this.log('Created local client');
    return this.client;
  }

  /**
   * Get the existing client (if any)
   */
  getClient(): BTCPLocalClient | null {
    return this.client;
  }

  /**
   * Create an agent adapter for calling tools
   */
  createAgentAdapter(): BTCPAgentAdapter {
    const adapter = new BTCPAgentAdapter(this);
    this.adapters.add(adapter);
    this.log('Created agent adapter');
    return adapter;
  }

  /**
   * Get all registered tools from the client
   */
  getTools(): BTCPToolDefinition[] {
    return this.client?.getRegisteredTools() ?? [];
  }

  /**
   * Execute a tool through the client
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<BTCPToolCallResult> {
    if (!this.client) {
      throw new BTCPExecutionError('No client connected to bridge');
    }

    this.emit('toolCall', name, args);

    try {
      const executor = this.client.getExecutor();
      const content = await executor.execute(name, args);
      return { content, isError: false };
    } catch (err) {
      const error = err as Error;
      this.emit('error', error);
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  /**
   * Notify adapters that tools have been updated
   */
  notifyToolsUpdated(tools: BTCPToolDefinition[]): void {
    this.emit('toolsUpdated', tools);
  }

  /**
   * Add event listener
   */
  on<K extends keyof BTCPLocalBridgeEvents>(
    event: K,
    handler: EventCallback<K>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof BTCPLocalBridgeEvents>(
    event: K,
    handler: EventCallback<K>
  ): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Emit an event
   */
  private emit<K extends keyof BTCPLocalBridgeEvents>(
    event: K,
    ...args: Parameters<BTCPLocalBridgeEvents[K]>
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
   * Check if client is connected
   */
  hasClient(): boolean {
    return this.client !== null;
  }

  /**
   * Disconnect and clean up
   */
  dispose(): void {
    this.client = null;
    this.adapters.clear();
    this.eventHandlers.clear();
    this.log('Bridge disposed');
  }

  /**
   * Log message if debug is enabled
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[BTCPBridge]', ...args);
    }
  }
}

/**
 * BTCPLocalClient - Client side of the local bridge
 *
 * Manages tool registration and execution for in-process communication.
 */
export class BTCPLocalClient implements IBTCPLocalClient {
  private bridge: BTCPLocalBridge;
  private executor: ToolExecutor;
  private registeredTools: BTCPToolDefinition[] = [];

  constructor(bridge: BTCPLocalBridge) {
    this.bridge = bridge;
    this.executor = new ToolExecutor();
  }

  /**
   * Get the tool executor for registering handlers
   */
  getExecutor(): ToolExecutor {
    return this.executor;
  }

  /**
   * Register tools with the bridge
   */
  registerTools(tools: BTCPToolDefinition[]): void {
    this.registeredTools = tools;

    // Warn about missing handlers
    for (const tool of tools) {
      if (!this.executor.hasHandler(tool.name)) {
        console.warn(`[BTCPLocalClient] No handler registered for tool: ${tool.name}`);
      }
    }

    // Notify the bridge and all adapters
    this.bridge.notifyToolsUpdated(tools);
  }

  /**
   * Get registered tools
   */
  getRegisteredTools(): BTCPToolDefinition[] {
    return this.registeredTools;
  }

  /**
   * Check if connected to bridge (always true for local client)
   */
  isConnected(): boolean {
    return true;
  }

  /**
   * Set browser agent for browser automation tools
   */
  setBrowserAgent(agent: unknown): void {
    this.executor.setBrowserAgent(agent as Parameters<ToolExecutor['setBrowserAgent']>[0]);
  }

  /**
   * Get all tool definitions including built-in browser tools
   */
  getAllToolDefinitions(): BTCPToolDefinition[] {
    return this.executor.getToolDefinitions();
  }
}

/**
 * BTCPAgentAdapter - Agent side of the local bridge
 *
 * Provides a simple API for AI agents to list and call tools
 * without dealing with protocol details.
 */
export class BTCPAgentAdapter implements IBTCPAgentAdapter {
  private bridge: BTCPLocalBridge;
  private toolsUpdateCallbacks: Set<(tools: BTCPToolDefinition[]) => void> = new Set();
  private boundToolsHandler: (tools: BTCPToolDefinition[]) => void;

  constructor(bridge: BTCPLocalBridge) {
    this.bridge = bridge;

    // Listen for tools updates from bridge
    this.boundToolsHandler = (tools: BTCPToolDefinition[]) => {
      for (const callback of this.toolsUpdateCallbacks) {
        try {
          callback(tools);
        } catch (err) {
          console.error('[BTCPAgentAdapter] Error in tools update callback:', err);
        }
      }
    };
    this.bridge.on('toolsUpdated', this.boundToolsHandler);
  }

  /**
   * List available tools
   */
  async listTools(): Promise<BTCPToolDefinition[]> {
    return this.bridge.getTools();
  }

  /**
   * Call a tool by name
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @returns Tool call result with content
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<BTCPToolCallResult> {
    return this.bridge.executeTool(name, args);
  }

  /**
   * Subscribe to tools updated events
   *
   * @param callback - Callback to invoke when tools are updated
   * @returns Unsubscribe function
   */
  onToolsUpdated(callback: (tools: BTCPToolDefinition[]) => void): () => void {
    this.toolsUpdateCallbacks.add(callback);

    // Return unsubscribe function
    return () => {
      this.toolsUpdateCallbacks.delete(callback);
    };
  }

  /**
   * Check if connected to client (through bridge)
   */
  isConnected(): boolean {
    return this.bridge.hasClient();
  }

  /**
   * Wait for client to connect
   *
   * @param timeout - Max wait time in ms (default: 5000)
   */
  async waitForClient(timeout = 5000): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for client to connect'));
      }, timeout);

      // Poll for client connection
      const checkInterval = setInterval(() => {
        if (this.isConnected()) {
          clearTimeout(timeoutId);
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Dispose the adapter and clean up listeners
   */
  dispose(): void {
    this.bridge.off('toolsUpdated', this.boundToolsHandler);
    this.toolsUpdateCallbacks.clear();
  }
}
