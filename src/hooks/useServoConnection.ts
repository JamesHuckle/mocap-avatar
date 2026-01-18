import {useState, useRef, useCallback, useEffect} from 'react';
import {ServoAngles} from '../components/ServoMapping';

// Default pulse limits
export const DEFAULT_MIN_PULSE = 0;
export const DEFAULT_MAX_PULSE = 1000;

// All servo IDs (1-18, including head servos)
export const ALL_SERVOS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18'];

// Standing default positions from TonyPi documentation
// These are the safe "standing" positions for the robot
export const STANDING_POSITIONS: Record<string, number> = {
  '1': 500,   // R Ankle
  '2': 390,   // R (Unknown)
  '3': 500,   // R Knee
  '4': 600,   // R Hip Front
  '5': 500,   // R Hip Side
  '6': 575,   // L Elbow
  '7': 800,   // L Shoulder Side
  '8': 725,   // L Shoulder Fwd
  '9': 500,   // L Ankle
  '10': 610,  // L (Unknown)
  '11': 500,  // L Knee
  '12': 400,  // L Hip Front
  '13': 500,  // L Hip Side
  '14': 425,  // R Elbow
  '15': 200,  // R Shoulder Side
  '16': 275,  // R Shoulder Fwd
  '17': 500,  // Head Pan
  '18': 500,  // Head Tilt
};

// Default enabled servos (all tracked joints) - CORRECTED servo numbers
export const DEFAULT_ENABLED_SERVOS = new Set([
  // Arms
  '6', '7', '8',     // Left arm: elbow, shoulder_side, shoulder_fwd
  '14', '15', '16',  // Right arm: elbow, shoulder_side, shoulder_fwd
  // Hips
  '4', '5',          // Right hip: front, side
  '12', '13',        // Left hip: front, side
  // Knees
  '3',               // Right knee
  '11',              // Left knee
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

  // Debug comparison: send both FBX and MediaPipe servo data for comparison
  const sendDebugComparison = useCallback((
    fbxServos: Record<string, number>,
    mediapipeServos: Record<string, number>,
    fbxJoints?: Record<string, {x: number; y: number; z: number}>,
    mediapipeJoints?: Record<string, {x: number; y: number; z: number}>
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const message = JSON.stringify({
      type: 'debug_comparison',
      fbx_servos: fbxServos,
      mediapipe_servos: mediapipeServos,
      ...(fbxJoints && {fbx_joints: fbxJoints}),
      ...(mediapipeJoints && {mediapipe_joints: mediapipeJoints}),
    });
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

  // Emergency stop: send standing positions to ALL servos, then disconnect after delay
  // This bypasses enabledServos filter intentionally for safety
  const emergencyStop = useCallback((onStopStreaming?: () => void) => {
    console.log('[Servo] 🚨 EMERGENCY STOP initiated');
    
    // Immediately call the stop streaming callback if provided
    if (onStopStreaming) {
      onStopStreaming();
    }
    
    // Send standing positions to ALL servos (bypass enabledServos filter for safety)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({type: 'servos', servos: STANDING_POSITIONS});
      
      // Send multiple times to ensure it gets through
      wsRef.current.send(message);
      console.log('[Servo] Standing positions sent (1/3)');
      
      // Send again after small delays for redundancy
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(message);
          console.log('[Servo] Standing positions sent (2/3)');
        }
      }, 100);
      
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(message);
          console.log('[Servo] Standing positions sent (3/3)');
        }
      }, 200);
      
      // Disconnect after 1.2 seconds to ensure messages are sent
      setTimeout(() => {
        console.log('[Servo] Disconnecting WebSocket after emergency stop');
        disconnect();
      }, 1200);
    } else {
      // If not connected, just ensure disconnected state
      disconnect();
    }
  }, [disconnect]);

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
    sendDebugComparison,
    ping,
    reset,
    emergencyStop,
  };
}
