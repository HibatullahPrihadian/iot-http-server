---
description: Implement a feature with checks and self-review
---

Implement the requested feature: $ARGUMENTS

Work through these steps:

1. Read the repository instructions in `AGENTS.md` and inspect the relevant application code before editing. Identify the affected service(s), API/UI contracts, and existing tests.
2. If the request is ambiguous or has materially different behavior choices, ask one concise clarification before changing code. Otherwise state a short implementation plan and proceed.
3. Keep the change focused. Preserve the existing architecture and conventions. Database migrations must be additive and idempotent. Do not read, print, or modify secrets, `.env` files, `note.txt`, or persistent production data.
4. Every new feature must increment the application version before committing: use `npm run version:bump -- minor` (for example, `2.7.0` -> `2.8.0`). Use `patch` for bug fixes and `major` only for breaking changes. Never edit `VERSION`, package versions, or lockfiles manually; the bump script synchronizes them. Run `npm run version:check` afterward. Include the resulting `v<version>` in every commit message as required by `AGENTS.md`.
5. Add or update tests for changed behavior where practical. Run the relevant checks, and for a broad feature run:
   - `npm run version:check`
   - `npm run test:hidro`
   - `npm run test:settings`
   - `npm run build:web`
   Do not treat `npm test --prefix iot-api` as a passing test: its current script is a placeholder that exits with failure. Report this test coverage gap when relevant.
6. Inspect the final diff for correctness, regressions, secrets, generated files, and unrelated edits. Do not discard or overwrite pre-existing user changes.
7. Finish with a concise report of files/behavior changed, exact checks and results, remaining risks or untested behavior, and a suggested PR title/body. Do not merge, deploy, or claim that a PR was created unless that action was explicitly requested and actually completed.

The user reviews the branch and CI result and performs the merge manually. Never access production credentials or deploy from this workflow.
