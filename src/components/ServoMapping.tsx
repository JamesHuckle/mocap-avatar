import {Box, Text, VStack, HStack, Grid, GridItem, Input, Button, Badge, Switch, Collapse, useToast, Tooltip, NumberInput, NumberInputField, NumberInputStepper, NumberIncrementStepper, NumberDecrementStepper, keyframes} from '@chakra-ui/react';
import {NormalizedLandmark} from '@mediapipe/tasks-vision';
import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {useServoConnection, ALL_SERVOS, DEFAULT_ENABLED_SERVOS} from '../hooks/useServoConnection';
import {DEFAULT_SERVO_CALIBRATIONS} from '../config/servoCalibrationDefaults';
import {TonyPiServoCalculator, ServoPositions, MP_LANDMARKS} from '../lib/tonypiServoCalculations';
import {ServoPositions as AnimServoPositions} from '../lib/vrmServoCalculations';

// Joint position type for debug comparison
export type JointPositions = Record<string, {x: number; y: number; z: number}>;

// Extract joint positions from MediaPipe landmarks for debug logging
function extractMediaPipeJoints(landmarks: NormalizedLandmark[]): JointPositions {
  if (!landmarks || landmarks.length < 33) return {};
  
  const joints: JointPositions = {};
  
  // Map MediaPipe landmark indices to named joints
  const landmarkMap: Record<string, number> = {
    leftShoulder: MP_LANDMARKS.LEFT_SHOULDER,
    rightShoulder: MP_LANDMARKS.RIGHT_SHOULDER,
    leftElbow: MP_LANDMARKS.LEFT_ELBOW,
    rightElbow: MP_LANDMARKS.RIGHT_ELBOW,
    leftWrist: MP_LANDMARKS.LEFT_WRIST,
    rightWrist: MP_LANDMARKS.RIGHT_WRIST,
    leftHip: MP_LANDMARKS.LEFT_HIP,
    rightHip: MP_LANDMARKS.RIGHT_HIP,
    leftKnee: MP_LANDMARKS.LEFT_KNEE,
    rightKnee: MP_LANDMARKS.RIGHT_KNEE,
    leftAnkle: MP_LANDMARKS.LEFT_ANKLE,
    rightAnkle: MP_LANDMARKS.RIGHT_ANKLE,
  };
  
  for (const [name, idx] of Object.entries(landmarkMap)) {
    const lm = landmarks[idx];
    if (lm) {
      joints[name] = {
        x: Number(lm.x.toFixed(4)),
        y: Number(lm.y.toFixed(4)),
        z: Number(lm.z.toFixed(4)),
      };
    }
  }
  
  return joints;
}

// Pulsing animation for emergency stop button
const pulseAnimation = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
`;

// Calibration settings per servo
export interface ServoCalibration {
  // Input range calibration (raw mocap angles). When set, we scale rawAngle from inputMin..inputMax
  // into the full servo pulse range (0..1000).
  inputMin?: number;
  inputMax?: number;
  invert: boolean;   // Invert the direction
}

// Full calibration config for export/import
export interface CalibrationConfig {
  version: number;
  servos: Record<string, ServoCalibration>;
  enabledServos: string[];
}

const DEFAULT_CALIBRATION: ServoCalibration = {
  invert: false,
};

const CALIBRATION_STORAGE_KEY = 'tonypi-servo-calibration';

// Load calibration from localStorage
function loadCalibration(): Record<string, ServoCalibration> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (stored) {
      const config: CalibrationConfig = JSON.parse(stored);
      return config.servos || {};
    }
  } catch (e) {
    console.error('Failed to load calibration:', e);
  }
  return {};
}

// Save calibration to localStorage
function saveCalibration(config: CalibrationConfig) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save calibration:', e);
  }
}

// Map raw mocap angle directly into servo pulse space (0..1000).
// No hard clamps: if you move beyond captured extremes, pulses can go <0 or >1000.
function mapRawToPulse(rawAngle: number, cal: ServoCalibration): number {
  const hasInputRange =
    typeof cal.inputMin === 'number' &&
    typeof cal.inputMax === 'number' &&
    isFinite(cal.inputMin) &&
    isFinite(cal.inputMax) &&
    cal.inputMax !== cal.inputMin;

  if (!hasInputRange) return 500; // neutral until you capture extremes

  const inMin = cal.inputMin as number;
  const inMax = cal.inputMax as number;
  const t0 = (rawAngle - inMin) / (inMax - inMin);
  const t = cal.invert ? 1 - t0 : t0;
  return Math.round(t * 1000);
}

// TonyPi Servo Configuration - CORRECTED mappings
// NOTE: This matches the Python tonypi_pose_mimic.py exactly
export const SERVO_CONFIG: Record<string, {name: string; group: string}> = {
  '1': {name: 'right_ankle', group: 'right_leg'},
  '2': {name: 'unused', group: 'right_leg'},
  '3': {name: 'right_knee', group: 'right_leg'},
  '4': {name: 'right_hip_front', group: 'right_leg'},
  '5': {name: 'right_hip_side', group: 'right_leg'},
  '6': {name: 'left_elbow', group: 'left_arm'},
  '7': {name: 'left_shoulder_side', group: 'left_arm'},
  '8': {name: 'left_shoulder_fwd', group: 'left_arm'},
  '9': {name: 'left_ankle', group: 'left_leg'},
  '10': {name: 'unused', group: 'left_leg'},
  '11': {name: 'left_knee', group: 'left_leg'},
  '12': {name: 'left_hip_front', group: 'left_leg'},
  '13': {name: 'left_hip_side', group: 'left_leg'},
  '14': {name: 'right_elbow', group: 'right_arm'},
  '15': {name: 'right_shoulder_side', group: 'right_arm'},
  '16': {name: 'right_shoulder_fwd', group: 'right_arm'},
} as const;

export interface ServoAngles {
  [key: string]: number;
}

// Singleton calculator instance (matches Python logic exactly)
const tonypiCalculator = new TonyPiServoCalculator(true); // fullBody=true

/**
 * Calculate servo pulses using the new Python-matching logic
 * Returns servo positions directly in pulse range (125-875)
 * 
 * NOTE: This replaces the old calculateServoAngles with correct logic
 * that matches scripts/tonypi_pose_mimic.py exactly
 */
export function calculateServoPulses(
  poseLandmarks: NormalizedLandmark[],
  _worldLandmarks?: NormalizedLandmark[]
): ServoPositions {
  // IMPORTANT: Always use poseLandmarks (normalized 0-1 image coords)
  // NOT worldLandmarks (which are in meters, centered at hip)
  // Python uses pose_landmarks which are normalized, matching poseLandmarks
  if (!poseLandmarks || poseLandmarks.length < 33) return {};
  
  const positions = tonypiCalculator.calculateServoPositions(poseLandmarks);
  return positions || {};
}

/**
 * Legacy function - converts new pulse output to old ServoAngles format
 * This maintains backward compatibility with calibration system
 */
export function calculateServoAngles(
  poseLandmarks: NormalizedLandmark[],
  _worldLandmarks?: NormalizedLandmark[]
): ServoAngles {
  // Use new calculator - always uses poseLandmarks (normalized image coords)
  const pulses = calculateServoPulses(poseLandmarks);
  const angles: ServoAngles = {};
  
  for (const [id, pulse] of Object.entries(pulses)) {
    // Store pulse directly - calibration will be bypassed when using new mode
    angles[id] = pulse;
  }
  
  // Fill in missing servos with neutral position (500)
  for (const id of ALL_SERVOS) {
    if (!(id in angles)) {
      angles[id] = 500; // Neutral position
    }
  }
  
  return angles;
}

// Servo indicator component with enable toggle and calibration
function ServoIndicator({id, name, rawAngle, calibratedAngle, group, streaming, enabled, onToggle, calibration, onCalibrationChange}: {
  id: string; 
  name: string; 
  rawAngle: number;
  calibratedAngle: number; // now represents pulse
  group: string;
  streaming?: boolean;
  enabled: boolean;
  onToggle: (id: string) => void;
  calibration: ServoCalibration;
  onCalibrationChange: (id: string, cal: ServoCalibration) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  
  const groupColors: Record<string, string> = {
    left_arm: '#3b82f6',
    right_arm: '#ef4444',
    left_leg: '#22c55e',
    right_leg: '#f97316',
  };

  const color = enabled ? (groupColors[group] || '#6b7280') : '#4a5568';
  const displayRaw = isNaN(rawAngle) ? 90 : Math.round(rawAngle);
  const pulseValue = isNaN(calibratedAngle) ? 500 : Math.round(calibratedAngle);
  const isStreaming = streaming && enabled;

  const updateCal = (key: keyof ServoCalibration, value: number | boolean) => {
    onCalibrationChange(id, {...calibration, [key]: value});
  };

  return (
    <Box 
      bg={enabled ? "gray.800" : "gray.900"} 
      borderRadius="md" 
      borderLeft="4px solid" 
      borderLeftColor={color}
      opacity={enabled ? 1 : 0.6}
      transition="all 0.15s"
    >
      {/* Header row - clickable to expand */}
      <Box 
        p={3}
        cursor="pointer"
        onClick={() => setExpanded(!expanded)}
        _hover={{bg: enabled ? "gray.750" : "gray.850"}}
      >
        <HStack justify="space-between" mb={1}>
          <HStack spacing={2}>
            <Text fontSize="sm" color="gray.400" fontWeight="bold">{id}</Text>
            <Switch 
              size="sm" 
              isChecked={enabled} 
              onChange={() => onToggle(id)}
              colorScheme="green"
              onClick={(e) => e.stopPropagation()}
            />
            {isStreaming && <Text fontSize="10px" color="green.400">●</Text>}
            <Text fontSize="10px" color="gray.500">{expanded ? '▼' : '▶'}</Text>
          </HStack>
          <VStack spacing={0} align="end">
            <HStack spacing={2}>
              <Tooltip label={`Raw mocap: ${displayRaw}°`} placement="top">
                <Text fontSize="lg" color="white" fontWeight="bold">{pulseValue}</Text>
              </Tooltip>
            </HStack>
            <Text fontSize="10px" color="gray.500" fontWeight="mono">pulse (0-1000)</Text>
          </VStack>
        </HStack>
        <Text fontSize="sm" color="gray.300" noOfLines={1}>{name.replace(/_/g, ' ')}</Text>
        
        {/* Range bar showing pulse value (0-1000) */}
        <Box mt={2} h="8px" bg="gray.700" borderRadius="full" overflow="hidden" position="relative">
          {/* Center (500) marker */}
          <Box position="absolute" left="50%" top={0} bottom={0} w="1px" bg="yellow.500" opacity={0.5} />
          {/* Current pulse position */}
          <Box h="100%" w={`${(pulseValue / 1000) * 100}%`} bg={color} transition="width 0.05s" />
        </Box>
        <HStack justify="space-between" mt={1}>
          <Text fontSize="9px" color="gray.600">0</Text>
          <Text fontSize="9px" color="gray.600">500</Text>
          <Text fontSize="9px" color="gray.600">1000</Text>
        </HStack>
      </Box>

      {/* Calibration controls - expandable */}
      <Collapse in={expanded}>
        <Box px={3} pb={3} pt={1} bg="gray.850" borderTop="1px solid" borderTopColor="gray.700">
          <Box mb={2} px={1}>
            <Text fontSize="10px" color="gray.500">
              Capture your real extremes: move to a min/max pose, then click <b>Set</b> to record the raw mocap angle.
              When Input Min/Max are set, your motion is scaled into full 0–1000 robot pulses.
            </Text>
          </Box>

          {/* Input (mocap) range capture */}
          <Grid templateColumns="1fr 1fr" gap={2} mb={3}>
            <VStack spacing={1} align="stretch">
              <HStack justify="space-between">
                <Text fontSize="10px" color="cyan.300">Input Min (raw°)</Text>
                <Button
                  size="xs"
                  variant="ghost"
                  color="white"
                  _hover={{bg: 'whiteAlpha.200'}}
                  onClick={() => updateCal('inputMin', displayRaw)}
                >
                  Set
                </Button>
              </HStack>
              <NumberInput
                size="xs"
                value={calibration.inputMin ?? ''}
                min={0}
                max={180}
                onChange={(v) => {
                  const n = Number(v);
                  if (!isNaN(n)) updateCal('inputMin', n);
                }}
              >
                <NumberInputField bg="gray.700" textAlign="center" px={1} placeholder="(unset)" />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </VStack>

            <VStack spacing={1} align="stretch">
              <HStack justify="space-between">
                <Text fontSize="10px" color="cyan.300">Input Max (raw°)</Text>
                <Button
                  size="xs"
                  variant="ghost"
                  color="white"
                  _hover={{bg: 'whiteAlpha.200'}}
                  onClick={() => updateCal('inputMax', displayRaw)}
                >
                  Set
                </Button>
              </HStack>
              <NumberInput
                size="xs"
                value={calibration.inputMax ?? ''}
                min={0}
                max={180}
                onChange={(v) => {
                  const n = Number(v);
                  if (!isNaN(n)) updateCal('inputMax', n);
                }}
              >
                <NumberInputField bg="gray.700" textAlign="center" px={1} placeholder="(unset)" />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </VStack>
          </Grid>

          <HStack justify="space-between">
            <HStack spacing={2}>
              <Text fontSize="xs" color="gray.400">Invert</Text>
              <Switch 
                size="sm" 
                isChecked={calibration.invert} 
                onChange={(e) => updateCal('invert', e.target.checked)}
                colorScheme="purple"
              />
            </HStack>
            <Button 
              size="xs" 
              variant="ghost" 
              onClick={() => onCalibrationChange(id, {...DEFAULT_CALIBRATION})}
            >
              Reset
            </Button>
          </HStack>
        </Box>
      </Collapse>
    </Box>
  );
}

// Throttle interval in ms (20Hz = 50ms)
const SEND_INTERVAL_MS = 50;

// Main component
export default function ServoMapping({
  poseLandmarks,
  worldLandmarks,
  animationServoPositions,
  debugComparisonMode = false,
  mediapipePoseForComparison,
  fbxJointPositions,
}: {
  poseLandmarks?: NormalizedLandmark[];
  worldLandmarks?: NormalizedLandmark[];
  animationServoPositions?: AnimServoPositions | null;
  debugComparisonMode?: boolean;
  mediapipePoseForComparison?: NormalizedLandmark[];
  fbxJointPositions?: JointPositions | null;
}) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [robotUrl, setRobotUrl] = useState('ws://192.168.0.104:8766');
  const [streaming, setStreaming] = useState(false);
  const [enabledServos, setEnabledServos] = useState<Set<string>>(() => new Set(DEFAULT_ENABLED_SERVOS));
  const [calibrations, setCalibrations] = useState<Record<string, ServoCalibration>>(() => ({
    ...DEFAULT_SERVO_CALIBRATIONS,
    ...loadCalibration(),
  }));
  const lastSendRef = useRef<number>(0);

  // Get calibration for a servo (with defaults)
  const getCalibration = useCallback((id: string): ServoCalibration => {
    return calibrations[id] || {...DEFAULT_CALIBRATION};
  }, [calibrations]);

  // Update calibration for a servo
  const updateCalibration = useCallback((id: string, cal: ServoCalibration) => {
    setCalibrations(prev => {
      const next = {...prev, [id]: cal};
      // Auto-save to localStorage
      saveCalibration({
        version: 1,
        servos: next,
        enabledServos: Array.from(enabledServos),
      });
      return next;
    });
  }, [enabledServos]);

  // Export calibration to JSON file
  const exportCalibration = useCallback(() => {
    const config = {
      _comment:
        'TonyPi Servo Calibration - inputMin/inputMax: capture raw mocap extremes (scales motion into full 0..1000 pulses). invert: flip direction.',
      version: 1,
      servos: calibrations,
      enabledServos: Array.from(enabledServos),
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tonypi-calibration-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: 'Calibration exported',
      status: 'success',
      duration: 2000,
    });
  }, [calibrations, enabledServos, toast]);

  // Import calibration from JSON file
  const importCalibration = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const config: CalibrationConfig = JSON.parse(e.target?.result as string);
        
        if (config.servos) setCalibrations(config.servos);
        if (config.enabledServos) setEnabledServos(new Set(config.enabledServos));
        
        // Save to localStorage
        saveCalibration(config);
        
        toast({
          title: 'Calibration imported',
          description: `Loaded ${Object.keys(config.servos || {}).length} servo configs`,
          status: 'success',
          duration: 3000,
        });
      } catch (err) {
        toast({
          title: 'Import failed',
          description: 'Invalid calibration file',
          status: 'error',
          duration: 3000,
        });
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [toast]);

  // Reset all calibrations to default
  const resetAllCalibrations = useCallback(() => {
    setCalibrations({...DEFAULT_SERVO_CALIBRATIONS});
    // Keep localStorage consistent with defaults (so refresh behaves the same)
    saveCalibration({
      version: 1,
      servos: {...DEFAULT_SERVO_CALIBRATIONS},
      enabledServos: Array.from(enabledServos),
    });
    toast({
      title: 'Calibrations reset',
      status: 'info',
      duration: 2000,
    });
  }, [toast, enabledServos]);

  const toggleServo = (id: string) => {
    setEnabledServos(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const enableGroup = (group: string) => {
    setEnabledServos(prev => {
      const next = new Set(prev);
      ALL_SERVOS.forEach(id => {
        if (SERVO_CONFIG[id]?.group === group) next.add(id);
      });
      return next;
    });
  };

  const disableGroup = (group: string) => {
    setEnabledServos(prev => {
      const next = new Set(prev);
      ALL_SERVOS.forEach(id => {
        if (SERVO_CONFIG[id]?.group === group) next.delete(id);
      });
      return next;
    });
  };

  const enableAll = () => setEnabledServos(new Set(ALL_SERVOS));
  const disableAll = () => setEnabledServos(new Set());
  const resetToDefault = () => setEnabledServos(new Set(DEFAULT_ENABLED_SERVOS));

  const servo = useServoConnection(robotUrl, {enabledServos});
  
  // Emergency stop handler (also callable via keyboard)
  const handleEmergencyStop = useCallback(() => {
    if (servo.connected) {
      servo.emergencyStop(() => setStreaming(false));
    }
  }, [servo]);
  
  // Keyboard shortcut for emergency stop (Escape key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key triggers emergency stop when connected and streaming
      if (e.key === 'Escape' && servo.connected && streaming) {
        e.preventDefault();
        handleEmergencyStop();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [servo.connected, streaming, handleEmergencyStop]);
  
  // Determine if we're using animation data or mocap data
  const isAnimationMode = animationServoPositions != null && Object.keys(animationServoPositions).length > 0;
  
  // Calculate servo pulses directly using Python-matching logic
  // The new calculator outputs pulse values (125-875) directly
  const rawAngles = useMemo(() => {
    // If animation is playing, use animation servo positions
    if (isAnimationMode && animationServoPositions) {
      const angles: ServoAngles = {};
      for (const [id, value] of Object.entries(animationServoPositions)) {
        angles[id] = value;
      }
      return angles;
    }
    // Otherwise use mocap pose landmarks
    return poseLandmarks ? calculateServoAngles(poseLandmarks, worldLandmarks) : {};
  }, [poseLandmarks, worldLandmarks, animationServoPositions, isAnimationMode]);
  
  // The calculator outputs pulse values directly, no calibration needed
  // Values are in range 125-875 (TonyPi safe operating range)
  const calibratedAngles = useMemo(() => {
    const angles: ServoAngles = {};
    for (const id of ALL_SERVOS) {
      angles[id] = rawAngles[id] ?? 500;
    }
    return angles;
  }, [rawAngles]);

  // Calculate MediaPipe servo positions for debug comparison (only when debug mode is active)
  const mediapipeServosForComparison = useMemo(() => {
    if (!debugComparisonMode || !mediapipePoseForComparison) return null;
    return calculateServoAngles(mediapipePoseForComparison);
  }, [debugComparisonMode, mediapipePoseForComparison]);

  // Ref for debug comparison throttling
  const lastDebugSendRef = useRef<number>(0);
  const DEBUG_COMPARISON_INTERVAL_MS = 500; // Send debug comparison every 500ms (2Hz) to avoid spam

  // Stream servo data when enabled
  useEffect(() => {
    if (!streaming || !servo.connected || !poseLandmarks) return;

    const now = Date.now();
    if (now - lastSendRef.current >= SEND_INTERVAL_MS) {
      servo.sendPulses(calibratedAngles);
      lastSendRef.current = now;
    }
  }, [streaming, servo.connected, poseLandmarks, calibratedAngles, servo]);

  // Extract MediaPipe joint positions for debug comparison
  const mediapipeJointsForComparison = useMemo(() => {
    if (!debugComparisonMode || !mediapipePoseForComparison) return null;
    return extractMediaPipeJoints(mediapipePoseForComparison);
  }, [debugComparisonMode, mediapipePoseForComparison]);

  // Debug frame counter for console logging
  const debugFrameRef = useRef<number>(0);
  const debugStatusLoggedRef = useRef<boolean>(false);

  // Log debug status when mode changes
  useEffect(() => {
    if (debugComparisonMode && !debugStatusLoggedRef.current) {
      console.log('\n🔬 DEBUG COMPARISON MODE ENABLED');
      console.log('━'.repeat(50));
      console.log('Requirements:');
      console.log('  ✓ Debug mode: ON');
      console.log(`  ${isAnimationMode ? '✓' : '✗'} Animation playing: ${isAnimationMode ? 'YES' : 'NO - Load and play an FBX'}`);
      console.log(`  ${mediapipeServosForComparison ? '✓' : '✗'} MediaPipe tracking: ${mediapipeServosForComparison ? 'YES' : 'NO - Turn on camera'}`);
      console.log('━'.repeat(50));
      if (!isAnimationMode || !mediapipeServosForComparison) {
        console.log('⚠️  Waiting for all requirements to be met...\n');
      }
      debugStatusLoggedRef.current = true;
    } else if (!debugComparisonMode) {
      debugStatusLoggedRef.current = false;
      debugFrameRef.current = 0;
    }
  }, [debugComparisonMode, isAnimationMode, mediapipeServosForComparison]);

  // Send debug comparison data when debug mode is active
  // Also logs to browser console so you can see comparison without backend
  useEffect(() => {
    if (!debugComparisonMode) return;
    if (!isAnimationMode || !animationServoPositions) return;
    if (!mediapipeServosForComparison) return;

    const now = Date.now();
    if (now - lastDebugSendRef.current >= DEBUG_COMPARISON_INTERVAL_MS) {
      debugFrameRef.current += 1;
      
      // Convert animation servo positions to string keys for comparison
      const fbxServos: Record<string, number> = {};
      for (const [id, value] of Object.entries(animationServoPositions)) {
        fbxServos[String(id)] = value;
      }

      const mpServos: Record<string, number> = {};
      for (const [id, value] of Object.entries(mediapipeServosForComparison)) {
        mpServos[String(id)] = value;
      }

      // Always log to browser console for debugging
      console.log(`\n${'═'.repeat(80)}`);
      console.log(`[DEBUG FRAME ${debugFrameRef.current.toString().padStart(4, '0')}] FBX vs MediaPipe Comparison`);
      console.log(`${'═'.repeat(80)}`);
      
      // Log servo comparison
      console.log('\n🤖 SERVO POSITIONS:');
      console.log('ID    Name                    FBX     MediaPipe   Diff');
      console.log('─'.repeat(60));
      for (const id of ['6', '7', '8', '14', '15', '16']) {
        const name = SERVO_CONFIG[id]?.name || 'unknown';
        const fbx = fbxServos[id] ?? '-';
        const mp = mpServos[id] ?? '-';
        const diff = typeof fbx === 'number' && typeof mp === 'number' ? fbx - mp : '-';
        const diffStr = typeof diff === 'number' ? (diff >= 0 ? `+${diff}` : `${diff}`) : diff;
        console.log(`${id.padEnd(6)}${name.padEnd(24)}${String(Math.round(fbx as number)).padEnd(8)}${String(Math.round(mp as number)).padEnd(12)}${diffStr}`);
      }

      // Log joint positions if available
      if (fbxJointPositions || mediapipeJointsForComparison) {
        console.log('\n📍 JOINT POSITIONS:');
        console.log('Joint               FBX (x,y,z)                    MediaPipe (x,y,z)');
        console.log('─'.repeat(75));
        const joints = ['leftShoulder', 'leftElbow', 'rightShoulder', 'rightElbow'];
        for (const joint of joints) {
          const fbxPos = fbxJointPositions?.[joint];
          const mpPos = mediapipeJointsForComparison?.[joint];
          const fbxStr = fbxPos ? `(${fbxPos.x.toFixed(3)}, ${fbxPos.y.toFixed(3)}, ${fbxPos.z.toFixed(3)})` : '(no data)';
          const mpStr = mpPos ? `(${mpPos.x.toFixed(3)}, ${mpPos.y.toFixed(3)}, ${mpPos.z.toFixed(3)})` : '(no data)';
          console.log(`${joint.padEnd(20)}${fbxStr.padEnd(31)}${mpStr}`);
        }
      }
      console.log(`${'═'.repeat(80)}\n`);
      
      lastDebugSendRef.current = now;
    }
  }, [debugComparisonMode, isAnimationMode, animationServoPositions, mediapipeServosForComparison, fbxJointPositions, mediapipeJointsForComparison]);

  const handleConnect = () => {
    if (servo.connected) {
      setStreaming(false);
      servo.disconnect();
    } else {
      servo.connect();
    }
  };

  const enabledCount = enabledServos.size;

  return (
    <Box bg="gray.900" borderRadius="xl" p={5} color="white" maxH="100vh" overflowY="auto" minW="500px">
      <HStack justify="center" spacing={2} mb={3}>
        <Text fontSize="xl" fontWeight="bold">TonyPi Servo Control</Text>
        {isAnimationMode && (
          <Badge colorScheme="purple" fontSize="sm" px={2} py={1}>
            🎬 Animation Mode
          </Badge>
        )}
      </HStack>

      {/* Connection Controls */}
      <Box bg="gray.800" borderRadius="lg" p={3} mb={4}>
        <HStack mb={3}>
          <Input
            size="md"
            value={robotUrl}
            onChange={(e) => setRobotUrl(e.target.value)}
            placeholder="ws://192.168.0.104:8766"
            disabled={servo.connected}
            bg="gray.700"
            border="none"
          />
          <Button
            size="md"
            colorScheme={servo.connected ? 'red' : 'green'}
            onClick={handleConnect}
            isLoading={servo.connecting}
            minW="100px"
          >
            {servo.connected ? 'Disconnect' : 'Connect'}
          </Button>
        </HStack>

        <HStack justify="space-between" mb={3}>
          <HStack>
            <Badge colorScheme={servo.connected ? 'green' : 'gray'} fontSize="sm" px={2} py={1}>
              {servo.connected ? '● Connected' : '○ Disconnected'}
            </Badge>
            {servo.error && <Badge colorScheme="red">{servo.error}</Badge>}
          </HStack>

          {servo.connected && (
            <HStack>
              <Button
                size="sm"
                colorScheme="yellow"
                onClick={() => {
                  setStreaming(false);
                  servo.reset();
                }}
              >
                ⟲ Reset
              </Button>
              <Button
                size="sm"
                colorScheme={streaming ? 'orange' : 'blue'}
                onClick={() => setStreaming(s => !s)}
              >
                {streaming ? '⏸ Stop' : '▶ Stream'}
              </Button>
            </HStack>
          )}
        </HStack>

        {/* Emergency Stop Button - Always visible when connected */}
        {servo.connected && (
          <Box mb={3}>
            <Button
              size="lg"
              width="100%"
              height="60px"
              bg="red.600"
              color="white"
              fontWeight="bold"
              fontSize="lg"
              _hover={{ bg: 'red.500' }}
              _active={{ bg: 'red.700' }}
              animation={streaming ? `${pulseAnimation} 1.5s infinite` : undefined}
              onClick={handleEmergencyStop}
              borderRadius="lg"
              border="2px solid"
              borderColor="red.400"
            >
              🛑 EMERGENCY STOP
            </Button>
            <Text fontSize="xs" color="gray.500" textAlign="center" mt={1}>
              Returns robot to standing position and disconnects • Press <kbd style={{background: '#4a5568', padding: '0 4px', borderRadius: '3px'}}>Esc</kbd> while streaming
            </Text>
          </Box>
        )}

        {/* Pulse Limits removed for now — mapping always targets full 0..1000 */}

        {/* Quick Controls */}
        <HStack justify="center" spacing={2} flexWrap="wrap" mb={2}>
          <Button size="xs" onClick={enableAll}>Enable All</Button>
          <Button size="xs" onClick={disableAll}>Disable All</Button>
          <Button size="xs" colorScheme="blue" onClick={resetToDefault}>Shoulders Only</Button>
        </HStack>
        
        {/* Calibration Export/Import */}
        <HStack justify="center" spacing={2} flexWrap="wrap">
          <Button size="xs" colorScheme="teal" onClick={exportCalibration}>
            📤 Export Mapping
          </Button>
          <Button size="xs" colorScheme="purple" onClick={() => fileInputRef.current?.click()}>
            📥 Import Mapping
          </Button>
          <Button size="xs" variant="ghost" color="gray.400" onClick={resetAllCalibrations}>
            Reset All
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{display: 'none'}}
            onChange={importCalibration}
          />
        </HStack>

        {streaming && (
          <Text fontSize="sm" color="orange.300" mt={2} textAlign="center">
            ⚠️ {enabledCount} servos active • {Math.round(1000 / SEND_INTERVAL_MS)}Hz • Pulse 0-1000
          </Text>
        )}
      </Box>

      {/* Debug Comparison Panel */}
      {debugComparisonMode && isAnimationMode && (
        <Box bg="orange.900" borderRadius="lg" p={3} mb={4} border="1px solid" borderColor="orange.400">
          <HStack mb={2}>
            <Text fontSize="sm" fontWeight="bold" color="orange.200">🔬 Debug Comparison Active</Text>
            <Badge colorScheme="orange" fontSize="xs">
              {servo.connected ? 'Sending to Backend' : 'Not Connected'}
            </Badge>
          </HStack>
          
          {!mediapipeServosForComparison ? (
            <Text fontSize="xs" color="orange.300">
              ⚠️ Turn on camera to enable MediaPipe tracking for comparison
            </Text>
          ) : (
            <Box>
              <Text fontSize="xs" color="orange.200" mb={2}>
                Comparing FBX Animation vs MediaPipe Tracking (2Hz to backend)
              </Text>
              <Grid templateColumns="repeat(3, 1fr)" gap={1} fontSize="xs">
                <Text color="gray.400" fontWeight="bold">Servo</Text>
                <Text color="purple.300" fontWeight="bold">FBX</Text>
                <Text color="cyan.300" fontWeight="bold">MediaPipe</Text>
                {['6', '7', '8', '14', '15', '16'].map(id => {
                  const fbxVal = animationServoPositions?.[Number(id)] ?? '-';
                  const mpVal = mediapipeServosForComparison?.[id] ?? '-';
                  const diff = typeof fbxVal === 'number' && typeof mpVal === 'number' 
                    ? Math.abs(fbxVal - mpVal) 
                    : null;
                  return (
                    <React.Fragment key={id}>
                      <Text color="gray.400">{id} ({SERVO_CONFIG[id]?.name.slice(0, 8)})</Text>
                      <Text color="purple.200">{typeof fbxVal === 'number' ? Math.round(fbxVal) : fbxVal}</Text>
                      <Text color={diff && diff > 100 ? 'red.300' : 'cyan.200'}>
                        {typeof mpVal === 'number' ? Math.round(mpVal) : mpVal}
                        {diff !== null && <Text as="span" color={diff > 100 ? 'red.400' : 'gray.500'}> ({diff > 0 ? `±${diff}` : '0'})</Text>}
                      </Text>
                    </React.Fragment>
                  );
                })}
              </Grid>
            </Box>
          )}
        </Box>
      )}

      {/* Group Quick Toggle */}
      <HStack justify="center" spacing={3} my={3} flexWrap="wrap">
        <HStack>
          <Box w={3} h={3} bg="#3b82f6" borderRadius="full" />
          <Text fontSize="sm">L_ARM</Text>
          <Button size="xs" variant="ghost" onClick={() => enableGroup('left_arm')}>+</Button>
          <Button size="xs" variant="ghost" onClick={() => disableGroup('left_arm')}>-</Button>
        </HStack>
        <HStack>
          <Box w={3} h={3} bg="#ef4444" borderRadius="full" />
          <Text fontSize="sm">R_ARM</Text>
          <Button size="xs" variant="ghost" onClick={() => enableGroup('right_arm')}>+</Button>
          <Button size="xs" variant="ghost" onClick={() => disableGroup('right_arm')}>-</Button>
        </HStack>
        <HStack>
          <Box w={3} h={3} bg="#22c55e" borderRadius="full" />
          <Text fontSize="sm">L_LEG</Text>
          <Button size="xs" variant="ghost" onClick={() => enableGroup('left_leg')}>+</Button>
          <Button size="xs" variant="ghost" onClick={() => disableGroup('left_leg')}>-</Button>
        </HStack>
        <HStack>
          <Box w={3} h={3} bg="#f97316" borderRadius="full" />
          <Text fontSize="sm">R_LEG</Text>
          <Button size="xs" variant="ghost" onClick={() => enableGroup('right_leg')}>+</Button>
          <Button size="xs" variant="ghost" onClick={() => disableGroup('right_leg')}>-</Button>
        </HStack>
      </HStack>

      <Grid templateColumns="repeat(2, 1fr)" gap={3}>
        <GridItem>
          <Text fontSize="sm" fontWeight="bold" color="blue.300" mb={2}>Left Arm</Text>
          <VStack spacing={2} align="stretch">
            <ServoIndicator id="8" name="left_shoulder_rotate" rawAngle={rawAngles['8'] ?? 90} calibratedAngle={calibratedAngles['8']} group="left_arm" streaming={streaming} enabled={enabledServos.has('8')} onToggle={toggleServo} calibration={getCalibration('8')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="7" name="left_shoulder_side" rawAngle={rawAngles['7'] ?? 90} calibratedAngle={calibratedAngles['7']} group="left_arm" streaming={streaming} enabled={enabledServos.has('7')} onToggle={toggleServo} calibration={getCalibration('7')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="6" name="left_elbow_up" rawAngle={rawAngles['6'] ?? 90} calibratedAngle={calibratedAngles['6']} group="left_arm" streaming={streaming} enabled={enabledServos.has('6')} onToggle={toggleServo} calibration={getCalibration('6')} onCalibrationChange={updateCalibration} />
          </VStack>
        </GridItem>

        <GridItem>
          <Text fontSize="sm" fontWeight="bold" color="red.300" mb={2}>Right Arm</Text>
          <VStack spacing={2} align="stretch">
            <ServoIndicator id="16" name="right_shoulder_rotate" rawAngle={rawAngles['16'] ?? 90} calibratedAngle={calibratedAngles['16']} group="right_arm" streaming={streaming} enabled={enabledServos.has('16')} onToggle={toggleServo} calibration={getCalibration('16')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="15" name="right_shoulder_side" rawAngle={rawAngles['15'] ?? 90} calibratedAngle={calibratedAngles['15']} group="right_arm" streaming={streaming} enabled={enabledServos.has('15')} onToggle={toggleServo} calibration={getCalibration('15')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="14" name="right_elbow_up" rawAngle={rawAngles['14'] ?? 90} calibratedAngle={calibratedAngles['14']} group="right_arm" streaming={streaming} enabled={enabledServos.has('14')} onToggle={toggleServo} calibration={getCalibration('14')} onCalibrationChange={updateCalibration} />
          </VStack>
        </GridItem>

        <GridItem>
          <Text fontSize="sm" fontWeight="bold" color="green.300" mb={2}>Left Leg</Text>
          <VStack spacing={2} align="stretch">
            <ServoIndicator id="5" name="left_hip_side" rawAngle={rawAngles['5'] ?? 90} calibratedAngle={calibratedAngles['5']} group="left_leg" streaming={streaming} enabled={enabledServos.has('5')} onToggle={toggleServo} calibration={getCalibration('5')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="4" name="left_hip_up" rawAngle={rawAngles['4'] ?? 90} calibratedAngle={calibratedAngles['4']} group="left_leg" streaming={streaming} enabled={enabledServos.has('4')} onToggle={toggleServo} calibration={getCalibration('4')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="3" name="left_knee_up" rawAngle={rawAngles['3'] ?? 90} calibratedAngle={calibratedAngles['3']} group="left_leg" streaming={streaming} enabled={enabledServos.has('3')} onToggle={toggleServo} calibration={getCalibration('3')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="2" name="left_ankle_up" rawAngle={rawAngles['2'] ?? 90} calibratedAngle={calibratedAngles['2']} group="left_leg" streaming={streaming} enabled={enabledServos.has('2')} onToggle={toggleServo} calibration={getCalibration('2')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="1" name="left_ankle_side" rawAngle={rawAngles['1'] ?? 90} calibratedAngle={calibratedAngles['1']} group="left_leg" streaming={streaming} enabled={enabledServos.has('1')} onToggle={toggleServo} calibration={getCalibration('1')} onCalibrationChange={updateCalibration} />
          </VStack>
        </GridItem>

        <GridItem>
          <Text fontSize="sm" fontWeight="bold" color="orange.300" mb={2}>Right Leg</Text>
          <VStack spacing={2} align="stretch">
            <ServoIndicator id="13" name="right_hip_side" rawAngle={rawAngles['13'] ?? 90} calibratedAngle={calibratedAngles['13']} group="right_leg" streaming={streaming} enabled={enabledServos.has('13')} onToggle={toggleServo} calibration={getCalibration('13')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="12" name="right_hip_up" rawAngle={rawAngles['12'] ?? 90} calibratedAngle={calibratedAngles['12']} group="right_leg" streaming={streaming} enabled={enabledServos.has('12')} onToggle={toggleServo} calibration={getCalibration('12')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="11" name="right_knee_up" rawAngle={rawAngles['11'] ?? 90} calibratedAngle={calibratedAngles['11']} group="right_leg" streaming={streaming} enabled={enabledServos.has('11')} onToggle={toggleServo} calibration={getCalibration('11')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="10" name="right_ankle_up" rawAngle={rawAngles['10'] ?? 90} calibratedAngle={calibratedAngles['10']} group="right_leg" streaming={streaming} enabled={enabledServos.has('10')} onToggle={toggleServo} calibration={getCalibration('10')} onCalibrationChange={updateCalibration} />
            <ServoIndicator id="9" name="right_ankle_side" rawAngle={rawAngles['9'] ?? 90} calibratedAngle={calibratedAngles['9']} group="right_leg" streaming={streaming} enabled={enabledServos.has('9')} onToggle={toggleServo} calibration={getCalibration('9')} onCalibrationChange={updateCalibration} />
          </VStack>
        </GridItem>
      </Grid>
    </Box>
  );
}
