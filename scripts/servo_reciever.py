#!/usr/bin/env python3
"""
Servo Receiver - Runs on the TonyPi robot.
Receives servo commands over WebSocket and executes them.

Usage on Pi:
    python3 servo_receiver.py --port 8766

Then from laptop:
    python3 servo_client.py --robot ws://192.168.0.104:8766
"""

import asyncio
import json
import argparse
import sys
import signal

# Import robot SDK
sys.path.insert(0, '/home/pi/TonyPi/HiwonderSDK')
try:
    import hiwonder.ros_robot_controller_sdk as rrc
    from hiwonder.Controller import Controller
    ROBOT_AVAILABLE = True
except ImportError:
    ROBOT_AVAILABLE = False
    print("Warning: Robot SDK not available, running in test mode")

import websockets

# Neutral position (center) for all servos
NEUTRAL_PULSE = 500

# Servo Configuration - matches UI
SERVO_CONFIG = {
    1: {'name': 'left_ankle_side', 'group': 'left_leg'},
    2: {'name': 'left_ankle_up', 'group': 'left_leg'},
    3: {'name': 'left_knee_up', 'group': 'left_leg'},
    4: {'name': 'left_hip_up', 'group': 'left_leg'},
    5: {'name': 'left_hip_side', 'group': 'left_leg'},
    6: {'name': 'left_elbow_up', 'group': 'left_arm'},
    7: {'name': 'left_shoulder_side', 'group': 'left_arm'},
    8: {'name': 'left_shoulder_rotate', 'group': 'left_arm'},
    9: {'name': 'right_ankle_side', 'group': 'right_leg'},
    10: {'name': 'right_ankle_up', 'group': 'right_leg'},
    11: {'name': 'right_knee_up', 'group': 'right_leg'},
    12: {'name': 'right_hip_up', 'group': 'right_leg'},
    13: {'name': 'right_hip_side', 'group': 'right_leg'},
    14: {'name': 'right_elbow_up', 'group': 'right_arm'},
    15: {'name': 'right_shoulder_side', 'group': 'right_arm'},
    16: {'name': 'right_shoulder_rotate', 'group': 'right_arm'},
}

# Default enabled servos (shoulders only)
DEFAULT_ENABLED_SERVOS = [7, 8, 15, 16]

# All bus servos on TonyPi (1-16)
ALL_BUS_SERVOS = list(range(1, 17))


class ServoController:
    def __init__(self):
        self.controller = None
        self.board = None
        if ROBOT_AVAILABLE:
            print("Connecting to robot servos...")
            self.board = rrc.Board()
            self.controller = Controller(self.board)
            print("Robot connected!")
        else:
            print("Running in test mode (no robot)")

    def reset_to_neutral(self, servos=None, time_ms=500):
        """Reset specified servos to neutral position (500 pulse).
        
        Args:
            servos: List of servo IDs to reset. If None, resets default enabled servos only.
            time_ms: Movement time in milliseconds (slower = safer)
        """
        if servos is None:
            servos = DEFAULT_ENABLED_SERVOS
        
        print(f"Resetting servos {servos} to neutral ({NEUTRAL_PULSE})...")
        
        if self.controller:
            for servo_id in servos:
                try:
                    self.controller.set_bus_servo_pulse(int(servo_id), NEUTRAL_PULSE, int(time_ms))
                except Exception as e:
                    print(f"  Warning: Could not reset servo {servo_id}: {e}")
            print("Reset complete!")
        else:
            print(f"  [TEST MODE] Would reset servos: {servos}")

    def set_servos(self, servo_dict, time_ms=50):
        """Set servo positions."""
        if self.controller:
            for servo_id, pulse in servo_dict.items():
                self.controller.set_bus_servo_pulse(int(servo_id), int(pulse), int(time_ms))
        else:
            # Test mode - just print
            servos_str = ", ".join(f"{k}:{v}" for k, v in sorted(servo_dict.items()))
            print(f"Servos: {servos_str}")


async def handle_client(websocket, controller):
    """Handle incoming servo commands."""
    addr = websocket.remote_address
    print(f"Client connected: {addr}")

    try:
        async for message in websocket:
            data = json.loads(message)

            if data.get('type') == 'servos':
                controller.set_servos(data['servos'])

            elif data.get('type') == 'ping':
                await websocket.send(json.dumps({'type': 'pong'}))
            
            elif data.get('type') == 'reset':
                # Allow remote reset command
                controller.reset_to_neutral()
                await websocket.send(json.dumps({'type': 'reset_done'}))

    except websockets.exceptions.ConnectionClosed:
        print(f"Client disconnected: {addr}")
        # Optionally reset on disconnect (comment out if not wanted)
        # controller.reset_to_neutral()
    except Exception as e:
        print(f"Error: {e}")


async def main(port, skip_reset=False):
    controller = ServoController()

    # Reset servos to neutral on startup
    if not skip_reset:
        print("\n=== STARTUP RESET ===")
        controller.reset_to_neutral(time_ms=1000)  # Slow movement for safety
        await asyncio.sleep(1.5)  # Wait for movement to complete
    
    # Handle graceful shutdown
    loop = asyncio.get_event_loop()
    
    def shutdown_handler():
        print("\n=== SHUTDOWN: Resetting servos ===")
        controller.reset_to_neutral(time_ms=500)
    
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown_handler)

    print(f"\nServo Receiver starting on port {port}...")
    async with websockets.serve(
        lambda ws: handle_client(ws, controller),
        "0.0.0.0",
        port
    ):
        print(f"Ready! Waiting for connections on ws://0.0.0.0:{port}")
        print("Press Ctrl+C to stop (will reset servos)")
        await asyncio.Future()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--no-reset', action='store_true', 
                        help='Skip initial servo reset')
    args = parser.parse_args()

    asyncio.run(main(args.port, skip_reset=args.no_reset))