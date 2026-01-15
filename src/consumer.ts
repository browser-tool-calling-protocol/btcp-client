/**
 * BTCP Tool Consumer - Agent-side interface for calling tools
 *
 * ToolConsumer is the tool CONSUMER (agent side):
 * - Lists available tools
 * - Calls tools by name
 *
 * Works in two modes:
 * - Local: wraps BTCPClient directly (same process)
 * - Remote: connects to BTCP server via HTTP
 */

import {
  BTCPToolDefinition,
  BTCPToolCallResult,
  BTCPContent,
} from './types.js';

import { BTCPClient } from './client.js';

/**
 * Configuration for ToolConsumer
 */
export interface ToolConsumerConfig {
  /** Server URL for remote mode */
  serverUrl?: string;
  /** BTCPClient instance for local mode */
  client?: BTCPClient;
  /** Request timeout in ms */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Tool Consumer - Agent-side interface for calling tools
 *
 * @example Local mode (same process)
 * ```typescript
 * const client = new BTCPClient();
 * client.registerHandler('click', async (args) => { ... });
 *
 * const consumer = new ToolConsumer({ client });
 * const tools = await consumer.listTools();
 * const result = await consumer.callTool('click', { selector: '.btn' });
 * ```
 *
 * @example Remote mode (separate process)
 * ```typescript
 * const consumer = new ToolConsumer({ serverUrl: 'http://localhost:8765' });
 * const tools = await consumer.listTools();
 * const result = await consumer.callTool('click', { selector: '.btn' });
 * ```
 */
export class ToolConsumer {
  private config: Required<ToolConsumerConfig>;
  private client: BTCPClient | null;
  private isRemote: boolean;

  constructor(config: ToolConsumerConfig = {}) {
    this.client = config.client ?? null;
    this.isRemote = !!config.serverUrl && !config.client;

    this.config = {
      serverUrl: config.serverUrl ?? '',
      client: config.client ?? (null as unknown as BTCPClient),
      timeout: config.timeout ?? 30000,
      debug: config.debug ?? false,
    };

    if (!this.client && !this.isRemote) {
      throw new Error('ToolConsumer requires either a client (local) or serverUrl (remote)');
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<BTCPToolDefinition[]> {
    if (this.client) {
      // Local mode: get tools from client's executor
      return this.client.getExecutor().getToolDefinitions();
    }

    // Remote mode: fetch from server
    return this.fetchFromServer<BTCPToolDefinition[]>('tools/list', {});
  }

  /**
   * Call a tool by name
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<BTCPToolCallResult> {
    if (this.client) {
      // Local mode: execute directly
      return this.client.execute(name, args);
    }

    // Remote mode: call via server
    try {
      const result = await this.fetchFromServer<{ content: BTCPContent[]; isError?: boolean }>(
        'tools/call',
        { name, arguments: args }
      );
      return {
        content: result.content,
        isError: result.isError ?? false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  /**
   * Check if running in local mode
   */
  isLocal(): boolean {
    return !this.isRemote;
  }

  /**
   * Fetch from server (remote mode)
   */
  private async fetchFromServer<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const url = `${this.config.serverUrl}/rpc`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const json = await response.json();

    if (json.error) {
      throw new Error(json.error.message || 'Unknown error');
    }

    return json.result as T;
  }

  /**
   * Log message if debug is enabled
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[ToolConsumer]', ...args);
    }
  }
}
