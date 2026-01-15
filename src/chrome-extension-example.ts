/**
 * Chrome Extension Example - BTCP Client Usage
 *
 * Shows how to use BTCP client in a Chrome extension (local mode).
 * The agent integrates via its own interface (MCP, programmatic, etc.).
 */

import { BTCPClient } from './index.js';

/**
 * Example: Set up BTCP tools in a Chrome extension
 */
export function setupBrowserTools() {
  // Create client (local mode by default)
  const client = new BTCPClient({ debug: true });

  // Register DOM tools
  client.registerHandler('click', async (args) => {
    const el = document.querySelector(args.selector as string) as HTMLElement;
    if (!el) throw new Error(`Element not found: ${args.selector}`);
    el.click();
    return `Clicked: ${args.selector}`;
  });

  client.registerHandler('fill', async (args) => {
    const el = document.querySelector(args.selector as string) as HTMLInputElement;
    if (!el) throw new Error(`Element not found: ${args.selector}`);
    el.value = args.value as string;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return `Filled: ${args.selector}`;
  });

  client.registerHandler('getText', async (args) => {
    const el = document.querySelector(args.selector as string);
    if (!el) throw new Error(`Element not found: ${args.selector}`);
    return el.textContent || '';
  });

  client.registerHandler('getPageInfo', async () => {
    return {
      url: window.location.href,
      title: document.title,
    };
  });

  return client;
}

/**
 * Example usage:
 *
 * // In content script
 * const client = setupBrowserTools();
 *
 * // Agent calls tools via its own interface (MCP, etc.)
 * // which internally calls:
 * const result = await client.execute('click', { selector: '.btn' });
 */
