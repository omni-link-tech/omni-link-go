import express from 'express';

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

const N = 19;
const LETTERS = 'ABCDEFGHJKLMNOPQRST'; // Go board columns (skip I)
let board = Array.from({ length: N }, () => Array(N).fill(0));

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

  board[y][x] = color;
  res.json({ ok: true });
});

app.post('/api/reset', (req, res) => {
  board = Array.from({ length: N }, () => Array(N).fill(0));
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Go API server running on port ${port}`);
});
