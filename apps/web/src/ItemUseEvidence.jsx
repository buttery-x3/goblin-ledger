import React from 'react';

function UtcTime({value}) {
  return <time dateTime={value}>{value.replace('T',' ').replace(/(?:\.000)?Z$/, ' UTC')}</time>;
}

export function ItemUseEvidence({record}) {
  const observation = record.useKind === 'observed turn-in';
  return <article className="rs-card">
    <strong>{record.useThesis}</strong>
    <h4>{record.title}</h4>
    <p>{record.summary}</p>
    <dl>
      <dt>{observation ? 'Observer' : 'Source'}</dt><dd>{record.url && !observation
        ? <a href={record.url} target="_blank" rel="noreferrer">{record.publisher}</a> : record.publisher}</dd>
      {observation && record.url && <><dt>Supporting link</dt><dd><a href={record.url} target="_blank" rel="noreferrer">{record.title}</a></dd></>}
      {record.useContext && <><dt>{observation ? 'Turn-in and game context' : 'Game build'}</dt><dd>{record.useContext}</dd></>}
      {record.effectiveOn && <><dt>Effective date</dt><dd>{record.effectiveOn}</dd></>}
      {record.observedAt && <><dt>Hand-in observed</dt><dd><UtcTime value={record.observedAt}/></dd></>}
      <dt>Known locally</dt><dd><UtcTime value={record.availableAt}/> · revision {record.revision}</dd>
      <dt>Affected items</dt><dd>{record.itemIds.map(id=>'#'+id).join(', ')}</dd>
    </dl>
    <small>{observation ? 'One recorded hand-in. Repeatability and market demand are unverified.'
      : 'Item-use evidence only. Market demand and sales require separate observations.'}</small>
  </article>;
}
