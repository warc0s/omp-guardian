# Compatibility

| Component | Supported                | Validation                                                                |
| --------- | ------------------------ | ------------------------------------------------------------------------- |
| OMP       | `>=17.2.12 <18`          | Extension loader, tool hook, Bash delegation, model context, thinking API |
| Bun       | `>=1.3.0`                | CI tests the minimum and pinned current versions                          |
| Platforms | Linux and macOS expected | Windows paths are handled, but the beta needs more live Windows coverage  |

The extension uses OMP's extension API and `ctx.invokeTool`. These interfaces
may change between OMP releases. Run the full check and live smoke after every
OMP upgrade. Do not widen the declared range without a fresh live validation.

The live smoke must use a freshly built `dist/index.js` and a new OMP process;
an already-running process has stale imported code.
