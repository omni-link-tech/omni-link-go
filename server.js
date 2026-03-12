import express from 'express';
import mqtt from 'mqtt';

const app = express();
app.use(express.json());

// Basic CORS so the browser front-end can reach the API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

let N = 19;
const LETTERS = 'ABCDEFGHJKLMNOPQRST'; // Go board columns (skip I)
let board = Array.from({ length: N }, () => Array(N).fill(0));

function getNeighbors(x, y) {
  const n = [];
  if (x > 0) n.push([x - 1, y]);
  if (x < N - 1) n.push([x + 1, y]);
  if (y > 0) n.push([x, y - 1]);
  if (y < N - 1) n.push([x, y + 1]);
  return n;
}

function collectGroupAndLiberties(x, y, boardOverrideEmpty = null) {
  const color = board[y][x];
  if (color === 0) return { cells: new Set(), liberties: new Set() };

  const cells = new Set();
  const liberties = new Set();
  const stack = [[x, y]];
  cells.add(`${x},${y}`);

  while (stack.length > 0) {
    const [cx, cy] = stack.pop();
    for (const [nx, ny] of getNeighbors(cx, cy)) {
      const k = `${nx},${ny}`;
      const treatedEmpty = boardOverrideEmpty && boardOverrideEmpty.has(k);
      const val = treatedEmpty ? 0 : board[ny][nx];

      if (val === 0) {
        liberties.add(k);
      } else if (val === color && !cells.has(k)) {
        cells.add(k);
        stack.push([nx, ny]);
      }
    }
  }
  return { cells, liberties };
}

// --- MQTT SETUP ---
const mqttClient = mqtt.connect('ws://localhost:9001');

mqttClient.on('connect', () => {
  console.log("Connected to MQTT Broker via WebSockets for state publishing");
});

// Periodically publish state
setInterval(() => {
  if (mqttClient.connected) {
    // Calculate scores to include in the context
    let blackCount = 0;
    let whiteCount = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (board[y][x] === 1) blackCount++;
        if (board[y][x] === 2) whiteCount++;
      }
    }

    const gameState = {
      type: "state",
      board: board,
      score: { black: blackCount, white: whiteCount },
      turn: blackCount > whiteCount ? "white" : "black"
    };

    mqttClient.publish('olink/context', JSON.stringify(gameState), { qos: 0 });
  }
}, 20000); // 100ms publishing
// -----------------


app.get('/api/board', (req, res) => {
  res.json({ board });
});

app.post('/api/place', (req, res) => {
  const { intersection, color } = req.body;
  if (typeof intersection !== 'string' || ![1, 2].includes(color)) {
    return res.status(400).json({ error: 'invalid move' });
  }

  const letter = intersection[0]?.toUpperCase();
  const number = parseInt(intersection.slice(1), 10);
  const x = LETTERS.indexOf(letter);
  const y = number - 1;

  if (x === -1 || x >= N || isNaN(y) || y < 0 || y >= N) {
    return res.status(400).json({ error: 'invalid move' });
  }

  if (board[y][x] !== 0) {
    return res.status(400).json({ error: 'occupied' });
  }

  board[y][x] = color;
  const enemy = color === 1 ? 2 : 1;
  const capturedSet = new Set();

  for (const [nx, ny] of getNeighbors(x, y)) {
    if (board[ny][nx] === enemy) {
      const { cells, liberties } = collectGroupAndLiberties(nx, ny);
      if (liberties.size === 0) {
        cells.forEach(k => capturedSet.add(k));
      }
    }
  }

  const placedGroup = collectGroupAndLiberties(x, y, capturedSet);
  const suicide = placedGroup.liberties.size === 0 && capturedSet.size === 0;

  if (suicide) {
    board[y][x] = 0; // revert
    return res.status(400).json({ error: 'suicide' });
  }

  capturedSet.forEach(k => {
    const [cx, cy] = k.split(',').map(Number);
    board[cy][cx] = 0;
  });

  res.json({ ok: true, captures: capturedSet.size });
});

app.post('/api/reset', (req, res) => {
  const { size } = req.body || {};
  if (size && [9, 13, 19].includes(size)) {
    N = size;
  }
  board = Array.from({ length: N }, () => Array(N).fill(0));
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Go API server running on port ${port}`);
});
