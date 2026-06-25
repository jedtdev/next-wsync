export interface PubSubAdapter {
  publish(channel: string, data: unknown): Promise<void>;
  subscribe(channel: string, handler: (data: unknown) => void): void;
  unsubscribe(channel: string): void;
  close(): Promise<void>;
}
