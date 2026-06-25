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
