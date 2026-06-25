import type { PubSubAdapter } from './types';

export interface AdapterDef<TConn> {
  connect(): TConn | Promise<TConn>;
  publish(conn: TConn, channel: string, data: unknown): void | Promise<void>;
  subscribe(
    conn: TConn,
    channel: string,
    handler: (data: unknown) => void,
  ): void | Promise<void>;
  unsubscribe(conn: TConn, channel: string): void | Promise<void>;
  close(conn: TConn): void | Promise<void>;
}

export function defineAdapter<TConn>(def: AdapterDef<TConn>): PubSubAdapter {
  let connPromise: Promise<TConn> | null = null;

  const conn = (): Promise<TConn> => {
    if (!connPromise) connPromise = Promise.resolve(def.connect());
    return connPromise;
  };

  return {
    async publish(channel, data) {
      await def.publish(await conn(), channel, data);
    },
    subscribe(channel, handler) {
      void conn().then((c) => def.subscribe(c, channel, handler));
    },
    unsubscribe(channel) {
      void conn().then((c) => def.unsubscribe(c, channel));
    },
    async close() {
      if (!connPromise) return;
      await def.close(await connPromise);
      connPromise = null;
    },
  };
}
