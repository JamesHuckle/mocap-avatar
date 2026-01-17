import {useState, useRef, useCallback, useEffect} from 'react';
import {ServoAngles} from '../components/ServoMapping';

// Default pulse limits
export const DEFAULT_MIN_PULSE = 0;
export const DEFAULT_MAX_PULSE = 1000;

// All servo IDs (1-16)
export const ALL_SERVOS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'];

// Default enabled servos (shoulders only)
export const DEFAULT_ENABLED_SERVOS = new Set([
  '7', '8',   // Left shoulder
  '15', '16', // Right shoulder
]);

// Convert degrees to pulse with configurable limits (legacy path; not used when sending pulses directly)
export function degreesToPulse(degrees: number, minPulse: number, maxPulse: number): number {
  const normalized = degrees / 180;
  return Math.round(minPulse + normalized * (maxPulse - minPulse));
}

export interface ServoConnectionState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastSentAt: number | null;
}

export interface ServoConnectionConfig {
  enabledServos: Set<string>;
}

export function useServoConnection(robotUrl: string, config: ServoConnectionConfig) {
  const [state, setState] = useState<ServoConnectionState>({
    connected: false,
    connecting: false,
    error: null,
    lastSentAt: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setState(s => ({...s, connecting: true, error: null}));

    try {
      const ws = new WebSocket(robotUrl);

      ws.onopen = () => {
        setState({connected: true, connecting: false, error: null, lastSentAt: null});
        console.log('[Servo] Connected to robot');
      };

      ws.onclose = () => {
        setState(s => ({...s, connected: false, connecting: false}));
        console.log('[Servo] Disconnected from robot');
        wsRef.current = null;
      };

      ws.onerror = (e) => {
        console.error('[Servo] WebSocket error:', e);
        setState(s => ({...s, error: 'Connection failed', connecting: false, connected: false}));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') {
            console.log('[Servo] Pong received');
          }
        } catch {
          // Ignore parse errors
        }
      };

      wsRef.current = ws;
    } catch (err) {
      setState(s => ({...s, error: String(err), connecting: false}));
    }
  }, [robotUrl]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({connected: false, connecting: false, error: null, lastSentAt: null});
  }, []);

  const sendServos = useCallback((angles: ServoAngles) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const {enabledServos} = configRef.current;
    
    // Convert only enabled servo angles to pulses
    const servos: Record<string, number> = {};
    for (const [id, degrees] of Object.entries(angles)) {
      if (enabledServos.has(id) && typeof degrees === 'number' && !isNaN(degrees)) {
        // Legacy: interpret incoming values as *degrees* and map into full 0..1000
        servos[id] = degreesToPulse(degrees, DEFAULT_MIN_PULSE, DEFAULT_MAX_PULSE);
      }
    }

    if (Object.keys(servos).length === 0) return;

    const message = JSON.stringify({type: 'servos', servos});
    wsRef.current.send(message);
    setState(s => ({...s, lastSentAt: Date.now()}));
  }, []);

  // Preferred: send pulses (0..1000) directly
  const sendPulses = useCallback((pulses: Record<string, number>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const {enabledServos} = configRef.current;

    const servos: Record<string, number> = {};
    for (const [id, pulse] of Object.entries(pulses)) {
      if (enabledServos.has(id) && typeof pulse === 'number' && !isNaN(pulse)) {
        servos[id] = Math.round(pulse);
      }
    }
    if (Object.keys(servos).length === 0) return;

    const message = JSON.stringify({type: 'servos', servos});
    wsRef.current.send(message);
    setState(s => ({...s, lastSentAt: Date.now()}));
  }, []);

  const ping = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({type: 'ping'}));
  }, []);

  const reset = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({type: 'reset'}));
    console.log('[Servo] Reset command sent');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    sendServos,
    sendPulses,
    ping,
    reset,
  };
}
