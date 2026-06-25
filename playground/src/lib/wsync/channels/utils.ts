export interface Matchmaker {
  matchmake(): string;
  release(roomId: string): void;
}

export function createMatchmaker(opts: {
  roomIds: () => Iterable<string>;
  filled: (roomId: string) => number;
  newRoomId?: () => string;
  ttl?: number;
}): Matchmaker {
  const ttl = opts.ttl ?? 10_000;
  const reservations = new Map<string, { n: number; exp: number }>();
  const newRoomId = opts.newRoomId ?? (() => Math.random().toString(36).slice(2, 8));

  function active(roomId: string): number {
    const r = reservations.get(roomId);
    if (!r) return 0;
    if (r.exp <= Date.now()) { reservations.delete(roomId); return 0; }
    return r.n;
  }

  function reserve(roomId: string): void {
    const now = Date.now();
    const r = reservations.get(roomId);
    if (!r || r.exp <= now) reservations.set(roomId, { n: 1, exp: now + ttl });
    else { r.n++; r.exp = now + ttl; }
  }

  return {
    matchmake() {
      const seen = new Set<string>();
      for (const id of opts.roomIds()) {
        seen.add(id);
        const f = opts.filled(id);
        if (f < 2 && f + active(id) === 1) { reserve(id); return id; }
      }
      for (const id of reservations.keys()) {
        if (seen.has(id)) continue;
        if (active(id) === 1) { reserve(id); return id; }
      }
      const id = newRoomId();
      reserve(id);
      return id;
    },
    release(roomId) {
      const r = reservations.get(roomId);
      if (!r) return;
      r.n = Math.max(0, r.n - 1);
      if (r.n <= 0) reservations.delete(roomId);
    },
  };
}
