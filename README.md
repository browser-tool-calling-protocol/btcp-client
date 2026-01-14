# BTCP Client

Browser Tool Calling Protocol (BTCP) JavaScript/TypeScript client for connecting browser extensions to AI agents.

This is a proof-of-concept implementation of the [BTCP Specification](https://github.com/browser-tool-calling-protocol/btcp-specification), enabling AI agents to discover and invoke tools directly within browsers through client-defined interfaces.

## Features

- **HTTP Streaming** (SSE + POST) - More bandwidth efficient than WebSocket
- JSON-RPC 2.0 protocol for message exchange
- Tool registration and discovery
- Tool execution with customizable handlers
- Integration with [btcp-browser-agent](https://github.com/browser-tool-calling-protocol/btcp-browser-agent) for browser automation
- Auto-reconnection support
- Works in both Node.js and browser environments

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    AI Agent     │────▶│   BTCP Server   │◀────│  Browser Client │
│  (Tool Caller)  │     │ (Message Broker)│     │  (Tool Provider)│
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        │  POST /message        │  SSE /events          │  POST /message
        │  SSE  /events         │                       │  SSE  /events
        └───────────────────────┴───────────────────────┘

Communication:
  • Server → Client: SSE (Server-Sent Events) - efficient streaming
  • Client → Server: HTTP POST - only when needed
```

## Installation

```bash
npm install btcp-client
```

## Quick Start

### 1. Start the Server

```bash
npm run build
npm run server
```

### 2. Start a Browser Client

```javascript
import { BTCPClient } from 'btcp-client';

const client = new BTCPClient({
  serverUrl: 'http://localhost:8765',
  debug: true,
});

// Register a custom tool handler
client.getExecutor().registerHandler('greet', async (args) => {
  return `Hello, ${args.name}!`;
});

// Connect and register tools
await client.connect();
await client.registerTools([
  {
    name: 'greet',
    description: 'Greet a person by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      }
    }
  }
]);

console.log(`Session ID: ${client.getSessionId()}`);
```

### 3. Connect an AI Agent

```javascript
// Agent connects to the same server
const agent = new BTCPAgent(sessionId);
await agent.connect();
await agent.joinSession();

// Call tools on the browser
const result = await agent.callTool('greet', { name: 'World' });
// Result: "Hello, World!"
```

## API Reference

### BTCPClient

The main client class for browser-side tool providers.

```typescript
const client = new BTCPClient({
  serverUrl: 'http://localhost:8765', // Server URL (HTTP, not WS)
  sessionId: 'my-session',            // Optional session ID
  debug: true,                         // Enable debug logging
  autoReconnect: true,                // Auto-reconnect on disconnect
  reconnectDelay: 1000,               // Reconnection delay (ms)
  maxReconnectAttempts: 5,            // Max reconnection attempts
  connectionTimeout: 10000,           // Connection timeout (ms)
});
```

#### Methods

- `connect(): Promise<void>` - Connect to the BTCP server via SSE
- `disconnect(): void` - Disconnect from the server
- `isConnected(): boolean` - Check connection status
- `getSessionId(): string` - Get the session ID
- `registerTools(tools: BTCPToolDefinition[]): Promise<void>` - Register tools
- `getExecutor(): ToolExecutor` - Get the tool executor
- `on(event, handler)` - Add event listener
- `off(event, handler)` - Remove event listener

#### Events

- `connect` - Connected to server
- `disconnect(code, reason)` - Disconnected from server
- `error(error)` - Error occurred
- `toolCall(request)` - Tool call received
- `toolsList(request)` - Tools list requested

### ToolExecutor

Handles tool execution with optional browser agent integration.

```typescript
const executor = client.getExecutor();

// Register a custom handler
executor.registerHandler('myTool', async (args) => {
  return { result: args.value * 2 };
});

// Set browser agent for DOM automation
executor.setBrowserAgent(browserAgent);
```

### Protocol Utilities

```typescript
import {
  createRequest,
  createResponse,
  createTextContent,
  createImageContent,
  parseMessage,
  serializeMessage,
} from 'btcp-client';

// Create a text response
const content = createTextContent('Hello, World!');

// Create an image response
const image = createImageContent(base64Data, 'image/png');
```

## Built-in Tools

When a browser agent is configured, the following tools are automatically available:

| Tool | Description |
|------|-------------|
| `browser_snapshot` | Get DOM snapshot |
| `browser_click` | Click an element |
| `browser_fill` | Fill a form field |
| `browser_type` | Type text into element |
| `browser_hover` | Hover over element |
| `browser_press` | Press keyboard key |
| `browser_scroll` | Scroll page/element |
| `browser_wait` | Wait for element |
| `browser_get_text` | Get element text |
| `browser_get_attribute` | Get element attribute |
| `browser_is_visible` | Check visibility |
| `browser_get_url` | Get current URL |
| `browser_get_title` | Get page title |
| `browser_screenshot` | Take screenshot |
| `browser_execute` | Execute command |
| `evaluate` | Execute JavaScript |
| `echo` | Echo message (testing) |

## Running the Examples

```bash
# Build the project
npm install
npm run build

# Terminal 1: Start the server
npm run server

# Terminal 2: Start the browser client
npm run example

# Terminal 3: Run the agent (pass the session ID from terminal 2)
npm run agent -- <session-id>
```

## Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/events` | GET | SSE stream for receiving messages |
| `/message` | POST | Send JSON-RPC messages |
| `/health` | GET | Health check |

### Query Parameters for `/events`

- `sessionId` - Session identifier (required)
- `clientType` - `browser` or `agent`
- `version` - Protocol version

### Headers for `/message`

- `Content-Type: application/json`
- `X-Session-ID: <session-id>`

## Protocol Messages

### Tools Register (Browser Client → Server via POST)

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/register",
  "params": {
    "tools": [
      {
        "name": "greet",
        "description": "Greet a person",
        "inputSchema": {
          "type": "object",
          "properties": {
            "name": { "type": "string" }
          }
        }
      }
    ]
  }
}
```

### Tool Call (Server → Browser Client via SSE)

```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "greet",
    "arguments": { "name": "World" }
  }
}
```

### Tool Response (Browser Client → Server via POST)

```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "result": {
    "content": [
      { "type": "text", "text": "Hello, World!" }
    ],
    "isError": false
  }
}
```

## Browser Extension Usage

For use in a Chrome extension:

```typescript
// In your extension's content script or background script
import { BTCPClient } from 'btcp-client';
import { BrowserAgent } from 'btcp-browser-agent';

const agent = new BrowserAgent();
await agent.launch();

const client = new BTCPClient({
  serverUrl: 'http://localhost:8765',
  debug: true
});
client.getExecutor().setBrowserAgent(agent);

await client.connect();
await client.registerTools(client.getExecutor().getToolDefinitions());
```

## Why HTTP Streaming over WebSocket?

1. **Lower bandwidth** - SSE is unidirectional, no frame overhead
2. **Better proxy/CDN support** - HTTP works everywhere
3. **Simpler protocol** - Standard HTTP semantics
4. **Auto-reconnect built-in** - EventSource handles reconnection
5. **No handshake overhead** - Direct HTTP connection

## License

MIT
