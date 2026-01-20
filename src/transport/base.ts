/**
 * Base Transport Implementation
 *
 * Provides shared functionality for all transport implementations.
 */

import type { Transport, TransportEvents, TransportEventHandler } from './types.js';

/**
 * Abstract base class for transport implementations.
 *
 * Provides common event handling and logging functionality.
 */
export abstract class BaseTransport implements Transport {
  protected eventHandlers: Map<keyof TransportEvents, Set<Function>> = new Map();
  protected debugEnabled: boolean;

  constructor(debug = false) {
    this.debugEnabled = debug;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract send(data: string): Promise<void>;
  abstract isConnected(): boolean;

  /**
   * Add event listener
   */
  on<K extends keyof TransportEvents>(event: K, handler: TransportEventHandler<K>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof TransportEvents>(event: K, handler: TransportEventHandler<K>): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Emit an event to all registered handlers
   */
  protected emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as Function)(...args);
        } catch (err) {
          this.log(`Error in event handler for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Log message if debug is enabled
   */
  protected log(prefix: string, ...args: unknown[]): void {
    if (this.debugEnabled) {
      console.log(prefix, ...args);
    }
  }
}
