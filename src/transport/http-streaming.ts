/**
 * HTTP Streaming Transport Implementation
 *
 * Uses Server-Sent Events (SSE) for server-to-client streaming
 * and HTTP POST for client-to-server messages.
 */

import { BaseTransport } from './base.js';
import type { HttpStreamingTransportConfig } from './types.js';
import { BTCPConnectionError } from '../types.js';

// EventSource polyfill for Node.js
let EventSourceImpl: typeof EventSource;

const DEFAULT_CONFIG = {
  connectionTimeout: 10000,
  debug: false,
  version: '1.0.0',
};

/**
 * HTTP Streaming transport for BTCP.
 *
 * Uses SSE (Server-Sent Events) for receiving messages from the server,
 * and HTTP POST for sending messages to the server.
 *
 * @example
 * ```typescript
 * const transport = new HttpStreamingTransport({
 *   url: 'http://localhost:8765',
 *   debug: true,
 * });
 *
 * transport.on('message', (data) => console.log('Received:', data));
 * await transport.connect();
 * await transport.send(JSON.stringify({ method: 'ping' }));
 * ```
 */
export class HttpStreamingTransport extends BaseTransport {
  private config: Required<HttpStreamingTransportConfig>;
  private eventSource: EventSource | null = null;
  private isConnecting = false;
  private abortController: AbortController | null = null;

  constructor(config: HttpStreamingTransportConfig) {
    super(config.debug ?? false);

    if (!config.url) {
      throw new BTCPConnectionError('url is required for HttpStreamingTransport');
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      sessionId: config.sessionId || '',
      version: config.version || DEFAULT_CONFIG.version,
      headers: config.headers || {},
    };
  }

  /**
   * Connect to the server using SSE
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.isConnecting) {
      throw new BTCPConnectionError('Connection already in progress');
    }

    this.isConnecting = true;
    this.abortController = new AbortController();

    // Ensure EventSource is available
    await this.ensureEventSource();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        reject(new BTCPConnectionError('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        const sseUrl = this.buildSseUrl();
        this.log('[Transport-HTTP]', `Connecting to ${sseUrl}`);

        this.eventSource = new EventSourceImpl(sseUrl);

        this.eventSource.onopen = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.log('[Transport-HTTP]', 'Connected via SSE');
          this.emit('connect');
          resolve();
        };

        this.eventSource.onerror = () => {
          clearTimeout(timeout);
          if (this.isConnecting) {
            this.isConnecting = false;
            const error = new BTCPConnectionError('SSE connection error');
            this.emit('error', error);
            reject(error);
          } else {
            // Connection lost
            this.eventSource = null;
            this.emit('disconnect', 0, 'Connection lost');
          }
        };

        this.eventSource.onmessage = (event) => {
          this.log('[Transport-HTTP]', 'Received:', event.data);
          this.emit('message', event.data);
        };

        // Listen for specific event types
        this.eventSource.addEventListener('request', (event) => {
          const data = (event as MessageEvent).data;
          this.log('[Transport-HTTP]', 'Received request:', data);
          this.emit('message', data);
        });

        this.eventSource.addEventListener('response', (event) => {
          const data = (event as MessageEvent).data;
          this.log('[Transport-HTTP]', 'Received response:', data);
          this.emit('message', data);
        });

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
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.emit('disconnect', 1000, 'Client disconnected');
  }

  /**
   * Send a message via HTTP POST
   */
  async send(data: string): Promise<void> {
    const url = `${this.config.url}/message`;

    this.log('[Transport-HTTP]', 'Sending:', data);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': this.config.sessionId,
        ...this.config.headers,
      },
      body: data,
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new BTCPConnectionError(`HTTP error: ${response.status}`);
    }

    // Check if there's a response body and emit it
    const text = await response.text();
    if (text) {
      this.log('[Transport-HTTP]', 'Response:', text);
      this.emit('message', text);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.eventSource !== null && this.eventSource.readyState === EventSource.OPEN;
  }

  /**
   * Build SSE URL with query parameters
   */
  private buildSseUrl(): string {
    const baseUrl = this.config.url.replace(/\/$/, '');
    const params = new URLSearchParams();

    if (this.config.sessionId) {
      params.set('sessionId', this.config.sessionId);
    }
    params.set('clientType', 'browser');
    params.set('version', this.config.version);

    return `${baseUrl}/events?${params.toString()}`;
  }

  /**
   * Ensure EventSource is available (polyfill for Node.js)
   */
  private async ensureEventSource(): Promise<void> {
    if (typeof globalThis.EventSource !== 'undefined') {
      EventSourceImpl = globalThis.EventSource;
      return;
    }

    // Node.js environment - use eventsource package
    try {
      const { default: EventSource } = await import('eventsource');
      EventSourceImpl = EventSource as unknown as typeof globalThis.EventSource;
    } catch {
      throw new BTCPConnectionError(
        'EventSource not available. Install eventsource package: npm install eventsource'
      );
    }
  }
}
