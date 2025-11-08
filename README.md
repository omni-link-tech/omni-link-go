# Go3D

A minimal 3D Go board in React + Three.js using TypeScript. Features:
- 19/13/9 board sizes with star points
- Click to place stones, turn handling
- Basic captures + no-suicide rule
- Orbit/pan/zoom controls, soft shadows

## Setup

```bash
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
