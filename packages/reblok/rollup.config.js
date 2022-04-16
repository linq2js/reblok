import { uglify } from "rollup-plugin-uglify";

export default {
  input: "./dist/tsc/main.js",
  output: {
    dir: "dist",
    format: "cjs",
    indent: false,
  },
  plugins: [uglify()],
};
