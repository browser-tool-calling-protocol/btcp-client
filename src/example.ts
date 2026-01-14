/**
 * BTCP Client Example
 *
 * This example shows how to:
 * 1. Create a BTCP client
 * 2. Register custom tool handlers
 * 3. Connect to a BTCP server
 * 4. Handle tool invocations from AI agents
 */

import { BTCPClient, BTCPToolDefinition, createTextContent } from './index.js';

async function main() {
  // Create client with debug logging
  const client = new BTCPClient({
    serverUrl: process.env.BTCP_SERVER_URL || 'http://localhost:8765',
    debug: true,
    autoReconnect: true,
  });

  console.log(`Session ID: ${client.getSessionId()}`);

  // Get the executor to register custom handlers
  const executor = client.getExecutor();

  // Register a custom tool handler
  executor.registerHandler('greet', async (args) => {
    const name = (args.name as string) || 'World';
    return createTextContent(`Hello, ${name}!`);
  });

  // Register a calculator tool
  executor.registerHandler('calculate', async (args) => {
    const { operation, a, b } = args as { operation: string; a: number; b: number };

    let result: number;
    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        if (b === 0) throw new Error('Division by zero');
        result = a / b;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    return createTextContent(`${a} ${operation} ${b} = ${result}`);
  });

  // Register a timestamp tool
  executor.registerHandler('getTimestamp', async () => {
    return createTextContent(new Date().toISOString());
  });

  // Define the tools to expose
  const tools: BTCPToolDefinition[] = [
    {
      name: 'echo',
      description: 'Echo a message back',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to echo' },
        },
      },
    },
    {
      name: 'greet',
      description: 'Greet a person by name',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet', default: 'World' },
        },
      },
    },
    {
      name: 'calculate',
      description: 'Perform a basic arithmetic calculation',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['add', 'subtract', 'multiply', 'divide'],
            description: 'The operation to perform',
          },
          a: { type: 'number', description: 'First operand' },
          b: { type: 'number', description: 'Second operand' },
        },
        required: ['operation', 'a', 'b'],
      },
    },
    {
      name: 'getTimestamp',
      description: 'Get the current timestamp',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'evaluate',
      description: 'Execute JavaScript code',
      inputSchema: {
        type: 'object',
        properties: {
          script: { type: 'string', description: 'JavaScript code to execute' },
        },
        required: ['script'],
      },
      capabilities: ['code:execute'],
    },
  ];

  // Set up event handlers
  client.on('connect', () => {
    console.log('Connected to BTCP server!');
  });

  client.on('disconnect', (code, reason) => {
    console.log(`Disconnected: ${code} - ${reason}`);
  });

  client.on('error', (error) => {
    console.error('Error:', error.message);
  });

  client.on('toolCall', (request) => {
    console.log(`Tool call received: ${request.params.name}`);
  });

  client.on('toolsList', () => {
    console.log('Tools list requested');
  });

  try {
    // Connect to server
    console.log('Connecting to BTCP server...');
    await client.connect();

    // Register tools
    console.log('Registering tools...');
    await client.registerTools(tools);

    console.log('Client ready! Waiting for tool calls...');
    console.log(`Share this session ID with AI agents: ${client.getSessionId()}`);

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\nDisconnecting...');
      client.disconnect();
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to connect:', (err as Error).message);
    process.exit(1);
  }
}

// Run example
main().catch(console.error);
