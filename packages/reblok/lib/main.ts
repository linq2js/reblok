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
   */
  use(): T;
  /**
   * bind the blok to the React component and return selected slice of the blok data
   * @param selector
   * @param compare
   */
  use<R>(selector: (blok: this) => R, compare?: Comparer<R>): R;
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

export interface DefaultExports {
  <T = void>(mutation: () => T): T;
  <T = any>(initialData: T): Blok<T>;
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
  ): Blok<TResult extends Promise<infer T> ? T : TResult>;
}

let mutationCount = 0;
const changes = new Set<VoidFunction>();

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

const create = (initialData: any) => {
  let data: any;
  let loading = false;
  let error: any;
  let blok: Blok;
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

  const Use = (selector?: Function, compare?: Function) => {
    const selectorRef = useRef<Function>();
    const prevDataRef = useRef<any>();
    const compareRef = useRef<Function>();
    const errorRef = useRef<any>();
    const activeRef = useRef(true);
    const rerender = useState<any>()[1];

    selectorRef.current =
      selector ??
      (() => {
        if (error) throw error;
        if (loading) throw wait();
        return data;
      });
    compareRef.current = compare;
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
  };

  set(initialData);

  return blok;
};

const from = (bloks: any, selector: Function, mode?: ConcurrentMode) => {
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
  blok = create(undefined);
  handleChange();
  return blok;
};

const defaultExports: DefaultExports = (...args: any[]) => {
  if (typeof args[0] === "function") {
    return mutate(args[0]);
  }
  if (typeof args[1] === "function") {
    return from(args[0], args[1], args[2]);
  }
  return create(args[0]);
};

export default defaultExports;
