# Market verification

## Reproduce the checks

Run the focused acceptance cases from the repository root.

```powershell
node --test apps/local/market.test.mjs
```

To check the provider from a machine with internet access, choose a diagnostic region explicitly. The probe records contract outcomes and dates. It does not select the player's home market.

```powershell
node scripts/probe-market.mjs us
```

AuctionHouse.tk.gg supplies house discovery, a bulk snapshot and targeted item histories. The application limits each house overview to one request per hour and queues detail requests one item at a time. The provider infers the PvP label for group 1. A separately timed AHledger check is available from an item detail view. With a known item ID, use **Look up #…** even before the first complete primary snapshot arrives. The independent scan retains its own house key and observation time, expires with its cache allowance, and stays outside the SQLite archive. [Primary data contract](https://auctionhouse.tk.gg/data/) · [AHledger fields and access terms](https://ahledger.com/developers)

A hosted Windows diagnostic on 18 November 2026 at 15:50 UTC resolved the US PvP Alliance key `us-2-110`. Its primary overview contained 6,746 items. Item 18945 returned 24 hourly observations and seven visible tiers with a book time of 15:25:01 UTC. The local development environment could not resolve the provider hostname. The hosted check establishes that those primary endpoints returned coherent payloads at that time.

## Archive load test

```powershell
node scripts/benchmark-markets.mjs 6600 720
```

The script creates a temporary SQLite database, synthesises 6,600 items for each of 720 hourly observations, and publishes each snapshot through the normal transaction and scanner. It includes the scan for previously unseen items, derived findings, indexes and retention work. At the end it queries a 40-row market page, the active opportunities and one item's 30-day local history, checkpoints the WAL and measures the database file. The temporary directory is released when the process exits normally. Smaller arguments run a shorter sanity check.

| Measurement | Result |
|---|---:|
| Item observations | 4,752,000 |
| Total ingestion time | 792.29 s |
| Mean time per 6,600-item snapshot | 1.10 s |
| Database size after checkpoint | 2,548,666,368 bytes (2.37 GiB) |
| Highest process RSS sampled after a snapshot | 359,067,648 bytes (342.4 MiB) |
| First market page plus opportunities query | 5.91 ms |
| One-item history query | 13.61 ms |

Measured on Windows, AMD Ryzen 5 5600X, 31.95 GiB RAM and Node 24.15.0. The query measurements came from the first implementation of the market handlers during the build, with an already warm database. They cover local server work only. Provider latency, browser rendering, populated recipe search and storage on other machines can produce different timings. The benchmark stays outside routine CI.

A separate Windows service check on 18 November at 16:05:56 UTC published the EU house, validated search and scanner results, and compared three targeted asks in memory with a separately labelled AHledger scan. The primary recipe check also passed after the quantity fix. Results and observation limits are recorded in [implementation status](implementation-status.md). Run the end-to-end source check on demand with `node scripts/probe-service.mjs eu`. Pass `us` for the US house. Each execution fetches a full public overview. Respect the one-per-market-per-hour limit across diagnostic profiles.

## US comparison on 18 November 2026

At 18:14 UTC the service published 6,759 items for `us-2-110` from the 17:25:01 UTC snapshot, produced 22 scanner findings and retrieved 24 history rows and 12 book tiers for item 18945. The diagnostic selected commodity IDs from the primary house and checked them individually against AHledger.

| Item | Independent scan (UTC) | What could be compared |
|---|---|---|
| 18945 | 13 November, 23:39:43 | Outside the one-hour comparison window. |
| 3030 | 18 November, 18:01:41 | The asks agreed. The listed quantities differed across the 36-minute, 40-second interval. |
| 8069 | Unavailable | The comparison request failed. No observation was available. |

The single matching ask gives limited support for the US mapping. A multi-item check with agreement across the two sources remains outstanding. The diagnostic records comparison outcomes and timestamps. Secondary prices and quantities stay out of the archive. [Windows diagnostic run](https://github.com/buttery-x3/goblin-ledger/actions/runs/44367327317)
