"use client";

import { GameLobby } from "@/components/custom/game-lobby";

export default function RpsLobbyPage() {
  return <GameLobby game="rps" basePath="/play/rock-paper-scissors" title="Rock Paper Scissors" showBestOf />;
}
