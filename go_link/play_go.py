"""Play a Go game using OmniLink tool calling.

The AI agent calls the ``make_move`` tool, which acts as a local Go
engine.  The model never sees the board -- it simply triggers the tool.
The tool evaluates the position, picks the best move, and relays it to
the 3D Go UI.

Usage
-----
    python -u play_go.py
"""

from __future__ import annotations

import pathlib
import sys
from typing import Any

# -- Path setup --------------------------------------------------------------
_HERE = str(pathlib.Path(__file__).resolve().parent)
LIB_PATH = str(pathlib.Path(__file__).resolve().parents[3] / "omnilink-lib" / "src")
if _HERE in sys.path:
    sys.path.remove(_HERE)
if LIB_PATH not in sys.path:
    sys.path.insert(0, LIB_PATH)

from omnilink.tool_runner import ToolRunner

if _HERE not in sys.path:
    sys.path.append(_HERE)

from go_api import place as server_place
from go_engine import (
    pick_move,
    apply_move,
    label_to_coord,
    stone_counts,
    territory_estimate,
)

# -- Constants ---------------------------------------------------------------
BOARD_SIZE = 19
KOMI = 6.5
LETTERS = "ABCDEFGHJKLMNOPQRST"
SYMBOLS = {0: ".", 1: "X", 2: "O"}


def _board_text(board: list[list[int]], n: int) -> str:
    lines = [f"   {' '.join(LETTERS[i] for i in range(n))}"]
    for y in range(n - 1, -1, -1):
        row = " ".join(SYMBOLS[board[y][x]] for x in range(n))
        lines.append(f"{y + 1:>2} {row}")
    return "\n".join(lines)


class GoRunner(ToolRunner):
    agent_name = "go-agent"
    display_name = "Go"
    tool_description = "Run the Go engine and place the next stone."
    poll_interval = 2.0
    memory_every = 10
    ask_every = 600

    def __init__(self) -> None:
        self._n = BOARD_SIZE
        self._board: list[list[int]] = [[0] * self._n for _ in range(self._n)]
        self._move_number = 0
        self._move_log: list[str] = []
        self._consecutive_passes = 0
        self._captures = {"black": 0, "white": 0}
        self._game_over = False
        self._last_printed_move = 0

    # -- ToolRunner hooks ----------------------------------------------------

    def get_state(self) -> dict[str, Any]:
        return {
            "board": self._board,
            "n": self._n,
            "move_number": self._move_number,
            "move_log": self._move_log,
            "consecutive_passes": self._consecutive_passes,
            "captures": self._captures,
            "game_over": self._game_over,
        }

    def execute_action(self, state: dict[str, Any]) -> None:
        n = self._n
        color = 1 if self._move_number % 2 == 0 else 2
        color_name = "Black" if color == 1 else "White"

        intersection = pick_move(self._board, color, n)

        if intersection is None:
            self._consecutive_passes += 1
            self._move_log.append(f"{color_name}: pass")
            self._move_number += 1
            print(f"  {self._move_number}. {color_name} passes")
            if self._consecutive_passes >= 2:
                print("  Both sides passed -- game over.")
                self._game_over = True
            return

        self._consecutive_passes = 0
        x, y = label_to_coord(intersection)
        caps = apply_move(self._board, x, y, color, n)
        if caps > 0:
            self._captures["black" if color == 1 else "white"] += caps

        self._move_number += 1
        self._move_log.append(f"{color_name}: {intersection}")

        # Relay to 3D UI.
        try:
            server_place(intersection, "black" if color == 1 else "white")
        except Exception as e:
            print(f"  [UI] Could not relay move: {e}")

        cap_str = f" (captures {caps})" if caps > 0 else ""
        print(f"  {self._move_number}. {color_name} {intersection}{cap_str}")

    def state_summary(self, state: dict[str, Any]) -> str:
        n = self._n
        counts = stone_counts(self._board, n)
        terr = territory_estimate(self._board, n)
        turn = "Black" if self._move_number % 2 == 0 else "White"
        black_score = counts["black"] + terr["black"]
        white_score = counts["white"] + terr["white"] + int(KOMI)

        if black_score > white_score + 5:
            advantage = f"Black leads by ~{black_score - white_score} points."
        elif white_score > black_score + 5:
            advantage = f"White leads by ~{white_score - black_score} points (incl. komi)."
        else:
            advantage = "The game is close."

        recent = self._move_log[-20:]
        return (
            f"Board size: {n}x{n}\n"
            f"Move {self._move_number} -- {turn} to play.\n"
            f"Stones -- Black: {counts['black']}, White: {counts['white']}\n"
            f"Territory -- Black: {terr['black']}, White: {terr['white']} (+{KOMI} komi)\n"
            f"Captures -- Black: {self._captures['black']}, White: {self._captures['white']}\n"
            f"{advantage}\n"
            f"Recent moves: {', '.join(recent)}"
        )

    def is_game_over(self, state: dict[str, Any]) -> bool:
        return self._game_over or self._move_number >= 600

    def game_over_message(self, state: dict[str, Any]) -> str:
        counts = stone_counts(self._board, self._n)
        terr = territory_estimate(self._board, self._n)
        black_total = counts["black"] + terr["black"]
        white_total = counts["white"] + terr["white"] + int(KOMI)
        if black_total > white_total:
            result = f"Black wins by ~{black_total - white_total} points."
        else:
            result = f"White wins by ~{white_total - black_total + 0.5:.1f} points."
        return f"GAME OVER -- {result}"

    def log_events(self, state: dict[str, Any]) -> None:
        if self._move_number % 10 == 0 and self._move_number != self._last_printed_move:
            self._last_printed_move = self._move_number
            print()
            print(_board_text(self._board, self._n))
            print()

    def on_start(self) -> None:
        print(_board_text(self._board, self._n))
        print()

    def get_review_instruction(self) -> dict[str, Any]:
        return {
            "mainTask": (
                f"Monitor Go game. If both sides passed, the board is mostly filled, "
                f"or one side has an overwhelming lead, output stop_game. "
                f"Otherwise call {self.tool_name}."
            ),
            "availableTools": self.tool_name,
            "availableToolDetails": [
                {"name": self.tool_name, "description": "Continue -- position still developing."},
            ],
            "availableCommands": self.commands,
            "allowToolUse": True,
        }


if __name__ == "__main__":
    GoRunner().run()
