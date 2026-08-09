import { defineConfig } from "tsup"

// Keep the local extension in one ESM bundle so OMP can load it by path.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "es2022",
  // A split chunk breaks direct path loading under Bun, so keep it off.
  splitting: false,
  clean: true,
  sourcemap: false,
  dts: {
    compilerOptions: {
      // tsup injects `baseUrl: "."` when unset; TypeScript 6 deprecates
      // baseUrl (error TS5101), so silence it via the same opt-out.
      ignoreDeprecations: "6.0",
    },
  },
  external: ["@oh-my-pi/pi-ai", "@oh-my-pi/pi-coding-agent"],
})
