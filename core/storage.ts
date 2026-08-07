// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MethodMap = Record<string, (...args: any[]) => unknown>;

export interface StorageMiddleware<TMethods extends MethodMap> {
  onCall?(method: keyof TMethods & string, args: unknown[]): void;
  onResult?(
    method: keyof TMethods & string,
    args: unknown[],
    result: unknown,
  ): void;
  onError?(
    method: keyof TMethods & string,
    args: unknown[],
    error: unknown,
  ): void;
}

function applyMiddleware<TMethods extends MethodMap>(
  methods: TMethods,
  mw: StorageMiddleware<TMethods>,
): TMethods {
  const wrapped: Record<string, (...args: unknown[]) => unknown> = {};
  for (const key of Object.keys(methods) as Array<keyof TMethods & string>) {
    wrapped[key] = (...args: unknown[]) => {
      mw.onCall?.(key, args);
      let result: unknown;
      try {
        result = methods[key](...args);
      } catch (err) {
        mw.onError?.(key, args, err);
        throw err;
      }
      if (result instanceof Promise) {
        return result.then(
          (r) => {
            mw.onResult?.(key, args, r);
            return r;
          },
          (err) => {
            mw.onError?.(key, args, err);
            throw err;
          },
        );
      }
      mw.onResult?.(key, args, result);
      return result;
    };
  }
  return wrapped as TMethods;
}

// ── StorageInstance ───────────────────────────────────────────

export interface StorageInstance<
  TName extends string,
  TStore,
  TMethods extends MethodMap,
> {
  readonly storeName: TName;
  readonly store: TStore;
  readonly methods: TMethods;
  clone<TNewName extends string = TName>(
    name?: TNewName,
  ): StorageInstance<TNewName, TStore, TMethods>;
  ref<TNewName extends string = TName>(
    name?: TNewName,
  ): StorageInstance<TNewName, TStore, TMethods>;
}

type StoreInit<TStore> = TStore | (() => TStore);

export function storage<
  TName extends string,
  TStore,
  TMethods extends MethodMap,
>(
  name: TName,
  options: {
    store: StoreInit<TStore>;
    methods: (store: TStore) => TMethods;
    middleware?: StorageMiddleware<TMethods>;
  },
): StorageInstance<TName, TStore, TMethods> {
  const storeInit: () => TStore =
    typeof options.store === 'function'
      ? (options.store as () => TStore)
      : () => options.store as TStore;

  const storeValue = storeInit();
  const rawMethods = options.methods(storeValue);
  const methods = options.middleware
    ? applyMiddleware(rawMethods, options.middleware)
    : rawMethods;

  return {
    storeName: name,
    store: storeValue,
    methods,
    clone<TNewName extends string = TName>(newName?: TNewName) {
      return storage((newName ?? name) as TNewName, {
        store: storeInit,
        methods: options.methods,
        middleware: options.middleware,
      });
    },
    ref<TNewName extends string = TName>(newName?: TNewName) {
      return storage((newName ?? name) as TNewName, {
        store: storeValue,
        methods: options.methods,
        middleware: options.middleware,
      });
    },
  };
}

export function redisStorage<
  TName extends string,
  TRedisClient,
  TMethods extends MethodMap = Record<never, never>,
>(
  name: TName,
  redisClient: TRedisClient,
  methods?: (redis: TRedisClient) => TMethods,
  middleware?: StorageMiddleware<TMethods>,
): StorageInstance<TName, TRedisClient, TMethods> {
  return storage(name, {
    store: redisClient,
    methods: methods ?? (() => ({}) as TMethods),
    middleware,
  });
}

export type InferStores<T> = T extends StorageInstance<
  string,
  unknown,
  MethodMap
>[]
  ? { [K in T[number] as K['storeName']]: K['methods'] }
  : Record<never, never>;
