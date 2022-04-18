import { useEffect, useRef, useState } from "react";
import {
  Actions,
  Blok,
  BlokOptions,
  ConcurrentMode,
  Create,
  Emitter,
  ExtraActions,
  Family,
  FamilyOptions,
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
export const batch = <TResult>(mutation: () => TResult): TResult => {
  try {
    if (!mutationCount) {
      batchChanges = new Set();
    }
    mutationCount++;
    return mutation();
  } finally {
    mutationCount--;
    if (!mutationCount) {
      for (const x of batchChanges) {
        x();
      }
    }
  }
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
  const context = {};
  const compare = options?.compare ?? Object.is;

  let blok: Blok<TData>;
  let waitPromise: Promise<TData> | undefined;
  let lazyInit = typeof initialData === "function";
  let initialized = !lazyInit;
  let lastUpdateContext: UpdateContext | undefined;
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

      if (mode) {
        mode(context, () => blok.set(nextData));
        return;
      }

      try {
        if (typeof nextData === "function") {
          const context = createUpdateContext();
          nextData = (nextData as Updater<TData>)(blok.data, context);
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
            if (snapshot !== state) return;
            changeState({
              data: value,
              loading: false,
              error: undefined,
            });
          },
          (e: any) => {
            if (snapshot !== state) return;
            changeState({
              loading: false,
              error: e?.name === "AbortError" ? undefined : e,
            });
          }
        );
        return;
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
    action(f: Function): any {
      return (...outer: any[]) =>
        blok.set((...inner: any[]) => f.apply(null, outer.concat(inner)));
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

      let hasDefaultValue = false;
      let defaultValue: any;
      // use(selector, compare?)
      if (typeof args[0] === "function") {
        [ref.selector, ref.compare = Object.is] = args;
      } else {
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
    ...options?.props,
  };

  if (options?.actions) {
    const actions = options.actions;
    for (const key of Object.keys(actions)) {
      (blok as any)[key] = blok.action(actions[key]);
    }
  }

  if (!lazyInit) {
    blok.set(initialData);
  }

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
        const originalDispose = (original as any).dispose;
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
    const [source, selector, options] = args;
    return from(source, selector, options);
  }
  if (
    Array.isArray(args[0]) &&
    args[0].length === 1 &&
    typeof args[0][0] === "function"
  ) {
    const [[factory], options] = args;
    return family(factory, options);
  }
  const [data, options] = args;
  return create(data, options);
};
