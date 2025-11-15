# Go3D

A minimal 3D Go board in React + Three.js using TypeScript. Features:
- 19/13/9 board sizes with star points
- Click to place stones, turn handling
- Basic captures + no-suicide rule
- Orbit/pan/zoom controls, soft shadows

## Setup

```bash
# 1. Clone the repository and navigate into the folder
git clone https://github.com/omni-link-tech/omni-link-go.git
cd omni-link-go

# 2. Install JavaScript dependencies and start the dev server
npm install
npm run dev
```

## API

A simple Express server is included to allow external scripts to place stones on a 19x19 board.

Run the server:

```bash
npm run server
```

### Endpoints

- `POST /api/place` – body `{ "intersection": "D5", "color": 1 }` (`color` 1=black, 2=white)
  - Intersections use labels like `A1` (top-left) to `T19` (bottom-right), skipping `I`.
- `GET /api/board` – returns current board state
- `POST /api/reset` – clears the board

### Python example

An example client is in `scripts/place_stone.py` and uses `requests`:

```bash
pip install requests
python scripts/place_stone.py
```

This places a black stone at intersection `D5`.

## Requirements

- Node.js (18+): Required for the frontend and game server.
- npm: Used for dependency management.
- Python 3.9+
- Mosquitto MQTT Broker: Must be installed and configured for WebSockets.

## Installation

Clone the repository and install all language dependencies:

```bash
# 1. Clone the repository and navigate into the folder
git clone https://github.com/omni-link-tech/omni-link-go.git
cd omni-link-go

# 2. Install JavaScript dependencies for the UI and Game Server
npm install

# 3. Install Python dependencies for the OmniLink Bridge (Note: Bridge files are in go_link/)
pip install requests paho-mqtt omnilink-lib
```

## Definitive Setup Guide

This setup requires three persistent processes running in separate terminal windows (T1, T2, T3).

### Step 1: Configure and Start the MQTT Broker

The setup is CRITICAL and requires WebSockets on port 9001 with anonymous access.

Stop Service: Ensure no existing service is blocking the port.

```bash
sudo systemctl stop mosquitto.service
```

Edit Configuration: Open the Mosquitto configuration file.

```bash
sudo nano /etc/mosquitto/mosquitto.conf
```

Add/Verify Configuration: Add the following lines to enable the required protocol and port, and to prevent the authentication error (rc=5).

```
# Allows connection without credentials (CRITICAL for local testing)
allow_anonymous true 

# WebSockets listener (Must match OmniLink UI and Python Bridge)
listener 9001
protocol websockets
```

Start Broker: Start the service to load the new configuration.

```bash
sudo systemctl start mosquitto.service
```

(Terminal 2): The broker is now correctly configured and running.

### Step 2: Start the Go Server (JavaScript UI & State)

The UI and the API server must be launched simultaneously.

T1:
- `npm run dev` — Starts the Vite development server (UI) on http://localhost:5173.
- `npm run server` — Must be run separately. This launches the Express server that handles the /api/place commands.

CRITICAL NOTE: You must run both `npm run dev` and `npm run server` for the demo to work, often requiring a concurrent manager like `concurrently` (or two separate terminal windows for T1).

### Step 3: Launch the OmniLink Python Bridge

The Python script receives commands via MQTT and sends HTTP requests to the Go Server.

T3:
```bash
export MQTT_TRANSPORT=websockets    # Ensures the Python client connects via WebSockets.
export HUSKY_API_URL=http://127.0.0.1:5000   # (If required by the link script's internal logic).
cd go_link/    # CRITICAL: Navigate to the folder containing the bridge script (link.py or similar).
python link.py    # Launches the OmniLink bridge.
```

Verification: A successful connection will show: `[OmniLinkMQTT] Connected localhost:9001... Subscribed to olink/commands.`

## OmniLink Agent Configuration

You must configure the OmniLink Agent UI to recognize the Go game commands.

1. Connection Settings

In the OmniLink UI, verify the following:

- BROKER URL: `ws://localhost:9001`
- Command Topic: `olink/commands`

2. Command Templates (CRITICAL Syntax)

The core command is `place_stone_at_[location]`. Use the specific color variable structure.

- Main Task: You are a Go game coach. You help users play Go. You can place stones on the board.
- Available Commands: `place_[color]_stone_at_[location]`
- Custom Instructions: Locations are typically two characters, like `D5` or `K10`. When placing a stone, confirm the color is either `black` or `white`.

## Usage and Verification

- Open the frontend UI at http://localhost:5173.
- Issue a command in the OmniLink UI (voice or text): "Place a black stone at D5."

Verification:

- T3 (Bridge): Logs the received command string (e.g., `place_black_stone_at_D5`).
- Go Board UI: A black stone should appear at the intersection D5.
