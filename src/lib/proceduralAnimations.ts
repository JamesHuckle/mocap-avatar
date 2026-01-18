import * as THREE from 'three';
import {VRM, VRMHumanBoneName} from '@pixiv/three-vrm';

// Keyframe for bone animation
export interface BoneKeyframe {
  time: number;
  // For backwards compatibility, animations can specify either:
  // - rotation (Euler): treated as a delta rotation from the VRM rest pose
  // - quaternion (Quaternion): treated as a delta rotation from the VRM rest pose
  rotation?: THREE.Euler;
  quaternion?: THREE.Quaternion;
}

// Animation definition
export interface ProceduralAnimation {
  name: string;
  duration: number;
  bones: Record<string, BoneKeyframe[]>;
}

// Animation player class that directly manipulates VRM bones
export class VRMAnimationPlayer {
  private vrm: VRM;
  private animation: ProceduralAnimation | null = null;
  private isPlaying = false;
  private currentTime = 0;
  private speed = 1.0;
  private loop = true;
  private onUpdate: ((time: number, duration: number) => void) | null = null;
  private animationFrameId: number | null = null;
  private lastTimestamp = 0;
  private restPose: Record<string, THREE.Quaternion> = {};

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.captureDefaultRestPose();
  }

  private captureDefaultRestPose() {
    const boneNames: VRMHumanBoneName[] = [
      'hips',
      'spine',
      'chest',
      'upperChest',
      'neck',
      'head',
      'leftShoulder',
      'leftUpperArm',
      'leftLowerArm',
      'leftHand',
      'rightShoulder',
      'rightUpperArm',
      'rightLowerArm',
      'rightHand',
      'leftUpperLeg',
      'leftLowerLeg',
      'leftFoot',
      'leftToes',
      'rightUpperLeg',
      'rightLowerLeg',
      'rightFoot',
      'rightToes',
    ];

    boneNames.forEach((boneName) => {
      const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
      if (!bone) return;
      this.restPose[boneName] = bone.quaternion.clone();
    });
  }

  loadAnimation(animation: ProceduralAnimation) {
    this.animation = animation;
    this.currentTime = 0;
    console.log('Loaded animation:', animation.name, 'duration:', animation.duration);

    // Ensure we have rest pose captured for any bones referenced by the animation
    Object.keys(animation.bones).forEach((boneName) => {
      if (this.restPose[boneName]) return;
      const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
      if (!bone) return;
      this.restPose[boneName] = bone.quaternion.clone();
    });
  }

  play() {
    if (!this.animation) return;
    this.isPlaying = true;
    this.lastTimestamp = performance.now();
    this.tick();
  }

  pause() {
    this.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  stop() {
    this.pause();
    this.currentTime = 0;
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  setLoop(loop: boolean) {
    this.loop = loop;
  }

  setOnUpdate(callback: (time: number, duration: number) => void) {
    this.onUpdate = callback;
  }

  getIsPlaying() {
    return this.isPlaying;
  }

  getDuration() {
    return this.animation?.duration ?? 0;
  }

  private tick = () => {
    if (!this.isPlaying || !this.animation) return;

    const now = performance.now();
    const delta = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    this.currentTime += delta * this.speed;

    // Handle looping
    if (this.currentTime >= this.animation.duration) {
      if (this.loop) {
        this.currentTime = this.currentTime % this.animation.duration;
      } else {
        this.currentTime = this.animation.duration;
        this.isPlaying = false;
      }
    }

    // Apply bone rotations
    this.applyFrame(this.currentTime);

    // Update callback
    if (this.onUpdate) {
      this.onUpdate(this.currentTime, this.animation.duration);
    }

    if (this.isPlaying) {
      this.animationFrameId = requestAnimationFrame(this.tick);
    }
  };

  private applyFrame(time: number) {
    if (!this.animation) return;

    Object.entries(this.animation.bones).forEach(([boneName, keyframes]) => {
      const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
      if (!bone) return;
      if (!this.restPose[boneName]) {
        this.restPose[boneName] = bone.quaternion.clone();
      }
      const restQ = this.restPose[boneName];

      // Find the two keyframes to interpolate between
      let prevKf = keyframes[0];
      let nextKf = keyframes[keyframes.length - 1];

      for (let i = 0; i < keyframes.length - 1; i++) {
        if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
          prevKf = keyframes[i];
          nextKf = keyframes[i + 1];
          break;
        }
      }

      // Calculate interpolation factor
      const duration = nextKf.time - prevKf.time;
      const t = duration > 0 ? (time - prevKf.time) / duration : 0;

      // Interpolate quaternions
      const q1 =
        prevKf.quaternion?.clone() ??
        new THREE.Quaternion().setFromEuler(prevKf.rotation ?? new THREE.Euler());
      const q2 =
        nextKf.quaternion?.clone() ??
        new THREE.Quaternion().setFromEuler(nextKf.rotation ?? new THREE.Euler());

      // Ensure shortest-path interpolation
      if (q1.dot(q2) < 0) {
        q2.set(-q2.x, -q2.y, -q2.z, -q2.w);
      }

      const delta = new THREE.Quaternion().slerpQuaternions(q1, q2, t);

      // Apply to bone
      bone.quaternion.copy(restQ).multiply(delta);
    });
  }

  dispose() {
    this.stop();
  }
}

// Create a Three.js AnimationClip from a procedural animation definition (kept for compatibility)
export function createProceduralClip(
  animation: ProceduralAnimation,
  vrm: VRM
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  Object.entries(animation.bones).forEach(([boneName, keyframes]) => {
    const vrmBone = vrm.humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
    if (!vrmBone) return;

    const times: number[] = [];
    const values: number[] = [];

    keyframes.forEach((kf) => {
      times.push(kf.time);
      const q =
        kf.quaternion?.clone() ??
        new THREE.Quaternion().setFromEuler(kf.rotation ?? new THREE.Euler());
      values.push(q.x, q.y, q.z, q.w);
    });

    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${vrmBone.name}.quaternion`,
        times,
        values
      )
    );
  });

  return new THREE.AnimationClip(animation.name, animation.duration, tracks);
}

// Helper to create rotation keyframe
function kf(time: number, x: number, y: number, z: number): BoneKeyframe {
  return {
    time,
    rotation: new THREE.Euler(
      THREE.MathUtils.degToRad(x),
      THREE.MathUtils.degToRad(y),
      THREE.MathUtils.degToRad(z)
    ),
  };
}

// ===== PREDEFINED ANIMATIONS =====

// Wave Animation - arm raised up like greeting someone
export const WAVE_ANIMATION: ProceduralAnimation = {
  name: 'Wave',
  duration: 2,
  bones: {
    // Raise right arm up (X=-150 lifts arm up, Z=-30 keeps it slightly outward)
    rightUpperArm: [
      kf(0, -150, 0, -30),
      kf(2, -150, 0, -30),
    ],
    // Bend elbow so forearm points up
    rightLowerArm: [
      kf(0, -45, 0, 0),
      kf(2, -45, 0, 0),
    ],
    // Wave the hand back and forth
    rightHand: [
      kf(0, 0, 0, 0),
      kf(0.15, 0, 0, 30),
      kf(0.3, 0, 0, -30),
      kf(0.45, 0, 0, 30),
      kf(0.6, 0, 0, -30),
      kf(0.75, 0, 0, 30),
      kf(0.9, 0, 0, -30),
      kf(1.05, 0, 0, 30),
      kf(1.2, 0, 0, -30),
      kf(1.35, 0, 0, 30),
      kf(1.5, 0, 0, -30),
      kf(1.65, 0, 0, 30),
      kf(1.8, 0, 0, -30),
      kf(2, 0, 0, 0),
    ],
  },
};

// Hip Hop Bounce
export const HIPHOP_ANIMATION: ProceduralAnimation = {
  name: 'Hip Hop',
  duration: 2,
  bones: {
    hips: [
      kf(0, 0, 0, 0),
      kf(0.25, -5, 5, 0),
      kf(0.5, 0, 0, 0),
      kf(0.75, -5, -5, 0),
      kf(1, 0, 0, 0),
      kf(1.25, -5, 5, 0),
      kf(1.5, 0, 0, 0),
      kf(1.75, -5, -5, 0),
      kf(2, 0, 0, 0),
    ],
    spine: [
      kf(0, 0, 0, 0),
      kf(0.25, 5, -5, 0),
      kf(0.5, 0, 0, 0),
      kf(0.75, 5, 5, 0),
      kf(1, 0, 0, 0),
      kf(1.25, 5, -5, 0),
      kf(1.5, 0, 0, 0),
      kf(1.75, 5, 5, 0),
      kf(2, 0, 0, 0),
    ],
    leftUpperArm: [
      kf(0, 0, 0, 60),
      kf(0.25, 0, 0, 45),
      kf(0.5, 0, 0, 60),
      kf(0.75, 0, 0, 45),
      kf(1, 0, 0, 60),
      kf(1.25, 0, 0, 45),
      kf(1.5, 0, 0, 60),
      kf(1.75, 0, 0, 45),
      kf(2, 0, 0, 60),
    ],
    rightUpperArm: [
      kf(0, 0, 0, -60),
      kf(0.25, 0, 0, -45),
      kf(0.5, 0, 0, -60),
      kf(0.75, 0, 0, -45),
      kf(1, 0, 0, -60),
      kf(1.25, 0, 0, -45),
      kf(1.5, 0, 0, -60),
      kf(1.75, 0, 0, -45),
      kf(2, 0, 0, -60),
    ],
    leftLowerArm: [
      kf(0, -45, 0, 0),
      kf(0.25, -60, 0, 0),
      kf(0.5, -45, 0, 0),
      kf(0.75, -60, 0, 0),
      kf(1, -45, 0, 0),
      kf(1.25, -60, 0, 0),
      kf(1.5, -45, 0, 0),
      kf(1.75, -60, 0, 0),
      kf(2, -45, 0, 0),
    ],
    rightLowerArm: [
      kf(0, -45, 0, 0),
      kf(0.25, -60, 0, 0),
      kf(0.5, -45, 0, 0),
      kf(0.75, -60, 0, 0),
      kf(1, -45, 0, 0),
      kf(1.25, -60, 0, 0),
      kf(1.5, -45, 0, 0),
      kf(1.75, -60, 0, 0),
      kf(2, -45, 0, 0),
    ],
    leftUpperLeg: [
      kf(0, 0, 0, 0),
      kf(0.25, 10, 0, 0),
      kf(0.5, 0, 0, 0),
      kf(0.75, 0, 0, 0),
      kf(1, 0, 0, 0),
      kf(1.25, 10, 0, 0),
      kf(1.5, 0, 0, 0),
      kf(1.75, 0, 0, 0),
      kf(2, 0, 0, 0),
    ],
    rightUpperLeg: [
      kf(0, 0, 0, 0),
      kf(0.25, 0, 0, 0),
      kf(0.5, 0, 0, 0),
      kf(0.75, 10, 0, 0),
      kf(1, 0, 0, 0),
      kf(1.25, 0, 0, 0),
      kf(1.5, 0, 0, 0),
      kf(1.75, 10, 0, 0),
      kf(2, 0, 0, 0),
    ],
  },
};

// Groove/Sway Animation
export const GROOVE_ANIMATION: ProceduralAnimation = {
  name: 'Groove',
  duration: 4,
  bones: {
    hips: [
      kf(0, 0, 0, 0),
      kf(0.5, 0, 10, 5),
      kf(1, 0, 0, 0),
      kf(1.5, 0, -10, -5),
      kf(2, 0, 0, 0),
      kf(2.5, 0, 10, 5),
      kf(3, 0, 0, 0),
      kf(3.5, 0, -10, -5),
      kf(4, 0, 0, 0),
    ],
    spine: [
      kf(0, 0, 0, 0),
      kf(0.5, 5, -5, -3),
      kf(1, 0, 0, 0),
      kf(1.5, 5, 5, 3),
      kf(2, 0, 0, 0),
      kf(2.5, 5, -5, -3),
      kf(3, 0, 0, 0),
      kf(3.5, 5, 5, 3),
      kf(4, 0, 0, 0),
    ],
    chest: [
      kf(0, 0, 0, 0),
      kf(0.5, 3, -3, -2),
      kf(1, 0, 0, 0),
      kf(1.5, 3, 3, 2),
      kf(2, 0, 0, 0),
      kf(2.5, 3, -3, -2),
      kf(3, 0, 0, 0),
      kf(3.5, 3, 3, 2),
      kf(4, 0, 0, 0),
    ],
    head: [
      kf(0, 0, 0, 0),
      kf(0.5, 0, 5, 3),
      kf(1, 0, 0, 0),
      kf(1.5, 0, -5, -3),
      kf(2, 0, 0, 0),
      kf(2.5, 0, 5, 3),
      kf(3, 0, 0, 0),
      kf(3.5, 0, -5, -3),
      kf(4, 0, 0, 0),
    ],
    leftUpperArm: [
      kf(0, 0, 0, 50),
      kf(1, 0, 0, 40),
      kf(2, 0, 0, 50),
      kf(3, 0, 0, 40),
      kf(4, 0, 0, 50),
    ],
    rightUpperArm: [
      kf(0, 0, 0, -50),
      kf(1, 0, 0, -40),
      kf(2, 0, 0, -50),
      kf(3, 0, 0, -40),
      kf(4, 0, 0, -50),
    ],
    leftLowerArm: [
      kf(0, -30, 0, 0),
      kf(1, -45, 0, 0),
      kf(2, -30, 0, 0),
      kf(3, -45, 0, 0),
      kf(4, -30, 0, 0),
    ],
    rightLowerArm: [
      kf(0, -30, 0, 0),
      kf(1, -45, 0, 0),
      kf(2, -30, 0, 0),
      kf(3, -45, 0, 0),
      kf(4, -30, 0, 0),
    ],
  },
};

// Jump Animation
export const JUMP_ANIMATION: ProceduralAnimation = {
  name: 'Jump',
  duration: 1.5,
  bones: {
    hips: [
      kf(0, 0, 0, 0),
      kf(0.3, 10, 0, 0), // Crouch
      kf(0.5, -15, 0, 0), // Jump up
      kf(0.8, -10, 0, 0), // Peak
      kf(1.1, 5, 0, 0), // Land
      kf(1.5, 0, 0, 0),
    ],
    spine: [
      kf(0, 0, 0, 0),
      kf(0.3, 15, 0, 0),
      kf(0.5, -10, 0, 0),
      kf(0.8, -5, 0, 0),
      kf(1.1, 10, 0, 0),
      kf(1.5, 0, 0, 0),
    ],
    leftUpperArm: [
      kf(0, 0, 0, 60),
      kf(0.3, 20, 0, 40),
      kf(0.5, -60, 0, 20),
      kf(0.8, -45, 0, 30),
      kf(1.1, 10, 0, 50),
      kf(1.5, 0, 0, 60),
    ],
    rightUpperArm: [
      kf(0, 0, 0, -60),
      kf(0.3, 20, 0, -40),
      kf(0.5, -60, 0, -20),
      kf(0.8, -45, 0, -30),
      kf(1.1, 10, 0, -50),
      kf(1.5, 0, 0, -60),
    ],
    leftUpperLeg: [
      kf(0, 0, 0, 0),
      kf(0.3, 45, 0, 0),
      kf(0.5, -20, 0, 0),
      kf(0.8, -10, 0, 0),
      kf(1.1, 30, 0, 0),
      kf(1.5, 0, 0, 0),
    ],
    rightUpperLeg: [
      kf(0, 0, 0, 0),
      kf(0.3, 45, 0, 0),
      kf(0.5, -20, 0, 0),
      kf(0.8, -10, 0, 0),
      kf(1.1, 30, 0, 0),
      kf(1.5, 0, 0, 0),
    ],
    leftLowerLeg: [
      kf(0, 0, 0, 0),
      kf(0.3, 60, 0, 0),
      kf(0.5, 30, 0, 0),
      kf(0.8, 20, 0, 0),
      kf(1.1, 45, 0, 0),
      kf(1.5, 0, 0, 0),
    ],
    rightLowerLeg: [
      kf(0, 0, 0, 0),
      kf(0.3, 60, 0, 0),
      kf(0.5, 30, 0, 0),
      kf(0.8, 20, 0, 0),
      kf(1.1, 45, 0, 0),
      kf(1.5, 0, 0, 0),
    ],
  },
};

// Disco Dance
export const DISCO_ANIMATION: ProceduralAnimation = {
  name: 'Disco',
  duration: 4,
  bones: {
    hips: [
      kf(0, 0, 0, 0),
      kf(0.5, -5, 15, 5),
      kf(1, 0, 0, 0),
      kf(1.5, -5, -15, -5),
      kf(2, 0, 0, 0),
      kf(2.5, -5, 15, 5),
      kf(3, 0, 0, 0),
      kf(3.5, -5, -15, -5),
      kf(4, 0, 0, 0),
    ],
    spine: [
      kf(0, 0, 0, 0),
      kf(0.5, 10, -10, -3),
      kf(1, 0, 0, 0),
      kf(1.5, 10, 10, 3),
      kf(2, 0, 0, 0),
      kf(2.5, 10, -10, -3),
      kf(3, 0, 0, 0),
      kf(3.5, 10, 10, 3),
      kf(4, 0, 0, 0),
    ],
    // Classic disco point up
    rightUpperArm: [
      kf(0, 0, 0, -60),
      kf(0.5, -90, 30, -30),
      kf(1, 0, 0, -60),
      kf(1.5, 0, 0, -60),
      kf(2, 0, 0, -60),
      kf(2.5, -90, 30, -30),
      kf(3, 0, 0, -60),
      kf(3.5, 0, 0, -60),
      kf(4, 0, 0, -60),
    ],
    leftUpperArm: [
      kf(0, 0, 0, 60),
      kf(0.5, 0, 0, 60),
      kf(1, 0, 0, 60),
      kf(1.5, -90, -30, 30),
      kf(2, 0, 0, 60),
      kf(2.5, 0, 0, 60),
      kf(3, 0, 0, 60),
      kf(3.5, -90, -30, 30),
      kf(4, 0, 0, 60),
    ],
    rightLowerArm: [
      kf(0, -30, 0, 0),
      kf(0.5, -20, 0, 0),
      kf(1, -30, 0, 0),
      kf(1.5, -30, 0, 0),
      kf(2, -30, 0, 0),
      kf(2.5, -20, 0, 0),
      kf(3, -30, 0, 0),
      kf(3.5, -30, 0, 0),
      kf(4, -30, 0, 0),
    ],
    leftLowerArm: [
      kf(0, -30, 0, 0),
      kf(0.5, -30, 0, 0),
      kf(1, -30, 0, 0),
      kf(1.5, -20, 0, 0),
      kf(2, -30, 0, 0),
      kf(2.5, -30, 0, 0),
      kf(3, -30, 0, 0),
      kf(3.5, -20, 0, 0),
      kf(4, -30, 0, 0),
    ],
    leftUpperLeg: [
      kf(0, 0, 0, 0),
      kf(0.5, 15, 0, 0),
      kf(1, 0, 0, 0),
      kf(1.5, 0, 0, 0),
      kf(2, 0, 0, 0),
      kf(2.5, 15, 0, 0),
      kf(3, 0, 0, 0),
      kf(3.5, 0, 0, 0),
      kf(4, 0, 0, 0),
    ],
    rightUpperLeg: [
      kf(0, 0, 0, 0),
      kf(0.5, 0, 0, 0),
      kf(1, 0, 0, 0),
      kf(1.5, 15, 0, 0),
      kf(2, 0, 0, 0),
      kf(2.5, 0, 0, 0),
      kf(3, 0, 0, 0),
      kf(3.5, 15, 0, 0),
      kf(4, 0, 0, 0),
    ],
  },
};

// Robot Dance
export const ROBOT_ANIMATION: ProceduralAnimation = {
  name: 'Robot',
  duration: 4,
  bones: {
    hips: [
      kf(0, 0, 0, 0),
      kf(1, 0, 20, 0),
      kf(2, 0, 0, 0),
      kf(3, 0, -20, 0),
      kf(4, 0, 0, 0),
    ],
    chest: [
      kf(0, 0, 0, 0),
      kf(0.5, 0, 0, 0),
      kf(1, 0, -15, 0),
      kf(1.5, 0, -15, 0),
      kf(2, 0, 0, 0),
      kf(2.5, 0, 0, 0),
      kf(3, 0, 15, 0),
      kf(3.5, 0, 15, 0),
      kf(4, 0, 0, 0),
    ],
    head: [
      kf(0, 0, 0, 0),
      kf(0.5, 0, 30, 0),
      kf(1, 0, 30, 0),
      kf(1.5, 0, 0, 0),
      kf(2, 0, -30, 0),
      kf(2.5, 0, -30, 0),
      kf(3, 0, 0, 0),
      kf(3.5, 0, 0, 0),
      kf(4, 0, 0, 0),
    ],
    leftUpperArm: [
      kf(0, 0, 0, 90),
      kf(0.5, 0, 0, 90),
      kf(1, -45, 0, 45),
      kf(1.5, -45, 0, 45),
      kf(2, 0, 0, 90),
      kf(2.5, 0, 0, 90),
      kf(3, -90, 0, 0),
      kf(3.5, -90, 0, 0),
      kf(4, 0, 0, 90),
    ],
    rightUpperArm: [
      kf(0, 0, 0, -90),
      kf(0.5, -90, 0, 0),
      kf(1, -90, 0, 0),
      kf(1.5, 0, 0, -90),
      kf(2, 0, 0, -90),
      kf(2.5, -45, 0, -45),
      kf(3, -45, 0, -45),
      kf(3.5, 0, 0, -90),
      kf(4, 0, 0, -90),
    ],
    leftLowerArm: [
      kf(0, 0, 0, 0),
      kf(0.5, 0, 0, 0),
      kf(1, -90, 0, 0),
      kf(1.5, -90, 0, 0),
      kf(2, 0, 0, 0),
      kf(2.5, 0, 0, 0),
      kf(3, -90, 0, 0),
      kf(3.5, -90, 0, 0),
      kf(4, 0, 0, 0),
    ],
    rightLowerArm: [
      kf(0, 0, 0, 0),
      kf(0.5, -90, 0, 0),
      kf(1, -90, 0, 0),
      kf(1.5, 0, 0, 0),
      kf(2, 0, 0, 0),
      kf(2.5, -90, 0, 0),
      kf(3, -90, 0, 0),
      kf(3.5, 0, 0, 0),
      kf(4, 0, 0, 0),
    ],
  },
};

// Macarena-like animation
export const MACARENA_ANIMATION: ProceduralAnimation = {
  name: 'Macarena',
  duration: 8,
  bones: {
    // Arms out front, palms down
    leftUpperArm: [
      kf(0, 0, 0, 60),
      kf(1, -45, 45, 30), // arm out
      kf(2, -45, 45, 30),
      kf(3, -45, 45, 30), // flip hands
      kf(4, -45, 45, 30),
      kf(5, 0, 0, 60), // hands on shoulders
      kf(6, 0, 0, 60), // hands behind head
      kf(7, 0, 0, 60), // hands on hips
      kf(8, 0, 0, 60),
    ],
    rightUpperArm: [
      kf(0, 0, 0, -60),
      kf(1, 0, 0, -60),
      kf(2, -45, -45, -30), // arm out
      kf(3, -45, -45, -30),
      kf(4, -45, -45, -30), // flip hands
      kf(5, 0, 0, -60), // hands on shoulders
      kf(6, 0, 0, -60), // hands behind head
      kf(7, 0, 0, -60), // hands on hips
      kf(8, 0, 0, -60),
    ],
    leftLowerArm: [
      kf(0, -30, 0, 0),
      kf(1, 0, 0, 0),
      kf(2, 0, 0, 0),
      kf(3, 0, 0, 0),
      kf(4, 0, 0, 0),
      kf(5, -90, 0, 0),
      kf(6, -120, 0, 0),
      kf(7, -60, 0, 0),
      kf(8, -30, 0, 0),
    ],
    rightLowerArm: [
      kf(0, -30, 0, 0),
      kf(1, -30, 0, 0),
      kf(2, 0, 0, 0),
      kf(3, 0, 0, 0),
      kf(4, 0, 0, 0),
      kf(5, -90, 0, 0),
      kf(6, -120, 0, 0),
      kf(7, -60, 0, 0),
      kf(8, -30, 0, 0),
    ],
    hips: [
      kf(0, 0, 0, 0),
      kf(1, 0, 0, 0),
      kf(2, 0, 0, 0),
      kf(3, 0, 0, 0),
      kf(4, 0, 0, 0),
      kf(5, 0, 0, 0),
      kf(6, 0, 0, 0),
      kf(7, 0, 20, 5),
      kf(7.5, 0, -20, -5),
      kf(8, 0, 0, 0),
    ],
  },
};

// All available animations
export const PROCEDURAL_ANIMATIONS: ProceduralAnimation[] = [
  WAVE_ANIMATION,
  HIPHOP_ANIMATION,
  GROOVE_ANIMATION,
  JUMP_ANIMATION,
  DISCO_ANIMATION,
  ROBOT_ANIMATION,
  MACARENA_ANIMATION,
];
