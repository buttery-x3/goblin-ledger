# Goblin Ledger

A local Windows dashboard for finding gold-making opportunities on a WoW Forever PvP Alliance auction house. Start with the Atlas to compare farms, or search the whole house in Markets. The workspace also brings together crafting costs, dated guide advice, character eligibility and the cost basis of your holdings.

## Run on Windows

Install [Node.js 26.13.1 LTS](https://nodejs.org/en/blog/release/v26.13.1). From a source checkout, run these commands in PowerShell in the repository folder.

```powershell
.\Setup-GoblinLedger.cmd
.\Start-GoblinLedger.cmd
```

Setup installs the locked dependencies and builds the frontend. For subsequent starts, double-click **Start-GoblinLedger.cmd** and open **http://127.0.0.1:4774**. A second launch reports the running instance. Leave the service window open to collect hourly snapshots. Close it or press Ctrl+C to stop collection.

A Windows build artifact contains the built interface and its service dependencies. Extract the inner GoblinLedger-windows.zip, then run Start-GoblinLedger.cmd from the extracted folder.

## Read the house and choose an activity

Open **Opportunities → House trends** to see rising and falling asks, changes in listed supply and how many items had comparable observations. Choose the previous scan, 24 hours or seven days. On the first scan you can already inspect current supply. Open a mover to see its price history. When the item has a known farm, expand **Where to farm this item** for routes and the characters who meet their recorded requirements.

In **Characters → Gold-making activities**, choose an alt and a session length. Each suggestion names the item and location, explains the character’s requirements and links to the route in Farms. A route without a measured yield shows the units per hour needed to meet your target when an ask is available. You can explore these leads as soon as market and character data arrive.

## First session

1. Open **Settings**, choose **Live**, select **US** or **EU**, then **Apply profile**. The collector discovers the PvP Alliance house for that region. To explore with synthetic prices and characters, select **Demo**. Each profile has its own database and saved arrangements.
2. In the **Atlas**, select a named hotspot. Its route opens in **Farms**, where you can inspect requirements, change session length and enter a timed haul. A missing auction quote or measured yield is shown as a gap. When you sell a tracked haul, open **Farms → History → Sale receipts**. Select the sale, stack and quantity to replace the sold portion of the estimate with the receipt. **Opportunities** keeps its house-wide results when you select a route.
3. In **Markets**, search by name or item ID to inspect asks, listed quantity, inferred activity and history. In **Professions**, choose **Refresh catalog**, search for a recipe or ingredient, select a recipe and enter your batch size. Click **Check price tiers** beside a listed ingredient to fill in missing purchase depth. **Research** shows dated recommendations.
4. For character data, choose **Settings → Browse folders** or paste your WoW parent or `_forever_` folder. Inspect the resolved destination, select the account and click **Install**. Enable the addon during normal play. After a normal logout or UI reload, the service imports the saved export. The next ordinary bank visit supplies an observed bank snapshot. **Positions** supports manual opening balances, purchases, sales and hold notes.
5. Open **Layouts** to switch among one, two, four or eight panes or save an arrangement. The initial view gives the Atlas the full left side, with Farms, Opportunities and Characters on the right.

In **Research**, choose **Add source**, set **Action** to **changed use**, and enter the affected item IDs. For a build change, link the source and enter its effective date. For an observed turn-in, record who saw it, where and when (UTC). Find the item by ID in **Markets** to see its thesis, even when it has no listing. Use **Record a revision** in Research to correct the evidence or replay an earlier date to see what was known then.

## Status and recovery

**Console** shows attempts, logs, source errors, last success, next scheduled work and controls. A failed provider poll preserves the preceding snapshot and its original timestamp. In Demo, run the diagnostic and retry its failed attempt to exercise recovery.

The default data directory is `%LOCALAPPDATA%\GoblinLedger`, with separate `live` and `demo` directories. Use the backup and verification jobs in Console for a consistent SQLite snapshot. To inspect a backup, restore to an **empty** directory with the recovery command below. Stop the current service or choose a different port for the restored session. Choose a fresh data root, restore into its `live` subdirectory and point `GOBLIN_LEDGER_HOME` at the new root before starting.

```powershell
node apps/local/operations/recover.mjs "C:\backups\snapshot.sqlite" "C:\LedgerRestore\live"
```

If the dashboard is unreachable, relaunch it and read the launch window or `bootstrap.log` in the private data directory. Set `GOBLIN_LEDGER_PORT` to choose another port. All state-changing requests use the same-origin local session.

## Development

The pinned package manager is pnpm 10.26.2. From a clean checkout with that version available, run the following commands.

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm smoke
node scripts/workspace-dom.mjs
pnpm start
```

| Location | Responsibility |
|---|---|
| `apps/web` | React workspace, route navigation, Atlas and tool panels |
| `apps/local` | Fastify API, SQLite profiles, jobs, source adapters and recovery |
| `packages/domain` | Evidence, economics, identity and progression rules |
| `addon/GoblinLedger` | UI-free game addon and account-scoped export |
| `docs/` | Product contract, development plan and verification evidence |

The primary market and recipe feed comes from [AuctionHouse.tk.gg](https://auctionhouse.tk.gg/data/). The optional item cross-check comes from [AHledger](https://ahledger.com/developers). Route, article and recipe records carry their source links. Consult the [implementation status](docs/implementation-status.md), [product design](docs/Goblin-Ledger-Design-v2.md), [development plan](docs/Goblin-Ledger-Agent-Plan-v2.md) and [repository instructions](AGENTS.md).
