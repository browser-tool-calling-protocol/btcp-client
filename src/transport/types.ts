/**
 * Transport Layer Types for BTCP Client
 *
 * Defines the interface for pluggable transport implementations.
 */

// ============================================================================
// Transport Events
// ============================================================================

export interface TransportEvents {
  /** Connection established */
  connect: () => void;
  /** Connection closed */
  disconnect: (code: number, reason: string) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** Message received */
  message: (data: string) => void;
}

export type TransportEventHandler<K extends keyof TransportEvents> = TransportEvents[K];

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Transport interface for BTCP communication.
 *
 * Implementations handle the low-level connection and message passing,
 * allowing the BTCPClient to be transport-agnostic.
 */
export interface Transport {
  /**
   * Connect to the server
   * @returns Promise that resolves when connected
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the server
   */
  disconnect(): void;

  /**
   * Send a message to the server
   * @param data - Serialized message string
   */
  send(data: string): Promise<void>;

  /**
   * Check if transport is connected
   */
  isConnected(): boolean;

  /**
   * Add event listener
   */
  on<K extends keyof TransportEvents>(event: K, handler: TransportEventHandler<K>): void;

  /**
   * Remove event listener
   */
  off<K extends keyof TransportEvents>(event: K, handler: TransportEventHandler<K>): void;
}

// ============================================================================
// Base Transport Configuration
// ============================================================================

export interface TransportConfig {
  /** Server URL */
  url: string;
  /** Session ID */
  sessionId?: string;
  /** Client version */
  version?: string;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// WebSocket Transport Configuration
// ============================================================================

export interface WebSocketTransportConfig extends TransportConfig {
  /** Keep-alive ping interval in ms (default: 30000, 0 to disable) */
  pingInterval?: number;
}

// ============================================================================
// HTTP Streaming Transport Configuration
// ============================================================================

export interface HttpStreamingTransportConfig extends TransportConfig {
  /** Custom headers for HTTP requests */
  headers?: Record<string, string>;
}
