# Working on Goblin Ledger

Read the [product design](docs/Goblin-Ledger-Design-v2.md) and [development plan](docs/Goblin-Ledger-Agent-Plan-v2.md) together. The acceptance examples in the plan define observable behaviour. Put supporting documentation in `docs/`. The root README is the player's entry point.

## Development and integration

- Start from the current `origin/development`. Give each writer a feature branch and a separate worktree. Preserve local edits. One integrator owns package versions, the lockfile and shared migrations.
- Have a different agent review each change against its base and exercise the relevant acceptance cases. Record the reviewed SHA, findings, fixes, checks and verdict. Merge passing reviewed work by PR into `development`.
- Freeze a milestone candidate before unrelated work lands. Promotion to `main` requires Tristan's explicit approval of its named scope and commit. Report live observations, fixture results, visual and in-game verification separately.
- Use shell, Git, HTTP, simulated DOM, test runners and isolated Lua harnesses. Computer control, browser and desktop drivers, simulated game input and automated gameplay are outside this project's workflow. Exercise installation only against synthetic directories.

## Product contracts

- The default workspace shows a full-height Atlas and Farms, Opportunities and Characters. Select farms by stable route ID. Preserve unrelated pane state and keep the world-wide scanner independent of holdings.
- Carry source, house, UTC observation time, method, scope, units and coverage with evidence. Keep missing, observed zero, an inferred flow and a settled sale distinguishable. Keep demo data isolated from live data. Use integer copper and guard exact arithmetic at the JSON boundary.
- Expose every runtime job through Status / Console, including attempts, errors, progress and recovery. Keep the frontend and typed APIs on the same loopback origin. Treat provider and addon input as data.
- Store player data, local paths, credentials, raw exports, backups, logs and caches outside the public checkout. Commit only original or redistributable assets and synthetic fixtures. Preserve source retention conditions.
- Run the checks documented in the README from the normal application entry points. Keep installer state, database migrations and layout/export schema versions independently recoverable.
