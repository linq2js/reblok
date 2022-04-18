# reblok

2KB (GZipped) state manager for React. It is tiny but powerful

## Installation

**NPM**

```bash
npm i remos --save
```

**YARN**

```bash
yarn add remos
```

## Live Demos

https://codesandbox.io/s/reblok-demo-5ksi6t

## Recipes

### Counter App (3 lines of code)

```jsx
import { blok } from "reblok";
// creating a blok with initial data
const counter = blok(0);
// using use() method to bind the blok to React component
const App = () => <h1 onClick={() => counter.data++}>{counter.use()}</h1>;
```

### Async data

```jsx
import { blok } from "reblok";
// block data can be promise object
const userProfile = blok(
  fetch("https://jsonplaceholder.typicode.com/users/1").then((res) =>
    res.json()
  )
);
console.log(userProfile.loading); // true

const UserProfile = () => {
  // if the blok is still loading, a promise object will be thrown
  // and Suspense component will handle loading status
  const { username } = userProfile.use();
  return <div>{username}</div>;
};

const App = () => (
  // blok also supports suspense and error boundary
  <Suspense fallback="Loading...">
    <UserProfile />
  </Suspense>
);
```

### Updating blok using reducer

```js
import { blok } from "reblok";

const counter = blok(0);
counter.set((prev) => prev + 1);
```

### Batch updating

```js
import { batch } from "reblok";

batch(() => {
  counter.data++;
  counter.data++;
  counter.data++;
});
// the counter change triggers once
```

## API Reference

Docs: https://linq2js.github.io/reblok/

### Default Export: blok(initialData): Blok

### Default Export: blok(sourceBlok, selector, concurrentMode?): Blok

Create a blok from source blok, the blok data is result of selector. Passing concurrentMode to control blok updating behavior

```js
const counter = blok(0);
const doubledCounter = blok(counter, (x) => x * 2);
// when counter blok changed, the debouncedDoubledCounter does not update immediately, it delays update in 100ms
const debouncedDoubledCounter = blok(counter, (x) => x * 2, debounce(100));
```

### Default Export: blok(mutation): any

### Blok Insntance: blok.loading: boolean

### Blok Insntance: blok.error: any

### Blok Insntance: blok.data: any

### Blok Insntance: blok.get(): any

### Blok Insntance: blok.set(data): void

Update blok data, if the data is the same of previous one, no change is triggered.
The data can be:

- Any object
- A function which retrieves previous data and return new data
- A promise object. When passing promise object as blok data, the blok status becomes loading.
  When the promise is resolved, the blok uses resolved value as its data.
  When the promise is rejected, the blok uses rejected reason as its error

### Blok Insntance: blok.listen(listener): Function

Register listener to listen blok change event and return unsubscribe function

### Blok Insntance: blok.use(): any

Bind the blok to React component and return the blok data

```js
const count = counter.use();
```

Note: use() handles suspense and error boundary automatically.
If the blok is loading, a promise object throws when component is re-rendering.
If the blok has an error, the error throws when component is re-rendering.

```jsx
const CountValue = () => <div>{counter.use()}</div>;
const App = () => (
  <Suspense fallback="Loading...">
    <CountValue />
  </Suspense>
);
```

### Blok Insntance: blok.use(selector, compare?): any

Bind the blok to React component and return selected slice of data.
By default, blok uses strict compare function to compare selector result.
If the selector result is complex object, you can use shallow compare to optimize rendering

Note: Using use() with selector does not handle suspense and error boundary.

```js
// the component always re-render when the state changed because the selector always returns new object
// prevResult !== nextResult
const { id, username } = profile.use((x) => ({
  id: x.id,
  username: x.username,
}));

import { shallow } from "blok";

const { id, username } = profile.use(
  (x) => ({
    id: x.id,
    username: x.username,
  }),
  // using shallow compare function to optimize re-render
  shallow
);
```

### debounce(ms)

Delay updating in X milliseconds

```js
import { blok, debounce } from "reblok";

function updateCounter() {
  counter.set((prev) => prev + 1, debounce(500));
}

updateCounter(); // counter = 0
updateCounter(); // counter = 0
updateCounter(); // counter = 0
// wait in 600ms
// counter = 1
```

### throttle(ms)

```js
import { blok, throttle } from "reblok";

const counter = blok(0);

function updateCounter() {
  counter.set((prev) => prev + 1, throttle(500));
}

updateCounter(); // counter = 1
updateCounter(); // this updating is skipped
// wait in 600ms
updateCounter(); // counter = 2
```
