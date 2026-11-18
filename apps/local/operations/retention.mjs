// The primary adapter is the sole live source in these tables. Synthetic
// books are identified by their profile's explicit demo snapshot provenance.
export function expireRestoredMarket(db, now = Date.now()) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((t) => t.name),
  )
  if (!tables.has('market_snapshots')) return
  const cutoff = now - 30 * 24 * 3600_000
  db.exec('BEGIN IMMEDIATE')
  try {
    // Keep the synthetic fixture intact even when opened long after its date.
    // Remove expired orphaned tiers, including books without an overview.
    for (const table of [
      'market_rows',
      'market_details',
      'market_findings',
      'market_signal_versions',
    ]) {
      if (tables.has(table))
        db.prepare(
          'DELETE FROM ' +
            table +
            " WHERE t<? AND house NOT IN (SELECT house FROM market_snapshots WHERE source='demo')",
        ).run(cutoff)
    }
    if (tables.has('market_house')) {
      db.prepare(
        "DELETE FROM market_house WHERE json_extract(data,'$.snapshot')<? AND json_extract(data,'$.key') NOT IN (SELECT house FROM market_snapshots WHERE source='demo')",
      ).run(cutoff)
    }
    db.prepare(
      "DELETE FROM market_snapshots WHERE t<? AND source='auctionhouse.tk.gg'",
    ).run(cutoff)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
