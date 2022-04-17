import { useEffect, useRef, useState } from "react";

export type Comparer<T> = (a: T, b: T) => boolean;

export type ConcurrentMode = (
  context: Record<string, any>,
  callback: VoidFunction
) => void;

export type Data<T> =
  | Promise<T>
  | T
  | ((prev: T, abourController: AbortController) => T | Promise<T>);
export interface Blok<T = any> {
  readonly error: any;

  readonly loading: boolean;

  /**
   * get current data of the blok
   */
  data: T;
  /**
   *
   * @param listener
   */
  listen(listener: VoidFunction): VoidFunction;

  /**
   *
   * @param data
   * @param mode
   */
  set(data: Data<T>, mode?: ConcurrentMode): boolean;

  debounce(ms: number, data: Data<T>): void;

  throttle(ms: number, data: Data<T>): void;

  /**
   * get current data of the blok
   */
  get(): T;
  /**
   * bind the blok to the React component and return the blok data
   * Note: this is React hook so you must follow hook rules to use this: https://reactjs.org/docs/hooks-rules.html
   */
  use(): T;
  /**
   * bind the blok to the React component and return selected slice of the blok data.
   * Note: this is React hook so you must follow hook rules to use this: https://reactjs.org/docs/hooks-rules.html
   * @param selector
   * @param compare
   */
  use<R>(selector: (blok: this) => R, compare?: Comparer<R>): R;

  use(defaultValue: T): T;
  /**
   * wait until blok data is ready or blok has an error
   */
  wait(): Promise<T>;

  /**
   * reset blok data to initial data
   */
  reset(): void;
}

export function shallow(a: any, b: any) {
  if (a === b) return true;
  // handle falsy
  if ((a && !b) || (b && !a)) return false;
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  if ((aIsArray && !bIsArray) || (bIsArray && !aIsArray)) {
    return false;
  }
  const aIsDate = a instanceof Date;
  const bIsDate = b instanceof Date;
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

type InferData<T> = T extends Promise<infer TResolved> ? TResolved : T;

export interface DefaultExports {
  /**
   * create linked blok
   */
  <TBloks, TResult = any, TExtra extends {} = {}>(
    bloks: TBloks,
    selector: (
      data: TBloks extends Blok<infer T>
        ? T
        : {
            [key in keyof TBloks]: TBloks[key] extends Blok<infer T>
              ? T
              : never;
          },
      prev: any,
      abourController: AbortController
    ) => TResult,
    extraProps: TExtra,
    mode?: ConcurrentMode
  ): Blok<InferData<TResult>> & TExtra;

  /**
   * create linked blok
   */
  <TBloks, TResult = any>(
    bloks: TBloks,
    selector: (
      data: TBloks extends Blok<infer T>
        ? T
        : {
            [key in keyof TBloks]: TBloks[key] extends Blok<infer T>
              ? T
              : never;
          },
      prev: any,
      abourController: AbortController
    ) => TResult,
    mode?: ConcurrentMode
  ): Blok<InferData<TResult>>;

  /**
   * perform mutation of multiple bloks, when the mutation done, all change notifications are triggered
   */
  <TData = void>(mutation: () => TData): TData;

  /**
   * create a simple blok with initialData and extraProps
   */
  <TData = any, TExtra extends {} = {}>(
    initialData: TData,
    extraProps: TExtra
  ): Blok<InferData<TData>> & TExtra;

  /**
   * create a simple blok with initialData
   */
  <TData = any>(initialData: TData): Blok<InferData<TData>>;
}

let mutationCount = 0;
const changes = new Set<VoidFunction>();

/**
 * perform mutation of multiple bloks, when the mutation done, all change notifications are triggered
 * @param mutation
 * @returns
 */
const mutate = (mutation: Function) => {
  try {
    if (!mutationCount) {
      changes.clear();
    }
    mutationCount++;
    return mutation();
  } finally {
    mutationCount--;
    if (!mutationCount) {
      Array.from(changes).forEach((x) => x());
    }
  }
};

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

const create = <TData = any, TExtra extends {} = {}>(
  initialData: TData,
  extraProps?: TExtra
): Blok<TData> & TExtra => {
  let data: TData;
  let loading = false;
  let error: any;
  let blok: Blok<TData>;
  let waitPromise: Promise<any> | undefined;
  let abourController: AbortController | undefined;
  const context = {};
  const listeners = new Array<VoidFunction>();
  const notify = () => {
    if (mutationCount) {
      changes.add(notify);
      return;
    }
    listeners.slice().forEach((x) => x());
  };
  const listen = (listener: VoidFunction) => {
    listeners.push(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  };
  const get = () => data;
  const set = (nextData: any, mode?: ConcurrentMode): boolean => {
    // cancel prev http request if any
    abourController?.abort();

    if (mode) {
      mode(context, () => set(nextData));
      return false;
    }
    try {
      if (typeof nextData === "function") {
        if (typeof AbortController !== "undefined") {
          abourController = new AbortController();
        }
        nextData = nextData(data, abourController);
      }
    } catch (e) {
      loading = false;
      error = e;
      notify();
      return true;
    }
    // is promise
    if (typeof nextData?.then === "function") {
      const snapshot = data;
      loading = true;
      notify();
      nextData.then(
        (value: any) => {
          if (snapshot !== data) return;
          loading = false;
          // if nothing changed, call notify() manually
          if (!set(value)) {
            notify();
          }
        },
        (e: any) => {
          if (snapshot !== data) return;
          loading = false;
          // skip abort error
          if (e?.name !== "AbortError") {
            error = e;
          }
          notify();
        }
      );
      return false;
    }

    if (nextData !== data) {
      loading = false;
      data = nextData;
      notify();
      return true;
    }
    return false;
  };

  const wait = () => {
    if (waitPromise) return waitPromise;
    if (loading) {
      waitPromise = new Promise((resolve, reject) => {
        const unsubscribe = listen(() => {
          unsubscribe();
          waitPromise = undefined;
          if (error) return reject(error);
          return resolve(data);
        });
      });
      return waitPromise;
    }
    const errorPromise = Promise.reject(error);
    errorPromise.catch(() => {});
    return errorPromise;
  };

  const Use: Blok["use"] = (...args: any[]) => {
    const selectorRef = useRef<Function>();
    const prevDataRef = useRef<any>();
    const compareRef = useRef<Function>();
    const errorRef = useRef<any>();
    const activeRef = useRef(true);
    const rerender = useState<any>()[1];
    let hasDefaultValue = false;
    let defaultValue: any;
    if (typeof args[0] === "function") {
      [selectorRef.current, compareRef.current] = args;
    } else {
      [hasDefaultValue, defaultValue, selectorRef.current] = [
        !!args.length,
        args[0],
        () => {
          if (hasDefaultValue && (error || loading)) return defaultValue;
          if (error) throw error;
          if (loading) throw wait();
          return data;
        },
      ];
    }

    activeRef.current = true;

    useEffect(
      () => () => {
        activeRef.current = false;
      },
      []
    );

    useEffect(() => {
      activeRef.current = true;
      const handleChange = () => {
        if (!activeRef.current) return;
        try {
          const nextData = selectorRef.current!(blok);
          const noChange = compareRef.current
            ? compareRef.current!(nextData, prevDataRef.current)
            : nextData === prevDataRef.current;
          if (noChange) return;
        } catch (e) {
          errorRef.current = e;
        }
        rerender({});
      };
      return listen(handleChange);
    }, [rerender]);

    if (errorRef.current) {
      const error = errorRef.current;
      errorRef.current = undefined;
      throw error;
    }

    prevDataRef.current = selectorRef.current!(blok);
    return prevDataRef.current;
  };

  blok = {
    listen,
    get,
    set,
    debounce: (ms, data) => set(data, debounce(ms)),
    throttle: (ms, data) => set(data, throttle(ms)),
    reset: () => set(initialData),
    use: Use,
    wait,
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get data() {
      return data;
    },
    set data(value) {
      set(value);
    },
    // DONT PUT extraProps before default props, the prop getters becomes useless
    ...extraProps,
  };

  set(initialData);

  return blok as any;
};

const from = (
  bloks: any,
  selector: Function,
  extraProps: any,
  mode?: ConcurrentMode
) => {
  let blok: Blok;
  const single = typeof bloks.listen === "function";
  const entries = single
    ? Object.entries({ value: bloks } as Record<string, Blok>)
    : Object.entries(bloks as Record<string, Blok>);
  const select = (prev?: any, abourController?: any) => {
    return selector(
      single
        ? bloks.data
        : entries.reduce((obj, [key, blok]) => {
            obj[key] = blok.data;
            return obj;
          }, {} as any),
      prev,
      abourController
    );
  };
  const handleChange = () => {
    blok.set(
      (prev: any, abourController: any) => select(prev, abourController),
      mode
    );
  };
  entries.forEach(([, x]) =>
    x.listen(() => !x.loading && !x.error && handleChange())
  );
  blok = create(undefined, extraProps);
  handleChange();
  return blok;
};

const defaultExports: DefaultExports = (...args: any[]) => {
  // blok(mutation)
  if (typeof args[0] === "function") {
    return mutate(args[0]);
  }
  if (typeof args[1] === "function") {
    if (typeof args[2] === "function") {
      // blok(bloks, selector, mode)
      return from(args[0], args[1], undefined, args[2]);
    }
    // blok(bloks, selector, extraProps, mode)
    return from(args[0], args[1], args[2], args[3]);
  }
  // blok(initialData, extraProps?)
  return create(args[0], args[1]);
};

export default defaultExports;
