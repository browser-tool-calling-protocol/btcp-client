/**
 * Chrome Extension Example - BTCP Client + ToolConsumer Usage
 *
 * Shows the separation between:
 * - BTCPClient: Tool provider (registers handlers)
 * - ToolConsumer: Tool consumer (agent calls tools)
 */

import { BTCPClient, ToolConsumer } from './index.js';

/**
 * Example: Set up BTCP in a Chrome extension
 */
export function setup() {
  // === PROVIDER SIDE (browser/content script) ===
  const client = new BTCPClient({ debug: true });

  // Register tool handlers
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

  client.registerHandler('getPageInfo', async () => ({
    url: window.location.href,
    title: document.title,
  }));

  // === CONSUMER SIDE (agent) ===
  const consumer = new ToolConsumer({ client });

  return { client, consumer };
}

/**
 * Example usage:
 *
 * const { client, consumer } = setup();
 *
 * // Agent uses consumer to interact with tools
 * const tools = await consumer.listTools();
 * const result = await consumer.callTool('click', { selector: '.btn' });
 */
