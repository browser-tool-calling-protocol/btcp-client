/**
 * BTCP Agent Example
 *
 * This example shows how an AI agent would connect to the BTCP server
 * and call tools provided by a browser client.
 *
 * Usage:
 *   1. Start the server: node dist/server.js
 *   2. Start the browser client: node dist/example.js
 *   3. Start this agent: node dist/agent-example.js <session-id>
 */

import WebSocket from 'ws';
import {
  createRequest,
  parseMessage,
  serializeMessage,
  isResponse,
  isRequest,
} from './protocol.js';
import type { JsonRpcResponse, BTCPToolDefinition } from './types.js';

const SERVER_URL = process.env.BTCP_SERVER_URL || 'ws://localhost:8765';

class BTCPAgent {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private tools: BTCPToolDefinition[] = [];
  private pendingRequests: Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(SERVER_URL);

      this.ws.on('open', () => {
        console.log('Connected to BTCP server');
        this.sendHello();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        console.log('Disconnected from server');
      });

      this.ws.on('error', (err) => {
        reject(err);
      });
    });
  }

  private sendHello(): void {
    const request = createRequest('hello', {
      clientType: 'agent',
      version: '1.0.0',
    });
    this.send(request);
  }

  async joinSession(): Promise<void> {
    const response = await this.sendRequest('session/join', {
      sessionId: this.sessionId,
    }) as { tools?: BTCPToolDefinition[] };

    if (response.tools) {
      this.tools = response.tools;
      console.log(`Joined session. Available tools: ${this.tools.map(t => t.name).join(', ')}`);
    }
  }

  async listTools(): Promise<BTCPToolDefinition[]> {
    const response = await this.sendRequest('tools/list', {}) as { tools: BTCPToolDefinition[] };
    this.tools = response.tools || [];
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    console.log(`Calling tool: ${name}`);
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
    return response;
  }

  private send(message: unknown): void {
    if (!this.ws) throw new Error('Not connected');
    const data = serializeMessage(message as Parameters<typeof serializeMessage>[0]);
    console.log('Sending:', data);
    this.ws.send(data);
  }

  private async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = createRequest(method, params);

      this.pendingRequests.set(request.id, { resolve, reject });

      setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      this.send(request);
    });
  }

  private handleMessage(data: string): void {
    console.log('Received:', data);

    const message = parseMessage(data);
    if (!message) return;

    if (isResponse(message)) {
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } else if (isRequest(message)) {
      // Handle notifications from server
      console.log(`Notification: ${message.method}`);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

async function main() {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.log('Usage: node agent-example.js <session-id>');
    console.log('\nFirst start the server and browser client to get a session ID.');
    process.exit(1);
  }

  const agent = new BTCPAgent(sessionId);

  try {
    await agent.connect();
    await agent.joinSession();

    // List available tools
    const tools = await agent.listTools();
    console.log('\nAvailable tools:');
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }

    // Call some tools
    console.log('\n--- Testing Tools ---\n');

    // Test echo
    console.log('Testing echo:');
    const echoResult = await agent.callTool('echo', { message: 'Hello from agent!' });
    console.log('Result:', echoResult);

    // Test greet
    console.log('\nTesting greet:');
    const greetResult = await agent.callTool('greet', { name: 'BTCP' });
    console.log('Result:', greetResult);

    // Test calculate
    console.log('\nTesting calculate:');
    const calcResult = await agent.callTool('calculate', {
      operation: 'multiply',
      a: 6,
      b: 7,
    });
    console.log('Result:', calcResult);

    // Test timestamp
    console.log('\nTesting getTimestamp:');
    const timeResult = await agent.callTool('getTimestamp', {});
    console.log('Result:', timeResult);

    // Test evaluate
    console.log('\nTesting evaluate:');
    const evalResult = await agent.callTool('evaluate', {
      script: '2 + 2',
    });
    console.log('Result:', evalResult);

    console.log('\n--- All Tests Complete ---');

    agent.disconnect();
  } catch (err) {
    console.error('Error:', (err as Error).message);
    agent.disconnect();
    process.exit(1);
  }
}

main().catch(console.error);
