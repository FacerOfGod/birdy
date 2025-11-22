import asyncio
import json
import websockets
import pyautogui
import sys

# Configuration
PORT = 8765
FAILSAFE = True
pyautogui.FAILSAFE = FAILSAFE
pyautogui.PAUSE = 0.01  # Minimal pause for faster response

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
