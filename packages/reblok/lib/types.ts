export interface Emitter {
  // add handler
  add(handler: Function): VoidFunction;
  // emit event
  emit(event?: any): void;
  // loop through all handlers
  each(callback: (handler: Function) => void): void;
  // clear all handlers
  clear(): void;

  emitIfAny(eventFactory: () => any): void;
}

export type Comparer<T> = (a: T, b: T) => boolean;

export type Updater<TData, TParams extends any[] = []> = (
  prev: TData,
  context: UpdateContext<TData>,
  ...args: TParams
) => Data<TData>;

export type Data<TData> = TData extends Function
  ? never
  : TData | Promise<TData>;

export type Actions<T> = { [key: string]: Updater<T, any[]> };

export interface ConcurrentController {
  done?(error?: any): void;
  dispose?(): void;
}

export type ConcurrentMode = (
  context: Record<string, any>,
  callback: VoidFunction
) => ConcurrentController | void;

export interface UpdateContext<T> {
  signal?: any;
  /**
   * cancel AbortSignal if possible
   */
  cancel(): void;
  /**
   * return clone of pervious data. clone() method returns Array if the previous data is Array unless it returns Object
   */
  clone(): T;
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
  set(data: UpdateData<TData>, mode?: ConcurrentMode): this;

  set<TPath extends FieldPath<TData>>(
    path: TPath,
    data: UpdateData<FieldPathValue<TData, TPath>>,
    mode?: ConcurrentMode
  ): this;

  mset<
    TKey extends FieldPath<TData>,
    TValues extends { [key in TKey]?: UpdateData<FieldPathValue<TData, key>> }
  >(
    values: TValues,
    mode?: ConcurrentMode
  ): this;

  readonly merge: TData extends { [key: string]: any }
    ? (data: UpdateData<Partial<TData>>, mode?: ConcurrentMode) => this
    : never;

  debounce(ms: number, data: UpdateData<TData>): void;

  throttle(ms: number, data: UpdateData<TData>): void;

  /**
   * get current data of the blok
   */
  get(): TData;
  get<TPath extends FieldPath<TData>>(
    path: TPath
  ): FieldPathValue<TData, TPath>;
  /**
   * bind the blok to the React component and return the blok data
   * Note: this is React hook so you must follow hook rules to use this: https://reactjs.org/docs/hooks-rules.html
   */
  use(): TData;
  /**
   * create a local instance of the blok
   * Note: this is React hook so you must follow hook rules to use this: https://reactjs.org/docs/hooks-rules.html
   */
  local(): this;
  /**
   * create a local instance of the blok
   * @param data
   */
  local(data: UpdateData<TData>): this;
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
    updater: Updater<TData, TParams>,
    mode?: ConcurrentMode
  ): (...args: TParams) => void;

  dispose(): void;
}

export interface Family<TBlok extends Blok<any>, TKey> {
  get(key: TKey): TBlok;
  clear(): void;
}

export interface FamilyOptions<TKey> {
  compare?: Comparer<TKey>;
  hydrate?: HydrateBlok;
}

export interface BlokOptions<TData, TProps, TActions> {
  compare?: Comparer<TData>;
  props?: TProps;
  actions?: TActions;
  hydrate?: HydrateBlok;
  autoRefresh?: number | ((next: VoidFunction, blok: Blok<TData>) => void);
}

export interface LinkedBlokOptions<TData, TProps, TActions>
  extends BlokOptions<TData, TProps, TActions> {
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
  context: UpdateContext<TData>
) => Data<TData>;

export interface Create extends Function {
  (): Blok<any>;

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
    options: LinkedBlokOptions<TData, TProps, TActions>
  ): Blok<TData> & TProps & ExtraActions<TActions>;

  <TData>(data: UpdateData<TData>): Blok<TData>;

  <TData, TProps, TActions extends Actions<TData>>(
    data: UpdateData<TData>,
    options?: BlokOptions<TData, TProps, TActions>
  ): Blok<TData> & TProps & ExtraActions<TActions>;
}

export interface HydrationOptions {}

export type HydrateBlok = (blok: Blok) => [boolean, any];

export interface Hydration {
  of(key: any, options?: HydrationOptions): HydrateBlok;
  ofMember(key: any, member: any, options?: HydrationOptions): HydrateBlok;
  dehydrate(callback: (data: DehydratedDataCollection) => void): VoidFunction;
  dataOf<TData>(key: any, data: TData): TData;
  dataOfMember<TData>(key: any, member: any, data: TData): TData;
  /**
   * dehydrate creates a frozen representation of a cache that can later be hydrated with hydrate().
   * This is useful for passing prefetched blok data from server to client or persisting blok data to localStorage or other persistent locations.
   * It only includes currently using blok by default.
   * @returns
   */
  dehydrate(): DehydratedDataCollection;
}

export type DehydratedData = { data?: any; members?: [any, any][] };

export type DehydratedDataCollection = [any, DehydratedData][];

// BEGIN react-hook-form types
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ArrayKey = number;

export type Primitive =
  | null
  | undefined
  | string
  | number
  | boolean
  | symbol
  | bigint;

export type PathImpl<K extends string | number, V> = V extends Primitive
  ? `${K}`
  : `${K}` | `${K}.${Path<V>}`;

export type IsTuple<T extends ReadonlyArray<any>> = number extends T["length"]
  ? false
  : true;

export type TupleKeys<T extends ReadonlyArray<any>> = Exclude<
  keyof T,
  keyof any[]
>;

export type FieldValues = Record<string, any>;

export type FieldPath<TFieldValues extends FieldValues> = Path<TFieldValues>;

export type Path<T> = T extends ReadonlyArray<infer V>
  ? IsTuple<T> extends true
    ? {
        [K in TupleKeys<T>]-?: PathImpl<K & string, T[K]>;
      }[TupleKeys<T>]
    : PathImpl<ArrayKey, V>
  : {
      [K in keyof T]-?: PathImpl<K & string, T[K]>;
    }[keyof T];

export type FieldPathValue<
  TFieldValues extends FieldValues,
  TFieldPath extends FieldPath<TFieldValues>
> = PathValue<TFieldValues, TFieldPath>;

export type PathValue<T, P extends Path<T>> = T extends any
  ? P extends `${infer K}.${infer R}`
    ? K extends keyof T
      ? R extends Path<T[K]>
        ? PathValue<T[K], R>
        : never
      : K extends `${ArrayKey}`
      ? T extends ReadonlyArray<infer V>
        ? PathValue<V, R & Path<V>>
        : never
      : never
    : P extends keyof T
    ? T[P]
    : P extends `${ArrayKey}`
    ? T extends ReadonlyArray<infer V>
      ? V
      : never
    : never
  : never;
// END react-hook-form types
