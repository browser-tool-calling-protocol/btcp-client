/**
 * BTCP Transport Layer
 *
 * Provides pluggable transport implementations for BTCP communication.
 */

// Types
export type {
  Transport,
  TransportConfig,
  TransportEvents,
  TransportEventHandler,
  WebSocketTransportConfig,
  HttpStreamingTransportConfig,
} from './types.js';

// Base class (for custom implementations)
export { BaseTransport } from './base.js';

// Transport implementations
export { WebSocketTransport } from './websocket.js';
export { HttpStreamingTransport } from './http-streaming.js';
