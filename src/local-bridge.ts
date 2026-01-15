/**
 * BTCP Local Client - Run tools locally without a server
 *
 * Use this when the client and agent run in the same context (Chrome extension).
 * The agent integrates via its own interface (MCP, programmatic, etc.).
 *
 * @example
 * ```typescript
 * import { createLocalClient } from 'btcp-client';
 *
 * // Create local client
 * const client = createLocalClient();
 *
 * // Register tool handlers
 * client.registerHandler('click', async (args) => {
 *   document.querySelector(args.selector as string)?.click();
 *   return 'clicked';
 * });
 *
 * // Execute tools directly (agent calls this)
 * const result = await client.execute('click', { selector: '.btn' });
 * ```
 */

import {
  BTCPToolDefinition,
  BTCPContent,
  BTCPToolCallResult,
  ToolHandler,
} from './types.js';

import { ToolExecutor } from './executor.js';

/**
 * Local client interface - what the agent needs to call tools
 */
export interface LocalClient {
  /** Register a tool handler */
  registerHandler(name: string, handler: ToolHandler): void;

  /** Execute a tool by name */
  execute(name: string, args: Record<string, unknown>): Promise<BTCPToolCallResult>;

  /** Get tool definitions */
  getToolDefinitions(): BTCPToolDefinition[];

  /** Set browser agent for built-in browser tools */
  setBrowserAgent(agent: unknown): void;

  /** Access underlying executor if needed */
  readonly executor: ToolExecutor;
}

/**
 * Create a local client for in-process tool execution
 */
export function createLocalClient(): LocalClient {
  const executor = new ToolExecutor();

  return {
    registerHandler(name: string, handler: ToolHandler): void {
      executor.registerHandler(name, handler);
    },

    async execute(name: string, args: Record<string, unknown>): Promise<BTCPToolCallResult> {
      try {
        const content = await executor.execute(name, args);
        return { content, isError: false };
      } catch (err) {
        const error = err as Error;
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },

    getToolDefinitions(): BTCPToolDefinition[] {
      return executor.getToolDefinitions();
    },

    setBrowserAgent(agent: unknown): void {
      executor.setBrowserAgent(agent as Parameters<ToolExecutor['setBrowserAgent']>[0]);
    },

    get executor(): ToolExecutor {
      return executor;
    },
  };
}

// Keep backward compatibility exports (deprecated)
export { createLocalClient as BTCPLocalBridge };
export { createLocalClient as BTCPLocalClient };
export { createLocalClient as BTCPAgentAdapter };
