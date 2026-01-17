#!/usr/bin/env python3
"""
Servo Client - Interactive CLI to control TonyPi servos.
Connects to servo_receiver.py and sends servo commands.

Usage:
    python3 servo_client.py --robot ws://192.168.0.104:8766

Servo Mappings:
    1: left_ankle_side      9: right_ankle_side
    2: left_ankle_up       10: right_ankle_up
    3: left_knee_up        11: right_knee_up
    4: left_hip_up         12: right_hip_up
    5: left_hip_side       13: right_hip_side
    6: left_elbow_up       14: right_elbow_up
    7: left_shoulder_side  15: right_shoulder_side
    8: left_shoulder_rotate 16: right_shoulder_rotate

Commands:
    <servo_id> <degrees>  - Set servo to angle (e.g. "7 90")
    ping                  - Test connection
    quit/exit             - Exit the program
"""

import asyncio
import json
import argparse
import sys

try:
    import websockets
except ImportError:
    print("Error: websockets library required. Install with: pip install websockets")
    sys.exit(1)


def degrees_to_pulse(degrees: float) -> int:
    """Convert degrees (10-170) to servo pulse value (0-1000)."""
    degrees = max(10, min(170, degrees))  # Safety limits
    pulse = (degrees / 180.0) * 1000
    return int(pulse)


def pulse_to_degrees(pulse: int) -> float:
    """Convert servo pulse value (0-1000) to degrees (0-180)."""
    degrees = (pulse / 1000.0) * 180.0
    return round(degrees, 1)


async def send_servo_command(websocket, servo_id: int, degrees: float, time_ms: int = 100):
    """Send a servo command to the receiver."""
    pulse = degrees_to_pulse(degrees)
    message = {
        'type': 'servos',
        'servos': {str(servo_id): pulse}
    }
    await websocket.send(json.dumps(message))
    print(f"  Sent: Servo {servo_id} -> {degrees}° (pulse: {pulse})")


async def send_ping(websocket):
    """Send a ping and wait for pong."""
    await websocket.send(json.dumps({'type': 'ping'}))
    response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
    data = json.loads(response)
    if data.get('type') == 'pong':
        print("  Pong received! Connection OK.")
    else:
        print(f"  Unexpected response: {data}")


def print_help():
    """Print available commands."""
    print("\nCommands:")
    print("  <servo_id> <degrees>     - Set servo angle (e.g. '1 90')")
    print("  <servo_id> <degrees> <ms> - Set servo with custom duration")
    print("  ping                     - Test connection")
    print("  help                     - Show this help")
    print("  quit / exit              - Exit program")
    print("\nExamples:")
    print("  1 90      - Set servo 1 to 90 degrees")
    print("  5 45 200  - Set servo 5 to 45 degrees over 200ms")
    print()


async def interactive_loop(robot_url: str):
    """Main interactive loop."""
    print(f"\nConnecting to {robot_url}...")
    
    try:
        async with websockets.connect(robot_url) as websocket:
            print("Connected!")
            print_help()
            
            while True:
                try:
                    user_input = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: input("\nservo> ").strip().lower()
                    )
                    
                    if not user_input:
                        continue
                    
                    if user_input in ('quit', 'exit', 'q'):
                        print("Goodbye!")
                        break
                    
                    if user_input == 'help':
                        print_help()
                        continue
                    
                    if user_input == 'ping':
                        await send_ping(websocket)
                        continue
                    
                    # Parse servo command: <id> <degrees> [time_ms]
                    parts = user_input.split()
                    if len(parts) < 2:
                        print("  Error: Use format '<servo_id> <degrees>' (e.g. '1 90')")
                        continue
                    
                    try:
                        servo_id = int(parts[0])
                        degrees = float(parts[1])
                        time_ms = int(parts[2]) if len(parts) > 2 else 100
                        
                        if not 10 <= degrees <= 170:
                            print("  Warning: Degrees should be 10-170 (safety limits), clamping value")
                        
                        await send_servo_command(websocket, servo_id, degrees, time_ms)
                        
                    except ValueError:
                        print("  Error: Invalid number format")
                        print("  Use: <servo_id> <degrees> (e.g. '1 90')")
                        
                except KeyboardInterrupt:
                    print("\nGoodbye!")
                    break
                    
    except (OSError, TimeoutError) as e:
        print(f"Error: Could not connect to {robot_url}")
        print("Make sure servo_receiver.py is running on the robot.")
        print(f"  ({e})")
        sys.exit(1)
    except Exception as e:
        print(f"Connection error: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Interactive CLI to control TonyPi servos",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python3 servo_client.py --robot ws://192.168.0.104:8766
    python3 servo_client.py --robot ws://localhost:8766
        """
    )
    parser.add_argument(
        '--robot', '-r',
        type=str,
        default='ws://192.168.0.104:8766',
        help='WebSocket URL of servo_receiver.py (default: ws://192.168.0.104:8766)'
    )
    args = parser.parse_args()
    
    print("=" * 50)
    print("  TonyPi Servo Control Client")
    print("=" * 50)
    
    asyncio.run(interactive_loop(args.robot))


if __name__ == '__main__':
    main()
