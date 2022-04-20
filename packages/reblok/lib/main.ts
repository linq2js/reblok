import { useEffect, useRef, useState } from "react";
import {
  Actions,
  Blok,
  BlokOptions,
  ConcurrentController,
  ConcurrentMode,
  Create,
  DehydratedDataCollection,
  Emitter,
  ExtraActions,
  Family,
  FamilyOptions,
  Hydration,
  HydrationOptions,
  LinkedBlokOptions,
  Selector,
  UpdateContext,
  UpdateData,
  Updater,
} from "./types";

export * from "./types";

let mutationCount = 0;
let batchChanges = new Set<VoidFunction>();

/**
 * perform mutation of multiple bloks, when the mutation done, all change notifications are triggered
 * @param mutation
 * @returns
 */
export const batch = <T extends Function>(mutation: T): T => {
  return ((...args: any[]) => {
    try {
      if (!mutationCount) {
        batchChanges = new Set();
      }
      mutationCount++;
      return mutation(...args);
    } finally {
      mutationCount--;
      if (!mutationCount) {
        for (const x of batchChanges) {
          x();
        }
      }
    }
  }) as unknown as T;
};

export function createEmitter(): Emitter {
  const handlers: Function[] = [];
  let indexesChanged = {};
  return {
    each(callback) {
      for (const handler of handlers) {
        callback(handler);
      }
    },
    add(handler) {
      const initialIndex = handlers.length;
      const initialToken = indexesChanged;
      handlers.push(handler);
      let active = true;
      return () => {
        if (!active) return;
        const index =
          initialToken === indexesChanged
            ? initialIndex
            : handlers.indexOf(handler);
        if (index !== -1) {
          indexesChanged = {};
          handlers.splice(index, 1);
        }
      };
    },
    emit(payload) {
      for (const handler of handlers.slice(0)) {
        handler(payload);
      }
    },
    clear() {
      handlers.length = 0;
    },
  };
}

const testDate = new Date();
const testArray = new Array<any>();
export function shallow(a: any, b: any) {
  if (a === b) return true;
  // handle falsy
  if ((a && !b) || (b && !a)) return false;
  if (!a && !b) return false;
  const aIsArray = a.every === testArray.every;
  const bIsArray = b.every === testArray.every;
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((v: any, i: any) => v === b[i]);
  }
  if ((aIsArray && !bIsArray) || (bIsArray && !aIsArray)) {
    return false;
  }
  const aIsDate = a.getTime === testDate.getTime;
  const bIsDate = b.getTime === testDate.getTime;
  if (aIsDate && bIsDate) {
    return a.getTime() === b.getTime();
  }
  if ((aIsDate && !bIsDate) || (bIsDate && !aIsDate)) {
    return false;
  }
  if (typeof a === "object" && typeof b === "object") {
    for (const key in a) {
      if (a[key] !== b[key]) return false;
    }
    for (const key in b) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }
  return false;
}

/**
 * delay updating in X milliseconds
 * @param ms
 * @returns
 */
export const debounce =
  (ms: number): ConcurrentMode =>
  (context, callback) => {
    clearTimeout(context.debounceTimer);
    context.debounceTimer = setTimeout(callback, ms);
  };

export const droppable = (): ConcurrentMode => (context, callback) => {
  if (context.updatingToken) {
    console.log("skip");
    return;
  }
  const token = (context.updatingToken = {});
  callback();
  return {
    done() {
      if (token === context.updatingToken) {
        delete context.updatingToken;
      }
    },
  };
};

/**
 * limit one updating in X milliseconds
 * @param ms
 * @returns
 */
export const throttle =
  (ms: number): ConcurrentMode =>
  (context, callback) => {
    const now = Date.now();
    if (
      !context.throttleLastExecution ||
      context.throttleLastExecution + ms <= now
    ) {
      context.throttleLastExecution = now;
      callback();
    }
  };

const abortControllerSupported = typeof AbortController !== "undefined";
function createUpdateContext(): UpdateContext {
  let abortController: AbortController | undefined;
  return {
    get signal() {
      if (!abortController && abortControllerSupported) {
        abortController = new AbortController();
      }
      return abortController?.signal;
    },
    cancel() {
      abortController?.abort();
    },
  };
}

export function create<TData, TProps, TActions extends Actions<TData>>(
  initialData: UpdateData<TData>,
  options?: BlokOptions<TData, TProps, TActions>
): Blok<TData> & TProps & ExtraActions<TActions> {
  type State = { loading: boolean; data: TData; error: any };

  const changeEmitter = createEmitter();
  const concurrentContext: Record<string, any> = {};
  const compare = options?.compare ?? Object.is;

  let blok: Blok<TData>;
  let waitPromise: Promise<TData> | undefined;
  let lazyInit = typeof initialData === "function";
  let initialized = !lazyInit;
  let lastUpdateContext: UpdateContext | undefined;
  let concurrentController: ConcurrentController | void;
  let autoRefreshTimer: any;
  let disposed = false;
  let state: State = {
    data: undefined as any,
    loading: false,
    error: undefined,
  };

  const notify = () => {
    if (mutationCount) {
      batchChanges.add(notify);
      return;
    }
    changeEmitter.emit();
  };

  const changeState = (change: Partial<State>) => {
    const nextState = { ...state, ...change };
    if (
      state.data === nextState.data &&
      state.error === nextState.error &&
      state.loading === nextState.loading
    ) {
      return;
    }

    if (state.data !== nextState.data && options?.hydrate) {
      clearDehyratedData();
    }

    state = nextState;
    notify();
  };

  const init = () => {
    if (initialized) return;
    initialized = true;
    blok.set(initialData);
    if (options?.autoRefresh) {
      let refreshFn: (next: VoidFunction, blok: Blok<TData>) => void;

      if (typeof options.autoRefresh === "number") {
        const ms = options.autoRefresh;
        refreshFn = (next) => {
          clearTimeout(autoRefreshTimer);
          autoRefreshTimer = setTimeout(next, ms);
        };
      } else {
        refreshFn = options.autoRefresh;
      }

      function next() {
        refreshFn(() => {
          if (disposed) return;
          blok.set(initialData);
          next();
        }, blok);
      }
      next();
    }
  };

  blok = {
    get loading() {
      return state.loading;
    },
    get data() {
      init();
      return state.data;
    },
    set data(data) {
      blok.set(data);
    },
    get error() {
      return state.error;
    },
    debounce: (ms, data) => blok.set(data, debounce(ms)),
    throttle: (ms, data) => blok.set(data, throttle(ms)),
    clearError() {
      changeState({ error: undefined });
    },
    reset() {
      if (!initialized) return;
      initialized = false;
      init();
    },
    set(nextData, mode) {
      lastUpdateContext?.cancel();
      concurrentController?.dispose?.();
      let cc: ConcurrentController | void | undefined;

      if (mode) {
        cc = concurrentController = mode(concurrentContext, () =>
          blok.set(nextData)
        );
        return;
      }

      try {
        if (typeof nextData === "function") {
          const updateContext = createUpdateContext();
          nextData = (nextData as Updater<TData>)(blok.data, updateContext);
        }
      } catch (e) {
        changeState({ loading: false, error: e });
        return;
      }

      // async update
      if (typeof (nextData as any)?.then === "function") {
        changeState({ error: undefined, loading: true });
        const snapshot = state;
        (nextData as any).then(
          (value: any) => {
            if (typeof cc === "object") {
              cc.done?.();
            }

            if (snapshot !== state) return;

            changeState({
              data: value,
              loading: false,
              error: undefined,
            });
          },
          (e: any) => {
            if (typeof cc === "object") {
              cc.done?.(e);
            }
            if (snapshot !== state) return;
            changeState({
              loading: false,
              error: e?.name === "AbortError" ? undefined : e,
            });
          }
        );
        return;
      }

      if (typeof cc === "object") {
        cc.done?.();
      }
      // state changed
      changeState({
        data: compare(nextData as TData, state.data)
          ? state.data
          : (nextData as TData),
        error: undefined,
        loading: false,
      });
    },
    get() {
      return blok.data;
    },
    action(f: Function, mode): any {
      return (...outer: any[]) =>
        blok.set((...inner: any[]) => f.apply(null, outer.concat(inner)), mode);
    },
    listen: changeEmitter.add,
    wait() {
      if (waitPromise) return waitPromise;
      if (state.loading) {
        waitPromise = new Promise((resolve, reject) => {
          const unsubscribe = blok.listen(() => {
            unsubscribe();
            waitPromise = undefined;
            if (state.error) return reject(state.error);
            return resolve(state.data);
          });
        });
        return waitPromise;
      }
      const errorPromise = Promise.reject(state.error);
      errorPromise.catch(() => {});
      return errorPromise;
    },
    use: function Use(...args: any[]) {
      type ComponentContext = {
        selector?: Function;
        compare?: Function;
        prevData?: any;
        nextData?: any;
        active?: boolean;
        error?: any;
        rerender?: Function;
        dataUpdated?: boolean;
      };

      init();

      const ref = useRef<ComponentContext>({}).current;
      ref.rerender = useState<any>()[1];

      // use(selector, compare?)
      if (typeof args[0] === "function") {
        [ref.selector, ref.compare = Object.is] = args;
      } else {
        let hasDefaultValue = false;
        let defaultValue: any;
        // use()
        ref.compare = Object.is;
        [hasDefaultValue, defaultValue, ref.selector] = [
          !!args.length,
          args[0],
          () => {
            if (hasDefaultValue && (blok.error || blok.loading))
              return defaultValue;
            if (blok.error) throw blok.error;
            if (blok.loading) throw blok.wait();
            return blok.data;
          },
        ];
      }

      ref.active = true;

      useEffect(
        () => () => {
          ref.active = false;
        },
        [ref]
      );

      useEffect(() => {
        ref.active = true;
        const handleChange = () => {
          if (!ref.active) return;
          ref.dataUpdated = false;

          try {
            const nextData = ref.selector!(blok);
            const noChange = ref.compare!(nextData, ref.prevData);
            if (noChange) return;
            ref.dataUpdated = true;
            ref.nextData = nextData;
          } catch (e) {
            ref.error = e;
          }
          ref.rerender!({});
        };
        return blok.listen(handleChange);
      }, [ref]);

      if (ref.error) {
        const error = ref.error;
        ref.error = undefined;
        throw error;
      }
      if (ref.dataUpdated) {
        ref.prevData = ref.nextData;
      } else {
        ref.prevData = ref.selector!(blok);
      }

      return ref.prevData;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
      changeEmitter.clear();
    },
    ...options?.props,
  };

  if (options?.actions) {
    const actions = options.actions;
    for (const key of Object.keys(actions)) {
      (blok as any)[key] = blok.action(actions[key]);
    }
  }

  if (options?.hydrate) {
    const [hydrated, value] = options.hydrate(blok.get);
    if (hydrated) {
      state.data = value;
      initialized = true;
    } else {
      if (!lazyInit) {
        blok.set(initialData);
      }
    }
  } else {
    if (!lazyInit) {
      blok.set(initialData);
    }
  }

  concurrentContext.blok = blok;

  return blok as any;
}

export function family<TBlok extends Blok<any>, TKey>(
  factory: (key: TKey) => TBlok,
  options?: FamilyOptions<TKey>
): Family<TBlok, TKey> {
  const map = new Map<any, TBlok>();
  const compare = options?.compare ?? Object.is;
  const findMember = (key: any): [any, TBlok | undefined] => {
    if (key && (typeof key === "object" || Array.isArray(key))) {
      const keyIterator = map.entries();
      while (true) {
        const { value, done } = keyIterator.next();
        if (done) break;
        if (compare(value[0], key)) {
          return value;
        }
      }
      return [undefined, undefined];
    } else {
      return [key, map.get(key)];
    }
  };

  return {
    get(key) {
      let [mapKey = key, member] = findMember(key);
      if (!member) {
        const original = factory(key);
        const originalDispose = original.dispose;
        member = Object.assign(original, {
          dispose() {
            originalDispose?.();
            map.delete(key);
          },
        });
        map.set(mapKey, member);
      }
      return member;
    },
    clear() {
      map.clear();
    },
  };
}

const forever = new Promise(() => {});
export function from<TData, TSource, TProps, TActions extends Actions<TData>>(
  source: any,
  selector: Selector<TSource, TData>,
  options?: LinkedBlokOptions<TData, TProps, TActions>
): Blok<TData> & TProps & ExtraActions<TActions> {
  let blok: Blok<TData>;
  const single = typeof source.listen === "function";
  const entries = single
    ? Object.entries({ value: source } as Record<string, Blok>)
    : Object.entries(source as Record<string, Blok>);

  const handleChange = () => {
    let loadingCount = 0;
    let errorCount = 0;
    let firstError: any;
    for (const [, x] of entries) {
      if (x.loading) {
        loadingCount++;
      } else if (x.error) {
        errorCount++;
        if (!firstError) firstError = x.error;
      }
    }
    // all blok have errors
    if (errorCount === entries.length) {
      blok.set(() => {
        throw firstError;
      });
    } else if (loadingCount) {
      blok.set(forever as any);
    } else {
      blok.set((prev, context) => {
        const next = selector(
          single
            ? source.data
            : entries.reduce((obj, [key, blok]) => {
                obj[key] = blok.data;
                return obj;
              }, {} as any),
          prev,
          context
        );
        if (shallow(next, prev)) return prev;
        return next as any;
      }, options?.mode);
    }
  };
  const unsubscribes = entries.map(([, x]) => x.listen(handleChange));
  blok = create<TData, TProps, TActions>(undefined as any, { ...options });

  handleChange();

  return Object.assign(blok, {
    dispose() {
      while (unsubscribes.length) {
        unsubscribes.shift()?.();
      }
    },
  }) as any;
}

export const blok: Create = (...args: any[]): any => {
  if (typeof args[1] === "function") {
    // blok(source, selector, options?)
    return from(args[0], args[1], args[2]);
  }
  if (
    Array.isArray(args[0]) &&
    args[0].length === 1 &&
    typeof args[0][0] === "function"
  ) {
    // blok([factory], options?)
    return family(args[0][0], args[1]);
  }
  // blok(data, options?)
  return create(args[0], args[1]);
};

type HydratedData = {
  data?: any;
  prevData?: any;
  members?: Map<any, HydratedData>;
  get?: () => any;
};
const hydratedData = new Map<any, HydratedData>();

let lastDehyratedData: DehydratedDataCollection | undefined;

function clearDehyratedData() {
  lastDehyratedData = undefined;
}

/**
 * hydrate adds a previously dehydrated state into a cache.
 * If the bloks included in dehydration already exist in the cache, hydrate does not overwrite them.
 * @param collection
 * @returns
 */
export function hydrate(
  collection?: DehydratedDataCollection,
  freshHydrate?: boolean
) {
  if (freshHydrate) {
    hydratedData.clear();
  }
  if (collection) {
    for (const [blokKey, blokData] of collection) {
      // is family
      if (blokData.members) {
        hydratedData.set(blokKey, {
          members: new Map<any, any>(
            blokData.members.map(([memberKey, memberData]) => [
              memberKey,
              { data: memberData },
            ])
          ),
        });
      } else {
        hydratedData.set(blokKey, { data: blokData.data });
      }
    }
  }
  return function (blokKey: any, options: HydrationOptions = {}): Hydration {
    const hasMemberKey = "memberKey" in options;

    return (get) => {
      let hydrated = true;
      let item = hydratedData.get(blokKey);
      if (!item) {
        hydrated = false;
        item = {};
        if (hasMemberKey) {
          const family: HydratedData = {
            members: new Map<any, HydratedData>(),
          };
          family.members?.set(options.memberKey, item);
          hydratedData.set(blokKey, family);
        } else {
          hydratedData.set(blokKey, item);
        }
      } else {
        if (hasMemberKey) {
          let member = item.members?.get(options.memberKey);
          if (!member) {
            hydrated = false;
            member = {};
            item.members?.set(options.memberKey, member);
          }
          item = member;
        }
      }
      item.get = get;
      return [hydrated, item.data];
    };
  };
}

/**
 * dehydrate creates a frozen representation of a cache that can later be hydrated with hydrate().
 * This is useful for passing prefetched blok data from server to client or persisting blok data to localStorage or other persistent locations.
 * It only includes currently using blok by default.
 * @returns
 */
export function dehyrate() {
  if (lastDehyratedData) return lastDehyratedData;
  const collection: DehydratedDataCollection = [];
  for (const [blokKey, blokData] of hydratedData) {
    if (blokData.members) {
      const members: [any, any][] = [];
      for (const [memberKey, memberData] of blokData.members) {
        if (!memberData.get) continue;
        members.push([memberKey, memberData.get()]);
      }
      collection.push([blokKey, { members }]);
      continue;
    }

    if (!blokData.get) continue;
    collection.push([blokKey, { data: blokData.get() }]);
  }
  lastDehyratedData = collection;
  return collection;
}
