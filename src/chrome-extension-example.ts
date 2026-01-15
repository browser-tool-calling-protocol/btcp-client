/**
 * Chrome Extension Example - BTCP Client Usage
 *
 * Shows the clean API:
 * - client.registerHandler() - register tools
 * - client.getConsumer() - get consumer for agent
 */

import { BTCPClient } from './index.js';

/**
 * Example: Set up BTCP in a Chrome extension
 */
export async function setup() {
  // Create client and register tools
  const client = new BTCPClient({ debug: true });

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

  // Get consumer for agent
  const consumer = await client.getConsumer();

  return { client, consumer };
}

/**
 * Example usage:
 *
 * const { consumer } = await setup();
 *
 * // Agent uses consumer
 * const tools = await consumer.listTools();
 * const result = await consumer.callTool('click', { selector: '.btn' });
 */
