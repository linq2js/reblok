# reblok

1KB (GZipped) state manager for React. It is small and easy to use

## Installation

**NPM**

```bash
npm i remos --save
```

**YARN**

```bash
yarn add remos
```

## Recipes

### Counter App (3 lines of code)

```jsx
import blok from "reblok";
// creating a blok with initial data
const counter = blok(0);
// using use() method to bind the blok to React component
const App = () => <h1 onClick={() => counter.data++}>{counter.use()}</h1>;
```

### Async data

```jsx
import blok from "reblok";
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
  <Suspense fllback="Loading...">
    <UserProfile />
  </Suspense>
);
```

### Updating blok using reducer

```js
import blok from "reblok";

const counter = blok(0);
counter.set((prev) => prev + 1);
```
