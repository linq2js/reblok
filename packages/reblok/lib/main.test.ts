import { blok, batch, droppable, hydrate, dehyrate } from "./main";

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
  batch(() => {
    counter.data++;
    counter.data++;
    counter.data++;
    counter.data++;
    counter.data++;
    expect(changes).toBe(0);
  });
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
  const hydration = hydrate();
  const counter1 = blok(0, { hydrate: hydration("counter") });
  counter1.data++;
  const data = dehyrate();
  hydrate(data);
  const counter2 = blok(0, { hydrate: hydration("counter") });
  expect(counter2.data).toBe(1);
});
