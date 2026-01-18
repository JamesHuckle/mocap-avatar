/**
 * TonyPi Servo Calculations - TypeScript port of Python pose_mimic logic
 * 
 * This module calculates servo positions from MediaPipe pose landmarks,
 * matching the exact logic from scripts/tonypi_pose_mimic.py
 * 
 * TonyPi Servo Map (from action group analysis):
 * ==============================================
 * RIGHT SIDE:                    LEFT SIDE:
 *   Servo 1:  Right ankle          Servo 9:  Left ankle
 *   Servo 2:  Right knee           Servo 10: Left knee
 *   Servo 3:  Right hip (front)    Servo 11: Left hip (front)
 *   Servo 4:  Right hip (side)     Servo 12: Left hip (side)
 *   Servo 5:  Right shoulder (fwd) Servo 13: Left ??? 
 *   Servo 6:  Left elbow           Servo 14: Right elbow
 *   Servo 7:  Left shoulder (side) Servo 15: Right shoulder (side)
 *   Servo 8:  Left shoulder (fwd)  Servo 16: Right shoulder (fwd)
 * 
 * NOTE: Camera image is mirrored, so:
 *   - Camera "left" landmarks (11,13,15,23,25,27) → Robot RIGHT servos
 *   - Camera "right" landmarks (12,14,16,24,26,28) → Robot LEFT servos
 */

import { NormalizedLandmark } from '@mediapipe/tasks-vision';

// MediaPipe Pose Landmark indices
export const MP_LANDMARKS = {
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
} as const;

// Servo pulse range (safe operating limits)
export const SERVO_MIN = 125;
export const SERVO_MAX = 875;

// Smoothing threshold - ignore changes smaller than this to reduce jitter
const SMOOTHING_THRESHOLD = 25;

// Servo configuration with correct mappings (CORRECTED)
export const SERVO_CONFIG: Record<number, { name: string; group: string }> = {
  1: { name: 'right_ankle', group: 'right_leg' },
  2: { name: 'unused', group: 'right_leg' },
  3: { name: 'right_knee', group: 'right_leg' },
  4: { name: 'right_hip_front', group: 'right_leg' },
  5: { name: 'right_hip_side', group: 'right_leg' },
  6: { name: 'left_elbow', group: 'left_arm' },
  7: { name: 'left_shoulder_side', group: 'left_arm' },
  8: { name: 'left_shoulder_fwd', group: 'left_arm' },
  9: { name: 'left_ankle', group: 'left_leg' },
  10: { name: 'unused', group: 'left_leg' },
  11: { name: 'left_knee', group: 'left_leg' },
  12: { name: 'left_hip_front', group: 'left_leg' },
  13: { name: 'left_hip_side', group: 'left_leg' },
  14: { name: 'right_elbow', group: 'right_arm' },
  15: { name: 'right_shoulder_side', group: 'right_arm' },
  16: { name: 'right_shoulder_fwd', group: 'right_arm' },
};

export interface ServoCommand {
  servoId: number;
  position: number;
  name: string;
}

export type ServoPositions = Record<number, number>;

// ============================================================================
// Helper Functions (matching Python exactly)
// ============================================================================

/**
 * Map a value from one range to another (linear interpolation)
 */
function valMap(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

/**
 * Clamp servo value to safe operating range
 */
function clampServo(value: number, minVal = SERVO_MIN, maxVal = SERVO_MAX): number {
  return Math.max(minVal, Math.min(maxVal, value));
}

/**
 * Calculate angle between two 2D vectors in degrees (-180 to 180)
 * Uses atan2(cross, dot) to get signed angle
 * 
 * This matches the Python vector_2d_angle exactly:
 *   cos = dot(v1, v2) / (|v1| * |v2|)
 *   sin = cross(v1, v2) / (|v1| * |v2|)
 *   angle = atan2(sin, cos)
 */
function vector2dAngle(v1: [number, number], v2: [number, number]): number | null {
  const mag1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
  const mag2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
  const d = mag1 * mag2;
  
  if (d === 0) return null;
  
  // Dot product for cos
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const cos = Math.max(-1, Math.min(1, dot / d));
  
  // 2D cross product for sin (z-component of 3D cross)
  const cross = v1[0] * v2[1] - v1[1] * v2[0];
  const sin = Math.max(-1, Math.min(1, cross / d));
  
  // atan2 gives us the signed angle
  const angleRad = Math.atan2(sin, cos);
  return Math.round(angleRad * (180 / Math.PI));
}

/**
 * Convert normalized landmark to pixel coordinates
 * Note: In JS we work with normalized coords (0-1), so width/height are effectively 1.0
 * But we keep this for consistency with Python logic
 */
function getPoint(landmark: NormalizedLandmark, width: number, height: number): [number, number] {
  return [landmark.x * width, landmark.y * height];
}

// ============================================================================
// Servo Calculator Class
// ============================================================================

export class TonyPiServoCalculator {
  private lastServos: Record<number, number> = {};
  private fullBody: boolean;
  
  // IMPORTANT: Use same aspect ratio as Python (640x480) for consistent angle calculations
  // MediaPipe returns normalized coords (0-1), we scale to pixel-equivalent for matching Python logic
  private readonly width = 640;
  private readonly height = 480;
  
  constructor(fullBody = true) {
    this.fullBody = fullBody;
  }
  
  /**
   * Apply smoothing to reduce jitter
   */
  private smoothServo(servoId: number, newValue: number): number {
    if (servoId in this.lastServos) {
      if (Math.abs(this.lastServos[servoId] - newValue) < SMOOTHING_THRESHOLD) {
        return this.lastServos[servoId];
      }
    }
    this.lastServos[servoId] = newValue;
    return newValue;
  }
  
  /**
   * Calculate arm servo positions (shoulders side, elbows)
   */
  private calculateArmServos(landmarks: NormalizedLandmark[]): ServoCommand[] {
    const commands: ServoCommand[] = [];
    
    // Get arm landmarks (using normalized coords, width=height=1)
    const leftShoulder = getPoint(landmarks[MP_LANDMARKS.LEFT_SHOULDER], this.width, this.height);
    const rightShoulder = getPoint(landmarks[MP_LANDMARKS.RIGHT_SHOULDER], this.width, this.height);
    const leftElbow = getPoint(landmarks[MP_LANDMARKS.LEFT_ELBOW], this.width, this.height);
    const rightElbow = getPoint(landmarks[MP_LANDMARKS.RIGHT_ELBOW], this.width, this.height);
    const leftWrist = getPoint(landmarks[MP_LANDMARKS.LEFT_WRIST], this.width, this.height);
    const rightWrist = getPoint(landmarks[MP_LANDMARKS.RIGHT_WRIST], this.width, this.height);
    
    // Reference points for angle calculation (horizontal lines from shoulders)
    const leftRef: [number, number] = [this.width, leftShoulder[1]]; // Point to the right
    const rightRef: [number, number] = [0, rightShoulder[1]]; // Point to the left
    
    // Left arm angles (will map to ROBOT RIGHT due to mirror swap)
    const leftShoulderAngle = vector2dAngle(
      [leftShoulder[0] - leftRef[0], leftShoulder[1] - leftRef[1]],
      [leftShoulder[0] - leftElbow[0], leftShoulder[1] - leftElbow[1]]
    );
    const leftElbowAngle = vector2dAngle(
      [leftElbow[0] - leftShoulder[0], leftElbow[1] - leftShoulder[1]],
      [leftWrist[0] - leftElbow[0], leftWrist[1] - leftElbow[1]]
    );
    
    // Right arm angles (will map to ROBOT LEFT due to mirror swap)
    const rightShoulderAngle = vector2dAngle(
      [rightShoulder[0] - rightRef[0], rightShoulder[1] - rightRef[1]],
      [rightShoulder[0] - rightElbow[0], rightShoulder[1] - rightElbow[1]]
    );
    const rightElbowAngle = vector2dAngle(
      [rightElbow[0] - rightShoulder[0], rightElbow[1] - rightShoulder[1]],
      [rightWrist[0] - rightElbow[0], rightWrist[1] - rightElbow[1]]
    );
    
    if (leftShoulderAngle !== null && leftElbowAngle !== null &&
        rightShoulderAngle !== null && rightElbowAngle !== null) {
      
      // Camera LEFT → Robot LEFT, Camera RIGHT → Robot RIGHT
      
      // Servo 7: Left shoulder (side) ← from camera's LEFT shoulder
      let servo7 = clampServo(Math.round(valMap(leftShoulderAngle, -90, 90, SERVO_MIN, SERVO_MAX)));
      servo7 = this.smoothServo(7, servo7);
      commands.push({ servoId: 7, position: servo7, name: 'L_shoulder_side' });
      
      // Servo 6: Left elbow ← from camera's LEFT elbow
      let servo6 = clampServo(Math.round(valMap(leftElbowAngle, -90, 90, SERVO_MIN, SERVO_MAX)));
      servo6 = this.smoothServo(6, servo6);
      commands.push({ servoId: 6, position: servo6, name: 'L_elbow' });
      
      // Servo 15: Right shoulder (side) ← from camera's RIGHT shoulder
      let servo15 = clampServo(Math.round(valMap(rightShoulderAngle, -90, 90, SERVO_MIN, SERVO_MAX)));
      servo15 = this.smoothServo(15, servo15);
      commands.push({ servoId: 15, position: servo15, name: 'R_shoulder_side' });
      
      // Servo 14: Right elbow ← from camera's RIGHT elbow
      let servo14 = clampServo(Math.round(valMap(rightElbowAngle, -90, 90, SERVO_MIN, SERVO_MAX)));
      servo14 = this.smoothServo(14, servo14);
      commands.push({ servoId: 14, position: servo14, name: 'R_elbow' });
    }
    
    return commands;
  }
  
  /**
   * Calculate forward shoulder rotation (arms forward/backward)
   * IMPROVED: Uses angle of upper arm in YZ plane (forward/back angle)
   * Combined with Z-depth for better accuracy
   */
  private calculateShoulderForwardServos(landmarks: NormalizedLandmark[]): ServoCommand[] {
    const commands: ServoCommand[] = [];
    
    const leftShoulder = landmarks[MP_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[MP_LANDMARKS.RIGHT_SHOULDER];
    const leftElbow = landmarks[MP_LANDMARKS.LEFT_ELBOW];
    const rightElbow = landmarks[MP_LANDMARKS.RIGHT_ELBOW];
    const leftHip = landmarks[MP_LANDMARKS.LEFT_HIP];
    const rightHip = landmarks[MP_LANDMARKS.RIGHT_HIP];
    
    // Calculate angle of upper arm relative to torso in the forward/back plane
    // Using Y (vertical) and Z (depth) components
    
    // Left arm forward angle (will map to robot RIGHT due to mirror)
    // Vector from shoulder to elbow in YZ plane
    const leftArmY = leftElbow.y - leftShoulder.y;
    const leftArmZ = leftElbow.z - leftShoulder.z;
    // Torso reference (shoulder to hip) in YZ plane
    const leftTorsoY = leftHip.y - leftShoulder.y;
    const leftTorsoZ = leftHip.z - leftShoulder.z;
    
    // Calculate angle between arm and torso in YZ plane
    // Positive = arm forward, Negative = arm back
    const leftFwdAngle = Math.atan2(leftArmZ, leftArmY) - Math.atan2(leftTorsoZ, leftTorsoY);
    const leftFwdDegrees = leftFwdAngle * (180 / Math.PI);
    
    // Right arm forward angle (will map to robot LEFT due to mirror)
    const rightArmY = rightElbow.y - rightShoulder.y;
    const rightArmZ = rightElbow.z - rightShoulder.z;
    const rightTorsoY = rightHip.y - rightShoulder.y;
    const rightTorsoZ = rightHip.z - rightShoulder.z;
    
    const rightFwdAngle = Math.atan2(rightArmZ, rightArmY) - Math.atan2(rightTorsoZ, rightTorsoY);
    const rightFwdDegrees = rightFwdAngle * (180 / Math.PI);
    
    // Map angle range: -60° (arm back) to +60° (arm forward) → servo range
    // Servo 16: Right shoulder forward ← from camera's RIGHT
    let servo16 = clampServo(Math.round(valMap(rightFwdDegrees, -60, 60, 125, 875)));
    servo16 = this.smoothServo(16, servo16);
    commands.push({ servoId: 16, position: servo16, name: 'R_shoulder_fwd' });
    
    // Servo 8: Left shoulder forward ← from camera's LEFT
    let servo8 = clampServo(Math.round(valMap(leftFwdDegrees, -60, 60, 875, 125)));
    servo8 = this.smoothServo(8, servo8);
    commands.push({ servoId: 8, position: servo8, name: 'L_shoulder_fwd' });
    
    return commands;
  }
  
  /**
   * Calculate hip servo positions (side lean and front/back)
   */
  private calculateHipServos(landmarks: NormalizedLandmark[]): ServoCommand[] {
    const commands: ServoCommand[] = [];
    
    // Get hip and knee landmarks
    const leftHip = getPoint(landmarks[MP_LANDMARKS.LEFT_HIP], this.width, this.height);
    const rightHip = getPoint(landmarks[MP_LANDMARKS.RIGHT_HIP], this.width, this.height);
    const leftKnee = getPoint(landmarks[MP_LANDMARKS.LEFT_KNEE], this.width, this.height);
    const rightKnee = getPoint(landmarks[MP_LANDMARKS.RIGHT_KNEE], this.width, this.height);
    
    // Hip side angle (leaning left/right)
    // Reference: vertical line from hip (point below hip)
    const leftHipRef: [number, number] = [leftHip[0], leftHip[1] + 100]; // Same as Python
    const rightHipRef: [number, number] = [rightHip[0], rightHip[1] + 100];
    
    const leftHipSideAngle = vector2dAngle(
      [leftHip[0] - leftHipRef[0], leftHip[1] - leftHipRef[1]],
      [leftHip[0] - leftKnee[0], leftHip[1] - leftKnee[1]]
    );
    const rightHipSideAngle = vector2dAngle(
      [rightHip[0] - rightHipRef[0], rightHip[1] - rightHipRef[1]],
      [rightHip[0] - rightKnee[0], rightHip[1] - rightKnee[1]]
    );
    
    // Lower body: Camera LEFT → Robot RIGHT (mirrored)
    if (leftHipSideAngle !== null) {
      // Servo 5: Right hip side ← from camera's LEFT hip
      let servo5 = clampServo(Math.round(valMap(leftHipSideAngle, -45, 45, 450, 750)));
      servo5 = this.smoothServo(5, servo5);
      commands.push({ servoId: 5, position: servo5, name: 'R_hip_side' });
    }
    
    if (rightHipSideAngle !== null) {
      // Servo 13: Left hip side ← from camera's RIGHT hip
      let servo13 = clampServo(Math.round(valMap(rightHipSideAngle, -45, 45, 250, 550)));
      servo13 = this.smoothServo(13, servo13);
      commands.push({ servoId: 13, position: servo13, name: 'L_hip_side' });
    }
    
    // Hip front/back angle (using z-depth)
    const leftHipLm = landmarks[MP_LANDMARKS.LEFT_HIP];
    const rightHipLm = landmarks[MP_LANDMARKS.RIGHT_HIP];
    const leftKneeLm = landmarks[MP_LANDMARKS.LEFT_KNEE];
    const rightKneeLm = landmarks[MP_LANDMARKS.RIGHT_KNEE];
    
    const leftHipZ = leftHipLm.z - leftKneeLm.z;
    const rightHipZ = rightHipLm.z - rightKneeLm.z;
    
    // Lower body: Camera LEFT → Robot RIGHT (mirrored)
    // Servo 4: Right hip front ← from camera's LEFT hip
    let servo4 = clampServo(Math.round(valMap(leftHipZ, -0.2, 0.2, 700, 300)));
    servo4 = this.smoothServo(4, servo4);
    commands.push({ servoId: 4, position: servo4, name: 'R_hip_front' });
    
    // Servo 12: Left hip front ← from camera's RIGHT hip
    let servo12 = clampServo(Math.round(valMap(rightHipZ, -0.2, 0.2, 300, 700)));
    servo12 = this.smoothServo(12, servo12);
    commands.push({ servoId: 12, position: servo12, name: 'L_hip_front' });
    
    return commands;
  }
  
  /**
   * Calculate knee servo positions
   */
  private calculateKneeServos(landmarks: NormalizedLandmark[]): ServoCommand[] {
    const commands: ServoCommand[] = [];
    
    // Get leg landmarks
    const leftHip = getPoint(landmarks[MP_LANDMARKS.LEFT_HIP], this.width, this.height);
    const rightHip = getPoint(landmarks[MP_LANDMARKS.RIGHT_HIP], this.width, this.height);
    const leftKnee = getPoint(landmarks[MP_LANDMARKS.LEFT_KNEE], this.width, this.height);
    const rightKnee = getPoint(landmarks[MP_LANDMARKS.RIGHT_KNEE], this.width, this.height);
    const leftAnkle = getPoint(landmarks[MP_LANDMARKS.LEFT_ANKLE], this.width, this.height);
    const rightAnkle = getPoint(landmarks[MP_LANDMARKS.RIGHT_ANKLE], this.width, this.height);
    
    // Knee angle = angle at knee between hip-knee and ankle-knee vectors
    const leftKneeAngle = vector2dAngle(
      [leftHip[0] - leftKnee[0], leftHip[1] - leftKnee[1]],
      [leftAnkle[0] - leftKnee[0], leftAnkle[1] - leftKnee[1]]
    );
    const rightKneeAngle = vector2dAngle(
      [rightHip[0] - rightKnee[0], rightHip[1] - rightKnee[1]],
      [rightAnkle[0] - rightKnee[0], rightAnkle[1] - rightKnee[1]]
    );
    
    // Lower body: Camera LEFT → Robot RIGHT (mirrored)
    // Use absolute angle value since knee angle can be negative depending on direction
    if (leftKneeAngle !== null) {
      // Servo 3: Right knee ← from camera's LEFT knee
      const angleAbs = Math.abs(leftKneeAngle);
      let servo3 = clampServo(Math.round(valMap(angleAbs, 90, 180, 150, 390)));
      servo3 = this.smoothServo(3, servo3);
      commands.push({ servoId: 3, position: servo3, name: 'R_knee' });
    }
    
    if (rightKneeAngle !== null) {
      // Servo 11: Left knee ← from camera's RIGHT knee
      const angleAbs = Math.abs(rightKneeAngle);
      let servo11 = clampServo(Math.round(valMap(angleAbs, 90, 180, 850, 610)));
      servo11 = this.smoothServo(11, servo11);
      commands.push({ servoId: 11, position: servo11, name: 'L_knee' });
    }
    
    return commands;
  }
  
  /**
   * Calculate all servo commands from pose landmarks
   * 
   * @param landmarks - MediaPipe pose landmarks (33 points)
   * @returns Array of servo commands, or null if landmarks invalid
   */
  calculateServoCommands(landmarks: NormalizedLandmark[]): ServoCommand[] | null {
    if (!landmarks || landmarks.length < 33) {
      return null;
    }
    
    const commands: ServoCommand[] = [];
    
    // Always calculate arm servos
    commands.push(...this.calculateArmServos(landmarks));
    commands.push(...this.calculateShoulderForwardServos(landmarks));
    
    // Full body includes hips and knees
    if (this.fullBody) {
      commands.push(...this.calculateHipServos(landmarks));
      commands.push(...this.calculateKneeServos(landmarks));
    }
    
    return commands.length > 0 ? commands : null;
  }
  
  /**
   * Calculate servo positions as a simple record (servo ID → position)
   * This format is easier to send over WebSocket
   */
  calculateServoPositions(landmarks: NormalizedLandmark[]): ServoPositions | null {
    const commands = this.calculateServoCommands(landmarks);
    if (!commands) return null;
    
    const positions: ServoPositions = {};
    for (const cmd of commands) {
      positions[cmd.servoId] = cmd.position;
    }
    return positions;
  }
  
  /**
   * Toggle full body mode
   */
  setFullBody(enabled: boolean): void {
    this.fullBody = enabled;
  }
  
  /**
   * Reset smoothing state (call when starting fresh)
   */
  reset(): void {
    this.lastServos = {};
  }
}

// Export a singleton instance for convenience
export const servoCalculator = new TonyPiServoCalculator();

// Export helper functions for testing
export { valMap, clampServo, vector2dAngle };
