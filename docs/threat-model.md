# Threat model

## Protected assets

- credentials, tokens, cookies, private keys, and authenticated sessions;
- private repository contents and local files;
- unpushed work and Git history;
- remote services, production systems, and user accounts;
- the integrity of OMP's approval boundary.

## Adversaries and failures

- an agent attempting an action outside user intent;
- prompt injection embedded in repositories, tool output, or remote content;
- ambiguous shell syntax and dynamically generated code;
- a reviewer model returning malformed or unsafe output;
- provider errors, timeouts, missing context, or unavailable UI;
- project configuration attempting to weaken trusted policy.

## Mitigations

- deterministic emergency brake before inference;
- tool-free reviewer subprocess with ambient agent features disabled;
- redaction and bounded evidence before provider submission;
- versioned structured decisions plus deterministic post-review gates;
- asymmetric configuration trust boundary;
- fail-closed error handling and denial circuit breaker;
- append-only audit records without raw commands.

## Explicit non-goals

This extension is not a sandbox, malware detector, network isolation layer,
policy proof system, or guarantee that a model understands every shell program.
An approved process still runs with the user's operating-system privileges.

Use containers, restricted accounts, filesystem permissions, network controls,
and secret isolation when stronger boundaries are required.
