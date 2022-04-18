export interface Emitter {
  // add handler
  add(handler: Function): VoidFunction;
  // emit event
  emit(event?: any): void;
  // loop through all handlers
  each(callback: (handler: Function) => void): void;
  // clear all handlers
  clear(): void;
}

export type Comparer<T> = (a: T, b: T) => boolean;

export type Updater<TData, TParams extends any[] = []> = (
  prev: TData,
  context: UpdateContext,
  ...args: TParams
) => Data<TData>;

export type Data<TData> = TData extends Function
  ? never
  : TData | Promise<TData>;

export type Actions<T> = { [key: string]: Updater<T, any[]> };

export type ConcurrentMode = (
  context: Record<string, any>,
  callback: VoidFunction
) => void;

export interface UpdateContext {
  signal?: any;
  cancel(): void;
}

export type UpdateData<T> = Promise<T> | T | Updater<T>;

export interface Blok<TData = any> {
  readonly error: any;

  readonly loading: boolean;

  /**
   * get current data of the blok
   */
  data: TData;
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
  set(data: UpdateData<TData>, mode?: ConcurrentMode): void;

  debounce(ms: number, data: UpdateData<TData>): void;

  throttle(ms: number, data: UpdateData<TData>): void;

  /**
   * get current data of the blok
   */
  get(): TData;
  /**
   * bind the blok to the React component and return the blok data
   * Note: this is React hook so you must follow hook rules to use this: https://reactjs.org/docs/hooks-rules.html
   */
  use(): TData;
  /**
   * bind the blok to the React component and return selected slice of the blok data.
   * Note: this is React hook so you must follow hook rules to use this: https://reactjs.org/docs/hooks-rules.html
   * @param selector
   * @param compare
   */
  use<R>(selector: (blok: this) => R, compare?: Comparer<R>): R;

  use(defaultValue: TData): TData;
  /**
   * wait until blok data is ready or blok has an error
   */
  wait(): Promise<TData>;

  /**
   * reset blok data to initial data
   */
  reset(): void;

  clearError(): void;

  /**
   * create an action that call specified reducer when invoking
   * @param updater
   */
  action<TParams extends any[]>(
    updater: Updater<TData, TParams>
  ): (...args: TParams) => void;
}

export interface DisposableBlok<TData> extends Blok<TData> {
  dispose(): void;
}

export interface Family<TBlok extends Blok<any>, TKey> {
  get(key: TKey): TBlok;
  clear(): void;
}

export interface FamilyOptions<TKey> {
  compare?: Comparer<TKey>;
}

export interface BlokOptions<TProps, TActions> {
  props?: TProps;
  actions?: TActions;
}

export interface LinkedBlokOptions<TProps, TActions>
  extends BlokOptions<TProps, TActions> {
  mode?: ConcurrentMode;
}

export type ExtraActions<TActions> = {
  [key in keyof TActions]: TActions[key] extends Updater<any, infer TParams>
    ? (...args: TParams) => void
    : never;
};

export type DataGroup<TSource> = {
  [key in keyof TSource]: TSource[key] extends Blok<infer T> ? T : never;
};

export type Selector<TSource, TData> = (
  data: TSource extends Blok<infer T> ? T : DataGroup<TSource>,
  prev: TData,
  context: UpdateContext
) => Data<TData>;

export interface Create extends Function {
  <TBlok extends Blok<any>, TKey>(
    factory: [(key: TKey) => TBlok],
    options?: FamilyOptions<TKey>
  ): Family<TBlok, TKey>;

  <TData, TSource>(
    source: TSource,
    selector: Selector<TSource, TData>
  ): Blok<TData>;

  <TData, TSource, TProps, TActions extends Actions<TData>>(
    source: TSource,
    selector: Selector<TSource, TData>,
    options: LinkedBlokOptions<TProps, TActions>
  ): Blok<TData> & TProps & ExtraActions<TActions>;

  <TData>(data: UpdateData<TData>): Blok<TData>;

  <TData, TProps, TActions extends Actions<TData>>(
    data: UpdateData<TData>,
    options?: BlokOptions<TProps, TActions>
  ): Blok<TData> & TProps & ExtraActions<TActions>;
}
