import { describe, expect, it, vi } from 'vitest';
import { storage } from '../core/storage';

describe('storage()', () => {
  describe('basic store', () => {
    it('exposes storeName', () => {
      const s = storage('myStore', {
        store: { count: 0 },
        methods: (store) => ({
          increment() {
            store.count += 1;
          },
          get() {
            return store.count;
          },
        }),
      });

      expect(s.storeName).toBe('myStore');
    });

    it('exposes the raw store value', () => {
      const s = storage('test', {
        store: { items: [] as string[] },
        methods: (_store) => ({}),
      });

      expect(s.store).toEqual({ items: [] });
    });

    it('methods mutate store state', () => {
      const s = storage('counter', {
        store: { count: 0 },
        methods: (store) => ({
          increment() {
            store.count += 1;
          },
          get() {
            return store.count;
          },
        }),
      });

      s.methods.increment();
      s.methods.increment();
      expect(s.methods.get()).toBe(2);
    });

    it('supports factory function for store', () => {
      const s = storage('factory', {
        store: () => ({ value: 42 }),
        methods: (store) => ({
          get() {
            return store.value;
          },
        }),
      });

      expect(s.methods.get()).toBe(42);
    });
  });

  describe('middleware', () => {
    it('onCall is called before each method', () => {
      const onCall = vi.fn();
      const s = storage('mw', {
        store: { count: 0 },
        methods: (store) => ({
          increment() {
            store.count += 1;
          },
        }),
        middleware: { onCall },
      });

      s.methods.increment();
      expect(onCall).toHaveBeenCalledWith('increment', []);
    });

    it('onResult is called after each synchronous method', () => {
      const onResult = vi.fn();
      const s = storage('mw', {
        store: { count: 0 },
        methods: (store) => ({
          increment() {
            store.count += 1;
            return store.count;
          },
        }),
        middleware: { onResult },
      });

      s.methods.increment();
      expect(onResult).toHaveBeenCalledWith('increment', [], 1);
    });

    it('onResult receives resolved value for async methods', async () => {
      const onResult = vi.fn();
      const s = storage('mw', {
        store: { count: 0 },
        methods: (store) => ({
          async increment() {
            store.count += 1;
            return store.count;
          },
        }),
        middleware: { onResult },
      });

      await s.methods.increment();
      expect(onResult).toHaveBeenCalledWith('increment', [], 1);
    });

    it('onError is called when method throws synchronously', () => {
      const onError = vi.fn();
      const s = storage('mw', {
        store: {},
        methods: () => ({
          boom() {
            throw new Error('sync error');
          },
        }),
        middleware: { onError },
      });

      expect(() => s.methods.boom()).toThrow('sync error');
      expect(onError).toHaveBeenCalledWith(
        'boom',
        [],
        expect.any(Error),
      );
    });

    it('onError is called when async method rejects', async () => {
      const onError = vi.fn();
      const s = storage('mw', {
        store: {},
        methods: () => ({
          async boom() {
            throw new Error('async error');
          },
        }),
        middleware: { onError },
      });

      await expect(s.methods.boom()).rejects.toThrow('async error');
      expect(onError).toHaveBeenCalledWith(
        'boom',
        [],
        expect.any(Error),
      );
    });

    it('passes args to onCall and onResult', () => {
      const onCall = vi.fn();
      const onResult = vi.fn();
      const s = storage('mw', {
        store: {},
        methods: () => ({
          add(a: number, b: number) {
            return a + b;
          },
        }),
        middleware: { onCall, onResult },
      });

      s.methods.add(3, 4);
      expect(onCall).toHaveBeenCalledWith('add', [3, 4]);
      expect(onResult).toHaveBeenCalledWith('add', [3, 4], 7);
    });
  });

  describe('clone()', () => {
    it('creates a new instance with fresh state', () => {
      const s = storage('original', {
        store: () => ({ count: 0 }),
        methods: (store) => ({
          increment() {
            store.count += 1;
          },
          get() {
            return store.count;
          },
        }),
      });

      s.methods.increment();
      const cloned = s.clone();

      expect(cloned.methods.get()).toBe(0);
      expect(s.methods.get()).toBe(1);
    });

    it('clone accepts a new name', () => {
      const s = storage('original', {
        store: { x: 1 },
        methods: (_store) => ({}),
      });

      const cloned = s.clone('renamed');
      expect(cloned.storeName).toBe('renamed');
    });

    it('clone without new name keeps the same storeName', () => {
      const s = storage('myStore', {
        store: { x: 1 },
        methods: (_store) => ({}),
      });

      const cloned = s.clone();
      expect(cloned.storeName).toBe('myStore');
    });
  });

  describe('ref()', () => {
    it('shares the same underlying state', () => {
      const s = storage('shared', {
        store: { count: 0 },
        methods: (store) => ({
          increment() {
            store.count += 1;
          },
          get() {
            return store.count;
          },
        }),
      });

      const refInstance = s.ref();

      s.methods.increment();
      expect(refInstance.methods.get()).toBe(1);

      refInstance.methods.increment();
      expect(s.methods.get()).toBe(2);
    });

    it('ref accepts a new name', () => {
      const s = storage('original', {
        store: { x: 1 },
        methods: (_store) => ({}),
      });

      const r = s.ref('alias');
      expect(r.storeName).toBe('alias');
    });

    it('ref without new name keeps storeName', () => {
      const s = storage('myStore', {
        store: { x: 1 },
        methods: (_store) => ({}),
      });

      const r = s.ref();
      expect(r.storeName).toBe('myStore');
    });
  });
});
