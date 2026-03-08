"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RuntimeDashboardStatePatch, SSEConnectionState } from "../types";
import { createRuntimeEventSource } from "../api/client";

export function useRuntimeEvents(
  onPatch?: (patch: RuntimeDashboardStatePatch) => void,
  enabled: boolean = true
) {
  const [connectionState, setConnectionState] = useState<SSEConnectionState>({
    connected: false,
    connecting: false,
    error: null,
    lastEventAt: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    setConnectionState((prev) => ({ ...prev, connecting: true }));

    try {
      const source = createRuntimeEventSource(
        (event) => {
          setConnectionState({
            connected: true,
            connecting: false,
            error: null,
            lastEventAt: Date.now(),
          });

          if (event.type === "patch" && event.data && onPatch) {
            onPatch(event.data);
          }
        },
        (error) => {
          console.error("SSE error:", error);
          setConnectionState((prev) => ({
            ...prev,
            connected: false,
            connecting: false,
            error: new Error("Connection failed"),
          }));
        }
      );

      eventSourceRef.current = source;
    } catch (err) {
      setConnectionState((prev) => ({
        ...prev,
        connected: false,
        connecting: false,
        error: err instanceof Error ? err : new Error("Unknown error"),
      }));
    }
  }, [enabled, onPatch]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnectionState({
      connected: false,
      connecting: false,
      error: null,
      lastEventAt: null,
    });
  }, []);

  // Auto-reconnect on disconnect
  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    if (!connectionState.connected && !connectionState.connecting && !connectionState.error) {
      connect();
    }

    // Reconnect if disconnected unexpectedly
    if (!connectionState.connected && !connectionState.connecting && connectionState.error) {
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, connect, disconnect, connectionState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...connectionState,
    connect,
    disconnect,
  };
}
