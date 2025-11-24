# Birdy - AI Posture & Gesture Control

Birdy is an intelligent desktop assistant that uses your webcam to monitor your posture and control your computer with hand gestures. Built with Electron, MediaPipe, and Python

## How a project born out of giving up ended up winning a prize

This project was built for [Lauzhack EPFL 2025](https://lauzhack.com/). A huge room full of people who look like they’ve been preparing for this moment for weeks. Teams of four forming battle plans, whiteboards covered with diagrams, AI agents everywhere.

Me?
_A few hours in, and I was already lost._

My team and I originally planned to attack the SBB challenge… until we realized none of us were actually excited about it. Then came hours of brainstorming, trying to chase an idea that felt meaningful, original, or at least buildable. Nothing clicked. Every new idea died within minutes.

So eventually, we did the unthinkable:
_We gave up._

But here’s the thing, once we freed ourselves from the pressure to “produce something impressive,” Lauzhack suddenly became fun again. I decided to stay anyway, just to enjoy the atmosphere. Hackathons have this special kind of energy that keeps you coding even when you have no idea why.

So I started hopping around GitHub, poking into random repositories like someone browsing channels with no plan at 3 a.m. And then I stumbled on a project showing how AI/ML could detect body posture and head position. That caught my eye.

_“Why not? Let’s try it,” I thought._

One experiment became two. Then ten. Suddenly I was building things with no intention of submitting anything. Just pure curiosity.

And then it hit me.
_“This… actually has potential.”_

The submission deadline was midnight. At 23:55, I was still debating with myself. Should I submit? Should I pretend this isn’t happening?

A teammate who was also deep in his own fun side-project just looked at me and said:
_“Dude, just sign up. You can always dip later if you don’t want to present.”_

So at 23:59, literally one minute before the deadline, I hit submit.

And that was it. Suddenly I was motivated again. Not because I had planned it, not because I felt ready, but because Birdy had become something that mattered, not only to me, but potentially to anyone who sits in front of a computer all day.

## Example 

<img width="2560" height="1600" alt="image" src="https://github.com/user-attachments/assets/6a9a99c3-f03f-47ce-ba55-70af458f04dd" />

## Features

### 🧘 Posture Monitoring
*   **Real-time Analysis**: Detects slouching, leaning, and distance from the screen.
*   **Smart Alerts**: Visual notifications when you need to sit up straight or take a break.
*   **Standing Detection**: Automatically detects when you stand up.

### ⏱️ Smart Timer
*   **Sitting Timer**: Tracks how long you've been sitting.
*   **Auto-Pause/Resume**: The timer automatically stops when you stand up or leave the desk, and resumes when you sit back down.
*   **Break Reminders**: Reminds you to stretch after prolonged sitting.

### 🖐️ Gesture Control
Control your computer without a mouse using intuitive hand gestures.

| Action | Gesture | Description |
| :--- | :--- | :--- |
| **Toggle Cursor** | **Fist → Peace** | Make a fist, then a peace sign to activate/deactivate the virtual cursor. |
| **Move Cursor** | **Peace Sign** | Move your hand while holding a peace sign to move the cursor. |
| **Click** | **Pinch** | Pinch your thumb and index finger quickly to click. |
| **Drag** | **Pinch (Hold)** | Pinch and hold to drag items. Release to drop. |
| **Switch Desktop** | **Swipe** | Swipe left or right with an open hand (when cursor is inactive). |
| **Task View** | **Fist → Open Hand** | Hold a fist, then open your hand to toggle Task View. |
| **Volume Control** | **Index Finger** | Place your index finger near your ear and move up/down to adjust volume. |

### 🖥️ Compact Mode
*   Switch to a minimalist "Compact Mode" to keep Birdy unobtrusive while you work.
*   Always-on-top floating window with essential controls.

## Prerequisites

1.  **Node.js**: [Download & Install](https://nodejs.org/)
2.  **Python 3.x**: [Download & Install](https://www.python.org/)

## Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/birdy.git
    cd birdy
    ```

2.  **Install Node.js dependencies**:
    ```bash
    npm install
    ```

3.  **Install Python dependencies**:
    ```bash
    pip install websockets pyautogui pycaw comtypes
    ```

## Usage

Birdy requires both the Python server (for system control) and the Electron app to be running.

1.  **Start the Python Server**:
    Open a terminal in the project directory and run:
    ```bash
    python server.py
    ```
    *Keep this terminal open.*

2.  **Start the Application**:
    Open a new terminal in the project directory and run:
    ```bash
    npm start
    ```

3.  **Calibration**:
    *   Sit in your normal working posture.
    *   Click the **"Calibrate"** button.
    *   Birdy will now monitor your posture relative to this baseline.

## Troubleshooting

*   **"Server not connected"**: Ensure `server.py` is running in a separate terminal.
*   **Gestures not working**: Make sure your hand is clearly visible to the camera. Good lighting helps!
*   **Cursor drifting**: Recalibrate by toggling the cursor off and on (Fist -> Peace).




