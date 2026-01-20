/**
 * WebSocket Transport Implementation
 *
 * Provides bidirectional, full-duplex communication with lower latency
 * compared to HTTP streaming.
 */

import { BaseTransport } from './base.js';
import type { WebSocketTransportConfig } from './types.js';
import { BTCPConnectionError } from '../types.js';

// WebSocket implementation (browser or Node.js)
let WebSocketImpl: typeof WebSocket;

const DEFAULT_CONFIG = {
  connectionTimeout: 10000,
  pingInterval: 30000,
  debug: false,
  version: '1.0.0',
};

/**
 * WebSocket-based transport for BTCP.
 *
 * @example
 * ```typescript
 * const transport = new WebSocketTransport({
 *   url: 'ws://localhost:8765',
 *   debug: true,
 * });
 *
 * transport.on('message', (data) => console.log('Received:', data));
 * await transport.connect();
 * await transport.send(JSON.stringify({ method: 'ping' }));
 * ```
 */
export class WebSocketTransport extends BaseTransport {
  private config: Required<WebSocketTransportConfig>;
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: WebSocketTransportConfig) {
    super(config.debug ?? false);

    if (!config.url) {
      throw new BTCPConnectionError('url is required for WebSocketTransport');
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      sessionId: config.sessionId || '',
      version: config.version || DEFAULT_CONFIG.version,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.isConnecting) {
      throw new BTCPConnectionError('Connection already in progress');
    }

    this.isConnecting = true;

    // Ensure WebSocket is available
    await this.ensureWebSocket();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        reject(new BTCPConnectionError('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        const wsUrl = this.buildWebSocketUrl();
        this.log('[Transport-WS]', `Connecting to ${wsUrl}`);

        this.ws = new WebSocketImpl(wsUrl);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.log('[Transport-WS]', 'Connected');

          // Start ping interval for keep-alive
          this.startPingInterval();

          this.emit('connect');
          resolve();
        };

        this.ws.onerror = () => {
          clearTimeout(timeout);
          if (this.isConnecting) {
            this.isConnecting = false;
            const error = new BTCPConnectionError('WebSocket connection error');
            this.emit('error', error);
            reject(error);
          }
        };

        this.ws.onclose = (event) => {
          clearTimeout(timeout);
          this.stopPingInterval();

          if (this.isConnecting) {
            this.isConnecting = false;
            reject(new BTCPConnectionError(`WebSocket closed: ${event.code} ${event.reason}`));
          } else {
            this.ws = null;
            this.emit('disconnect', event.code, event.reason || 'Connection closed');
          }
        };

        this.ws.onmessage = (event) => {
          const data = event.data as string;
          this.log('[Transport-WS]', 'Received:', data);
          this.emit('message', data);
        };

      } catch (err) {
        clearTimeout(timeout);
        this.isConnecting = false;
        reject(new BTCPConnectionError(`Failed to connect: ${(err as Error).message}`));
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.stopPingInterval();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }

    this.emit('disconnect', 1000, 'Client disconnected');
  }

  /**
   * Send a message over WebSocket
   */
  async send(data: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new BTCPConnectionError('WebSocket not connected');
    }

    this.log('[Transport-WS]', 'Sending:', data);
    this.ws.send(data);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Build WebSocket URL with query parameters
   */
  private buildWebSocketUrl(): string {
    const baseUrl = this.config.url.replace(/\/$/, '');

    const url = new URL(baseUrl);
    if (!url.pathname.endsWith('/ws')) {
      url.pathname = url.pathname + '/ws';
    }

    // Add query parameters
    if (this.config.sessionId) {
      url.searchParams.set('sessionId', this.config.sessionId);
    }
    url.searchParams.set('clientType', 'browser');
    url.searchParams.set('version', this.config.version);

    return url.toString();
  }

  /**
   * Ensure WebSocket is available (polyfill for Node.js)
   */
  private async ensureWebSocket(): Promise<void> {
    if (typeof globalThis.WebSocket !== 'undefined') {
      WebSocketImpl = globalThis.WebSocket;
      return;
    }

    // Node.js environment - use ws package
    try {
      const { default: WS } = await import('ws');
      WebSocketImpl = WS as unknown as typeof WebSocket;
    } catch {
      throw new BTCPConnectionError(
        'WebSocket not available. Install ws package: npm install ws'
      );
    }
  }

  /**
   * Start keep-alive ping interval
   */
  private startPingInterval(): void {
    if (this.config.pingInterval > 0) {
      this.pingIntervalId = setInterval(() => {
        if (this.isConnected()) {
          // Send a ping message (the client will handle the response)
          this.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: `ping-${Date.now()}` }))
            .catch((err) => {
              this.log('[Transport-WS]', 'Ping failed:', err);
            });
        }
      }, this.config.pingInterval);
    }
  }

  /**
   * Stop keep-alive ping interval
   */
  private stopPingInterval(): void {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }
}
