/**
 * VRM Servo Calculations - Convert VRM bone positions to TonyPi servo positions
 * 
 * This module extracts bone world positions from a VRM model (during animation playback)
 * and calculates joint angles to map to TonyPi servo pulse values.
 * 
 * IMPORTANT: We use BONE POSITIONS, not Euler rotations!
 * This approach is more robust because:
 * 1. It's independent of rest pose
 * 2. It's independent of rotation order (no gimbal lock issues)
 * 3. It directly measures the physical angle at each joint
 * 4. It matches how TonyPi servos work (angle at joint = servo position)
 * 
 * This is the same approach used in tonypiServoCalculations.ts for MediaPipe.
 * 
 * TonyPi Servo Map:
 * =================
 * LEFT ARM:                      RIGHT ARM:
 *   Servo 7:  Left shoulder side   Servo 15: Right shoulder side
 *   Servo 8:  Left shoulder fwd    Servo 16: Right shoulder fwd
 *   Servo 6:  Left elbow           Servo 14: Right elbow
 * 
 * LEFT LEG:                      RIGHT LEG:
 *   Servo 13: Left hip side        Servo 5:  Right hip side
 *   Servo 12: Left hip front       Servo 4:  Right hip front
 *   Servo 11: Left knee            Servo 3:  Right knee
 *   Servo 9:  Left ankle           Servo 1:  Right ankle
 */

import * as THREE from 'three';
import {VRM, VRMHumanBoneName} from '@pixiv/three-vrm';

// Servo pulse range (safe operating limits)
export const SERVO_MIN = 125;
export const SERVO_MAX = 875;
export const SERVO_CENTER = 500;

// Type for servo positions
export type ServoPositions = Record<number, number>;

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
 * Convert radians to degrees
 */
function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

// Joint position type for debug comparison
export type JointPositions = Record<string, {x: number; y: number; z: number}>;

/**
 * Get bone world position
 */
function getBoneWorldPosition(vrm: VRM, boneName: VRMHumanBoneName): THREE.Vector3 | null {
  const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!bone) return null;
  
  const worldPos = new THREE.Vector3();
  bone.getWorldPosition(worldPos);
  return worldPos;
}

/**
 * Extract all relevant joint positions from a VRM model for debug comparison
 */
export function extractVRMJointPositions(vrm: VRM): JointPositions {
  const joints: JointPositions = {};
  
  const boneMap: Record<string, VRMHumanBoneName> = {
    leftShoulder: 'leftUpperArm',
    rightShoulder: 'rightUpperArm',
    leftElbow: 'leftLowerArm',
    rightElbow: 'rightLowerArm',
    leftWrist: 'leftHand',
    rightWrist: 'rightHand',
    leftHip: 'leftUpperLeg',
    rightHip: 'rightUpperLeg',
    leftKnee: 'leftLowerLeg',
    rightKnee: 'rightLowerLeg',
    leftAnkle: 'leftFoot',
    rightAnkle: 'rightFoot',
  };
  
  for (const [name, boneName] of Object.entries(boneMap)) {
    const pos = getBoneWorldPosition(vrm, boneName);
    if (pos) {
      joints[name] = {
        x: Number(pos.x.toFixed(4)),
        y: Number(pos.y.toFixed(4)),
        z: Number(pos.z.toFixed(4)),
      };
    }
  }
  
  return joints;
}

/**
 * Calculate angle between two 3D vectors in degrees (0 to 180)
 * Returns the unsigned angle between the vectors
 */
function angleBetweenVectors3D(v1: THREE.Vector3, v2: THREE.Vector3): number {
  const dot = v1.dot(v2);
  const mag1 = v1.length();
  const mag2 = v2.length();
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return radToDeg(Math.acos(cosAngle));
}

/**
 * Calculate signed angle between two 2D vectors (in a plane)
 * Used for shoulder side angle calculation
 * Returns angle in degrees (-180 to 180)
 */
function signedAngle2D(v1x: number, v1y: number, v2x: number, v2y: number): number {
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  // Normalize
  const n1x = v1x / mag1;
  const n1y = v1y / mag1;
  const n2x = v2x / mag2;
  const n2y = v2y / mag2;
  
  // Dot and cross
  const dot = n1x * n2x + n1y * n2y;
  const cross = n1x * n2y - n1y * n2x;
  
  return radToDeg(Math.atan2(cross, dot));
}

/**
 * Calculate joint angle at the middle point (like elbow or knee)
 * This measures the angle formed by three points: parent -> joint -> child
 * 
 * We measure the angle between:
 * - The incoming limb direction (parent → joint)
 * - The outgoing limb direction (joint → child)
 * 
 * When limbs are aligned (straight arm/leg): angle ≈ 0°
 * When bent 90°: angle = 90°
 * 
 * This matches the MediaPipe approach in tonypiServoCalculations.ts
 */
function calculateJointAngle(
  parentPos: THREE.Vector3,
  jointPos: THREE.Vector3,
  childPos: THREE.Vector3
): number {
  // Incoming limb direction: from parent toward joint (e.g., upper arm direction)
  const incoming = new THREE.Vector3().subVectors(jointPos, parentPos);
  // Outgoing limb direction: from joint toward child (e.g., forearm direction)
  const outgoing = new THREE.Vector3().subVectors(childPos, jointPos);
  
  // Angle between the limb directions
  // When straight: vectors aligned → angle ≈ 0°
  // When bent: angle increases
  const angle = angleBetweenVectors3D(incoming, outgoing);
  
  return angle;
}

/**
 * Calculate shoulder side angle (abduction/adduction)
 * This is the angle of the upper arm relative to a vertical line down from shoulder
 * Looking at the model from front: arm down = 0°, arm horizontal = 90°
 */
function calculateShoulderSideAngle(
  shoulderPos: THREE.Vector3,
  elbowPos: THREE.Vector3,
  isLeft: boolean
): number {
  // Vector from shoulder to elbow (upper arm direction)
  const armVec = new THREE.Vector3().subVectors(elbowPos, shoulderPos);
  
  // Reference: vertical down (negative Y in Three.js)
  const downVec = new THREE.Vector3(0, -1, 0);
  
  // We measure in the frontal plane (XY plane), ignoring depth (Z)
  // Using 2D angle in XY plane for side-to-side movement
  const armXY = new THREE.Vector2(armVec.x, armVec.y);
  const downXY = new THREE.Vector2(0, -1);
  
  // Calculate signed angle
  let angle = signedAngle2D(downXY.x, downXY.y, armXY.x, armXY.y);
  
  // For left arm: positive angle = arm moving away from body (left)
  // For right arm: positive angle = arm moving away from body (right)  
  // We want: arm down = 0°, arm horizontal = ±90°
  if (!isLeft) {
    angle = -angle; // Mirror for right side
  }
  
  return angle;
}

/**
 * Calculate shoulder forward angle (flexion/extension)
 * This is the angle of the upper arm forward/backward from the torso
 * Looking at model from side: arm at side = 0°, arm forward = positive, arm back = negative
 */
function calculateShoulderForwardAngle(
  shoulderPos: THREE.Vector3,
  elbowPos: THREE.Vector3,
  hipPos: THREE.Vector3
): number {
  // Vector from shoulder to elbow (upper arm direction)
  const armVec = new THREE.Vector3().subVectors(elbowPos, shoulderPos);
  
  // Torso reference: shoulder to hip (down and possibly forward)
  const torsoVec = new THREE.Vector3().subVectors(hipPos, shoulderPos);
  
  // We measure in the sagittal plane (YZ plane)
  // Z is depth: negative Z = forward (toward camera)
  
  // Calculate angle in YZ plane
  const armYZ = new THREE.Vector2(armVec.y, armVec.z);
  const torsoYZ = new THREE.Vector2(torsoVec.y, torsoVec.z);
  
  // Signed angle: positive = arm forward of torso, negative = arm behind
  const angle = signedAngle2D(torsoYZ.x, torsoYZ.y, armYZ.x, armYZ.y);
  
  return angle;
}

/**
 * Calculate hip side angle (abduction/adduction)
 * Angle of upper leg relative to vertical
 */
function calculateHipSideAngle(
  hipPos: THREE.Vector3,
  kneePos: THREE.Vector3,
  isLeft: boolean
): number {
  // Vector from hip to knee
  const legVec = new THREE.Vector3().subVectors(kneePos, hipPos);
  
  // In XY plane (frontal view)
  const angle = signedAngle2D(0, -1, legVec.x, legVec.y);
  
  if (!isLeft) {
    return -angle; // Mirror for right side
  }
  return angle;
}

/**
 * Calculate hip forward angle (flexion/extension)
 * Angle of upper leg forward/backward
 */
function calculateHipForwardAngle(
  hipPos: THREE.Vector3,
  kneePos: THREE.Vector3
): number {
  // Vector from hip to knee
  const legVec = new THREE.Vector3().subVectors(kneePos, hipPos);
  
  // In YZ plane (side view)
  // Down is negative Y, forward is negative Z
  const angle = signedAngle2D(0, -1, legVec.z, legVec.y);
  
  return -angle; // Positive = leg forward
}

/**
 * Calculate TonyPi servo positions from current VRM bone positions
 * 
 * @param vrm - The VRM model with current bone positions (from animation playback)
 * @returns ServoPositions - Record of servo ID to pulse value (125-875)
 */
export function calculateServosFromVRM(vrm: VRM): ServoPositions {
  const positions: ServoPositions = {};
  
  // Initialize all servos to center
  for (let i = 1; i <= 16; i++) {
    positions[i] = SERVO_CENTER;
  }
  
  // Get all bone world positions
  const leftShoulder = getBoneWorldPosition(vrm, 'leftUpperArm');
  const leftElbow = getBoneWorldPosition(vrm, 'leftLowerArm');
  const leftWrist = getBoneWorldPosition(vrm, 'leftHand');
  const rightShoulder = getBoneWorldPosition(vrm, 'rightUpperArm');
  const rightElbow = getBoneWorldPosition(vrm, 'rightLowerArm');
  const rightWrist = getBoneWorldPosition(vrm, 'rightHand');
  const leftHip = getBoneWorldPosition(vrm, 'leftUpperLeg');
  const leftKnee = getBoneWorldPosition(vrm, 'leftLowerLeg');
  const leftAnkle = getBoneWorldPosition(vrm, 'leftFoot');
  const rightHip = getBoneWorldPosition(vrm, 'rightUpperLeg');
  const rightKnee = getBoneWorldPosition(vrm, 'rightLowerLeg');
  const rightAnkle = getBoneWorldPosition(vrm, 'rightFoot');
  
  // ========== ARM SERVOS ==========
  // Matching the MediaPipe servo mappings from tonypiServoCalculations.ts
  // MediaPipe uses signed angles with range -90 to +90, neutral at 0
  // Position-based calculation gives unsigned angles: 0 = straight, increasing = more bent
  
  if (leftShoulder && leftElbow && leftWrist && leftHip) {
    // Left shoulder side (Servo 7)
    // MediaPipe maps: -90 to +90 → SERVO_MIN to SERVO_MAX
    // Arm down ≈ 0°, arm horizontal = ~90°
    const leftShoulderSide = calculateShoulderSideAngle(leftShoulder, leftElbow, true);
    // Match MediaPipe: -90 to 90 → 125 to 875
    positions[7] = clampServo(Math.round(valMap(leftShoulderSide, -90, 90, SERVO_MIN, SERVO_MAX)));
    
    // Left shoulder forward (Servo 8)
    // MediaPipe maps: -60 to +60 → 875 to 125 (inverted for left)
    const leftShoulderFwd = calculateShoulderForwardAngle(leftShoulder, leftElbow, leftHip);
    positions[8] = clampServo(Math.round(valMap(leftShoulderFwd, -60, 60, 875, 125)));
    
    // Left elbow (Servo 6)
    // MediaPipe uses angle between limb vectors: -90 to +90 → 125 to 875
    // Our position-based angle: 0 = straight, ~90-120 = bent
    // When straight (0°), we want servo near center (500)
    // When bent (90°), servo moves toward max or min
    const leftElbowAngle = calculateJointAngle(leftShoulder, leftElbow, leftWrist);
    // Map: 0° (straight) → 500, 90° (bent) → 875
    positions[6] = clampServo(Math.round(valMap(leftElbowAngle, -90, 90, SERVO_MIN, SERVO_MAX)));
  }
  
  if (rightShoulder && rightElbow && rightWrist && rightHip) {
    // Right shoulder side (Servo 15)
    const rightShoulderSide = calculateShoulderSideAngle(rightShoulder, rightElbow, false);
    // Match MediaPipe: -90 to 90 → 125 to 875 (same as left)
    positions[15] = clampServo(Math.round(valMap(rightShoulderSide, -90, 90, SERVO_MIN, SERVO_MAX)));
    
    // Right shoulder forward (Servo 16)
    // MediaPipe maps: -60 to +60 → 125 to 875 (opposite of left)
    const rightShoulderFwd = calculateShoulderForwardAngle(rightShoulder, rightElbow, rightHip);
    positions[16] = clampServo(Math.round(valMap(rightShoulderFwd, -60, 60, 125, 875)));
    
    // Right elbow (Servo 14)
    const rightElbowAngle = calculateJointAngle(rightShoulder, rightElbow, rightWrist);
    // Same mapping as left: 0° → 500, 90° → 875
    positions[14] = clampServo(Math.round(valMap(rightElbowAngle, -90, 90, SERVO_MIN, SERVO_MAX)));
  }
  
  // ========== LEG SERVOS ==========
  // Matching MediaPipe mappings from tonypiServoCalculations.ts
  
  if (leftHip && leftKnee && leftAnkle) {
    // Left hip side (Servo 13)
    // MediaPipe maps: -45 to 45 → 250 to 550
    const leftHipSide = calculateHipSideAngle(leftHip, leftKnee, true);
    positions[13] = clampServo(Math.round(valMap(leftHipSide, -45, 45, 250, 550)));
    
    // Left hip front (Servo 12)
    // MediaPipe uses z-depth: -0.2 to 0.2 → 300 to 700
    const leftHipFwd = calculateHipForwardAngle(leftHip, leftKnee);
    positions[12] = clampServo(Math.round(valMap(leftHipFwd, -45, 90, 300, 700)));
    
    // Left knee (Servo 11)
    // MediaPipe: uses angle 90-180, maps to 850-610 (straight=610, bent=850)
    // Our angle: 0° = straight (limbs aligned), increasing = more bent
    // We need to map: 0° (straight) → 610, 90° (bent) → 850
    const leftKneeAngle = calculateJointAngle(leftHip, leftKnee, leftAnkle);
    positions[11] = clampServo(Math.round(valMap(leftKneeAngle, 0, 90, 610, 850)));
  }
  
  if (rightHip && rightKnee && rightAnkle) {
    // Right hip side (Servo 5)
    // MediaPipe maps: -45 to 45 → 450 to 750
    const rightHipSide = calculateHipSideAngle(rightHip, rightKnee, false);
    positions[5] = clampServo(Math.round(valMap(rightHipSide, -45, 45, 450, 750)));
    
    // Right hip front (Servo 4)
    // MediaPipe uses z-depth: -0.2 to 0.2 → 700 to 300
    const rightHipFwd = calculateHipForwardAngle(rightHip, rightKnee);
    positions[4] = clampServo(Math.round(valMap(rightHipFwd, -45, 90, 700, 300)));
    
    // Right knee (Servo 3)
    // MediaPipe: uses angle 90-180, maps to 150-390 (straight=390, bent=150)
    // We need to map: 0° (straight) → 390, 90° (bent) → 150
    const rightKneeAngle = calculateJointAngle(rightHip, rightKnee, rightAnkle);
    positions[3] = clampServo(Math.round(valMap(rightKneeAngle, 0, 90, 390, 150)));
  }
  
  return positions;
}

/**
 * VRM Servo Calculator class - for use with animation playback
 * Provides state management and callbacks
 */
export class VRMServoCalculator {
  private vrm: VRM;
  private lastPositions: ServoPositions = {};
  private onUpdateCallback: ((positions: ServoPositions) => void) | null = null;
  
  constructor(vrm: VRM) {
    this.vrm = vrm;
  }
  
  /**
   * Set callback for position updates
   */
  onUpdate(callback: (positions: ServoPositions) => void): void {
    this.onUpdateCallback = callback;
  }
  
  /**
   * Calculate current servo positions and trigger callback if changed
   */
  update(): ServoPositions {
    const positions = calculateServosFromVRM(this.vrm);
    
    // Check if positions changed (simple comparison)
    const changed = Object.keys(positions).some(
      key => positions[Number(key)] !== this.lastPositions[Number(key)]
    );
    
    if (changed && this.onUpdateCallback) {
      this.onUpdateCallback(positions);
    }
    
    this.lastPositions = {...positions};
    return positions;
  }
  
  /**
   * Get current positions without triggering callback
   */
  getCurrentPositions(): ServoPositions {
    return calculateServosFromVRM(this.vrm);
  }
  
  /**
   * Update the VRM reference (if model changes)
   */
  setVRM(vrm: VRM): void {
    this.vrm = vrm;
  }
}

// Debug flag - set to true to enable console logging
let DEBUG_VRM_SERVOS = false;
let debugFrameCounter = 0;

/**
 * Enable/disable debug logging
 */
export function setVRMServoDebug(enabled: boolean): void {
  DEBUG_VRM_SERVOS = enabled;
  debugFrameCounter = 0;
}

/**
 * Debug helper - log bone positions and calculated angles for a VRM
 */
export function debugVRMServos(vrm: VRM): void {
  const leftShoulder = getBoneWorldPosition(vrm, 'leftUpperArm');
  const leftElbow = getBoneWorldPosition(vrm, 'leftLowerArm');
  const leftWrist = getBoneWorldPosition(vrm, 'leftHand');
  const rightShoulder = getBoneWorldPosition(vrm, 'rightUpperArm');
  const rightElbow = getBoneWorldPosition(vrm, 'rightLowerArm');
  const rightWrist = getBoneWorldPosition(vrm, 'rightHand');
  
  console.log('=== VRM Bone Debug ===');
  
  if (leftShoulder && leftElbow && leftWrist) {
    const elbowAngle = calculateJointAngle(leftShoulder, leftElbow, leftWrist);
    const shoulderSide = calculateShoulderSideAngle(leftShoulder, leftElbow, true);
    console.log(`Left arm: elbow=${elbowAngle.toFixed(1)}°, shoulder side=${shoulderSide.toFixed(1)}°`);
    console.log(`  Positions: shoulder=(${leftShoulder.x.toFixed(3)}, ${leftShoulder.y.toFixed(3)}, ${leftShoulder.z.toFixed(3)})`);
    console.log(`             elbow=(${leftElbow.x.toFixed(3)}, ${leftElbow.y.toFixed(3)}, ${leftElbow.z.toFixed(3)})`);
    console.log(`             wrist=(${leftWrist.x.toFixed(3)}, ${leftWrist.y.toFixed(3)}, ${leftWrist.z.toFixed(3)})`);
  }
  
  if (rightShoulder && rightElbow && rightWrist) {
    const elbowAngle = calculateJointAngle(rightShoulder, rightElbow, rightWrist);
    const shoulderSide = calculateShoulderSideAngle(rightShoulder, rightElbow, false);
    console.log(`Right arm: elbow=${elbowAngle.toFixed(1)}°, shoulder side=${shoulderSide.toFixed(1)}°`);
    console.log(`  Positions: shoulder=(${rightShoulder.x.toFixed(3)}, ${rightShoulder.y.toFixed(3)}, ${rightShoulder.z.toFixed(3)})`);
    console.log(`             elbow=(${rightElbow.x.toFixed(3)}, ${rightElbow.y.toFixed(3)}, ${rightElbow.z.toFixed(3)})`);
    console.log(`             wrist=(${rightWrist.x.toFixed(3)}, ${rightWrist.y.toFixed(3)}, ${rightWrist.z.toFixed(3)})`);
  }
  
  const positions = calculateServosFromVRM(vrm);
  console.log('Servo positions:', positions);
}

/**
 * Log debug info during animation (call this in the animation loop)
 * Only logs every N frames to avoid spam
 */
export function debugAnimationFrame(vrm: VRM, logEveryNFrames = 30): void {
  if (!DEBUG_VRM_SERVOS) return;
  
  debugFrameCounter++;
  if (debugFrameCounter % logEveryNFrames !== 0) return;
  
  const leftShoulder = getBoneWorldPosition(vrm, 'leftUpperArm');
  const leftElbow = getBoneWorldPosition(vrm, 'leftLowerArm');
  const leftWrist = getBoneWorldPosition(vrm, 'leftHand');
  const rightShoulder = getBoneWorldPosition(vrm, 'rightUpperArm');
  const rightElbow = getBoneWorldPosition(vrm, 'rightLowerArm');
  const rightWrist = getBoneWorldPosition(vrm, 'rightHand');
  
  const positions = calculateServosFromVRM(vrm);
  
  let leftElbowAngle = 0;
  let rightElbowAngle = 0;
  
  if (leftShoulder && leftElbow && leftWrist) {
    leftElbowAngle = calculateJointAngle(leftShoulder, leftElbow, leftWrist);
  }
  if (rightShoulder && rightElbow && rightWrist) {
    rightElbowAngle = calculateJointAngle(rightShoulder, rightElbow, rightWrist);
  }
  
  console.log(`[Frame ${debugFrameCounter}] L-elbow: ${leftElbowAngle.toFixed(1)}° → servo ${positions[6]}, R-elbow: ${rightElbowAngle.toFixed(1)}° → servo ${positions[14]}`);
}
