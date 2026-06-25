"use client";

import { GameLobby } from "@/components/custom/game-lobby";

export default function TttLobbyPage() {
  return <GameLobby game="tictactoe" basePath="/play/tic-tac-toe" title="Tic-Tac-Toe" />;
}
