/**
 * TonyPi Servo Safety Utilities
 * 
 * Ported from TonyPi/Functions/pose_control.py
 * These functions ensure servo positions are within safe ranges
 * and prevent dangerous movements.
 */

// TonyPi safe servo pulse limits (from pose_control.py lines 119-138)
// TonyPi bus servos accept 0-1000, but safe range is 125-875
export const TONYPI_MIN_PULSE = 125;
export const TONYPI_MAX_PULSE = 875;
export const TONYPI_NEUTRAL_PULSE = 500;

// Arm segment lengths for forward kinematics (from pose_control.py lines 54-55)
const ARM_SEGMENT_L1 = 0.06;  // Upper arm
const ARM_SEGMENT_L2 = 0.11;  // Forearm

// Deadband threshold - ignore changes smaller than this (from pose_control.py lines 140-147)
const DEADBAND_THRESHOLD = 30;

/**
 * Map a value from one range to another (equivalent to Python val_map)
 * From pose_control.py line 38-39
 */
export function valMap(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

/**
 * Calculate 2D vector angle (equivalent to Python vector_2d_angle)
 * From pose_control.py lines 41-52
 */
export function vector2dAngle(v1: [number, number], v2: [number, number]): number | null {
  const magV1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
  const magV2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
  const dV1V2 = magV1 * magV2;

  if (dV1V2 === 0) return null;

  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const cross = v1[0] * v2[1] - v1[1] * v2[0];

  let cos = dot / dV1V2;
  let sin = cross / dV1V2;

  // Clamp to [-1, 1] to avoid Math.acos/asin domain errors
  cos = Math.max(-1, Math.min(1, cos));
  sin = Math.max(-1, Math.min(1, sin));

  return Math.round((Math.atan2(sin, cos) * 180) / Math.PI);
}

/**
 * Clamp a pulse value to TonyPi safe range
 * From pose_control.py lines 123-138
 */
export function clampPulse(pulse: number): number {
  if (pulse > TONYPI_MAX_PULSE) return TONYPI_MAX_PULSE;
  if (pulse < TONYPI_MIN_PULSE) return TONYPI_MIN_PULSE;
  return Math.round(pulse);
}

/**
 * Map angle (-90 to 90) to servo pulse (125 to 875)
 * From pose_control.py lines 119-122
 */
export function angleToPulse(angle: number): number {
  const pulse = valMap(angle, -90, 90, TONYPI_MIN_PULSE, TONYPI_MAX_PULSE);
  return clampPulse(pulse);
}

/**
 * Map degrees (0-180) to servo pulse with safety limits
 * This is for the UI which uses 0-180 degree range
 */
export function degreesToSafePulse(degrees: number): number {
  // Map 0-180 degrees to safe pulse range 125-875
  const pulse = valMap(degrees, 0, 180, TONYPI_MIN_PULSE, TONYPI_MAX_PULSE);
  return clampPulse(pulse);
}

/**
 * Apply deadband filter to prevent jittery movements
 * From pose_control.py lines 139-147
 * 
 * Returns the new value if change is significant, otherwise returns previous value
 */
export function applyDeadband(
  newValue: number,
  previousValue: number,
  threshold: number = DEADBAND_THRESHOLD
): number {
  if (Math.abs(newValue - previousValue) < threshold) {
    return previousValue;
  }
  return newValue;
}

/**
 * Check forward kinematics to ensure arm position is valid
 * From pose_control.py lines 116-117, 148-153
 * 
 * Returns true if the arm position is in front of the body (safe)
 * Returns false if the arm would be behind the body (unsafe)
 */
export function checkForwardKinematics(
  shoulderAngle: number,
  elbowAngle: number
): boolean {
  // Convert angles to radians
  const shoulderRad = (shoulderAngle * Math.PI) / 180;
  const elbowRad = (elbowAngle * Math.PI) / 180;

  // Calculate end effector X position using forward kinematics
  // x = L1 * cos(shoulder) + L2 * cos(elbow + shoulder)
  const x =
    ARM_SEGMENT_L1 * Math.cos(shoulderRad) +
    ARM_SEGMENT_L2 * Math.cos(elbowRad + shoulderRad);

  // Arm is safe if X is positive (in front of body)
  return x > 0;
}

/**
 * Arm safety state - tracks previous values for deadband and validates positions
 */
export interface ArmSafetyState {
  leftShoulder: number;
  leftElbow: number;
  rightShoulder: number;
  rightElbow: number;
}

/**
 * Create initial arm safety state with neutral values
 */
export function createArmSafetyState(): ArmSafetyState {
  return {
    leftShoulder: TONYPI_NEUTRAL_PULSE,
    leftElbow: TONYPI_NEUTRAL_PULSE,
    rightShoulder: TONYPI_NEUTRAL_PULSE,
    rightElbow: TONYPI_NEUTRAL_PULSE,
  };
}

/**
 * Process servo commands with all TonyPi safety constraints
 * Returns filtered servo values or null if unsafe
 */
export function processSafeServos(
  servos: Record<string, number>,
  previousState: ArmSafetyState
): { safe: Record<string, number>; newState: ArmSafetyState; blocked: string[] } {
  const safe: Record<string, number> = {};
  const blocked: string[] = [];
  const newState = { ...previousState };

  // Get arm angles for forward kinematics check
  // Servo 7 = left_shoulder_side, Servo 6 = left_elbow_up
  // Servo 15 = right_shoulder_side, Servo 14 = right_elbow_up
  const leftShoulderPulse = servos['7'] ?? previousState.leftShoulder;
  const leftElbowPulse = servos['6'] ?? previousState.leftElbow;
  const rightShoulderPulse = servos['15'] ?? previousState.rightShoulder;
  const rightElbowPulse = servos['14'] ?? previousState.rightElbow;

  // Convert pulses back to angles for kinematics check (-90 to 90)
  const leftShoulderAngle = valMap(leftShoulderPulse, TONYPI_MIN_PULSE, TONYPI_MAX_PULSE, -90, 90);
  const leftElbowAngle = valMap(leftElbowPulse, TONYPI_MIN_PULSE, TONYPI_MAX_PULSE, -90, 90);
  const rightShoulderAngle = valMap(rightShoulderPulse, TONYPI_MIN_PULSE, TONYPI_MAX_PULSE, -90, 90);
  const rightElbowAngle = valMap(rightElbowPulse, TONYPI_MIN_PULSE, TONYPI_MAX_PULSE, -90, 90);

  // Check forward kinematics for each arm
  const leftArmSafe = checkForwardKinematics(leftShoulderAngle, leftElbowAngle);
  const rightArmSafe = checkForwardKinematics(rightShoulderAngle, rightElbowAngle);

  // Process each servo
  for (const [id, rawPulse] of Object.entries(servos)) {
    // Clamp to safe range
    let pulse = clampPulse(rawPulse);

    // Apply deadband based on servo group
    if (id === '7') {
      pulse = applyDeadband(pulse, previousState.leftShoulder);
      newState.leftShoulder = pulse;
    } else if (id === '6') {
      pulse = applyDeadband(pulse, previousState.leftElbow);
      newState.leftElbow = pulse;
    } else if (id === '15') {
      pulse = applyDeadband(pulse, previousState.rightShoulder);
      newState.rightShoulder = pulse;
    } else if (id === '14') {
      pulse = applyDeadband(pulse, previousState.rightElbow);
      newState.rightElbow = pulse;
    }

    // Block arm servos if forward kinematics fails
    const isLeftArm = ['6', '7', '8'].includes(id);
    const isRightArm = ['14', '15', '16'].includes(id);

    if (isLeftArm && !leftArmSafe) {
      blocked.push(id);
      continue;
    }
    if (isRightArm && !rightArmSafe) {
      blocked.push(id);
      continue;
    }

    safe[id] = pulse;
  }

  return { safe, newState, blocked };
}

/**
 * Validate a single pulse value is within safe range
 */
export function isPulseSafe(pulse: number): boolean {
  return pulse >= TONYPI_MIN_PULSE && pulse <= TONYPI_MAX_PULSE;
}

/**
 * Get human-readable safety status
 */
export function getSafetyStatus(blocked: string[]): string {
  if (blocked.length === 0) return 'OK';
  return `Blocked: ${blocked.join(', ')} (arm behind body)`;
}
