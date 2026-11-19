# Implementation and verification

The recipe pricing and item-use research milestone shipped to `main` in [PR #7](https://github.com/buttery-x3/goblin-ledger/pull/7). On 19 November 2026 the player reported testing that candidate with their own characters and finding that most behaviour matched their expectations. Individual addon events, export contents and bank scopes were outside that report.

| Area | Implemented | Verification boundary |
|---|---|---|
| Workspace | Named arrangements, four presets, programmable pane selection, adjustable splits, route-specific highlights, keyboard-accessible list, density and saved filters | Simulated DOM, SVG data and layout-state tests. Actual visual appearance and pointer feel await player inspection. |
| Markets | Whole-house snapshot publication, evidence at the vendor floor, supply changes, refill detection, bounded item history and book lookups, attributed time-limited price cross-check | End-to-end US and EU service ingests and synthetic edge cases. Three EU asks and one US ask matched independent scans at different times. US listed quantity differed on the comparable item. The selected home region starts unset. |
| Farms and crafting | Two distinct Hinterlands localities and a Maraudon loop, elapsed haul entry, actor-specific yields and session returns, explicit sale-to-haul allocation, searchable imported recipes with ingredient and output links, tier-sensitive batch quotes, and curated transformations | Imported recipes carry their catalog revision when available. Batch sales use an ask-price scenario. Vendor stock, bundle sizes, unresolved yields and learning requirements need separate evidence. Route locations are schematic. Scenarios and player measurements have separate provenance. |
| Characters and holdings | Folder inspection, staged addon install, background import, character snapshots, FIFO acquisitions and sales, player-confirmed alt transfers and manual reconciliation | Synthetic Windows installations, exports and a Lua event harness. The player tested the preceding milestone with their characters. Transfer coverage uses synthetic multi-character histories. Optional mailbox invoice capture still needs compatible evidence. |
| Research and progression | Dated Skulk Rock guide, revision-aware item-use theses in Research and Markets (including unlisted items), historical replay, optional loopback model annotations, account challenges and per-character skill eligibility | One reviewed starter guide plus manual records. Synthetic build changes and hand-ins exercise effective dates, observation times, local availability and corrections. Repeatability, market demand, audience reach and offline rested projections require independent evidence. |
| Operations | Persistent attempts, retry identities, failure logs, connection events, cooldowns, profile isolation, online backup and verified restore | Deterministic HTTP, SQLite and restart tests. Initial deployment has schema version 1. A later production schema upgrade must exercise the migration with real preceding schema fixtures. |

## Market evidence

A hosted Windows diagnostic on **18 November 2026 at 15:50:17 UTC** used the US PvP Alliance profile. The provider returned house `us-2-110`, 6,746 items and a source timestamp of `1795015501000` milliseconds UTC. The item endpoint for Dark Iron Residue (18945) returned 24 hourly observations and seven visible price tiers with no additional tiers reported. Source time and retrieval time are different fields. This diagnostic did not select the player's home region.

A second Windows diagnostic at **16:05:56 UTC** exercised the service on the EU PvP Alliance house. It published **6,942 items** to SQLite, generated **44 scanner findings** and retrieved 23 history rows and nine price tiers for item 18945. Three like-for-like item asks matched a separate, explicitly labelled AHledger EU scan. The two sources observed the house about 37 minutes apart, so this corroborates the mapping without establishing identical inventory or transactions. No secondary prices were archived.

A US service check at **18:14 UTC** published 6,759 items and compared three commodities. One ask matched with a different listed quantity, one independent scan was too old, and the third request failed. Independent corroboration of the US mapping is limited to that one ask. The item-level outcomes and timestamps are in [market verification](market-verification.md).

The initial recipe response exposed an output quantity the first normalizer could not represent as a positive whole number. After the fix, a separate hosted request at 15:57:33 UTC validated 2,493 recipe records and a linked product with reagents. Uncertain yields stay unpriced. See the [archive benchmark and test method](market-verification.md).

## Runtime decisions

The clean Windows Node 26.13.1 build attempted `better-sqlite3@13.0.3`. Its native installation failed. The application uses the bundled `node:sqlite` interface, including the online backup API. This follows the built-in-driver exception in the development plan and removes a native compiler prerequisite.

The service exposes only loopback endpoints. State-changing routes require the session cookie and request token. The browser includes a profile identifier and reacts to a change made by another tab. Expiring secondary price observations live in memory. Regular backups apply expiry for the durable market archive during recovery.

## Development limits

Additional adapters for credentialed Blizzard and ForeverDB.net sources remain optional future work. The current catalog and research assumptions are linked to their sources in the panels. Detailed visual checks across layouts and independent verification of a natural in-game export remain outstanding.
