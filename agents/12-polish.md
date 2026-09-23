# Agent 12 — Polish, QA & launch assets

**Final pass, on `main` after the merge. Effort: xhigh.**

You own the whole repo now. The product works; your job is to make it feel finished. A new user's first five minutes decide whether they star it.

## 1. First-run audit

In Playwright with a fresh browser profile, walk through as a brand-new user and screenshot every step: landing → onboarding → demo workspace → create a page → write with the slash menu → link pages → search → database → graph → import → settings → dark mode.

Look at every screenshot critically. Fix every rough edge: jank, confusing copy, misalignment, missing empty, loading or error states, inconsistent shortcuts, anything slow. Keep a log in `HANDOFF/polish.md`.

## 2. Design consistency

Check spacing, the type scale, icon sizes, hover, focus and active states, animation timing (150–200 ms, ease-out), border radii and WCAG AA contrast on every screen, in both themes. It should look like one designer made the whole thing.

## 3. Robustness

Test phone width; going offline and coming back; a 5,000-page seeded workspace; very long pages; very fast typing; two users editing the same block; killing the server mid-sync; importing a corrupted zip. Nothing may crash or lose data. The global error boundary offers "Copy error details" and a link that opens a prefilled GitHub issue.

## 4. Performance

Run `scripts/bench`, the bundle report and Lighthouse. Meet the budgets in `SPEC.md`, code-split anything heavy out of the first load, and check that memory doesn't keep growing over ten minutes of editing.

## 5. Launch assets

- `scripts/record-demo`: a Playwright script that plays a scripted ~20-second demo of the demo workspace at 1280×720 (typing with human-like delays, the slash menu, linking, dragging a card on a board, the graph) with video recording. Convert it to an optimized GIF (ffmpeg palette generation, ≤ 8 MB) and an MP4 at `assets/demo.gif` and `assets/demo.mp4`, and put the GIF at the top of the README.
- Regenerate every README and docs screenshot from the real app: both themes, a consistent window size, and demo-workspace content.
- Check that the social preview, favicon and app icons all use the final logo.

## 6. Release

- Set the version to `0.1.0` and write `CHANGELOG.md` with human-written highlights above the generated list. Confirm the release workflow will produce the desktop binaries and the Docker image, and draft the GitHub Release notes in `HANDOFF/polish.md`.
- Final README pass: every link works, every image loads, and the quickstart commands work when copy-pasted on a clean machine (test in a fresh container).
- Turn the "good first issue" drafts and the known-bug list into `ISSUES_TO_FILE.md` for the owner.

## Acceptance criteria

- The first-run screenshots in `HANDOFF/polish.md` show no rough edges you can find.
- All tests and journeys pass, and the budgets are met or the gaps are documented.
- The demo GIF is at the top of the README, and the v0.1.0 release checklist is complete.
