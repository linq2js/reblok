import { useEffect, useRef, useState } from "react";

export type Comparer<T> = (a: T, b: T) => boolean;

export interface Blok<T = any> {
  readonly error: any;
  readonly loading: boolean;
  /**
   * get current data of the blok
   */
  data: T;
  listen(listener: VoidFunction): VoidFunction;
  set(value: Promise<T> | T | ((prev: T) => T | Promise<T>)): void;
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

const create = (initialData: any) => {
  let data: any;
  let loading = false;
  let error: any;
  let blok: Blok;
  const listeners = new Array<VoidFunction>();
  const notify = () => listeners.slice().forEach((x) => x());
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
  const set = (nextData: any) => {
    try {
      if (typeof nextData === "function") {
        nextData = nextData(data);
      }
    } catch (e) {
      loading = false;
      error = e;
      notify();
      return;
    }
    // is promise
    if (typeof nextData?.then === "function") {
      const snapshot = data;
      loading = true;
      nextData.then(
        (value: any) => {
          if (snapshot !== data) return;
          loading = false;
          set(value);
        },
        (e: any) => {
          if (snapshot !== data) return;
          loading = false;
          error = e;
          notify();
        }
      );
      return;
    }

    if (nextData !== data) {
      loading = false;
      data = nextData;
      if (mutationCount) {
        changes.add(notify);
      } else {
        notify();
      }
    }
  };
  const Use = (selector?: Function, compare?: Function) => {
    const selectorRef = useRef<Function>();
    const prevDataRef = useRef<any>();
    const compareRef = useRef<Function>();
    const errorRef = useRef<any>();
    const activeRef = useRef(true);
    const rerender = useState<any>()[1];
    const removeSuspenseListenerRef = useRef<Function>();

    selectorRef.current =
      selector ??
      (() => {
        if (error) throw error;
        if (loading) {
          removeSuspenseListenerRef.current?.();
          throw new Promise((resolve, reject) => {
            const unsubscribe = listen(() => {
              unsubscribe();
              if (error) {
                return reject(error);
              }
              return resolve(data);
            });
            removeSuspenseListenerRef.current = unsubscribe;
          });
        }
        return data;
      });
    compareRef.current = compare;
    activeRef.current = true;

    useEffect(
      () => () => {
        activeRef.current = false;
        removeSuspenseListenerRef.current?.();
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
    use: Use,
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

const defaultExports: DefaultExports = (...args: any[]) => {
  if (typeof args[0] === "function") {
    return mutate(args[0]);
  }
  return create(args[0]);
};

export default defaultExports;
