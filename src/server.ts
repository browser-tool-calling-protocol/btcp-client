/**
 * Simple BTCP Server for Testing
 *
 * This is a minimal BTCP server implementation for testing the client.
 * It acts as a message broker between browser clients and AI agents.
 *
 * Usage:
 *   npx ts-node src/server.ts
 *   # or after build:
 *   node dist/server.js
 */

import { WebSocketServer, WebSocket } from 'ws';
import {
  parseMessage,
  serializeMessage,
  createResponse,
  createErrorResponse,
  createRequest,
  isRequest,
  isResponse,
} from './protocol.js';
import type { JsonRpcRequest, JsonRpcResponse, BTCPToolDefinition } from './types.js';

interface Session {
  id: string;
  browserClient: WebSocket | null;
  agentClients: Set<WebSocket>;
  tools: BTCPToolDefinition[];
  createdAt: Date;
}

interface ClientInfo {
  ws: WebSocket;
  type: 'browser' | 'agent' | 'unknown';
  sessionId: string | null;
}

const PORT = parseInt(process.env.BTCP_PORT || '8765', 10);

class BTCPServer {
  private wss: WebSocketServer;
  private sessions: Map<string, Session> = new Map();
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private pendingResponses: Map<string | number, {
    agentWs: WebSocket;
    originalId: string | number;
  }> = new Map();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.setupServer();
    console.log(`BTCP Server listening on ws://localhost:${port}`);
  }

  private setupServer(): void {
    this.wss.on('connection', (ws) => {
      console.log('New connection');

      this.clients.set(ws, {
        ws,
        type: 'unknown',
        sessionId: null,
      });

      ws.on('message', (data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
      });
    });
  }

  private handleMessage(ws: WebSocket, data: string): void {
    console.log('Received:', data);

    const message = parseMessage(data);
    if (!message) {
      console.log('Invalid message');
      return;
    }

    const client = this.clients.get(ws)!;

    // Handle responses from browser client
    if (isResponse(message)) {
      this.handleResponse(ws, message);
      return;
    }

    if (!isRequest(message)) {
      return;
    }

    const request = message as JsonRpcRequest;

    switch (request.method) {
      case 'hello':
        this.handleHello(ws, request);
        break;

      case 'tools/register':
        this.handleToolsRegister(ws, request);
        break;

      case 'tools/list':
        this.handleToolsList(ws, request);
        break;

      case 'tools/call':
        this.handleToolsCall(ws, request);
        break;

      case 'session/join':
        this.handleSessionJoin(ws, request);
        break;

      case 'ping':
        ws.send(serializeMessage(createResponse(request.id, { pong: true })));
        break;

      default:
        ws.send(serializeMessage(createErrorResponse(
          request.id,
          -32601,
          `Method not found: ${request.method}`
        )));
    }
  }

  private handleHello(ws: WebSocket, request: JsonRpcRequest): void {
    const params = request.params as {
      clientType: 'browser' | 'agent';
      sessionId?: string;
      version?: string;
    };

    const client = this.clients.get(ws)!;
    client.type = params.clientType;

    if (params.clientType === 'browser') {
      // Browser client creates or joins a session
      const sessionId = params.sessionId || `session-${Date.now()}`;
      client.sessionId = sessionId;

      let session = this.sessions.get(sessionId);
      if (!session) {
        session = {
          id: sessionId,
          browserClient: ws,
          agentClients: new Set(),
          tools: [],
          createdAt: new Date(),
        };
        this.sessions.set(sessionId, session);
        console.log(`Created session: ${sessionId}`);
      } else {
        session.browserClient = ws;
        console.log(`Browser rejoined session: ${sessionId}`);
      }

      ws.send(serializeMessage(createResponse(request.id, {
        sessionId,
        message: 'Welcome to BTCP server',
      })));
    } else {
      // Agent client
      ws.send(serializeMessage(createResponse(request.id, {
        message: 'Welcome to BTCP server (agent)',
        availableSessions: Array.from(this.sessions.keys()),
      })));
    }
  }

  private handleSessionJoin(ws: WebSocket, request: JsonRpcRequest): void {
    const params = request.params as { sessionId: string };
    const client = this.clients.get(ws)!;

    const session = this.sessions.get(params.sessionId);
    if (!session) {
      ws.send(serializeMessage(createErrorResponse(
        request.id,
        -32602,
        `Session not found: ${params.sessionId}`
      )));
      return;
    }

    client.sessionId = params.sessionId;
    session.agentClients.add(ws);
    console.log(`Agent joined session: ${params.sessionId}`);

    ws.send(serializeMessage(createResponse(request.id, {
      sessionId: params.sessionId,
      tools: session.tools,
    })));
  }

  private handleToolsRegister(ws: WebSocket, request: JsonRpcRequest): void {
    const client = this.clients.get(ws)!;
    if (!client.sessionId) {
      ws.send(serializeMessage(createErrorResponse(
        request.id,
        -32600,
        'Not in a session'
      )));
      return;
    }

    const session = this.sessions.get(client.sessionId);
    if (!session) {
      ws.send(serializeMessage(createErrorResponse(
        request.id,
        -32600,
        'Session not found'
      )));
      return;
    }

    const params = request.params as { tools: BTCPToolDefinition[] };
    session.tools = params.tools;
    console.log(`Registered ${params.tools.length} tools in session ${client.sessionId}`);

    ws.send(serializeMessage(createResponse(request.id, {
      registered: params.tools.length,
    })));

    // Notify agents about new tools
    for (const agentWs of session.agentClients) {
      agentWs.send(serializeMessage(createRequest('tools/updated', {
        tools: params.tools,
      })));
    }
  }

  private handleToolsList(ws: WebSocket, request: JsonRpcRequest): void {
    const client = this.clients.get(ws)!;

    if (client.type === 'agent') {
      // Agent requesting tools from browser
      if (!client.sessionId) {
        ws.send(serializeMessage(createErrorResponse(
          request.id,
          -32600,
          'Not in a session. Use session/join first.'
        )));
        return;
      }

      const session = this.sessions.get(client.sessionId);
      if (!session || !session.browserClient) {
        ws.send(serializeMessage(createErrorResponse(
          request.id,
          -32600,
          'Browser client not connected'
        )));
        return;
      }

      // Return cached tools
      ws.send(serializeMessage(createResponse(request.id, {
        tools: session.tools,
      })));
    } else {
      // Browser responding to tools list
      // This is handled in the request handler
    }
  }

  private handleToolsCall(ws: WebSocket, request: JsonRpcRequest): void {
    const client = this.clients.get(ws)!;

    if (client.type !== 'agent') {
      ws.send(serializeMessage(createErrorResponse(
        request.id,
        -32600,
        'Only agents can call tools'
      )));
      return;
    }

    if (!client.sessionId) {
      ws.send(serializeMessage(createErrorResponse(
        request.id,
        -32600,
        'Not in a session. Use session/join first.'
      )));
      return;
    }

    const session = this.sessions.get(client.sessionId);
    if (!session || !session.browserClient) {
      ws.send(serializeMessage(createErrorResponse(
        request.id,
        -32600,
        'Browser client not connected'
      )));
      return;
    }

    // Forward the request to the browser client
    const forwardedRequest = createRequest('tools/call', request.params as Record<string, unknown>);

    // Store mapping to route response back
    this.pendingResponses.set(forwardedRequest.id, {
      agentWs: ws,
      originalId: request.id,
    });

    session.browserClient.send(serializeMessage(forwardedRequest));
    console.log(`Forwarded tool call to browser: ${(request.params as { name: string }).name}`);
  }

  private handleResponse(ws: WebSocket, response: JsonRpcResponse): void {
    // Check if this is a response to a forwarded request
    const pending = this.pendingResponses.get(response.id);
    if (pending) {
      this.pendingResponses.delete(response.id);

      // Forward response back to agent with original ID
      const agentResponse = { ...response, id: pending.originalId };
      pending.agentWs.send(serializeMessage(agentResponse));
      console.log('Forwarded response to agent');
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    console.log(`Client disconnected: ${client.type}`);

    if (client.sessionId) {
      const session = this.sessions.get(client.sessionId);
      if (session) {
        if (client.type === 'browser') {
          session.browserClient = null;
          // Notify agents
          for (const agentWs of session.agentClients) {
            agentWs.send(serializeMessage(createRequest('session/browserDisconnected', {})));
          }
        } else {
          session.agentClients.delete(ws);
        }

        // Clean up empty sessions
        if (!session.browserClient && session.agentClients.size === 0) {
          this.sessions.delete(client.sessionId);
          console.log(`Removed empty session: ${client.sessionId}`);
        }
      }
    }

    this.clients.delete(ws);
  }

  close(): void {
    this.wss.close();
  }
}

// Run the server
const server = new BTCPServer(PORT);

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close();
  process.exit(0);
});
