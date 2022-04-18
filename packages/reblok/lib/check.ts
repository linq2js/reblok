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
}
