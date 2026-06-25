import { wsync } from "next-wsync";
import {
  rpsChannel,
  ticTacToeChannel,
  drawingChannel,
  chatChannel,
  cursorChannel,
  presenceChannel,
  roomsChannel,
  leaderboardChannel,
} from "./channels";

export const api = wsync([
  rpsChannel,
  ticTacToeChannel,
  drawingChannel,
  chatChannel,
  cursorChannel,
  presenceChannel,
  roomsChannel,
  leaderboardChannel,
]);
