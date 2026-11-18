import {createHash} from 'node:crypto';
import {guideRecord, normalizeArticle} from '../../../packages/domain/research.mjs';
import {challengeCatalog} from '../../../packages/domain/progression.mjs';

const initialized = new WeakSet();
export function initResearch(db) {
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research_revisions (
    id TEXT NOT NULL, revision INTEGER NOT NULL, first_seen TEXT NOT NULL, available_at TEXT NOT NULL,
    fingerprint TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id,revision));
    CREATE INDEX IF NOT EXISTS research_available ON research_revisions(id,available_at);
    CREATE TABLE IF NOT EXISTS research_notes (id TEXT NOT NULL, revision INTEGER NOT NULL, generated_at TEXT NOT NULL,
      note TEXT NOT NULL, PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS research_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS legacy_completion (pool TEXT NOT NULL,id TEXT NOT NULL,state INTEGER NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(pool,id));`);
  if (!db.prepare('PRAGMA table_info(legacy_completion)').all().some(col => col.name === 'pool')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE legacy_completion RENAME TO legacy_completion_unscoped;
        CREATE TABLE legacy_completion(pool TEXT NOT NULL,id TEXT NOT NULL,state INTEGER NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(pool,id));
        INSERT INTO legacy_completion SELECT 'manual',id,state,observed_at FROM legacy_completion_unscoped;
        DROP TABLE legacy_completion_unscoped;
        COMMIT;`);
    } catch (error) {db.exec('ROLLBACK');throw error;}
  }
  initialized.add(db);
  if (!db.prepare('SELECT 1 FROM research_revisions WHERE id=?').get(articleId(guideRecord.url))) writeRevision(db,guideRecord);
}

const hash = text => createHash('sha256').update(text).digest('hex');
const articleId = url => hash(url).slice(0,32);

export function writeRevision(db,input,at = new Date().toISOString()) {
  initResearch(db);
  const body = normalizeArticle(input), id = articleId(body.url);
  const serialized = JSON.stringify(body), fingerprint = hash(serialized);
  db.exec('BEGIN IMMEDIATE');
  try {
    const last = db.prepare('SELECT * FROM research_revisions WHERE id=? ORDER BY revision DESC LIMIT 1').get(id);
    if (last?.fingerprint === fingerprint) {
      db.exec('COMMIT');
      return {id,revision:last.revision,changed:false};
    }
    // A system clock adjustment must never change the order revisions became known.
    const availableAt = last && at < last.available_at ? last.available_at : at;
    const revision = (last?.revision ?? 0)+1;
    db.prepare('INSERT INTO research_revisions VALUES(?,?,?,?,?,?)').run(id,revision,last?.first_seen ?? availableAt,availableAt,fingerprint,serialized);
    db.exec('COMMIT');
    return {id,revision,changed:true};
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}

export function articles(db,{asOf,routeId = null,itemId = null,includeHistory = false} = {}) {
  initResearch(db);
  asOf ??= new Date().toISOString();
  const rows = db.prepare(`WITH dated AS (
    SELECT r.*,ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY r.revision DESC) rn
    FROM research_revisions r WHERE r.available_at <= ?
  ) SELECT d.*,n.note,n.generated_at FROM dated d LEFT JOIN research_notes n
    ON n.id=d.id AND n.revision=d.revision AND n.generated_at<=?
    WHERE (? OR rn=1) ORDER BY d.available_at DESC,d.revision DESC,d.id`).all(asOf,asOf,Number(includeHistory));
  return rows.map(row => ({...JSON.parse(row.body),id:row.id,revision:row.revision,firstSeenAt:row.first_seen,
    availableAt:row.available_at,datePrecision:'calendar date',annotation:row.note ? {...JSON.parse(row.note),generatedAt:row.generated_at} : null})).filter(a =>
    (!routeId || a.routeId === routeId) && (!itemId || a.itemIds.includes(itemId)) && (!a.publishedOn || a.publishedOn <= asOf.slice(0,10)));
}

export function accountProgress(db,pool) {
  initResearch(db);
  const observations = db.prepare('SELECT id,state,observed_at AS observedAt FROM legacy_completion WHERE pool=?').all(pool);
  return {scope:pool,completion:Object.fromEntries(observations.map(r => [r.id,Boolean(r.state)])),observations,catalog:challengeCatalog()};
}
