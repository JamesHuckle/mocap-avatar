import {Box, Text, VStack, HStack, Grid, GridItem} from '@chakra-ui/react';
import {NormalizedLandmark} from '@mediapipe/tasks-vision';

// TonyPi Servo Configuration
export const SERVO_CONFIG = {
  '1': {name: 'left_ankle_roll', group: 'left_leg'},
  '2': {name: 'left_ankle_pitch', group: 'left_leg'},
  '3': {name: 'left_knee_pitch', group: 'left_leg'},
  '4': {name: 'left_hip_pitch', group: 'left_leg'},
  '5': {name: 'left_hip_roll', group: 'left_leg'},
  '6': {name: 'left_elbow_pitch', group: 'left_arm'},
  '7': {name: 'left_shoulder_roll', group: 'left_arm'},
  '8': {name: 'left_shoulder_pitch', group: 'left_arm'},
  '9': {name: 'right_ankle_roll', group: 'right_leg'},
  '10': {name: 'right_ankle_pitch', group: 'right_leg'},
  '11': {name: 'right_elbow_pitch', group: 'right_arm'},
  '12': {name: 'right_hip_pitch', group: 'right_leg'},
  '13': {name: 'right_hip_roll', group: 'right_leg'},
  '14': {name: 'right_elbow_pitch2', group: 'right_arm'},
  '15': {name: 'right_shoulder_roll', group: 'right_arm'},
  '16': {name: 'right_shoulder_pitch', group: 'right_arm'},
  'PW1': {name: 'neck_twist', group: 'neck'},
  'PW2': {name: 'neck_pitch', group: 'neck'},
} as const;

// MediaPipe Pose Landmark indices
const MP = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

export interface ServoAngles {
  [key: string]: number;
}

type Vec3 = {x: number; y: number; z: number};

// Calculate angle at joint B given points A-B-C (returns 0-180°)
// 180° = straight line, 0° = fully folded back
function calcJointAngle(a: Vec3, b: Vec3, c: Vec3): number {
  const ba = {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z};
  const bc = {x: c.x - b.x, y: c.y - b.y, z: c.z - b.z};
  
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y + ba.z * ba.z);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y + bc.z * bc.z);
  
  if (magBA === 0 || magBC === 0) return 180;
  
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

// Calculate angle between two joints relative to torso vertical
// Returns angle where: 0° = limb pointing down along torso, 90° = horizontal, 180° = pointing up
function calcLimbAngle(shoulder: Vec3, elbow: Vec3, hip: Vec3): number {
  // Torso direction (shoulder to hip = "down")
  const torso = {x: hip.x - shoulder.x, y: hip.y - shoulder.y, z: hip.z - shoulder.z};
  // Limb direction (shoulder to elbow)
  const limb = {x: elbow.x - shoulder.x, y: elbow.y - shoulder.y, z: elbow.z - shoulder.z};
  
  const dot = torso.x * limb.x + torso.y * limb.y + torso.z * limb.z;
  const magTorso = Math.sqrt(torso.x * torso.x + torso.y * torso.y + torso.z * torso.z);
  const magLimb = Math.sqrt(limb.x * limb.x + limb.y * limb.y + limb.z * limb.z);
  
  if (magTorso === 0 || magLimb === 0) return 0;
  
  const cosAngle = Math.max(-1, Math.min(1, dot / (magTorso * magLimb)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

// Calculate roll (forward/backward rotation) based on Z depth difference
function calcRoll(upper: Vec3, lower: Vec3): number {
  const dz = lower.z - upper.z;
  const dx = Math.abs(lower.x - upper.x) + 0.001;
  return Math.atan2(dz, dx) * (180 / Math.PI);
}

// Map a joint angle to servo position
// jointAngle: the measured angle
// neutralJoint: what joint angle = 90° servo (neutral position)
// sensitivity: how much joint movement = how much servo movement (degrees joint per 90° servo)
function mapToServo(jointAngle: number, neutralJoint: number, sensitivity: number, invert = false): number {
  const delta = jointAngle - neutralJoint;
  let servo = 90 + (delta / sensitivity) * 90;
  servo = Math.max(0, Math.min(180, servo));
  if (invert) servo = 180 - servo;
  return Math.round(servo);
}

// Convert MediaPipe pose to TonyPi servo angles
export function calculateServoAngles(
  poseLandmarks: NormalizedLandmark[],
  worldLandmarks?: NormalizedLandmark[]
): ServoAngles {
  const angles: ServoAngles = {};
  const lm = worldLandmarks || poseLandmarks;
  
  if (!lm || lm.length < 33) return angles;

  // Get landmarks
  const nose = lm[MP.NOSE];
  const lShoulder = lm[MP.LEFT_SHOULDER];
  const rShoulder = lm[MP.RIGHT_SHOULDER];
  const lElbow = lm[MP.LEFT_ELBOW];
  const rElbow = lm[MP.RIGHT_ELBOW];
  const lWrist = lm[MP.LEFT_WRIST];
  const rWrist = lm[MP.RIGHT_WRIST];
  const lHip = lm[MP.LEFT_HIP];
  const rHip = lm[MP.RIGHT_HIP];
  const lKnee = lm[MP.LEFT_KNEE];
  const rKnee = lm[MP.RIGHT_KNEE];
  const lAnkle = lm[MP.LEFT_ANKLE];
  const rAnkle = lm[MP.RIGHT_ANKLE];
  const lFoot = lm[MP.LEFT_FOOT_INDEX];
  const rFoot = lm[MP.RIGHT_FOOT_INDEX];

  // Neck center
  const neck = {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2,
    z: (lShoulder.z + rShoulder.z) / 2,
  };

  // === NECK ===
  // PW1: neck_twist - left/right rotation
  const neckTwist = Math.atan2(nose.x - neck.x, Math.abs(nose.z - neck.z) + 0.01) * (180 / Math.PI);
  angles['PW1'] = mapToServo(neckTwist, 0, 45); // ±45° head turn = full servo range

  // PW2: neck_pitch - up/down tilt
  const neckPitch = Math.atan2(neck.y - nose.y, Math.abs(nose.z - neck.z) + 0.01) * (180 / Math.PI);
  angles['PW2'] = mapToServo(neckPitch, 45, 30); // Looking slightly down = neutral

  // === LEFT ARM ===
  // Servo 8: left_shoulder_pitch - arm angle from torso
  // 0° = arm along body, 90° = arm horizontal, 180° = arm up
  const lShoulderAngle = calcLimbAngle(lShoulder, lElbow, lHip);
  angles['8'] = mapToServo(lShoulderAngle, 0, 90); // Arm down = 90° servo
  
  // Servo 7: left_shoulder_roll - arm forward/backward
  const lShoulderRoll = calcRoll(lShoulder, lElbow);
  angles['7'] = mapToServo(lShoulderRoll, 0, 45);
  
  // Servo 6: left_elbow_pitch - elbow bend (180° = straight)
  const lElbowAngle = calcJointAngle(lShoulder, lElbow, lWrist);
  angles['6'] = mapToServo(lElbowAngle, 180, 90); // Straight arm = 90° servo

  // === RIGHT ARM ===
  // Servo 16: right_shoulder_pitch
  const rShoulderAngle = calcLimbAngle(rShoulder, rElbow, rHip);
  angles['16'] = mapToServo(rShoulderAngle, 0, 90, true); // Inverted for right side
  
  // Servo 15: right_shoulder_roll
  const rShoulderRoll = calcRoll(rShoulder, rElbow);
  angles['15'] = mapToServo(rShoulderRoll, 0, 45, true);
  
  // Servo 11: right_elbow_pitch
  const rElbowAngle = calcJointAngle(rShoulder, rElbow, rWrist);
  angles['11'] = mapToServo(rElbowAngle, 180, 90, true);

  // Servo 14: right_elbow_pitch2 - forearm twist
  const rForearmRoll = calcRoll(rElbow, rWrist);
  angles['14'] = mapToServo(rForearmRoll, 0, 45);

  // === LEFT LEG ===
  // Servo 4: left_hip_pitch - leg angle from torso (180° = straight down)
  const lHipAngle = calcLimbAngle(lHip, lKnee, lShoulder);
  angles['4'] = mapToServo(180 - lHipAngle, 0, 60); // Leg down = 90° servo
  
  // Servo 5: left_hip_roll
  const lHipRoll = calcRoll(lHip, lKnee);
  angles['5'] = mapToServo(lHipRoll, 0, 30);

  // Servo 3: left_knee_pitch (180° = straight leg)
  const lKneeAngle = calcJointAngle(lHip, lKnee, lAnkle);
  angles['3'] = mapToServo(lKneeAngle, 180, 90);

  // Servo 2: left_ankle_pitch
  const lAnkleAngle = calcJointAngle(lKnee, lAnkle, lFoot);
  angles['2'] = mapToServo(lAnkleAngle, 90, 45); // Foot perpendicular = neutral

  // Servo 1: left_ankle_roll
  const lAnkleRoll = calcRoll(lAnkle, lFoot);
  angles['1'] = mapToServo(lAnkleRoll, 0, 20);

  // === RIGHT LEG ===
  // Servo 12: right_hip_pitch
  const rHipAngle = calcLimbAngle(rHip, rKnee, rShoulder);
  angles['12'] = mapToServo(180 - rHipAngle, 0, 60, true);
  
  // Servo 13: right_hip_roll
  const rHipRoll = calcRoll(rHip, rKnee);
  angles['13'] = mapToServo(rHipRoll, 0, 30, true);

  // Servo 10: right_ankle_pitch
  const rAnkleAngle = calcJointAngle(rKnee, rAnkle, rFoot);
  angles['10'] = mapToServo(rAnkleAngle, 90, 45, true);

  // Servo 9: right_ankle_roll
  const rAnkleRoll = calcRoll(rAnkle, rFoot);
  angles['9'] = mapToServo(rAnkleRoll, 0, 20, true);

  return angles;
}

// Servo indicator component
function ServoIndicator({id, name, angle, group, info}: {
  id: string; 
  name: string; 
  angle: number; 
  group: string;
  info?: string;
}) {
  const groupColors: Record<string, string> = {
    left_arm: '#3b82f6',
    right_arm: '#ef4444',
    left_leg: '#22c55e',
    right_leg: '#f97316',
    neck: '#a855f7',
  };

  const color = groupColors[group] || '#6b7280';
  const displayAngle = isNaN(angle) ? 90 : Math.round(angle);

  return (
    <Box bg="gray.800" borderRadius="md" p={2} borderLeft="4px solid" borderLeftColor={color}>
      <HStack justify="space-between" mb={1}>
        <Text fontSize="xs" color="gray.400" fontWeight="bold">{id}</Text>
        <Text fontSize="lg" color="white" fontWeight="bold">{displayAngle}°</Text>
      </HStack>
      <Text fontSize="xs" color="gray.300" noOfLines={1}>{name.replace(/_/g, ' ')}</Text>
      {info && <Text fontSize="7px" color="gray.500">{info}</Text>}
      <Box mt={1} h="6px" bg="gray.700" borderRadius="full" overflow="hidden">
        <Box h="100%" w={`${(displayAngle / 180) * 100}%`} bg={color} transition="width 0.05s" />
      </Box>
    </Box>
  );
}

// Stick figure using MediaPipe positions
function StickFigure({landmarks}: {landmarks?: NormalizedLandmark[]}) {
  const W = 220, H = 280, M = 15;
  
  const toSVG = (lm: NormalizedLandmark | undefined, dx: number, dy: number) => {
    if (!lm) return {x: dx, y: dy};
    return {x: M + lm.x * (W - 2*M), y: M + lm.y * (H - 2*M)};
  };

  const pos = landmarks ? {
    nose: toSVG(landmarks[MP.NOSE], 110, 25),
    lShoulder: toSVG(landmarks[MP.LEFT_SHOULDER], 75, 60),
    rShoulder: toSVG(landmarks[MP.RIGHT_SHOULDER], 145, 60),
    lElbow: toSVG(landmarks[MP.LEFT_ELBOW], 55, 110),
    rElbow: toSVG(landmarks[MP.RIGHT_ELBOW], 165, 110),
    lWrist: toSVG(landmarks[MP.LEFT_WRIST], 45, 155),
    rWrist: toSVG(landmarks[MP.RIGHT_WRIST], 175, 155),
    lHip: toSVG(landmarks[MP.LEFT_HIP], 85, 145),
    rHip: toSVG(landmarks[MP.RIGHT_HIP], 135, 145),
    lKnee: toSVG(landmarks[MP.LEFT_KNEE], 80, 200),
    rKnee: toSVG(landmarks[MP.RIGHT_KNEE], 140, 200),
    lAnkle: toSVG(landmarks[MP.LEFT_ANKLE], 75, 255),
    rAnkle: toSVG(landmarks[MP.RIGHT_ANKLE], 145, 255),
  } : {
    nose: {x: 110, y: 25}, lShoulder: {x: 75, y: 60}, rShoulder: {x: 145, y: 60},
    lElbow: {x: 55, y: 110}, rElbow: {x: 165, y: 110}, lWrist: {x: 45, y: 155}, rWrist: {x: 175, y: 155},
    lHip: {x: 85, y: 145}, rHip: {x: 135, y: 145}, lKnee: {x: 80, y: 200}, rKnee: {x: 140, y: 200},
    lAnkle: {x: 75, y: 255}, rAnkle: {x: 145, y: 255},
  };

  const neck = {x: (pos.lShoulder.x + pos.rShoulder.x)/2, y: (pos.lShoulder.y + pos.rShoulder.y)/2};
  const hipC = {x: (pos.lHip.x + pos.rHip.x)/2, y: (pos.lHip.y + pos.rHip.y)/2};

  return (
    <Box w={`${W}px`} h={`${H}px`} mx="auto" bg="gray.800" borderRadius="lg">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <rect width={W} height={H} fill="#1a1a2e" />
        
        {/* Torso */}
        <line x1={neck.x} y1={neck.y} x2={hipC.x} y2={hipC.y} stroke="#4a5568" strokeWidth="4" />
        <line x1={pos.lShoulder.x} y1={pos.lShoulder.y} x2={pos.rShoulder.x} y2={pos.rShoulder.y} stroke="#4a5568" strokeWidth="4" />
        <line x1={pos.lHip.x} y1={pos.lHip.y} x2={pos.rHip.x} y2={pos.rHip.y} stroke="#4a5568" strokeWidth="4" />
        
        {/* Head */}
        <line x1={neck.x} y1={neck.y} x2={pos.nose.x} y2={pos.nose.y - 10} stroke="#a855f7" strokeWidth="3" />
        <circle cx={pos.nose.x} cy={pos.nose.y - 10} r="10" fill="none" stroke="#a855f7" strokeWidth="3" />
        
        {/* Left Arm */}
        <line x1={pos.lShoulder.x} y1={pos.lShoulder.y} x2={pos.lElbow.x} y2={pos.lElbow.y} stroke="#3b82f6" strokeWidth="4" />
        <line x1={pos.lElbow.x} y1={pos.lElbow.y} x2={pos.lWrist.x} y2={pos.lWrist.y} stroke="#3b82f6" strokeWidth="3" />
        <circle cx={pos.lShoulder.x} cy={pos.lShoulder.y} r="5" fill="#3b82f6" />
        <circle cx={pos.lElbow.x} cy={pos.lElbow.y} r="4" fill="#3b82f6" />
        <circle cx={pos.lWrist.x} cy={pos.lWrist.y} r="3" fill="#3b82f6" />
        
        {/* Right Arm */}
        <line x1={pos.rShoulder.x} y1={pos.rShoulder.y} x2={pos.rElbow.x} y2={pos.rElbow.y} stroke="#ef4444" strokeWidth="4" />
        <line x1={pos.rElbow.x} y1={pos.rElbow.y} x2={pos.rWrist.x} y2={pos.rWrist.y} stroke="#ef4444" strokeWidth="3" />
        <circle cx={pos.rShoulder.x} cy={pos.rShoulder.y} r="5" fill="#ef4444" />
        <circle cx={pos.rElbow.x} cy={pos.rElbow.y} r="4" fill="#ef4444" />
        <circle cx={pos.rWrist.x} cy={pos.rWrist.y} r="3" fill="#ef4444" />
        
        {/* Left Leg */}
        <line x1={pos.lHip.x} y1={pos.lHip.y} x2={pos.lKnee.x} y2={pos.lKnee.y} stroke="#22c55e" strokeWidth="4" />
        <line x1={pos.lKnee.x} y1={pos.lKnee.y} x2={pos.lAnkle.x} y2={pos.lAnkle.y} stroke="#22c55e" strokeWidth="3" />
        <circle cx={pos.lHip.x} cy={pos.lHip.y} r="5" fill="#22c55e" />
        <circle cx={pos.lKnee.x} cy={pos.lKnee.y} r="4" fill="#22c55e" />
        <circle cx={pos.lAnkle.x} cy={pos.lAnkle.y} r="3" fill="#22c55e" />
        
        {/* Right Leg */}
        <line x1={pos.rHip.x} y1={pos.rHip.y} x2={pos.rKnee.x} y2={pos.rKnee.y} stroke="#f97316" strokeWidth="4" />
        <line x1={pos.rKnee.x} y1={pos.rKnee.y} x2={pos.rAnkle.x} y2={pos.rAnkle.y} stroke="#f97316" strokeWidth="3" />
        <circle cx={pos.rHip.x} cy={pos.rHip.y} r="5" fill="#f97316" />
        <circle cx={pos.rKnee.x} cy={pos.rKnee.y} r="4" fill="#f97316" />
        <circle cx={pos.rAnkle.x} cy={pos.rAnkle.y} r="3" fill="#f97316" />
        
        <text x="5" y="12" fill="#6b7280" fontSize="8">POSE</text>
      </svg>
    </Box>
  );
}

// Main component
export default function ServoMapping({
  poseLandmarks,
  worldLandmarks,
}: {
  poseLandmarks?: NormalizedLandmark[];
  worldLandmarks?: NormalizedLandmark[];
}) {
  const angles = poseLandmarks ? calculateServoAngles(poseLandmarks, worldLandmarks) : {};

  return (
    <Box bg="gray.900" borderRadius="xl" p={3} color="white" maxH="100vh" overflowY="auto">
      <Text fontSize="md" fontWeight="bold" mb={2} textAlign="center">TonyPi Servos</Text>

      <StickFigure landmarks={poseLandmarks} />

      <HStack justify="center" spacing={2} my={2} flexWrap="wrap">
        <HStack><Box w={2} h={2} bg="#3b82f6" borderRadius="full" /><Text fontSize="xs">L_ARM</Text></HStack>
        <HStack><Box w={2} h={2} bg="#ef4444" borderRadius="full" /><Text fontSize="xs">R_ARM</Text></HStack>
        <HStack><Box w={2} h={2} bg="#22c55e" borderRadius="full" /><Text fontSize="xs">L_LEG</Text></HStack>
        <HStack><Box w={2} h={2} bg="#f97316" borderRadius="full" /><Text fontSize="xs">R_LEG</Text></HStack>
      </HStack>

      <Grid templateColumns="repeat(2, 1fr)" gap={2}>
        <GridItem colSpan={2}>
          <Text fontSize="xs" fontWeight="bold" color="purple.300" mb={1}>Neck</Text>
          <HStack spacing={2}>
            <ServoIndicator id="PW1" name="neck_twist" angle={angles['PW1'] ?? 90} group="neck" info="head L/R" />
            <ServoIndicator id="PW2" name="neck_pitch" angle={angles['PW2'] ?? 90} group="neck" info="head U/D" />
          </HStack>
        </GridItem>

        <GridItem>
          <Text fontSize="xs" fontWeight="bold" color="blue.300" mb={1}>Left Arm</Text>
          <VStack spacing={1} align="stretch">
            <ServoIndicator id="8" name="left_shoulder_pitch" angle={angles['8'] ?? 90} group="left_arm" info="arm↕ from body" />
            <ServoIndicator id="7" name="left_shoulder_roll" angle={angles['7'] ?? 90} group="left_arm" info="arm fwd/back" />
            <ServoIndicator id="6" name="left_elbow_pitch" angle={angles['6'] ?? 90} group="left_arm" info="elbow bend" />
          </VStack>
        </GridItem>

        <GridItem>
          <Text fontSize="xs" fontWeight="bold" color="red.300" mb={1}>Right Arm</Text>
          <VStack spacing={1} align="stretch">
            <ServoIndicator id="16" name="right_shoulder_pitch" angle={angles['16'] ?? 90} group="right_arm" info="arm↕ from body" />
            <ServoIndicator id="15" name="right_shoulder_roll" angle={angles['15'] ?? 90} group="right_arm" info="arm fwd/back" />
            <ServoIndicator id="11" name="right_elbow_pitch" angle={angles['11'] ?? 90} group="right_arm" info="elbow bend" />
            <ServoIndicator id="14" name="right_elbow_pitch2" angle={angles['14'] ?? 90} group="right_arm" info="forearm twist" />
          </VStack>
        </GridItem>

        <GridItem>
          <Text fontSize="xs" fontWeight="bold" color="green.300" mb={1}>Left Leg</Text>
          <VStack spacing={1} align="stretch">
            <ServoIndicator id="5" name="left_hip_roll" angle={angles['5'] ?? 90} group="left_leg" info="leg in/out" />
            <ServoIndicator id="4" name="left_hip_pitch" angle={angles['4'] ?? 90} group="left_leg" info="leg fwd/back" />
            <ServoIndicator id="3" name="left_knee_pitch" angle={angles['3'] ?? 90} group="left_leg" info="knee bend" />
            <ServoIndicator id="2" name="left_ankle_pitch" angle={angles['2'] ?? 90} group="left_leg" info="foot U/D" />
            <ServoIndicator id="1" name="left_ankle_roll" angle={angles['1'] ?? 90} group="left_leg" info="foot tilt" />
          </VStack>
        </GridItem>

        <GridItem>
          <Text fontSize="xs" fontWeight="bold" color="orange.300" mb={1}>Right Leg</Text>
          <VStack spacing={1} align="stretch">
            <ServoIndicator id="13" name="right_hip_roll" angle={angles['13'] ?? 90} group="right_leg" info="leg in/out" />
            <ServoIndicator id="12" name="right_hip_pitch" angle={angles['12'] ?? 90} group="right_leg" info="leg fwd/back" />
            <ServoIndicator id="10" name="right_ankle_pitch" angle={angles['10'] ?? 90} group="right_leg" info="foot U/D" />
            <ServoIndicator id="9" name="right_ankle_roll" angle={angles['9'] ?? 90} group="right_leg" info="foot tilt" />
          </VStack>
        </GridItem>
      </Grid>
    </Box>
  );
}
