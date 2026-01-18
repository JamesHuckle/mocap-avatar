#!/usr/bin/env python3
"""
TonyPi Pose Mimic - Full Body Tracking (WSL2 Compatible)

Runs MediaPipe pose estimation and outputs servo commands needed 
to make TonyPi mimic your movements including arms, hips, and knees.

TonyPi Servo Map (from action group analysis):
==============================================
RIGHT SIDE:                    LEFT SIDE:
  Servo 1:  Right ankle          Servo 9:  Left ankle
  Servo 2:  Right knee           Servo 10: Left knee
  Servo 3:  Right hip (front)    Servo 11: Left hip (front)
  Servo 4:  Right hip (side)     Servo 12: Left hip (side)
  Servo 5:  Right shoulder (fwd) Servo 13: Left ??? 
  Servo 6:  Left elbow           Servo 14: Right elbow
  Servo 7:  Left shoulder (side) Servo 15: Right shoulder (side)
  Servo 8:  Left shoulder (fwd)  Servo 16: Right shoulder (fwd)
  
HEAD:
  Servo 17: Head pan
  Servo 18: Head tilt

MediaPipe Pose Landmarks:
  11: left_shoulder    12: right_shoulder
  13: left_elbow       14: right_elbow
  15: left_wrist       16: right_wrist
  23: left_hip         24: right_hip
  25: left_knee        26: right_knee
  27: left_ankle       28: right_ankle
"""

import os
import cv2
import math
import time
import subprocess
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from dataclasses import dataclass
from typing import Optional, List, Dict


@dataclass
class ServoCommand:
    """Represents a servo command for TonyPi."""
    servo_id: int
    position: int
    name: str

    def __repr__(self):
        return f"Servo {self.servo_id:2} ({self.name}): {self.position}"


class FPS:
    def __init__(self):
        self.fps = 0.0
        self.last_time = 0
        self.current_time = 0

    def update(self):
        self.last_time = self.current_time
        self.current_time = time.time()
        if self.last_time != 0:
            new_fps = 1.0 / (self.current_time - self.last_time)
            self.fps = new_fps * 0.1 + self.fps * 0.9 if self.fps else new_fps
        return self.fps

    def show_fps(self, img):
        cv2.putText(img, f'FPS: {self.fps:.1f}', (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 0), 2)
        return img


def val_map(x, in_min, in_max, out_min, out_max):
    """Map value from one range to another."""
    return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min


def vector_2d_angle(v1, v2):
    """Calculate angle between two 2D vectors in degrees."""
    d = np.linalg.norm(v1) * np.linalg.norm(v2)
    if d == 0:
        return None
    cos = np.clip(np.dot(v1, v2) / d, -1.0, 1.0)
    sin = np.clip(np.cross(v1, v2) / d, -1.0, 1.0)
    return int(np.degrees(np.arctan2(sin, cos)))


def clamp_servo(value, min_val=125, max_val=875):
    """Clamp servo value to valid range."""
    return max(min_val, min(max_val, value))


# MediaPipe pose connections for skeleton drawing
POSE_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 7), (0, 4), (4, 5), (5, 6), (6, 8),
    (9, 10), (11, 12), (11, 23), (12, 24), (23, 24),
    (11, 13), (13, 15), (15, 17), (15, 19), (15, 21), (17, 19),
    (12, 14), (14, 16), (16, 18), (16, 20), (16, 22), (18, 20),
    (23, 25), (25, 27), (27, 29), (27, 31), (29, 31),
    (24, 26), (26, 28), (28, 30), (28, 32), (30, 32),
]


class FFmpegCapture:
    """Camera capture using ffmpeg subprocess (works better on WSL2)."""
    
    def __init__(self, device='/dev/video0', width=640, height=480, fps=30):
        self.width = width
        self.height = height
        self.frame_size = width * height * 3
        self.process = None
        self.device = device
        self.fps = fps
        
    def open(self):
        cmd = [
            'ffmpeg', '-f', 'v4l2', '-input_format', 'mjpeg',
            '-video_size', f'{self.width}x{self.height}',
            '-framerate', str(self.fps), '-thread_queue_size', '8',
            '-i', self.device, '-f', 'rawvideo', '-pix_fmt', 'bgr24',
            '-fflags', 'nobuffer', '-flags', 'low_delay', '-avioflags', 'direct', '-'
        ]
        self.process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=self.frame_size)
        return self.process is not None
    
    def read(self):
        if not self.process:
            return False, None
        raw = self.process.stdout.read(self.frame_size)
        if len(raw) != self.frame_size:
            return False, None
        return True, np.frombuffer(raw, dtype=np.uint8).reshape((self.height, self.width, 3))
    
    def flush_buffer(self):
        if self.process and self.process.stdout:
            import select
            while select.select([self.process.stdout], [], [], 0)[0]:
                self.process.stdout.read(self.frame_size)
    
    def release(self):
        if self.process:
            self.process.terminate()
            self.process = None
    
    def isOpened(self):
        return self.process is not None


class TonyPiPoseMimic:
    """
    Full-body pose tracking for TonyPi humanoid robot.
    
    Tracks: shoulders (side & forward), elbows, hips (side & front), knees
    """
    
    # Arm segment lengths for forward kinematics validation
    L1, L2 = 0.06, 0.11
    
    # Servo limits
    SERVO_MIN, SERVO_MAX = 125, 875
    
    # Smoothing threshold (ignore changes smaller than this)
    SMOOTHING_THRESHOLD = 25
    
    # TonyPi standing pose (neutral positions)
    STAND_POSE = {
        1: 500, 2: 390, 3: 500, 4: 600, 5: 500,   # Right leg + right shoulder fwd
        6: 575, 7: 800, 8: 725,                    # Left arm
        9: 500, 10: 610, 11: 500, 12: 400, 13: 500,  # Left leg
        14: 425, 15: 200, 16: 275,                 # Right arm
        17: 500, 18: 500                           # Head
    }
    
    def __init__(self, source='/dev/video0', model_path=None, full_body=True):
        """
        Initialize pose mimic.
        
        Args:
            source: Video source (device path, file, or URL)
            model_path: Path to MediaPipe pose model
            full_body: Enable full body tracking (hips, knees) or just arms
        """
        self.source = source
        self.full_body = full_body
        self.last_servos: Dict[int, int] = {}
        self.fps = FPS()
        
        if model_path is None:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            model_path = os.path.join(script_dir, '..', 'TonyPi', 'Functions', 'model', 'pose_landmarker_lite.task')
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found: {model_path}")
        
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.PoseLandmarkerOptions(base_options=base_options, output_segmentation_masks=True)
        self.detector = vision.PoseLandmarker.create_from_options(options)
        
        print(f"[TonyPi Pose Mimic] Model: {model_path}")
        print(f"[TonyPi Pose Mimic] Source: {source}")
        print(f"[TonyPi Pose Mimic] Full body: {full_body}")
    
    def get_point(self, landmarks, idx, width, height):
        """Get pixel coordinates for a landmark."""
        lm = landmarks[idx]
        return [int(lm.x * width), int(lm.y * height)]
    
    def smooth_servo(self, servo_id: int, new_value: int) -> int:
        """Apply smoothing to reduce jitter."""
        if servo_id in self.last_servos:
            if abs(self.last_servos[servo_id] - new_value) < self.SMOOTHING_THRESHOLD:
                return self.last_servos[servo_id]
        self.last_servos[servo_id] = new_value
        return new_value
    
    def calculate_arm_servos(self, landmarks, width, height) -> List[ServoCommand]:
        """Calculate arm servo positions (shoulders side, elbows)."""
        commands = []
        
        # Get arm landmarks
        left_shoulder = self.get_point(landmarks, 11, width, height)
        right_shoulder = self.get_point(landmarks, 12, width, height)
        left_elbow = self.get_point(landmarks, 13, width, height)
        right_elbow = self.get_point(landmarks, 14, width, height)
        left_wrist = self.get_point(landmarks, 15, width, height)
        right_wrist = self.get_point(landmarks, 16, width, height)
        
        # Reference points for angle calculation (horizontal lines)
        left_ref = [width, left_shoulder[1]]
        right_ref = [0, right_shoulder[1]]
        
        # Left arm angles
        left_shoulder_angle = vector_2d_angle(
            np.array(left_shoulder) - np.array(left_ref),
            np.array(left_shoulder) - np.array(left_elbow)
        )
        left_elbow_angle = vector_2d_angle(
            np.array(left_elbow) - np.array(left_shoulder),
            np.array(left_wrist) - np.array(left_elbow)
        )
        
        # Right arm angles  
        right_shoulder_angle = vector_2d_angle(
            np.array(right_shoulder) - np.array(right_ref),
            np.array(right_shoulder) - np.array(right_elbow)
        )
        right_elbow_angle = vector_2d_angle(
            np.array(right_elbow) - np.array(right_shoulder),
            np.array(right_wrist) - np.array(right_elbow)
        )
        
        if all(a is not None for a in [left_shoulder_angle, left_elbow_angle, right_shoulder_angle, right_elbow_angle]):
            # Map angles to servo positions
            # NOTE: L/R swapped because camera image is mirrored
            # Camera "left" (landmarks 11,13,15) → Robot RIGHT servos
            # Camera "right" (landmarks 12,14,16) → Robot LEFT servos
            
            # Servo 15: Right shoulder (side) ← from camera's left shoulder
            servo15 = clamp_servo(int(val_map(left_shoulder_angle, -90, 90, self.SERVO_MIN, self.SERVO_MAX)))
            servo15 = self.smooth_servo(15, servo15)
            commands.append(ServoCommand(15, servo15, "R_shoulder_side"))
            
            # Servo 14: Right elbow ← from camera's left elbow
            servo14 = clamp_servo(int(val_map(left_elbow_angle, -90, 90, self.SERVO_MIN, self.SERVO_MAX)))
            servo14 = self.smooth_servo(14, servo14)
            commands.append(ServoCommand(14, servo14, "R_elbow"))
            
            # Servo 7: Left shoulder (side) ← from camera's right shoulder
            servo7 = clamp_servo(int(val_map(right_shoulder_angle, -90, 90, self.SERVO_MIN, self.SERVO_MAX)))
            servo7 = self.smooth_servo(7, servo7)
            commands.append(ServoCommand(7, servo7, "L_shoulder_side"))
            
            # Servo 6: Left elbow ← from camera's right elbow
            servo6 = clamp_servo(int(val_map(right_elbow_angle, -90, 90, self.SERVO_MIN, self.SERVO_MAX)))
            servo6 = self.smooth_servo(6, servo6)
            commands.append(ServoCommand(6, servo6, "L_elbow"))
        
        return commands
    
    def calculate_shoulder_forward_servos(self, landmarks, width, height) -> List[ServoCommand]:
        """Calculate forward shoulder rotation (arms forward/backward)."""
        commands = []
        
        # Use z-depth of wrist relative to shoulder to estimate forward rotation
        left_shoulder = landmarks[11]
        right_shoulder = landmarks[12]
        left_wrist = landmarks[15]
        right_wrist = landmarks[16]
        
        # Z difference indicates forward/backward arm position
        # Negative z = closer to camera = arm forward
        left_z_diff = left_shoulder.z - left_wrist.z
        right_z_diff = right_shoulder.z - right_wrist.z
        
        # Map z difference to servo position (L/R swapped for mirror)
        # Typical z range is roughly -0.5 to 0.5
        # Servo 16: Right shoulder forward ← from camera's left
        servo16 = clamp_servo(int(val_map(left_z_diff, -0.3, 0.3, 500, 125)))
        servo16 = self.smooth_servo(16, servo16)
        commands.append(ServoCommand(16, servo16, "R_shoulder_fwd"))
        
        # Servo 8: Left shoulder forward ← from camera's right
        servo8 = clamp_servo(int(val_map(right_z_diff, -0.3, 0.3, 500, 900)))
        servo8 = self.smooth_servo(8, servo8)
        commands.append(ServoCommand(8, servo8, "L_shoulder_fwd"))
        
        return commands
    
    def calculate_hip_servos(self, landmarks, width, height) -> List[ServoCommand]:
        """Calculate hip servo positions (side lean and front/back)."""
        commands = []
        
        # Get hip and knee landmarks
        left_hip = self.get_point(landmarks, 23, width, height)
        right_hip = self.get_point(landmarks, 24, width, height)
        left_knee = self.get_point(landmarks, 25, width, height)
        right_knee = self.get_point(landmarks, 26, width, height)
        
        # Hip side angle (leaning left/right)
        # Reference: vertical line from hip
        left_hip_ref = [left_hip[0], left_hip[1] + 100]  # Point below hip
        right_hip_ref = [right_hip[0], right_hip[1] + 100]
        
        left_hip_side_angle = vector_2d_angle(
            np.array(left_hip) - np.array(left_hip_ref),
            np.array(left_hip) - np.array(left_knee)
        )
        right_hip_side_angle = vector_2d_angle(
            np.array(right_hip) - np.array(right_hip_ref),
            np.array(right_hip) - np.array(right_knee)
        )
        
        # L/R swapped for mirror
        if left_hip_side_angle is not None:
            # Servo 4: Right hip side ← from camera's left hip
            servo4 = clamp_servo(int(val_map(left_hip_side_angle, -45, 45, 450, 750)))
            servo4 = self.smooth_servo(4, servo4)
            commands.append(ServoCommand(4, servo4, "R_hip_side"))
        
        if right_hip_side_angle is not None:
            # Servo 12: Left hip side ← from camera's right hip
            servo12 = clamp_servo(int(val_map(right_hip_side_angle, -45, 45, 250, 550)))
            servo12 = self.smooth_servo(12, servo12)
            commands.append(ServoCommand(12, servo12, "L_hip_side"))
        
        # Hip front/back angle (using z-depth)
        left_hip_lm = landmarks[23]
        right_hip_lm = landmarks[24]
        left_knee_lm = landmarks[25]
        right_knee_lm = landmarks[26]
        
        # Z difference for hip bend forward/backward (L/R swapped for mirror)
        left_hip_z = left_hip_lm.z - left_knee_lm.z
        right_hip_z = right_hip_lm.z - right_knee_lm.z
        
        # Servo 3: Right hip front ← from camera's left hip
        servo3 = clamp_servo(int(val_map(left_hip_z, -0.2, 0.2, 700, 300)))
        servo3 = self.smooth_servo(3, servo3)
        commands.append(ServoCommand(3, servo3, "R_hip_front"))
        
        # Servo 11: Left hip front ← from camera's right hip
        servo11 = clamp_servo(int(val_map(right_hip_z, -0.2, 0.2, 300, 700)))
        servo11 = self.smooth_servo(11, servo11)
        commands.append(ServoCommand(11, servo11, "L_hip_front"))
        
        return commands
    
    def calculate_knee_servos(self, landmarks, width, height) -> List[ServoCommand]:
        """Calculate knee servo positions."""
        commands = []
        
        # Get leg landmarks
        left_hip = self.get_point(landmarks, 23, width, height)
        right_hip = self.get_point(landmarks, 24, width, height)
        left_knee = self.get_point(landmarks, 25, width, height)
        right_knee = self.get_point(landmarks, 26, width, height)
        left_ankle = self.get_point(landmarks, 27, width, height)
        right_ankle = self.get_point(landmarks, 28, width, height)
        
        # Knee angle = angle at knee between hip-knee and knee-ankle vectors
        left_knee_angle = vector_2d_angle(
            np.array(left_hip) - np.array(left_knee),
            np.array(left_ankle) - np.array(left_knee)
        )
        right_knee_angle = vector_2d_angle(
            np.array(right_hip) - np.array(right_knee),
            np.array(right_ankle) - np.array(right_knee)
        )
        
        # Debug: print knee angles to diagnose
        # print(f"DEBUG: left_knee_angle={left_knee_angle}, right_knee_angle={right_knee_angle}")
        
        # L/R swapped for mirror
        # Use absolute angle value since knee angle can be negative depending on direction
        if left_knee_angle is not None:
            # Servo 2: Right knee ← from camera's left knee
            # Straight leg ~180 degrees, bent ~90 degrees
            # Use abs() since angle direction can vary
            angle_abs = abs(left_knee_angle)
            servo2 = clamp_servo(int(val_map(angle_abs, 90, 180, 150, 390)))
            servo2 = self.smooth_servo(2, servo2)
            commands.append(ServoCommand(2, servo2, "R_knee"))
        
        if right_knee_angle is not None:
            # Servo 10: Left knee ← from camera's right knee
            angle_abs = abs(right_knee_angle)
            servo10 = clamp_servo(int(val_map(angle_abs, 90, 180, 850, 610)))
            servo10 = self.smooth_servo(10, servo10)
            commands.append(ServoCommand(10, servo10, "L_knee"))
        
        return commands
    
    def calculate_servo_commands(self, landmarks, width, height) -> Optional[List[ServoCommand]]:
        """Calculate all servo commands from pose landmarks."""
        commands = []
        
        # Always calculate arm servos
        commands.extend(self.calculate_arm_servos(landmarks, width, height))
        commands.extend(self.calculate_shoulder_forward_servos(landmarks, width, height))
        
        # Full body tracking includes hips and knees
        if self.full_body:
            commands.extend(self.calculate_hip_servos(landmarks, width, height))
            commands.extend(self.calculate_knee_servos(landmarks, width, height))
        
        return commands if commands else None
    
    def draw_skeleton(self, image, landmarks, width, height):
        """Draw pose skeleton on image."""
        points = [(int(lm.x * width), int(lm.y * height)) for lm in landmarks]
        
        for s, e in POSE_CONNECTIONS:
            if s < len(points) and e < len(points):
                cv2.line(image, points[s], points[e], (255, 255, 255), 2)
        
        for pt in points:
            cv2.circle(image, pt, 4, (0, 255, 0), -1)
        
        # Highlight tracked joints
        highlight_idx = [11, 12, 13, 14, 15, 16]  # Arms
        if self.full_body:
            highlight_idx.extend([23, 24, 25, 26, 27, 28])  # Hips, knees, ankles
        
        for i in highlight_idx:
            if i < len(points):
                cv2.circle(image, points[i], 8, (0, 255, 255), -1)
        
        return image
    
    def format_tonypi_command(self, commands: List[ServoCommand]) -> str:
        """Format commands as TonyPi board command."""
        servo_pairs = [[cmd.servo_id, cmd.position] for cmd in commands]
        return f"board.bus_servo_set_position(0.1, {servo_pairs})"
    
    def run(self, show_video=True, print_commands=True):
        """Main loop: capture video, detect pose, output servo commands."""
        # Determine capture method
        if isinstance(self.source, str) and self.source.startswith('/dev/video'):
            cap = FFmpegCapture(device=self.source)
            if not cap.open():
                raise RuntimeError(f"Failed to open {self.source}")
        elif isinstance(self.source, str) and (self.source.startswith('http') or os.path.isfile(self.source)):
            cap = cv2.VideoCapture(self.source)
        else:
            cap = cv2.VideoCapture(int(self.source) if str(self.source).isdigit() else self.source)
        
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open source: {self.source}")
        
        mode = "Full Body" if self.full_body else "Arms Only"
        print("\n" + "="*60)
        print(f"TonyPi Pose Mimic - {mode}")
        print("="*60)
        print("Press 'q' or ESC to quit")
        print("Press 'f' to toggle full body mode")
        print("="*60 + "\n")
        
        last_print = time.time()
        frame_count = 0
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    continue
                
                frame_count += 1
                if frame_count % 5 == 0 and hasattr(cap, 'flush_buffer'):
                    cap.flush_buffer()
                
                image = cv2.flip(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), 1)
                height, width = image.shape[:2]
                
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image)
                result = self.detector.detect(mp_image)
                
                annotated = np.copy(image)
                servo_commands = None
                
                if result.pose_landmarks:
                    for landmarks in result.pose_landmarks:
                        servo_commands = self.calculate_servo_commands(landmarks, width, height)
                        annotated = self.draw_skeleton(annotated, landmarks, width, height)
                
                # Print servo commands
                if print_commands and servo_commands and (time.time() - last_print) > 0.1:
                    print("\n--- Servo Commands ---")
                    for cmd in servo_commands:
                        print(f"  {cmd}")
                    print(f"  {self.format_tonypi_command(servo_commands)}")
                    last_print = time.time()
                
                self.fps.update()
                display = self.fps.show_fps(cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR))
                
                # Display servo values on screen
                if servo_commands:
                    y_offset = 50
                    for cmd in servo_commands[:8]:  # Show first 8
                        cv2.putText(display, f"{cmd.name}: {cmd.position}", (10, y_offset),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
                        y_offset += 22
                    if len(servo_commands) > 8:
                        y_offset2 = 50
                        for cmd in servo_commands[8:]:
                            cv2.putText(display, f"{cmd.name}: {cmd.position}", (width - 180, y_offset2),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
                            y_offset2 += 22
                
                # Mode indicator
                mode_text = "FULL BODY" if self.full_body else "ARMS ONLY"
                cv2.putText(display, mode_text, (width - 150, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 0), 2)
                
                if show_video:
                    cv2.imshow('TonyPi Pose Mimic', display)
                    key = cv2.waitKey(1)
                    if key in [ord('q'), 27]:
                        break
                    elif key == ord('f'):
                        self.full_body = not self.full_body
                        print(f"\n[Mode: {'Full Body' if self.full_body else 'Arms Only'}]")
                        
        finally:
            cap.release()
            cv2.destroyAllWindows()
            print("\n[Stopped]")


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='TonyPi Pose Mimic - Full Body Tracking',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Servo Map:
  Arms:  6=L_elbow, 7=L_shoulder, 8=L_shoulder_fwd
         14=R_elbow, 15=R_shoulder, 16=R_shoulder_fwd
  Hips:  3=R_hip_front, 4=R_hip_side, 11=L_hip_front, 12=L_hip_side  
  Knees: 2=R_knee, 10=L_knee
"""
    )
    parser.add_argument('--source', '-s', default='/dev/video0', help='Video source')
    parser.add_argument('--no-video', action='store_true', help='Disable video display')
    parser.add_argument('--no-print', action='store_true', help='Disable servo output')
    parser.add_argument('--arms-only', action='store_true', help='Track arms only (no hips/knees)')
    args = parser.parse_args()
    
    try:
        mimic = TonyPiPoseMimic(source=args.source, full_body=not args.arms_only)
        mimic.run(show_video=not args.no_video, print_commands=not args.no_print)
    except Exception as e:
        print(f"Error: {e}")
        return 1
    return 0


if __name__ == "__main__":
    exit(main())
