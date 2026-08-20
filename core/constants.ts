// ── Internal symbols ──────────────────────────────────────────
const $emit: unique symbol = Symbol('ws.emit');
const $receive: unique symbol = Symbol('ws.receive');
const $channel: unique symbol = Symbol('ws.channel');
const $cron: unique symbol = Symbol('ws.cron');
const $router: unique symbol = Symbol('ws.router');

export const symbols = Object.freeze({
  channel: $channel,
  cron: $cron,
  emit: $emit,
  receive: $receive,
  router: $router,
} as const);

// ── WebSocket close codes (RFC 6455 sec. 7.4) ────────────────────
// 1005, 1006, 1015 are reserved — they describe how a connection ended
// but can never be sent in an actual close frame.
export enum CloseCode {
  Normal = 1000,
  GoingAway = 1001,
  ProtocolError = 1002,
  UnsupportedData = 1003,
  InvalidFramePayloadData = 1007,
  PolicyViolation = 1008,
  MessageTooBig = 1009,
  MandatoryExtension = 1010,
  InternalError = 1011,
  ServiceRestart = 1012,
  TryAgainLater = 1013,
  BadGateway = 1014,
  Unauthorized = 3000,
  Forbidden = 3003,
  Timeout = 3008,
}
