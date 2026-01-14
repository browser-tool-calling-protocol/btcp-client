/**
 * BTCP Tool Executor
 * Handles tool execution with browser agent integration
 */

import {
  BTCPToolDefinition,
  BTCPContent,
  ToolHandler,
  BTCPToolNotFoundError,
  BTCPExecutionError,
} from './types.js';

import { createTextContent, createImageContent } from './protocol.js';

/**
 * Browser Agent Interface
 * Matches the btcp-browser-agent API
 */
interface BrowserAgent {
  launch(): Promise<void>;
  close(): Promise<void>;
  snapshot(options?: Record<string, unknown>): Promise<unknown>;
  click(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  type(selector: string, text: string, options?: Record<string, unknown>): Promise<unknown>;
  hover(selector: string): Promise<unknown>;
  press(key: string, selector?: string): Promise<unknown>;
  scroll(options: Record<string, unknown>): Promise<unknown>;
  waitFor(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  getText(selector: string): Promise<string>;
  getAttribute(selector: string, attribute: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  getUrl(): Promise<string>;
  getTitle(): Promise<string>;
  screenshot(options?: Record<string, unknown>): Promise<string>;
  evaluate<T>(script: string): Promise<T>;
  execute(command: { action: string; [key: string]: unknown }): Promise<unknown>;
}

/**
 * Tool Executor - Handles tool execution
 */
export class ToolExecutor {
  private handlers: Map<string, ToolHandler> = new Map();
  private browserAgent: BrowserAgent | null = null;

  constructor() {
    // Register default handlers
    this.registerDefaultHandlers();
  }

  /**
   * Set the browser agent for browser automation tools
   */
  setBrowserAgent(agent: BrowserAgent): void {
    this.browserAgent = agent;
    this.registerBrowserTools();
  }

  /**
   * Get the browser agent
   */
  getBrowserAgent(): BrowserAgent | null {
    return this.browserAgent;
  }

  /**
   * Register a tool handler
   */
  registerHandler(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Check if a handler exists
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Execute a tool
   */
  async execute(name: string, args: Record<string, unknown>): Promise<BTCPContent[]> {
    const handler = this.handlers.get(name);

    if (!handler) {
      throw new BTCPToolNotFoundError(name);
    }

    try {
      const result = await handler(args);
      return this.normalizeResult(result);
    } catch (err) {
      if (err instanceof BTCPToolNotFoundError) {
        throw err;
      }
      throw new BTCPExecutionError(
        `Tool execution failed: ${(err as Error).message}`,
        { tool: name, args, originalError: (err as Error).message }
      );
    }
  }

  /**
   * Normalize tool result to BTCPContent array
   */
  private normalizeResult(result: unknown): BTCPContent[] {
    if (Array.isArray(result)) {
      // Check if it's already a BTCPContent array
      if (result.length > 0 && typeof result[0] === 'object' && 'type' in result[0]) {
        return result as BTCPContent[];
      }
      // Convert array to text
      return [createTextContent(JSON.stringify(result, null, 2))];
    }

    if (typeof result === 'string') {
      // Check if it looks like base64 image data
      if (result.startsWith('data:image/') || result.match(/^[A-Za-z0-9+/]+=*$/)) {
        return [createImageContent(result)];
      }
      return [createTextContent(result)];
    }

    if (typeof result === 'object' && result !== null) {
      return [createTextContent(JSON.stringify(result, null, 2))];
    }

    return [createTextContent(String(result))];
  }

  /**
   * Register default utility handlers
   */
  private registerDefaultHandlers(): void {
    // Echo tool for testing
    this.registerHandler('echo', async (args) => {
      return createTextContent(args.message as string || 'No message provided');
    });

    // Eval tool for executing JavaScript (sandboxed in browser)
    this.registerHandler('evaluate', async (args) => {
      const script = args.script as string;
      if (!script) {
        throw new BTCPExecutionError('No script provided');
      }

      if (this.browserAgent) {
        const result = await this.browserAgent.evaluate(script);
        return result;
      }

      // Fallback: run in current context (be careful with this!)
      // eslint-disable-next-line no-eval
      const result = eval(script);
      return result;
    });
  }

  /**
   * Register browser automation tools when agent is available
   */
  private registerBrowserTools(): void {
    if (!this.browserAgent) return;

    const agent = this.browserAgent;

    // Snapshot - Get DOM snapshot
    this.registerHandler('browser_snapshot', async (args) => {
      const result = await agent.snapshot(args);
      return result;
    });

    // Click - Click an element
    this.registerHandler('browser_click', async (args) => {
      const selector = args.selector as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      await agent.click(selector, args);
      return createTextContent(`Clicked: ${selector}`);
    });

    // Fill - Fill a form field
    this.registerHandler('browser_fill', async (args) => {
      const selector = args.selector as string;
      const value = args.value as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      if (value === undefined) throw new BTCPExecutionError('value is required');
      await agent.fill(selector, value);
      return createTextContent(`Filled ${selector} with value`);
    });

    // Type - Type text with optional key-by-key typing
    this.registerHandler('browser_type', async (args) => {
      const selector = args.selector as string;
      const text = args.text as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      if (!text) throw new BTCPExecutionError('text is required');
      await agent.type(selector, text, args);
      return createTextContent(`Typed text into ${selector}`);
    });

    // Hover - Hover over an element
    this.registerHandler('browser_hover', async (args) => {
      const selector = args.selector as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      await agent.hover(selector);
      return createTextContent(`Hovered over: ${selector}`);
    });

    // Press - Press a key
    this.registerHandler('browser_press', async (args) => {
      const key = args.key as string;
      const selector = args.selector as string | undefined;
      if (!key) throw new BTCPExecutionError('key is required');
      await agent.press(key, selector);
      return createTextContent(`Pressed key: ${key}`);
    });

    // Scroll - Scroll the page or element
    this.registerHandler('browser_scroll', async (args) => {
      await agent.scroll(args);
      return createTextContent('Scrolled page');
    });

    // Wait - Wait for element
    this.registerHandler('browser_wait', async (args) => {
      const selector = args.selector as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      await agent.waitFor(selector, args);
      return createTextContent(`Element found: ${selector}`);
    });

    // Get text content
    this.registerHandler('browser_get_text', async (args) => {
      const selector = args.selector as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      const text = await agent.getText(selector);
      return createTextContent(text);
    });

    // Get attribute
    this.registerHandler('browser_get_attribute', async (args) => {
      const selector = args.selector as string;
      const attribute = args.attribute as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      if (!attribute) throw new BTCPExecutionError('attribute is required');
      const value = await agent.getAttribute(selector, attribute);
      return createTextContent(value ?? 'null');
    });

    // Check visibility
    this.registerHandler('browser_is_visible', async (args) => {
      const selector = args.selector as string;
      if (!selector) throw new BTCPExecutionError('selector is required');
      const visible = await agent.isVisible(selector);
      return createTextContent(String(visible));
    });

    // Get URL
    this.registerHandler('browser_get_url', async () => {
      const url = await agent.getUrl();
      return createTextContent(url);
    });

    // Get title
    this.registerHandler('browser_get_title', async () => {
      const title = await agent.getTitle();
      return createTextContent(title);
    });

    // Screenshot
    this.registerHandler('browser_screenshot', async (args) => {
      const data = await agent.screenshot(args);
      return createImageContent(data);
    });

    // Execute arbitrary command
    this.registerHandler('browser_execute', async (args) => {
      const action = args.action as string;
      if (!action) throw new BTCPExecutionError('action is required');
      const result = await agent.execute({ action, ...args });
      return result;
    });
  }

  /**
   * Get tool definitions for registered handlers
   */
  getToolDefinitions(): BTCPToolDefinition[] {
    const tools: BTCPToolDefinition[] = [];

    // Echo tool
    if (this.handlers.has('echo')) {
      tools.push({
        name: 'echo',
        description: 'Echo a message back (for testing)',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to echo' },
          },
        },
      });
    }

    // Evaluate tool
    if (this.handlers.has('evaluate')) {
      tools.push({
        name: 'evaluate',
        description: 'Execute JavaScript code in the browser context',
        inputSchema: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'JavaScript code to execute' },
          },
          required: ['script'],
        },
        capabilities: ['code:execute'],
      });
    }

    // Browser tools (if agent is available)
    if (this.browserAgent) {
      tools.push(
        {
          name: 'browser_snapshot',
          description: 'Get a snapshot of the current page DOM',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'Optional CSS selector to snapshot' },
            },
          },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_click',
          description: 'Click an element on the page',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or element ref' },
              button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
              clickCount: { type: 'number', default: 1 },
            },
            required: ['selector'],
          },
          capabilities: ['dom:interact'],
        },
        {
          name: 'browser_fill',
          description: 'Fill a form input field',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or element ref' },
              value: { type: 'string', description: 'Value to fill' },
            },
            required: ['selector', 'value'],
          },
          capabilities: ['dom:interact'],
        },
        {
          name: 'browser_type',
          description: 'Type text into an element',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or element ref' },
              text: { type: 'string', description: 'Text to type' },
              delay: { type: 'number', description: 'Delay between keystrokes (ms)' },
            },
            required: ['selector', 'text'],
          },
          capabilities: ['dom:interact'],
        },
        {
          name: 'browser_hover',
          description: 'Hover over an element',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or element ref' },
            },
            required: ['selector'],
          },
          capabilities: ['dom:interact'],
        },
        {
          name: 'browser_press',
          description: 'Press a keyboard key',
          inputSchema: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Key to press (e.g., Enter, Tab, Escape)' },
              selector: { type: 'string', description: 'Optional element to focus first' },
            },
            required: ['key'],
          },
          capabilities: ['dom:interact'],
        },
        {
          name: 'browser_scroll',
          description: 'Scroll the page or an element',
          inputSchema: {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
              amount: { type: 'number', description: 'Pixels to scroll' },
              selector: { type: 'string', description: 'Element to scroll (default: page)' },
            },
          },
          capabilities: ['dom:interact'],
        },
        {
          name: 'browser_wait',
          description: 'Wait for an element to appear',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector to wait for' },
              timeout: { type: 'number', description: 'Max wait time in ms', default: 30000 },
              state: { type: 'string', enum: ['attached', 'visible', 'hidden'], default: 'visible' },
            },
            required: ['selector'],
          },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_get_text',
          description: 'Get text content of an element',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or element ref' },
            },
            required: ['selector'],
          },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_get_attribute',
          description: 'Get an attribute value of an element',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or element ref' },
              attribute: { type: 'string', description: 'Attribute name' },
            },
            required: ['selector', 'attribute'],
          },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_is_visible',
          description: 'Check if an element is visible',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector or element ref' },
            },
            required: ['selector'],
          },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_get_url',
          description: 'Get the current page URL',
          inputSchema: { type: 'object', properties: {} },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_get_title',
          description: 'Get the current page title',
          inputSchema: { type: 'object', properties: {} },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_screenshot',
          description: 'Take a screenshot of the page',
          inputSchema: {
            type: 'object',
            properties: {
              fullPage: { type: 'boolean', description: 'Capture full page', default: false },
              selector: { type: 'string', description: 'Element to screenshot' },
            },
          },
          capabilities: ['dom:read'],
        },
        {
          name: 'browser_execute',
          description: 'Execute a browser agent command directly',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action name' },
            },
            required: ['action'],
            additionalProperties: true,
          },
          capabilities: ['browser:execute'],
        }
      );
    }

    return tools;
  }
}
