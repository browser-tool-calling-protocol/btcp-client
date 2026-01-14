/**
 * Simple BTCP Server for Testing (HTTP Streaming version)
 *
 * Uses SSE for server→client, HTTP POST for client→server
 * More bandwidth efficient than WebSocket.
 *
 * Usage:
 *   npx ts-node src/server.ts
 *   # or after build:
 *   node dist/server.js
 */

import http from 'http';
import { URL } from 'url';
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

interface SSEClient {
  res: http.ServerResponse;
  sessionId: string;
  clientType: 'browser' | 'agent';
}

interface Session {
  id: string;
  browserClient: SSEClient | null;
  agentClients: Set<SSEClient>;
  tools: BTCPToolDefinition[];
  createdAt: Date;
}

const PORT = parseInt(process.env.BTCP_PORT || '8765', 10);

class BTCPServer {
  private server: http.Server;
  private sessions: Map<string, Session> = new Map();
  private clients: Map<http.ServerResponse, SSEClient> = new Map();
  private pendingResponses: Map<string | number, {
    agentClient: SSEClient;
    originalId: string | number;
  }> = new Map();

  constructor(port: number) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(port, () => {
      console.log(`BTCP Server listening on http://localhost:${port}`);
      console.log('Endpoints:');
      console.log(`  GET  /events?sessionId=...&clientType=browser|agent  - SSE stream`);
      console.log(`  POST /message                                        - Send messages`);
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/events') {
      this.handleSSE(req, res, url);
    } else if (req.method === 'POST' && url.pathname === '/message') {
      this.handleMessage(req, res);
    } else if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: this.sessions.size }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  /**
   * Handle SSE connection
   */
  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const sessionId = url.searchParams.get('sessionId');
    const clientType = url.searchParams.get('clientType') as 'browser' | 'agent';

    if (!sessionId) {
      res.writeHead(400);
      res.end('Missing sessionId');
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial comment to establish connection
    res.write(': connected\n\n');

    const client: SSEClient = {
      res,
      sessionId,
      clientType: clientType || 'browser',
    };

    this.clients.set(res, client);

    // Handle session
    if (clientType === 'browser') {
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = {
          id: sessionId,
          browserClient: client,
          agentClients: new Set(),
          tools: [],
          createdAt: new Date(),
        };
        this.sessions.set(sessionId, session);
        console.log(`Created session: ${sessionId}`);
      } else {
        session.browserClient = client;
        console.log(`Browser rejoined session: ${sessionId}`);
      }

      // Send welcome message
      this.sendSSE(client, {
        jsonrpc: '2.0',
        id: 'welcome',
        result: { sessionId, message: 'Connected to BTCP server' },
      });
    } else {
      // Agent client - need to join session via message
      this.sendSSE(client, {
        jsonrpc: '2.0',
        id: 'welcome',
        result: {
          message: 'Connected to BTCP server (agent)',
          availableSessions: Array.from(this.sessions.keys()),
        },
      });
    }

    // Handle disconnect
    req.on('close', () => {
      this.handleDisconnect(res);
    });

    // Keep-alive ping every 30 seconds
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      } else {
        clearInterval(keepAlive);
      }
    }, 30000);
  }

  /**
   * Send SSE message to client
   */
  private sendSSE(client: SSEClient, data: unknown, event = 'message'): void {
    if (!client.res.writableEnded) {
      const json = typeof data === 'string' ? data : JSON.stringify(data);
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${json}\n\n`);
    }
  }

  /**
   * Handle POST message
   */
  private handleMessage(req: http.IncomingMessage, res: http.ServerResponse): void {
    const sessionId = req.headers['x-session-id'] as string;

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      console.log('Received message:', body);

      const message = parseMessage(body);
      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON-RPC message' }));
        return;
      }

      // Handle response from browser client
      if (isResponse(message)) {
        this.handleResponseFromBrowser(message as JsonRpcResponse, sessionId);
        res.writeHead(200);
        res.end();
        return;
      }

      if (!isRequest(message)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Expected request or response' }));
        return;
      }

      const request = message as JsonRpcRequest;

      // Handle different methods
      switch (request.method) {
        case 'tools/register':
          this.handleToolsRegister(request, sessionId, res);
          break;

        case 'tools/list':
          this.handleToolsList(request, sessionId, res);
          break;

        case 'tools/call':
          this.handleToolsCall(request, sessionId, res);
          break;

        case 'session/join':
          this.handleSessionJoin(request, sessionId, res);
          break;

        case 'ping':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(createResponse(request.id, { pong: true })));
          break;

        default:
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(createErrorResponse(
            request.id,
            -32601,
            `Method not found: ${request.method}`
          )));
      }
    });
  }

  private handleResponseFromBrowser(response: JsonRpcResponse, sessionId: string): void {
    const pending = this.pendingResponses.get(response.id);
    if (pending) {
      this.pendingResponses.delete(response.id);

      // Forward response back to agent with original ID
      const agentResponse = { ...response, id: pending.originalId };
      this.sendSSE(pending.agentClient, agentResponse, 'response');
      console.log('Forwarded response to agent');
    }
  }

  private handleToolsRegister(
    request: JsonRpcRequest,
    sessionId: string,
    res: http.ServerResponse
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createErrorResponse(request.id, -32600, 'Session not found')));
      return;
    }

    const params = request.params as { tools: BTCPToolDefinition[] };
    session.tools = params.tools;
    console.log(`Registered ${params.tools.length} tools in session ${sessionId}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(createResponse(request.id, { registered: params.tools.length })));

    // Notify agents about new tools
    for (const agentClient of session.agentClients) {
      this.sendSSE(agentClient, createRequest('tools/updated', { tools: params.tools }));
    }
  }

  private handleToolsList(
    request: JsonRpcRequest,
    sessionId: string,
    res: http.ServerResponse
  ): void {
    // Find session for this agent
    let session: Session | undefined;

    // Check if sessionId header matches a session
    if (sessionId) {
      session = this.sessions.get(sessionId);
    }

    if (!session) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createErrorResponse(
        request.id,
        -32600,
        'Session not found. Join a session first.'
      )));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(createResponse(request.id, { tools: session.tools })));
  }

  private handleToolsCall(
    request: JsonRpcRequest,
    sessionId: string,
    res: http.ServerResponse
  ): void {
    // Find the session
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createErrorResponse(
        request.id,
        -32600,
        'Session not found'
      )));
      return;
    }

    if (!session.browserClient) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createErrorResponse(
        request.id,
        -32600,
        'Browser client not connected'
      )));
      return;
    }

    // Find the agent client
    const agentClient = Array.from(session.agentClients).find(
      (c) => c.sessionId === sessionId
    );

    if (!agentClient) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createErrorResponse(
        request.id,
        -32600,
        'Agent not in session'
      )));
      return;
    }

    // Forward the request to the browser client via SSE
    const forwardedRequest = createRequest('tools/call', request.params as Record<string, unknown>);

    // Store mapping to route response back
    this.pendingResponses.set(forwardedRequest.id, {
      agentClient,
      originalId: request.id,
    });

    this.sendSSE(session.browserClient, forwardedRequest, 'request');
    console.log(`Forwarded tool call to browser: ${(request.params as { name: string }).name}`);

    // Respond immediately - actual result comes via SSE
    res.writeHead(202);
    res.end();
  }

  private handleSessionJoin(
    request: JsonRpcRequest,
    currentSessionId: string,
    res: http.ServerResponse
  ): void {
    const params = request.params as { sessionId: string };
    const targetSessionId = params.sessionId;

    const session = this.sessions.get(targetSessionId);
    if (!session) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createErrorResponse(
        request.id,
        -32602,
        `Session not found: ${targetSessionId}`
      )));
      return;
    }

    // Find the agent's SSE client by their current sessionId
    const agentClient = Array.from(this.clients.values()).find(
      (c) => c.sessionId === currentSessionId && c.clientType === 'agent'
    );

    if (agentClient) {
      // Update agent's session and add to session's agent list
      agentClient.sessionId = targetSessionId;
      session.agentClients.add(agentClient);
      console.log(`Agent joined session: ${targetSessionId}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(createResponse(request.id, {
      sessionId: targetSessionId,
      tools: session.tools,
    })));
  }

  private handleDisconnect(clientRes: http.ServerResponse): void {
    const client = this.clients.get(clientRes);
    if (!client) return;

    console.log(`Client disconnected: ${client.clientType}`);

    const session = this.sessions.get(client.sessionId);
    if (session) {
      if (client.clientType === 'browser') {
        session.browserClient = null;
        // Notify agents
        for (const agentClient of session.agentClients) {
          this.sendSSE(agentClient, createRequest('session/browserDisconnected', {}));
        }
      } else {
        session.agentClients.delete(client);
      }

      // Clean up empty sessions
      if (!session.browserClient && session.agentClients.size === 0) {
        this.sessions.delete(client.sessionId);
        console.log(`Removed empty session: ${client.sessionId}`);
      }
    }

    this.clients.delete(clientRes);
  }

  close(): void {
    this.server.close();
  }
}

// Run the server
const server = new BTCPServer(PORT);

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close();
  process.exit(0);
});
