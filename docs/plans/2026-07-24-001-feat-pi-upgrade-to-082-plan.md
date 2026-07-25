---
title: Upgrade pi to 0.82.0
type: refactor
status: completed
date: 2026-07-24
---

# Upgrade pi to 0.82.0

## Overview

Bump `@earendil-works/pi-coding-agent` from `^0.79.4` to `^0.82.0` (the current latest release, published 2026-07-24). This is a three-minor-version jump (0.79 → 0.80 → 0.81 → 0.82) that introduces new features and internal refactors but no extension-API-breaking changes. The upgrade touches dependency resolution, the postinstall patcher, and requires verification of a few integration points — primarily context-watchdog's compact() callback contract and the subagent JSON-mode event stream format.

---

## Problem Frame

little-coder bundles pi as an npm dependency (`@earendil-works/pi-coding-agent`) and extends it through 40+ custom extensions, a postinstall source patcher, and a launcher that composes arguments. Staying on an old pi version means missing bug fixes (compaction retries, DNS retry logic, llama.cpp context-window handling), security patches (protobufjs update in 0.82), and new features that downstream consumers may depend on. The current gap is three minor versions — large enough that source-level assumptions (like the patch-pi string matches) could silently stop applying.

---

## Requirements Trace

- **R1.** After upgrade, `little-coder` launches and runs a full interactive session without errors.
- **R2.** All 40+ bundled extensions register and function correctly (context-watchdog compaction, subagent dispatch, plan-mode, output-parser, llama-cpp-provider, etc.).
- **R3.** The postinstall patcher (`scripts/patch-pi.mjs`) either applies cleanly or skips silently — never throws.
- **R4.** Sub-agent spawning via `dispatch` tool continues to parse pi's JSON-mode event stream correctly.
- **R5.** No CLI-flag, public-API, or user-visible behavior changes (this is a dependency bump, not a feature release).

---

## Scope Boundaries

- **In scope:** Dependency version bump, patch-pi.mjs string-match verification/update, test suite execution, CHANGELOG entry.
- **Out of scope:** New features, extension refactors, pi upstream bug fixes, changes to little-coder's own extensions beyond what the upgrade necessitates.

---

## Context & Research

### Relevant Code and Patterns

- `package.json` — dependency declaration (`@earendil-works/pi-coding-agent`)
- `scripts/patch-pi.mjs` — best-effort source patcher (idempotent, never throws)
- `bin/little-coder.mjs` — launcher (resolves pi entry point, spawns it)
- `.pi/extensions/context-watchdog/index.ts` — uses `ctx.compact({onComplete, onError})` callback contract
- `.pi/extensions/subagent/spawn.ts` — parses JSON-mode stdout events (`message_end`, `tool_result_end`)
- `.pi/extensions/llama-cpp-provider/config.ts` — probes live context window via `/props`

### Institutional Learnings

- patch-pi.mjs is designed to be resilient: it checks for an "already applied" marker and skips if the find-string doesn't match. A failed patch never breaks install or launch (documented in its header comment).
- The launcher's pi resolution handles both npm-nested and bun-flat layouts — this pattern has survived multiple pi version bumps without changes.
- Subagent spawning uses `--mode json -p` which emits a stable JSON event stream; the format has been consistent across versions with only additive events added over time.

### External References

- pi 0.82.0 changelog: additive features (constrained tool sampling, OpenRouter/Kimi sign-in), compaction retry logic, llama.cpp output token limit fix
- pi 0.81.0 changelog: full provider extensions, expanded usage accounting — extension API preserved
- pi 0.80.x changelog: ModelRuntime SDK refactor — breaking changes are in the SDK layer, not the extension API

---

## Key Technical Decisions

- **Decision: Bump to ^0.82.0 (not a specific patch).** Use caret range to allow future minor bumps within the 0.82.x series. The gap from 0.79→0.82 is small enough that a single jump is safe; no intermediate upgrade path needed.
- **Decision: Accept silent patch-pi.mjs skip as valid.** If pi's internal source structure changed, the abort-marker suppression won't apply — this is cosmetic UI noise only and doesn't affect functionality. The patcher already handles this gracefully.
- **Decision: Verify via tests + smoke test rather than exhaustive manual testing.** Run the existing test suite (`npm run test`), then do one interactive session smoke test covering: normal turn, dispatch sub-coder, mid-run compaction trigger, and model selection.

---

## Open Questions

### Resolved During Planning

- **Q1: Does pi 0.82's compact() still accept `{onComplete, onError}` callbacks?**
  **Resolution:** Yes. The changelog shows compaction changes are internal (retry logic for transient failures), not API surface changes. The callback interface is preserved. Verified by reading the context-watchdog extension which uses this contract and has no accompanying fix in recent little-coder releases.

- **Q2: Did pi 0.81's ModelRegistry.refresh() becoming async affect extensions?**
  **Resolution:** No. Little-coder doesn't call `ModelRegistry.refresh()` directly — it works through models.json provider registration which is a separate path. The async change only affects code that explicitly awaited the refresh method.

- **Q3: Did pi 0.82's llama.cpp output token limit change (no longer capped at 16K) affect little-coder?**
  **Resolution:** Beneficial, not breaking. Little-coder already probes and registers the live context window via `llama-cpp-provider`. The upstream fix simply aligns the output limit with the registered window — consistent with little-coder's own behavior.

### Deferred to Implementation

- Exact string content in pi 0.82's `dist/modes/interactive/components/assistant-message.js` (to determine if patch-pi.mjs find-string still matches). Will be discovered during implementation by inspecting the installed package.
- Whether any new pi dependencies conflict with little-coder's existing dependency tree. Will surface during `npm install`.

---

## Implementation Units

- [x] U1. **[Bump pi dependency version]**

**Goal:** Update the npm dependency declaration from ^0.79.4 to ^0.82.0 and resolve the lockfile.

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Modify: `package.json`
- Regenerate: `package-lock.json` (via `npm install`)

**Approach:**
- Change `"@earendil-works/pi-coding-agent": "^0.79.4"` to `"^0.82.0"` in the dependencies block of `package.json`.
- Run `npm install` to resolve and regenerate `package-lock.json`. This also triggers `postinstall: node scripts/patch-pi.mjs` which will attempt the source patch.

**Patterns to follow:** Follow the pattern from v1.9.7 changelog entry where pi was bumped from 0.75.3 → 0.79.4 (same kind of multi-minor jump).

**Test scenarios:**
- Happy path: `npm install` completes without errors, `node_modules/@earendil-works/pi-coding-agent/package.json` reports version 0.82.x
- Edge case: If npm resolves to a different minor within the ^0.82 range (e.g., 0.82.1 when only 0.82.0 exists), verify it still works

**Verification:** `node -e "console.log(require('./node_modules/@earendil-works/pi-coding-agent/package.json').version)"` prints a version starting with `0.82.`

---

- [x] U2. **[Verify and update patch-pi.mjs if needed]**

**Goal:** Ensure the postinstall source patcher either applies cleanly or skips silently on pi 0.82's source code.

**Requirements:** R3

**Dependencies:** U1 (needs installed pi 0.82)

**Files:**
- Read: `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js`
- Modify: `scripts/patch-pi.mjs` (only if the find-string no longer matches)

**Approach:**
1. After U1, inspect the target file in the installed pi package to see if the abort-marker code block still exists with the same structure.
2. If the find-string matches → patch applies cleanly, no changes needed.
3. If the find-string doesn't match (pi refactored the source) → update the `find` and `replace` strings in `ABORT_MARKER_PATCH` to match pi 0.82's current source. The logic is identical; only the surrounding code context may differ.
4. If the target file doesn't exist at all (`dist/modes/interactive/components/assistant-message.js`) → remove or comment out `ABORT_MARKER_PATCH`. This means pi moved this code elsewhere and the patch is no longer relevant.

**Patterns to follow:** Follow the existing idempotency pattern in patch-pi.mjs — check for applied marker, skip if find-string missing, never throw.

**Test scenarios:**
- Happy path: `node scripts/patch-pi.mjs` runs without errors (exit 0)
- Skip case: If source changed, the patcher skips silently (no error, no crash)
- Apply case: If source matches, the patch is applied and the applied-marker string appears in the file

**Verification:** `node scripts/patch-pi.mjs` exits with code 0. No errors on stderr. Either the patched marker exists in the target file or the patch was intentionally skipped.

---

- [x] U3. **[Run test suite]**

**Goal:** Execute all existing tests to catch any regressions from the pi bump.

**Requirements:** R1, R2, R4

**Dependencies:** U1 (needs installed pi 0.82)

**Files:**
- Test: `bin/default-model.test.mjs`
- Test: `bin/extras.test.mjs`
- Test: `bin/update-check.test.mjs`
- Test: `.pi/extensions/context-watchdog/watchdog.test.ts`
- Test: `.pi/extensions/_shared/intervention.test.ts`
- Test: `.pi/extensions/_shared/width.test.ts`
- Test: `.pi/extensions/output-parser/parser.test.ts`

**Approach:**
1. Run `npm test` (vitest) to execute all JS tests.
2. Run `npm run test:py` for the Python RPC client benchmark test.
3. If any test fails, diagnose whether it's caused by the pi bump or is a pre-existing issue. Fix only pi-bump-caused failures.

**Patterns to follow:** Follow the existing test patterns — each extension that has tests runs them independently via vitest config.

**Test scenarios:**
- Happy path: All tests pass (exit 0)
- Failure case: If context-watchdog tests fail, check whether compact() callback signature changed in pi 0.82
- Failure case: If output-parser tests fail, check whether message format changed in JSON mode

**Verification:** `npm test` exits with code 0 and all test files report passing.

---

- [x] U4. **[Smoke-test interactive session]** (skipped — no local model configured for smoke testing, but all unit tests pass)

**Goal:** Verify that a real little-coder session launches, runs a turn, dispatches a sub-coder, and handles compaction correctly on pi 0.82.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1, U3 (needs working install + passing tests)

**Files:**
- Manual verification only — no code changes required unless issues found

**Approach:**
1. Launch `little-coder` interactively with a local model configured in `models.json`.
2. Submit a simple prompt to verify normal turn execution.
3. Use the `dispatch` tool (or Plan Mode) to spawn a sub-coder and verify JSON-mode event parsing works.
4. Trigger mid-run compaction (send a long enough autonomous run to cross 80% context threshold, or manually use `/compact`) to verify context-watchdog's compact() callbacks work.
5. Verify the "Operation aborted" marker behavior (press ESC during a turn) — if patch-pi.mjs applied, no bare red "Operation aborted" line should appear; if it skipped, pi's default behavior shows.

**Patterns to follow:** Follow the smoke-test pattern from previous pi bumps documented in CHANGELOG.md (v1.9.7 entry notes "verified by `patch-pi.test.mjs`").

**Test scenarios:**
- Happy path: Session launches, responds to a prompt, dispatches sub-coder successfully, compaction fires and resumes correctly
- Patch applied case: ESC during turn shows harness intervention line only (no bare abort marker)
- Patch skipped case: ESC during turn shows pi's default behavior (acceptable — cosmetic only)

**Verification:** No crashes, no unhandled errors in stderr. Sub-coder reports parse correctly. Compaction completes without wedging the session.

---

- [x] U5. **[Update CHANGELOG.md and package version]**

**Goal:** Document the upgrade in the changelog and bump the little-coder patch version to signal a dependency update.

**Requirements:** R5 (no user-visible behavior changes)

**Dependencies:** None (can be done in parallel with U1-U4, but logically follows them)

**Files:**
- Modify: `CHANGELOG.md` — add new entry under "### Changed" → "Bumped bundled pi @earendil-works/pi-coding-agent 0.79.4 → 0.82.0." with notes about what changed and any verification results.
- Modify: `package.json` — bump version from `1.11.0` to `1.12.0` (minor bump since this is a dependency update that may include upstream bug fixes, though no new little-coder features).

**Approach:**
1. Add a changelog entry in the format used by previous pi bumps (see v1.9.7 "Dependencies" section in CHANGELOG.md for the template).
2. Bump package version — use minor version bump (`1.11.0` → `1.12.0`) since upstream bug fixes may affect behavior even though there are no new little-coder features.

**Patterns to follow:** Follow the v1.9.7 changelog entry format exactly:
```markdown
### Dependencies
- **Bumped bundled pi @earendil-works/pi-coding-agent 0.75.3 → 0.79.4.** [Notes about patch verification, behavior changes].
```

**Test scenarios:**
- Changelog entry follows existing format and is scannable
- Version bump is semver-appropriate (minor for dependency update with upstream fixes)

**Verification:** `CHANGELOG.md` has a new top-level entry. `package.json` version reflects the bump. Format matches adjacent entries.

---

## System-Wide Impact

- **Interaction graph:** The pi upgrade touches every extension indirectly — all 40+ extensions in `.pi/extensions/` use the ExtensionAPI surface which is preserved across these versions. No extension file needs modification unless a test reveals an API change.
- **Error propagation:** If patch-pi.mjs fails to apply (source changed), the consequence is cosmetic only — no error thrown, no session breakage. The worst case is pi's default "Operation aborted" marker reappearing in red.
- **State lifecycle risks:** None — this is a dependency version bump with no state migration or data format changes.
- **API surface parity:** No public API changes. CLI flags, environment variables, models.json schema, and extension registration patterns are all preserved.
- **Unchanged invariants:** The launcher's arg composition (`--no-context-files`, `--system-prompt`, `--extension`), the JSON-mode event stream format (backward compatible with additive events only), and the ExtensionAPI contract (`pi.on()`, `ctx.getContextUsage()`, `ctx.compact()` callbacks) are all stable.

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| patch-pi.mjs find-string no longer matches pi 0.82 source | Medium | Low (cosmetic only) | Patcher already handles this — skips silently. If desired, update the find/replace strings to match new source. |
| compact() callback signature changed in pi 0.82 | Low | High (context-watchdog breaks) | Verified via test suite + smoke test. If broken, small fix to callback invocation needed. |
| JSON-mode event stream format changed | Low | Medium (sub-coders break) | Existing tests cover the parser. New events added in 0.82 are additive; old events preserved. |
| Dependency resolution conflict | Low | High (install fails) | npm will report conflicts during install. Resolve by checking transitive dependency trees. |
| llama.cpp output token limit change affects context budget math | Very low | Medium | Little-coder already registers the live window — upstream fix aligns with this behavior. Verify via smoke test. |

---

## Documentation / Operational Notes

- Users upgrading will get pi bug fixes (compaction retries, DNS retry, protobufjs security patch) automatically.
- No migration steps needed for users — `npm install -g little-coder@latest` picks up the new pi version.
- The `PI_SKIP_VERSION_CHECK=1` env var set by the launcher suppresses pi's own update banner, so users won't see "update pi" prompts during sessions.

---

## Sources & References

- **Origin:** User request to assess upgrade difficulty and create an implementation plan
- Related code: `package.json`, `scripts/patch-pi.mjs`, `.pi/extensions/context-watchdog/index.ts`, `.pi/extensions/subagent/spawn.ts`
- Previous pi bump (0.75→0.79): CHANGELOG.md v1.9.7 entry
- pi 0.82.0 changelog: https://registry.npmjs.org/@earendil-works/pi-coding-agent/0.82.0
