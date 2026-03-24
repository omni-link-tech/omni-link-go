"""Local Go engine — heuristic-based move selection.

This module is the ``make_move`` tool: given a board position it picks
the best move using capture priority, influence scoring, and pattern
heuristics.  Go's branching factor makes minimax impractical, so we
use a weighted heuristic evaluation instead.
"""

from __future__ import annotations

import random
from typing import Optional

# Go board column labels (skip I, standard convention).
LETTERS = "ABCDEFGHJKLMNOPQRST"


# ── Board helpers ─────────────────────────────────────────────────────

def neighbors(x: int, y: int, n: int) -> list[tuple[int, int]]:
    """Return orthogonal neighbors of (x, y) on an NxN board."""
    out: list[tuple[int, int]] = []
    if x > 0:
        out.append((x - 1, y))
    if x < n - 1:
        out.append((x + 1, y))
    if y > 0:
        out.append((x, y - 1))
    if y < n - 1:
        out.append((x, y + 1))
    return out


def collect_group(
    board: list[list[int]], x: int, y: int, n: int,
    override_empty: set[str] | None = None,
) -> tuple[set[str], set[str]]:
    """Flood-fill to find group cells and liberties for the stone at (x, y)."""
    color = board[y][x]
    if color == 0:
        return set(), set()
    cells: set[str] = set()
    liberties: set[str] = set()
    stack = [(x, y)]
    cells.add(f"{x},{y}")
    while stack:
        cx, cy = stack.pop()
        for nx, ny in neighbors(cx, cy, n):
            k = f"{nx},{ny}"
            treated = override_empty and k in override_empty
            val = 0 if treated else board[ny][nx]
            if val == 0:
                liberties.add(k)
            elif val == color and k not in cells:
                cells.add(k)
                stack.append((nx, ny))
    return cells, liberties


def is_legal(
    board: list[list[int]], x: int, y: int, color: int, n: int,
) -> tuple[bool, int]:
    """Check if placing *color* at (x, y) is legal.

    Returns (legal, captures) where captures is the number of enemy
    stones that would be removed.
    """
    if board[y][x] != 0:
        return False, 0

    # Temporarily place.
    board[y][x] = color
    enemy = 3 - color
    captured: set[str] = set()

    for nx, ny in neighbors(x, y, n):
        if board[ny][nx] == enemy:
            cells, libs = collect_group(board, nx, ny, n)
            if len(libs) == 0:
                captured |= cells

    # Check suicide.
    _, own_libs = collect_group(board, x, y, n, override_empty=captured)
    suicide = len(own_libs) == 0 and len(captured) == 0

    board[y][x] = 0  # revert
    if suicide:
        return False, 0
    return True, len(captured)


def apply_move(
    board: list[list[int]], x: int, y: int, color: int, n: int,
) -> int:
    """Place a stone and remove captures.  Returns number of captures."""
    board[y][x] = color
    enemy = 3 - color
    total = 0
    for nx, ny in neighbors(x, y, n):
        if board[ny][nx] == enemy:
            cells, libs = collect_group(board, nx, ny, n)
            if len(libs) == 0:
                for k in cells:
                    cx, cy = map(int, k.split(","))
                    board[cy][cx] = 0
                total += len(cells)
    return total


def coord_to_label(x: int, y: int) -> str:
    """Convert (x, y) grid coordinates to Go intersection label like 'D5'."""
    return f"{LETTERS[x]}{y + 1}"


def label_to_coord(label: str) -> tuple[int, int]:
    """Convert intersection label like 'D5' to (x, y) grid coordinates."""
    col = LETTERS.index(label[0].upper())
    row = int(label[1:]) - 1
    return col, row


# ── Evaluation & move selection ───────────────────────────────────────

def _distance_to_center(x: int, y: int, n: int) -> float:
    cx, cy = (n - 1) / 2, (n - 1) / 2
    return abs(x - cx) + abs(y - cy)


def _influence_near_stones(
    board: list[list[int]], x: int, y: int, color: int, n: int,
) -> float:
    """Score bonus for playing near friendly stones (connectivity)."""
    score = 0.0
    for nx, ny in neighbors(x, y, n):
        if board[ny][nx] == color:
            score += 3.0
        elif board[ny][nx] == 3 - color:
            score += 1.0  # contact plays can be useful
    return score


def _atari_rescue_score(
    board: list[list[int]], x: int, y: int, color: int, n: int,
) -> float:
    """High score if this move saves a friendly group in atari."""
    score = 0.0
    for nx, ny in neighbors(x, y, n):
        if board[ny][nx] == color:
            _, libs = collect_group(board, nx, ny, n)
            if len(libs) == 1:
                score += 15.0  # urgent — save the group
    return score


def _edge_penalty(x: int, y: int, n: int) -> float:
    """Penalise first/second line moves in the opening."""
    penalty = 0.0
    if x == 0 or x == n - 1 or y == 0 or y == n - 1:
        penalty += 3.0
    if x == 1 or x == n - 2 or y == 1 or y == n - 2:
        penalty += 1.0
    return penalty


def score_move(
    board: list[list[int]], x: int, y: int, color: int, n: int,
    captures: int,
) -> float:
    """Heuristic score for a candidate move (higher = better)."""
    score = 0.0

    # Captures are very valuable.
    score += captures * 10.0

    # Saving groups in atari.
    score += _atari_rescue_score(board, x, y, color, n)

    # Connectivity / influence.
    score += _influence_near_stones(board, x, y, color, n)

    # Prefer centre, penalise edges.
    max_dist = (n - 1)
    score += (max_dist - _distance_to_center(x, y, n)) * 0.3
    score -= _edge_penalty(x, y, n)

    # Small random jitter to avoid repetitive play.
    score += random.random() * 1.5

    return score


def pick_move(
    board: list[list[int]], color: int, n: int = 19,
) -> Optional[str]:
    """Pick the best move for *color* (1=black, 2=white).

    Returns an intersection label like ``'D5'``, or ``None`` if the
    engine chooses to pass (no good moves).
    """
    candidates: list[tuple[float, str]] = []

    for y in range(n):
        for x in range(n):
            legal, caps = is_legal(board, x, y, color, n)
            if not legal:
                continue
            s = score_move(board, x, y, color, n, caps)
            candidates.append((s, coord_to_label(x, y)))

    if not candidates:
        return None  # pass

    # Sort descending and pick from top candidates with some randomness.
    candidates.sort(key=lambda t: -t[0])
    top = candidates[: max(1, len(candidates) // 10)]
    return random.choice(top)[1]


def stone_counts(board: list[list[int]], n: int) -> dict[str, int]:
    """Count stones on the board."""
    black = white = 0
    for y in range(n):
        for x in range(n):
            if board[y][x] == 1:
                black += 1
            elif board[y][x] == 2:
                white += 1
    return {"black": black, "white": white}


def territory_estimate(board: list[list[int]], n: int) -> dict[str, int]:
    """Simple territory estimate via flood-fill of empty regions."""
    visited = [[False] * n for _ in range(n)]
    result = {"black": 0, "white": 0}

    for y in range(n):
        for x in range(n):
            if board[y][x] != 0 or visited[y][x]:
                continue
            stack = [(x, y)]
            visited[y][x] = True
            region: list[tuple[int, int]] = []
            borders: set[int] = set()
            while stack:
                cx, cy = stack.pop()
                region.append((cx, cy))
                for nx, ny in neighbors(cx, cy, n):
                    v = board[ny][nx]
                    if v == 0 and not visited[ny][nx]:
                        visited[ny][nx] = True
                        stack.append((nx, ny))
                    elif v != 0:
                        borders.add(v)
            if len(borders) == 1:
                owner = borders.pop()
                key = "black" if owner == 1 else "white"
                result[key] += len(region)

    return result
