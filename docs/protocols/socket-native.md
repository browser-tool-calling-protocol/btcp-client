# Socket Native Protocol

WebSocket-based transport for the Browser Tool Calling Protocol (BTCP).

## Overview

The Socket Native protocol provides bidirectional, full-duplex communication between BTCP clients and servers using WebSocket. This transport offers lower latency compared to SSE+HTTP due to persistent connections and eliminates the need for separate send/receive channels.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    AI Agent     │────▶│   BTCP Server   │◀────│  Browser Client │
│  (Tool Caller)  │     │ (Message Broker)│     │  (Tool Provider)│
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        └───────── WebSocket ───┴─── WebSocket ─────────┘

Communication:
  • Full-duplex WebSocket connections
  • Single connection handles both send and receive
  • Binary or text frame support
```

## Connection

### WebSocket Endpoint

```
ws://host:port/ws?sessionId={sessionId}&clientType={browser|agent}&version={version}
```

#### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `sessionId` | Yes | Unique session identifier |
| `clientType` | Yes | `browser` (tool provider) or `agent` (tool consumer) |
| `version` | No | Protocol version (default: `1.0.0`) |

### Connection Handshake

1. Client opens WebSocket connection with query parameters
2. Server validates parameters and creates/joins session
3. Server sends `welcome` response
4. Connection is established and ready for messages

## Message Format

All messages use JSON-RPC 2.0 format over WebSocket text frames.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "method/name",
  "params": { ... }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "result": { ... }
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "error": {
    "code": -32600,
    "message": "Error description",
    "data": { ... }
  }
}
```

### Notification (no response expected)

```json
{
  "jsonrpc": "2.0",
  "method": "method/name",
  "params": { ... }
}
```

## Methods

### Connection

#### `hello` (Client → Server)

Announce client capabilities after connection.

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "hello",
  "params": {
    "clientType": "browser",
    "version": "1.0.0",
    "capabilities": ["dom:read", "dom:interact"]
  }
}
```

#### `ping` / `pong`

Keep-alive mechanism.

```json
// Request
{ "jsonrpc": "2.0", "id": "2", "method": "ping" }

// Response
{ "jsonrpc": "2.0", "id": "2", "result": { "pong": true } }
```

### Session Management

#### `session/join` (Agent → Server)

Join an existing session.

```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "session/join",
  "params": {
    "sessionId": "target-session-id"
  }
}
```

### Tool Operations

#### `tools/register` (Browser → Server)

Register available tools.

```json
{
  "jsonrpc": "2.0",
  "id": "4",
  "method": "tools/register",
  "params": {
    "tools": [
      {
        "name": "browser_click",
        "description": "Click an element",
        "inputSchema": {
          "type": "object",
          "properties": {
            "selector": { "type": "string" }
          },
          "required": ["selector"]
        }
      }
    ]
  }
}
```

#### `tools/list` (Agent → Server)

List available tools in session.

```json
// Request
{
  "jsonrpc": "2.0",
  "id": "5",
  "method": "tools/list",
  "params": {}
}

// Response
{
  "jsonrpc": "2.0",
  "id": "5",
  "result": {
    "tools": [...]
  }
}
```

#### `tools/call` (Agent → Server → Browser)

Call a tool on the browser client.

```json
// Request (Agent → Server)
{
  "jsonrpc": "2.0",
  "id": "6",
  "method": "tools/call",
  "params": {
    "name": "browser_click",
    "arguments": { "selector": ".submit-btn" },
    "timeout": 30000
  }
}

// Forwarded to Browser, response forwarded back
{
  "jsonrpc": "2.0",
  "id": "6",
  "result": {
    "content": [{ "type": "text", "text": "Clicked: .submit-btn" }],
    "isError": false
  }
}
```

## Client Implementation

### SocketNativeClient

The `SocketNativeClient` class provides WebSocket-based BTCP communication.

```typescript
import { SocketNativeClient } from 'btcp-client';

const client = new SocketNativeClient({
  serverUrl: 'ws://localhost:8765',
  sessionId: 'my-session',        // Optional, auto-generated if not provided
  debug: true,                     // Enable debug logging
  autoReconnect: true,            // Auto-reconnect on disconnect
  reconnectDelay: 1000,           // Base reconnection delay (ms)
  maxReconnectAttempts: 5,        // Max reconnection attempts
  connectionTimeout: 10000,       // Connection timeout (ms)
  pingInterval: 30000,            // Keep-alive ping interval (ms)
});

// Register tool handlers
client.registerHandler('greet', async (args) => {
  return `Hello, ${args.name}!`;
});

// Connect
await client.connect();

// Register tools with server
await client.registerTools([
  {
    name: 'greet',
    description: 'Greet a person by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      },
      required: ['name']
    }
  }
]);

// Get session ID
console.log(`Session ID: ${client.getSessionId()}`);
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | Required | WebSocket server URL (ws:// or wss://) |
| `sessionId` | `string` | Auto | Session identifier |
| `version` | `string` | `1.0.0` | Protocol version |
| `autoReconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `reconnectDelay` | `number` | `1000` | Base reconnection delay (ms) |
| `maxReconnectAttempts` | `number` | `5` | Max reconnection attempts |
| `connectionTimeout` | `number` | `10000` | Connection timeout (ms) |
| `pingInterval` | `number` | `30000` | Keep-alive ping interval (ms) |
| `debug` | `boolean` | `false` | Enable debug logging |

### Events

| Event | Arguments | Description |
|-------|-----------|-------------|
| `connect` | - | Connected to server |
| `disconnect` | `(code, reason)` | Disconnected from server |
| `error` | `(error)` | Error occurred |
| `message` | `(message)` | Raw message received |
| `toolCall` | `(request)` | Tool call received |
| `toolsList` | `(request)` | Tools list requested |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<void>` | Connect to server |
| `disconnect()` | `void` | Disconnect from server |
| `isConnected()` | `boolean` | Check connection status |
| `getSessionId()` | `string` | Get session ID |
| `registerTools(tools)` | `Promise<void>` | Register tools with server |
| `getExecutor()` | `ToolExecutor` | Get tool executor |
| `registerHandler(name, fn)` | `void` | Register tool handler |
| `sendRequest(method, params)` | `Promise<Response>` | Send request and await response |
| `send(message)` | `Promise<void>` | Send message (no response) |
| `on(event, handler)` | `void` | Add event listener |
| `off(event, handler)` | `void` | Remove event listener |

## Comparison with HTTP Streaming (SSE + POST)

| Feature | Socket Native (WebSocket) | HTTP Streaming (SSE + POST) |
|---------|--------------------------|----------------------------|
| Latency | Lower (single connection) | Higher (separate channels) |
| Connection | Full-duplex | Half-duplex (server push only) |
| Proxy Support | May require config | Better support |
| Binary Data | Native support | Base64 encoding required |
| Auto-reconnect | Manual implementation | Built into EventSource |
| Browser Support | Excellent | Excellent |
| Firewall Friendly | May be blocked | Usually allowed |

## Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32000 | Connection error |

## Security Considerations

1. Use `wss://` in production for encrypted connections
2. Validate session IDs server-side
3. Implement authentication before tool registration
4. Rate-limit tool calls to prevent abuse
5. Sanitize tool arguments before execution
