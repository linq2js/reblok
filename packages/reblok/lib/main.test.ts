import blok from "./main";

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
  blok(() => {
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
