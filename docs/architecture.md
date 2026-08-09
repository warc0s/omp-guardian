# Architecture

OMP Approval Reviewer is an OMP extension with one production entry point:
`dist/index.js`.

## Runtime boundary

`src/index.ts` installs `src/omp/runtime.ts`. The runtime shadows Bash, observes
other tool calls, and delegates approved Bash calls through OMP's native
`ctx.invokeTool` exactly once. It does not implement an independent shell.

The routing order is:

1. emergency brake and trusted executable deny list;
2. static tool, command, capability, and path analysis;
3. bounded evidence collection;
4. isolated model review;
5. deterministic decision gates;
6. allow-once, deny, or explicit manual disposition.

## Reviewer isolation

`src/omp/invoker.ts` starts a fresh `omp -p` child process. The child inherits
only the selected model and thinking level. Tools, saved sessions, LSP, skills,
rules, title generation, prewalk, and PTY support are disabled. A child marker
prevents recursive extension registration.

## Evidence

The reviewer receives bounded and redacted evidence assembled from:

- the exact pending tool call;
- direct user messages and recent session transcript;
- static Bash capabilities;
- Git state relevant to pending mutations;
- local script contents when safely readable;
- SSH destination, remote semantics, and bounded stdin code.

Enrichment describes an action but never authorizes it. Missing evidence is
surfaced explicitly.

## Trust boundary

Global configuration is trusted. Repository configuration is untrusted and may
only make behavior more restrictive. The reviewer model, audit destination,
trusted roots, and baseline protections cannot be weakened by a repository.
