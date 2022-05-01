import {
  blok,
  batch,
  droppable,
  hydrate,
  push,
  pop,
  shift,
  unshift,
  sort,
  reverse,
  filter,
  map,
  splice,
  swap,
} from "./main";

const delay = <T = any>(ms = 0, value?: T) =>
  new Promise<T>((resolve) => setTimeout(resolve, ms, value));

test("counter", () => {
  const counter = blok(0);
  counter.data++;
  expect(counter.data).toBe(1);
});

test("reducer", () => {
  const counter = blok(0);
  counter.set((prev) => prev + 1);
  expect(counter.data).toBe(1);
});

test("lazyInit (sync)", () => {
  let initialized = false;
  const counter = blok(() => {
    initialized = true;
    return 0;
  });
  expect(initialized).toBe(false);
  expect(counter.data).toBe(0);
  expect(initialized).toBe(true);
});

test("lazyInit (async)", async () => {
  let initialized = false;
  const counter = blok(() => {
    initialized = true;
    return delay(10, 5);
  });
  expect(initialized).toBe(false);
  expect(counter.data).toBeUndefined();
  expect(initialized).toBe(true);
  await delay(15);
  expect(counter.data).toBe(5);
});

test("async data", async () => {
  const counter = blok(0);
  counter.set(delay(10, 1));
  counter.set(delay(15, 2));
  counter.set(delay(5, 3));
  expect(counter.loading).toBe(true);
  expect(counter.data).toBe(0);
  await delay(20);
  expect(counter.loading).toBe(false);
  expect(counter.data).toBe(3);
});

test("batch mutation", () => {
  let changes = 0;
  const counter = blok(0);
  counter.listen(() => changes++);
  const action = batch(() => {
    counter.data++;
    counter.data++;
    counter.data++;
    counter.data++;
    counter.data++;
    expect(changes).toBe(0);
  });
  action();
  expect(changes).toBe(1);
});

test("linked blok", async () => {
  const token = blok("");
  const profile = blok(token, (x) =>
    Promise.resolve(
      x ? { username: "authenticated" } : { username: "anonymous" }
    )
  );
  expect(profile.loading).toBe(true);
  await delay();
  expect(profile.data.username).toBe("anonymous");
  token.data = Math.random().toString();
  expect(profile.loading).toBe(true);
  await delay();
  expect(profile.data.username).toBe("authenticated");
});

test("droppable", async () => {
  const counter = blok(0);
  counter.set(delay(10, 1), droppable());
  // skip 2 updates
  counter.set(delay(5, 2), droppable());
  counter.set(delay(5, 3), droppable());
  await delay(15);
  expect(counter.data).toBe(1);
});

test("hydrate", () => {
  let hydration = hydrate(undefined);
  const counter1 = blok(0, { hydrate: hydration.of("counter") });
  counter1.data++;
  const data = hydration.dehydrate();
  const data2 = hydration.dehydrate();
  // should be the same if nothing change since last time
  expect(data).toBe(data2);
  hydration = hydrate(data);
  const counter2 = blok(0, { hydrate: hydration.of("counter") });
  expect(counter2.data).toBe(1);
  counter2.data++;
  counter2.data--;
  const data3 = hydration.dehydrate();
  // after the blok changed, the reference of dehyrated data is changed as well but it must be equal to prev one
  expect(data).not.toBe(data3);
  expect(data).toEqual(data3);
});

test("hydrate (family)", () => {
  let hydration = hydrate();
  const counters = blok([
    (key: number) => blok(0, { hydrate: hydration.ofMember("counter", key) }),
  ]);
  counters.get(1).data += 1;
  counters.get(2).data += 2;
  const data = hydration.dehydrate();

  hydration = hydrate(data);

  const othercCounters = blok([
    (key: number) => blok(0, { hydrate: hydration.ofMember("counter", key) }),
  ]);
  expect(othercCounters.get(1).data).toBe(1);
  expect(othercCounters.get(2).data).toBe(2);
});

test("autoRefresh", async () => {
  const values = [1, 2, 3, 4];
  const counter = blok(() => values.shift(), { autoRefresh: 20 });
  expect(counter.data).toBe(1);
  await delay(25);
  expect(counter.data).toBe(2);
  await delay(25);
  expect(counter.data).toBe(3);
  counter.dispose();
  // after dispose, the counter does not perform autoRefresh any more
  await delay(25);
  expect(counter.data).toBe(3);
});

test("lazy hydrate", () => {
  const hydration = hydrate();
  const counter1 = blok(0, { hydrate: hydration.of("counter") });
  expect(counter1.data).toBe(0);
  hydration.dataOf("counter", 1);
  expect(counter1.data).toBe(0);
  const counter2 = blok(0, { hydrate: hydration.of("counter") });
  expect(counter2.data).toBe(1);
  const counters = blok([
    (key: number) =>
      blok(key, { hydrate: hydration.ofMember("counters", key) }),
  ]);
  expect(counters.get(1).data).toBe(1);
  expect(counters.get(2).data).toBe(2);
  hydration.dataOfMember("counters", 3, 4);
  expect(counters.get(3).data).toBe(4);
});

test("merge", () => {
  const profile = blok({ username: "", password: "" });
  const data1 = profile.data;
  profile.merge({ username: "admin" });
  const data2 = profile.data;
  expect(data1).not.toBe(data2);
  expect(data2).toEqual({ username: "admin", password: "" });
});

test("array methods", () => {
  const array = blok<number[]>([]);
  const d1 = array.data;
  array.set(push(1, 2, 3));
  expect(array.data).toEqual([1, 2, 3]);
  const d2 = array.data;
  expect(d1).not.toBe(d2);
  // push nothing
  array.set(push());
  const d3 = array.data;
  // nothing changed
  expect(d2).toBe(d3);
  array.set(pop());
  expect(array.data).toEqual([1, 2]);
  array.set(shift());
  expect(array.data).toEqual([2]);
  array.set(unshift(1, 2, 3));
  expect(array.data).toEqual([1, 2, 3, 2]);
  array.set(sort());
  expect(array.data).toEqual([1, 2, 2, 3]);
  array.set(reverse());
  expect(array.data).toEqual([3, 2, 2, 1]);
  array.set(filter((x) => x % 2 !== 0));
  expect(array.data).toEqual([3, 1]);
  array.set(map((x) => x * 2));
  expect(array.data).toEqual([6, 2]);
  array.set(splice(0, 1, 1, 2, 3));
  expect(array.data).toEqual([1, 2, 3, 2]);
  array.set(swap(0, 3));
  expect(array.data).toEqual([2, 2, 3, 1]);
  array.set(swap(0, 4));
  expect(array.data).toEqual([undefined, 2, 3, 1, 2]);
});

test("get by path", () => {
  const b = blok({ nested: { nested: { value: 1 } } });
  expect(b.get("nested.nested.value")).toBe(1);
});

test("set by path", () => {
  const data = { nested: { nested: { value: 1 } }, other: [1, 2, 3] };
  const b = blok(data);
  b.set("nested.nested.value", 2);
  expect(b.data.nested.nested.value).toBe(2);
  expect(b.data).not.toBe(data);
  expect(b.data).toEqual({
    nested: { nested: { value: 2 } },
    other: [1, 2, 3],
  });
  b.set("nested.nested.value", (prev) => prev + 1);
  expect(b.data.nested.nested.value).toBe(3);
  b.mset({
    "nested.nested.value": 4,
    "other.0": 2,
  });
  expect(b.data).toEqual({
    nested: { nested: { value: 4 } },
    other: [2, 2, 3],
  });
  const other = b.data.other;
  // using clone() method of update context
  b.set("other", (_, { clone }) => clone().splice(1, 2));
  expect(b.data.other).not.toBe(other);
  expect(b.data.other).toEqual([2]);
});
