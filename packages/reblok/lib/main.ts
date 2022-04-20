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
  HydrateBlok,
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

  function emit(payload: any) {
    for (const handler of handlers.slice(0)) {
      handler(payload);
    }
  }

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
    emit,
    emitIfAny(factory) {
      if (handlers.length) return emit(factory());
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

function mergeData(prev: Record<string, any>, next: Record<string, any>) {
  const changed = Object.keys(next ?? {}).some(
    (key) => prev[key] !== next[key]
  );
  return changed ? { ...prev, ...next } : prev;
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
    merge: ((nextData: UpdateData<Partial<TData>>, mode?: ConcurrentMode) => {
      return blok.set((prev, context) => {
        const next: any =
          typeof nextData === "function" ? nextData(prev, context) : nextData;
        if (typeof next?.then === "function") {
          return next.then((result: any) => mergeData(prev, result));
        }
        return mergeData(prev, next);
      }, mode);
    }) as any,
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
    local: function Local() {
      const blokRef = useRef<any>();
      if (blokRef.current) {
        blokRef.current = create(initialData, options);
      }
      return blokRef.current;
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

  //
  if (options?.hydrate) {
    const [hydrated, value] = options.hydrate(blok);
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
  blok?: Blok;
};

/**
 * hydrate adds a previously dehydrated state into a cache.
 * If the bloks included in dehydration already exist in the cache, hydrate does not overwrite them.
 * @param collection
 * @returns
 */
export function hydrate(collection?: DehydratedDataCollection): Hydration {
  const hydratedData = new Map<any, HydratedData>();
  const dehydrateEmitter = createEmitter();
  let lastDehyratedData: DehydratedDataCollection | undefined;

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

  function dehydrate(input?: unknown): any {
    if (typeof input === "function") {
      return dehydrateEmitter.add(input);
    }
    if (lastDehyratedData) return lastDehyratedData;
    const collection: DehydratedDataCollection = [];
    for (const [blokKey, blokData] of hydratedData) {
      if (blokData.members) {
        const members: [any, any][] = [];
        for (const [memberKey, memberData] of blokData.members) {
          if (!memberData.blok) continue;
          members.push([memberKey, memberData.blok.data]);
        }
        collection.push([blokKey, { members }]);
        continue;
      }

      if (!blokData.blok) continue;
      collection.push([blokKey, { data: blokData.blok.data }]);
    }
    lastDehyratedData = collection;
    return collection;
  }

  function getHydrateOf(
    blokKey: any,
    memberKey: any,
    hasMemberKey: boolean,
    options: HydrationOptions = {}
  ): HydrateBlok {
    options;
    return (blok) => {
      let prevData = {};
      // handle blok change
      blok.listen(() => {
        if (blok.error || blok.loading) return;
        if (prevData === blok.data) return;
        prevData = blok.data;
        lastDehyratedData = undefined;
        dehydrateEmitter.emitIfAny(() => dehydrate());
      });

      let hydrated = true;
      let item = hydratedData.get(blokKey);
      if (!item) {
        hydrated = false;
        item = {};
        if (hasMemberKey) {
          const family: HydratedData = {
            members: new Map<any, HydratedData>(),
          };
          family.members?.set(memberKey, item);
          hydratedData.set(blokKey, family);
        } else {
          hydratedData.set(blokKey, item);
        }
      } else {
        if (hasMemberKey) {
          let member = item.members?.get(memberKey);
          if (!member) {
            hydrated = false;
            member = {};
            item.members?.set(memberKey, member);
          }
          item = member;
        }
      }
      item!.blok = blok;
      return [hydrated, item.data];
    };
  }

  function setDataOf(
    blokKey: any,
    memberKey: any,
    hasMemberKey: boolean,
    data: any
  ) {
    let item = hydratedData.get(blokKey);
    if (!item) {
      item = {};
      hydratedData.set(blokKey, item);
    }
    if (hasMemberKey) {
      if (!item.members) item.members = new Map();
      let member = item.members.get(memberKey);
      if (!member) {
        member = {};
        item.members.set(memberKey, member);
      }
      item = member;
    }
    item.data = data;
  }

  return {
    of(key, options) {
      return getHydrateOf(key, undefined, false, options);
    },
    ofMember(key, memberKey, options) {
      return getHydrateOf(key, memberKey, true, options);
    },
    dataOf(key, data) {
      setDataOf(key, undefined, false, data);
      return data;
    },
    dataOfMember(key, member, data) {
      setDataOf(key, member, true, data);
      return data;
    },
    dehydrate,
  };
}

export function push<TItem>(...items: TItem[]): Updater<TItem[]> {
  return (prev) => {
    if (!items.length) return prev;
    return prev.concat(items);
  };
}

export function pop<TItem>(): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length) return prev;
    return prev.slice(0, prev.length - 1);
  };
}

export function shift<TItem>(): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length) return prev;
    return prev.slice(1);
  };
}

export function unshift<TItem>(...items: TItem[]): Updater<TItem[]> {
  return (prev) => {
    if (!items.length) return prev;
    return items.concat(prev);
  };
}

export function filter<TItem>(
  predicate: (item: TItem, index: number) => boolean
): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length) return prev;
    const next = prev.filter(predicate);
    if (next.length === prev.length) return prev;
    return next;
  };
}

export function sort<TItem>(
  compare?: (a: TItem, b: TItem) => number
): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length) return prev;
    return prev.slice().sort(compare);
  };
}

export function reverse<TItem>(): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length) return prev;
    return prev.slice().reverse();
  };
}

export function slice<TItem>(start?: number, end?: number): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length) return prev;
    return prev.slice(start, end);
  };
}

export function map<TItem>(
  mapper: (item: TItem, index: number) => TItem
): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length) return prev;
    let changed = false;
    const result = prev.map((item, index) => {
      const next = mapper(item, index);
      if (next !== item) {
        changed = true;
      }
      return next;
    });
    return changed ? result : prev;
  };
}

export function swap<TItem>(from: number, to: number): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length || from === to) return prev;
    if (prev[from] === prev[to]) return prev;
    const next = prev.slice();
    [next[from], next[to]] = [prev[to], prev[from]];
    return next;
  };
}

export function by<TItem, TResult>(
  selector: (item: TItem) => TResult,
  desc = false
) {
  return (a: TItem, b: TItem) => {
    const av = selector(a);
    const bv = selector(b);
    if (av === bv) return 0;
    if (av > bv) return desc ? -1 : 1;
    return desc ? 1 : -1;
  };
}

export function order<TItem>(
  ...by: ((a: TItem, b: TItem) => number)[]
): Updater<TItem[]> {
  return sort((a, b) => {
    let result = 0;
    for (const s of by) {
      result = s(a, b);
      if (result !== 0) return result;
    }
    return result;
  });
}

export const include = filter;

export function exclude<TItem>(
  predicate: (item: TItem, index: number) => boolean
): Updater<TItem[]> {
  return filter((item, index) => !predicate(item, index));
}

export function splice<TItem>(
  index: number,
  remove: number,
  ...items: TItem[]
): Updater<TItem[]> {
  return (prev) => {
    if (!prev.length && !items.length) return prev;
    const next = prev.slice();
    next.splice(index, remove, ...items);
    // nothing to be removed
    if (!items.length && next.length === prev.length) return prev;
    return next;
  };
}
