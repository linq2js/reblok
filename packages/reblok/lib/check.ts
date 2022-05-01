import { blok } from "./main";

export function typeCheck() {
  const f = blok([
    () =>
      blok(0, {
        props: { name: "aaa" },
        actions: { add: (prev, _c, _t: string) => prev + 1 },
      }),
  ]);
  f.get(1).data;
  f.get(1).name;
  f.get(1).add("");
  const lazy = blok(() => Promise.resolve(1));
  lazy.action;
  const a = blok(1);
  a.data;
  const b = blok(() => true);
  b.data;
  const c = blok("");
  c.data;
  const d = blok(a, (x) => x.toString(), {
    props: {
      name: "abc",
      otherMethod(value: number) {
        return value;
      },
    },
    actions: { upper: (prev) => prev.toUpperCase() },
  });
  d.otherMethod(1).toString();
  d.upper();
  d.name;
  d.data;
  const e = blok(a, (x) => x.toString(), { actions: { xyz: (prev) => prev } });
  e.xyz();

  const s1 = blok(
    { a, b, c },
    (data) => data.a.toExponential() + data.b + data.c
  );
  s1.data;
  const s2 = blok(
    { a, b, c },
    (data) => data.a.toExponential() + data.b + data.c,
    { props: { name: "" } }
  );
  s2.name;
  s2.set((prev, _c) => prev);
  const s3 = blok(
    { a, b, c },
    (data) => data.a.toExponential() + data.b + data.c,
    { props: { name: "" } }
  );
  s3.data;

  type ThemeType = "dark";
  const def: ThemeType = "dark";
  const bb = blok(def, {
    props: { name: "" },
    actions: {
      increment: (_) => "dark",
    },
  });
  bb.name;

  const obj = blok({
    nested: {
      nested: {
        nested: {
          value: 1,
        },
      },
      array: [1, 2, 3],
      todos: [{ title: "todo 1" }, { title: "totd2" }],
    },
    other: 1,
  });
  const arr = obj.get("nested.array");
  console.log(arr.fill(0));
  const value = obj.get("nested.nested.nested.value");
  console.log(value);
  obj.mset({
    other: 2,
    "nested.nested.nested.value": (prev) => prev + 1,
  });
  const todoIndex: number = 0;
  obj.set(`nested.todos.${todoIndex}.title`, (prev) => prev + "");
}
