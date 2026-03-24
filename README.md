# OmniLink Go Demo

A 3D Go game powered by a local heuristic engine, orchestrated through the
OmniLink platform via **tool calling**.  The AI agent never sees the board — it
simply calls the `make_move` tool, which runs a local Go engine that picks
the best move and relays it to a React Three.js 3D board in real time.

This demo showcases four core OmniLink features:

| Feature | How it is used |
|---|---|
| **Tool Calling** | Agent calls `make_move` — the platform forwards execution to the local engine |
| **Commands** | Agent outputs `Command: stop_game` to end the game early |
| **Short-Term Memory** | Game state (stones, territory, moves) is saved after every move so the agent can answer questions |
| **Chat API** | The agent can be asked about the game state at any time from the OmniLink UI |

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or later |
| Python | 3.9 or later |
| OmniKey | Sign up at https://www.omnilink-agents.com |

Python packages:

```
pip install requests
```

The OmniLink Python client (`omnilink-lib`) must be available on your
`PYTHONPATH`.  The script auto-adds `../../omnilink-lib/src` to `sys.path`,
so the default repo layout works out of the box.

---

## Quick Start

You need **three terminals**, or use two if you combine the server and UI.

### 1. Install dependencies

```bash
cd omnilink-go
npm install
```

### 2. Start the Go server (Terminal 1)

```bash
npm run server
```

Starts the Express API on **http://localhost:3000**.
Handles move validation, captures, and board state.

### 3. Start the 3D board UI (Terminal 2)

```bash
npm run dev
```

Opens the Vite dev server at **http://localhost:5173**.
Open this URL in your browser to watch the game live.

### 4. Run the game (Terminal 3)

```bash
cd go_link
python -u play_go.py
```

The `-u` flag disables output buffering so you see moves printed in real time.

### 5. Watch and interact

- **Browser** — Open http://localhost:5173 to see stones placed on the 3D board.
- **OmniLink UI** — Log in at https://www.omnilink-agents.com, find the
  agent profile, and chat with it.  Ask things like *"Who is winning?"*
  or *"How many stones has each side captured?"* — the agent has the
  current game state in memory.
- **Stop the game** — Type *"stop the game"* in the OmniLink UI.  The agent
  will output `Command: stop_game`, which the script detects on the next move
  and ends the game.

---

## Configuration

All settings are at the top of `go_link/play_go.py`:

```python
BASE_URL   = "https://www.omnilink-agents.com"  # OmniLink platform URL
OMNI_KEY   = "olink_..."                         # Your OmniKey
AGENT_NAME = "chess-agent"                       # Agent profile name (reuses free-plan slot)
ENGINE     = "g2-engine"                         # AI engine (see below)
BOARD_SIZE = 19           # 9, 13, or 19
MAX_MOVES  = 300          # Max moves per side before stopping
MOVE_DELAY = 2            # Seconds between moves (for UI animation)
ASK_EVERY  = 20           # Agent reviews the position every N total moves
```

### Available Engines

| Engine | Model |
|---|---|
| `g1-engine` | Gemini |
| `g2-engine` | GPT-5 |
| `g3-engine` | Grok |
| `g4-engine` | Claude |

### Free Plan Limits

- **1 agent profile** — the script reuses the existing profile slot.
- **Monthly credit cap** — the tool-calling architecture minimises API usage:
  1 call to kick off the game + 1 review call every 20 moves.

---

## How It Works

### Architecture

```
+---------------------+       +--------------------+       +------------------+
|   OmniLink Cloud    |       |   Express Server   |       |   Browser        |
|   Chat + Memory +   |       |   localhost:3000    |       |   localhost:5173  |
|   Tool Calling      |       |   Go rules + API    |       |   React Three.js |
+---------------------+       |                    |       |   3D Go board     |
        ^                     +--------------------+       +------------------+
        |  REST API                  ^                            ^
        v                           |  HTTP POST                 |  Polling
+---------------------+             |                            |
|  play_go.py          |-------------+----------------------------+
|  + go_engine.py      |  relay_to_ui() sends moves to server
|  + go_api.py         |  UI polls server every 1s for updates
|  + OmniLinkClient    |
+---------------------+
```

### Game Loop

```
1. Kick off            One API call: agent calls Tool: make_move
                       This confirms the agent is connected. The local
                       engine then takes over.

2. Engine picks move   go_engine.pick_move() evaluates all legal moves
                       using heuristics: capture priority, atari rescue,
                       influence near existing stones, centre preference,
                       and edge penalty.

3. Apply locally       The move is applied to the local board state,
                       captures are resolved, and the move is logged.

4. Relay to UI         relay_to_ui() sends an HTTP POST to the Go server:
                       {"intersection": "D5", "color": 1}
                       The 3D UI polls the server every 1s and renders
                       new stones.

5. Check for UI stop   check_memory_for_stop() reads the agent's memory
                       via get_memory(). If the user typed "stop" in the
                       OmniLink UI, the agent's response contains
                       "Command: stop_game" — the script detects this
                       and breaks out of the loop.

6. Save to memory      set_memory() writes stone counts, territory
                       estimate, and recent moves to the agent's
                       short-term memory so it can answer questions.

7. Agent review        Every ASK_EVERY moves, the script asks the agent
   (periodic)          to review the position. The agent either:
                       - Calls Tool: make_move → game continues
                       - Outputs Command: stop_game → game ends

8. Sleep & repeat      Waits MOVE_DELAY seconds, then back to step 2.
```

### Stopping the Game

There are four ways the game can end:

| Method | How |
|---|---|
| **Both sides pass** | The engine passes when no good moves remain; two consecutive passes end the game |
| **Move limit** | The game stops after `MAX_MOVES * 2` total moves |
| **Agent review** | Every 20 moves the agent evaluates the position and can output `Command: stop_game` |
| **User via OmniLink UI** | Type "stop the game" in the chat — the agent responds with `Command: stop_game`, which the script detects on the next move |

### Scoring

The game uses **area scoring** (Chinese rules):
- **Stones** on the board count for their owner
- **Territory** is estimated via flood-fill of empty regions bordered by a single colour
- **Komi**: White receives 6.5 points compensation for going second

### OmniLink Tool Calling

Tools are defined in the `system_instruction` passed to `client.chat()`:

```python
system_instruction = {
    "mainTask": "You are a Go game coordinator...",
    "availableTools": "make_move",
    "availableToolDetails": [
        {
            "name": "make_move",
            "description": "Runs the Go engine and places the next stone.",
        },
    ],
    "availableCommands": "stop_game",
    "allowToolUse": True,
}
```

The model responds in this format:

```
Command: none
Response: I'll play the next move.
Tool: make_move
```

- **Tools** appear in the `Tool:` line — they trigger external execution.
- **Commands** appear in the `Command:` line — they signal intent (like `stop_game`).
- `Command: none` means no command was issued.

---

## Key Files

| File | Description |
|---|---|
| `go_link/play_go.py` | Main game script — OmniLink integration, game loop, memory sync |
| `go_link/go_engine.py` | Local Go engine — heuristic move selection, capture logic, territory estimation |
| `go_link/go_api.py` | HTTP API to place stones on the board (`place(intersection, color)`) |
| `server.js` | Express backend — Go rules, REST API (`/api/place`, `/api/board`, `/api/reset`) |
| `src/Go3D.tsx` | React Three.js frontend — 3D board visualisation |

---

## OmniLink Python Client — Quick Reference

```python
from omnilink.client import OmniLinkClient

client = OmniLinkClient(
    omni_key="olink_...",
    base_url="https://www.omnilink-agents.com",
)

# Chat with tool calling
result = client.chat(
    "Play a Go game. Call the make_move tool.",
    agent_name="go-agent",
    engine="g2-engine",
    system_instruction={
        "mainTask": "You are a Go coordinator.",
        "availableTools": "make_move",
        "availableToolDetails": [{"name": "make_move", "description": "..."}],
        "allowToolUse": True,
    },
    temperature=0.0,
)
print(result["text"])

# Save game state to memory
client.set_memory("go-agent", [
    {"role": "user",  "parts": [{"text": "Current game state..."}]},
    {"role": "model", "parts": [{"text": "Stones — Black: 45, White: 42..."}]},
])

# Read memory (e.g. to check for a stop flag)
memory = client.get_memory("go-agent")

# Clear memory before a new game
client.clear_memory("go-agent")
```

---

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `429: Monthly usage limit exceeded` | OmniKey credits exhausted | Wait for monthly reset or upgrade plan |
| `403: PROFILE_LIMIT_REACHED` | Free plan allows only 1 profile | Reuse an existing profile name |
| `ModuleNotFoundError: omnilink` | Python can't find the library | Ensure `omnilink-lib/src` is on your `PYTHONPATH`, or use the default repo layout |
| Stones don't appear on the 3D board | Go server not running | Start it with `npm run server` first |
| 3D UI not loading | Vite dev server not running | Start it with `npm run dev` |
| Board shows a stale game | Previous game still loaded | Reset: `curl -X POST http://localhost:3000/api/reset -H "Content-Type: application/json"` |
| No output from `play_go.py` | Buffered stdout | Use `python -u` (unbuffered) |
| Stop from UI doesn't work | Typed after memory was overwritten | Try again — the script checks memory before each overwrite |
| `400: suicide` from server | Engine tried an illegal move | Should not happen; the engine validates locally first |
