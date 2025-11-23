import asyncio
import json
import websockets
import pyautogui
import sys
from ctypes import cast, POINTER
from comtypes import CLSCTX_ALL
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

# Configuration
PORT = 8765
FAILSAFE = True
pyautogui.FAILSAFE = FAILSAFE
pyautogui.PAUSE = 0.01

# Initialize audio control
def setup_audio():
    devices = AudioUtilities.GetSpeakers()
    interface = devices.Activate(
        IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    volume = cast(interface, POINTER(IAudioEndpointVolume))
    return volume

# Get global volume control
try:
    system_volume = setup_audio()
    print("Audio control initialized successfully")
except Exception as e:
    print(f"Audio control initialization failed: {e}")
    system_volume = None

print(f"Starting Desktop Helper on port {PORT}...")
print(f"Screen resolution: {pyautogui.size()}")
print("Move mouse to corner to abort (FailSafe).")

async def handle_command(websocket):
    print("Client connected")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                cmd_type = data.get("type")
                
                if cmd_type == "move":
                    # Map normalized coordinates (0-1) to screen size
                    x_norm = data.get("x", 0)
                    y_norm = data.get("y", 0)
                    screen_width, screen_height = pyautogui.size()
                    
                    target_x = int(x_norm * screen_width)
                    target_y = int(y_norm * screen_height)
                    
                    # Move mouse
                    pyautogui.moveTo(target_x, target_y)
                    
                elif cmd_type == "click":
                    button = data.get("button", "left")
                    pyautogui.click(button=button)
                    print(f"Clicked {button}")
                    
                elif cmd_type == "drag":
                    state = data.get("state") # "start" or "end"
                    if state == "start":
                        pyautogui.mouseDown()
                        print("Drag start")
                    else:
                        pyautogui.mouseUp()
                        print("Drag end")
                        
                elif cmd_type == "shortcut":
                    name = data.get("name")
                    if name == "copy":
                        pyautogui.hotkey('ctrl', 'c')
                    elif name == "paste":
                        pyautogui.hotkey('ctrl', 'v')
                    print(f"Shortcut: {name}")

                elif cmd_type == "switch_desktop":
                    direction = data.get("direction")
                    if direction == "left":
                        pyautogui.hotkey('ctrl', 'win', 'left')
                        print("Switched Desktop Left")
                    elif direction == "right":
                        pyautogui.hotkey('ctrl', 'win', 'right')
                        print("Switched Desktop Right")
                
                elif cmd_type == "task_view":
                    action = data.get("action")
                    if action == "open":
                        pyautogui.hotkey('win', 'tab')
                        print("Task View Opened")
                    elif action == "close":
                        pyautogui.press('escape')
                        print("Task View Closed")
                
                # In your handle_command function, update the volume section:
                elif cmd_type == "volume":
                    direction = data.get("direction")  # "up" or "down"
                    if system_volume:
                        current_volume = system_volume.GetMasterVolumeLevelScalar()
                        if direction == "up":
                            new_volume = min(1.0, current_volume + 0.02)  # 2% increase for smoother control
                            system_volume.SetMasterVolumeLevelScalar(new_volume, None)
                            print(f"Volume increased to {int(new_volume * 100)}%")
                        elif direction == "down":
                            new_volume = max(0.0, current_volume - 0.02)  # 2% decrease for smoother control
                            system_volume.SetMasterVolumeLevelScalar(new_volume, None)
                            print(f"Volume decreased to {int(new_volume * 100)}%")
                    else:
                        # Fallback to keyboard shortcuts
                        if direction == "up":
                            pyautogui.press('volumeup')
                            print("Volume Up (fallback)")
                        elif direction == "down":
                            pyautogui.press('volumedown')
                            print("Volume Down (fallback)")
                
                elif cmd_type == "volume_set":
                    level = data.get("level", 50)  # 0-100
                    if system_volume:
                        # Convert 0-100 to 0.0-1.0
                        volume_scalar = max(0.0, min(1.0, level / 100.0))
                        system_volume.SetMasterVolumeLevelScalar(volume_scalar, None)
                        print(f"Volume set to {level}%")
                    else:
                        print(f"Volume set requested to {level}% (audio control not available)")
                
                # Acknowledge
                await websocket.send(json.dumps({"status": "ok", "cmd": cmd_type}))
                
            except json.JSONDecodeError:
                print("Invalid JSON received")
            except pyautogui.FailSafeException:
                print("FailSafe triggered! Aborting control.")
                break
            except Exception as e:
                print(f"Error executing command: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected")

async def main():
    async with websockets.serve(handle_command, "localhost", PORT):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")