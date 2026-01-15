/**
 * Chrome Extension Example - BTCP Local Bridge Usage
 *
 * This example demonstrates how to use BTCP in a Chrome extension where
 * both the browser client and AI agent run in the same context.
 *
 * NOTE: This file is an example and requires @types/chrome to compile.
 * Install it with: npm install -D @types/chrome
 *
 * Architecture Overview:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     Chrome Extension                            │
 * │  ┌─────────────────────┐         ┌─────────────────────┐       │
 * │  │   BTCPLocalClient   │◄───────►│  BTCPAgentAdapter   │       │
 * │  │   (Tool Provider)   │         │   (Tool Consumer)   │       │
 * │  │                     │         │                     │       │
 * │  │  - DOM Tools        │         │  - List Tools       │       │
 * │  │  - Form Tools       │         │  - Call Tools       │       │
 * │  │  - Page Tools       │         │  - AI Integration   │       │
 * │  └──────────┬──────────┘         └──────────┬──────────┘       │
 * │             │                               │                   │
 * │             └───────────┬───────────────────┘                   │
 * │                         │                                       │
 * │              ┌──────────▼──────────┐                            │
 * │              │   BTCPLocalBridge   │                            │
 * │              │   (In-Process Bus)  │                            │
 * │              └─────────────────────┘                            │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * No external server required!
 */

import {
  BTCPLocalBridge,
  BTCPLocalClient,
  BTCPAgentAdapter,
  BTCPToolDefinition,
  BTCPToolCallResult,
  IBTCPAgentAdapter,
} from './index.js';

// Chrome extension types (available when @types/chrome is installed)
declare const chrome: {
  runtime?: {
    onMessage: {
      addListener: (
        callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | void
      ) => void;
      removeListener: (callback: unknown) => void;
    };
  };
  tabs: {
    sendMessage: (tabId: number, message: unknown, callback?: (response: unknown) => void) => void;
  };
};

// ============================================================================
// Chrome Extension Content Script Example
// ============================================================================

/**
 * Example: Setting up BTCP in a Chrome extension content script
 */
export class ChromeExtensionBTCP {
  private bridge: BTCPLocalBridge;
  private client: BTCPLocalClient;
  private agent: BTCPAgentAdapter;

  constructor() {
    // Create the local bridge
    this.bridge = new BTCPLocalBridge({ debug: true });

    // Create client (tool provider) and agent (tool consumer)
    this.client = this.bridge.createClient();
    this.agent = this.bridge.createAgentAdapter();

    // Set up tools
    this.setupTools();
  }

  /**
   * Set up browser automation tools
   */
  private setupTools(): void {
    const executor = this.client.getExecutor();

    // Tool: Get page information
    executor.registerHandler('page_info', async () => {
      return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
      };
    });

    // Tool: Query DOM elements
    executor.registerHandler('query_elements', async (args) => {
      const selector = args.selector as string;
      const elements = document.querySelectorAll(selector);
      return {
        count: elements.length,
        elements: Array.from(elements).slice(0, 10).map((el, i) => ({
          index: i,
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          textContent: el.textContent?.slice(0, 100),
        })),
      };
    });

    // Tool: Click an element
    executor.registerHandler('click_element', async (args) => {
      const selector = args.selector as string;
      const element = document.querySelector(selector) as HTMLElement;
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      element.click();
      return `Clicked element: ${selector}`;
    });

    // Tool: Fill a form field
    executor.registerHandler('fill_field', async (args) => {
      const selector = args.selector as string;
      const value = args.value as string;
      const element = document.querySelector(selector) as HTMLInputElement;
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return `Filled ${selector} with value`;
    });

    // Tool: Get element text
    executor.registerHandler('get_text', async (args) => {
      const selector = args.selector as string;
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      return element.textContent || '';
    });

    // Tool: Take a screenshot (using html2canvas or similar)
    executor.registerHandler('screenshot', async () => {
      // In a real implementation, you'd use html2canvas or similar
      // For this example, we'll return a placeholder
      return {
        type: 'image',
        mimeType: 'image/png',
        data: 'screenshot-placeholder',
      };
    });

    // Tool: Execute custom JavaScript
    executor.registerHandler('execute_script', async (args) => {
      const script = args.script as string;
      // Use Function constructor for safer evaluation
      const fn = new Function('return ' + script);
      return fn();
    });

    // Tool: Wait for element
    executor.registerHandler('wait_for_element', async (args) => {
      const selector = args.selector as string;
      const timeout = (args.timeout as number) || 5000;

      return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = () => {
          const element = document.querySelector(selector);
          if (element) {
            resolve(`Element found: ${selector}`);
            return;
          }

          if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout waiting for element: ${selector}`));
            return;
          }

          requestAnimationFrame(check);
        };

        check();
      });
    });

    // Register tool definitions
    const toolDefinitions: BTCPToolDefinition[] = [
      {
        name: 'page_info',
        description: 'Get current page information (URL, title, state)',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'query_elements',
        description: 'Query DOM elements by CSS selector',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector' },
          },
          required: ['selector'],
        },
      },
      {
        name: 'click_element',
        description: 'Click an element on the page',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of element to click' },
          },
          required: ['selector'],
        },
      },
      {
        name: 'fill_field',
        description: 'Fill a form input field with a value',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of input field' },
            value: { type: 'string', description: 'Value to fill' },
          },
          required: ['selector', 'value'],
        },
      },
      {
        name: 'get_text',
        description: 'Get text content of an element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector' },
          },
          required: ['selector'],
        },
      },
      {
        name: 'screenshot',
        description: 'Take a screenshot of the current page',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'execute_script',
        description: 'Execute JavaScript code on the page',
        inputSchema: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'JavaScript code to execute' },
          },
          required: ['script'],
        },
        capabilities: ['code:execute'],
      },
      {
        name: 'wait_for_element',
        description: 'Wait for an element to appear on the page',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector to wait for' },
            timeout: { type: 'number', description: 'Timeout in milliseconds', default: 5000 },
          },
          required: ['selector'],
        },
      },
    ];

    this.client.registerTools(toolDefinitions);
  }

  /**
   * Get the agent adapter for AI integration
   */
  getAgent(): BTCPAgentAdapter {
    return this.agent;
  }

  /**
   * Get the client for additional tool registration
   */
  getClient(): BTCPLocalClient {
    return this.client;
  }

  /**
   * Get the bridge for advanced usage
   */
  getBridge(): BTCPLocalBridge {
    return this.bridge;
  }
}

// ============================================================================
// AI Agent Integration Example
// ============================================================================

/**
 * Example: AI agent that uses BTCP tools
 */
export class ExampleAIAgent {
  private btcp: BTCPAgentAdapter;

  constructor(btcpAdapter: BTCPAgentAdapter) {
    this.btcp = btcpAdapter;
  }

  /**
   * Example: Automated form filling workflow
   */
  async fillLoginForm(username: string, password: string): Promise<string> {
    const steps: string[] = [];

    try {
      // Wait for form to be ready
      await this.btcp.callTool('wait_for_element', { selector: 'form' });
      steps.push('Form found');

      // Fill username
      await this.btcp.callTool('fill_field', {
        selector: 'input[name="username"], input[type="email"], #username',
        value: username,
      });
      steps.push('Username filled');

      // Fill password
      await this.btcp.callTool('fill_field', {
        selector: 'input[name="password"], input[type="password"], #password',
        value: password,
      });
      steps.push('Password filled');

      // Click submit
      await this.btcp.callTool('click_element', {
        selector: 'button[type="submit"], input[type="submit"]',
      });
      steps.push('Form submitted');

      return `Login workflow completed: ${steps.join(' -> ')}`;
    } catch (error) {
      return `Login workflow failed at step: ${steps.length + 1}. Error: ${(error as Error).message}`;
    }
  }

  /**
   * Example: Page analysis workflow
   */
  async analyzePage(): Promise<{
    pageInfo: BTCPToolCallResult;
    links: BTCPToolCallResult;
    buttons: BTCPToolCallResult;
    forms: BTCPToolCallResult;
  }> {
    const [pageInfo, links, buttons, forms] = await Promise.all([
      this.btcp.callTool('page_info', {}),
      this.btcp.callTool('query_elements', { selector: 'a' }),
      this.btcp.callTool('query_elements', { selector: 'button' }),
      this.btcp.callTool('query_elements', { selector: 'form' }),
    ]);

    return { pageInfo, links, buttons, forms };
  }

  /**
   * Example: Execute a sequence of actions
   */
  async executeWorkflow(actions: Array<{ tool: string; args: Record<string, unknown> }>): Promise<BTCPToolCallResult[]> {
    const results: BTCPToolCallResult[] = [];

    for (const action of actions) {
      const result = await this.btcp.callTool(action.tool, action.args);
      results.push(result);

      // Stop on error
      if (result.isError) {
        break;
      }
    }

    return results;
  }
}

// ============================================================================
// Usage Example (would run in Chrome extension context)
// ============================================================================

/**
 * Example usage in a Chrome extension
 */
export async function runExample(): Promise<void> {
  // Initialize BTCP for Chrome extension
  const extension = new ChromeExtensionBTCP();

  // Get the agent adapter
  const agentAdapter = extension.getAgent();

  // List available tools
  const tools = await agentAdapter.listTools();
  console.log('Available tools:', tools.map(t => t.name));

  // Create an AI agent instance
  const aiAgent = new ExampleAIAgent(agentAdapter);

  // Example 1: Analyze the current page
  console.log('Analyzing page...');
  const analysis = await aiAgent.analyzePage();
  console.log('Page analysis:', analysis);

  // Example 2: Direct tool call
  console.log('Getting page info...');
  const pageInfo = await agentAdapter.callTool('page_info', {});
  console.log('Page info:', pageInfo);

  // Example 3: Query elements
  console.log('Finding all links...');
  const links = await agentAdapter.callTool('query_elements', { selector: 'a' });
  console.log('Links:', links);

  // Example 4: Subscribe to tool updates
  const unsubscribe = agentAdapter.onToolsUpdated((updatedTools) => {
    console.log('Tools updated:', updatedTools.map(t => t.name));
  });

  // Later: unsubscribe when no longer needed
  // unsubscribe();

  // Example 5: Execute a workflow
  const workflowResults = await aiAgent.executeWorkflow([
    { tool: 'page_info', args: {} },
    { tool: 'query_elements', args: { selector: 'h1' } },
    { tool: 'get_text', args: { selector: 'h1' } },
  ]);
  console.log('Workflow results:', workflowResults);
}

// ============================================================================
// Message Passing Example (for Chrome extension communication)
// ============================================================================

/**
 * Example: Expose BTCP tools through Chrome extension messaging
 *
 * This allows the AI agent to run in the background script while
 * tools execute in the content script.
 */
export function setupMessagePassing(bridge: BTCPLocalBridge): void {
  // Content script: Listen for tool calls from background
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const msg = message as { type: string; name?: string; args?: Record<string, unknown> };

      if (msg.type === 'btcp_tool_call' && msg.name) {
        bridge.executeTool(msg.name, msg.args ?? {}).then(sendResponse);
        return true; // Keep channel open for async response
      }

      if (msg.type === 'btcp_list_tools') {
        sendResponse(bridge.getTools());
        return false;
      }

      return false;
    });
  }
}

/**
 * Example: Agent adapter that works through Chrome messaging
 *
 * Use this when the agent runs in background.js and tools are in content.js
 */
export class ChromeMessagingAgentAdapter implements IBTCPAgentAdapter {
  private tabId: number;

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  async listTools(): Promise<BTCPToolDefinition[]> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(this.tabId, { type: 'btcp_list_tools' }, (response) => {
        resolve(response as BTCPToolDefinition[]);
      });
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<BTCPToolCallResult> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        this.tabId,
        { type: 'btcp_tool_call', name, args },
        (response) => {
          resolve(response as BTCPToolCallResult);
        }
      );
    });
  }

  onToolsUpdated(callback: (tools: BTCPToolDefinition[]) => void): () => void {
    // For messaging-based adapter, you'd set up a port listener
    // This is a simplified example
    const listener = (message: unknown) => {
      const msg = message as { type: string; tools: BTCPToolDefinition[] };
      if (msg.type === 'btcp_tools_updated') {
        callback(msg.tools);
      }
    };
    chrome.runtime?.onMessage.addListener(listener);
    return () => chrome.runtime?.onMessage.removeListener(listener);
  }

  isConnected(): boolean {
    return true;
  }
}
