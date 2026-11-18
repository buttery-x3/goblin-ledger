export function valuePosition(position,item) {
  if (!item || item.id!==position.itemId || !item.t || !item.house || !item.source) return null
  const units=BigInt(Math.max(0,position.economic))
  const valid=value=>Number.isSafeInteger(value) && value>=0
  const vendor=valid(item.sell) ? units*BigInt(item.sell) : null
  // A base-ID ask cannot price a suffix. An ask is a hypothetical settlement, never an executable bid.
  const canPrice=position.binding==='tradeable' && position.variant==='0' && valid(item.ask) && item.ask>0
  const gross=canPrice ? units*BigInt(item.ask) : null
  const net=gross===null?null:gross-gross*500n/10000n
  return {name:item.name,house:item.house,source:item.source,at:item.t,unitAskCopper:item.ask??null,unitVendorCopper:item.sell??null,
    vendorCopper:vendor?.toString()??null,scenarioNetCopper:net?.toString()??null,feeBasisPoints:500,resolution:'base item'}
}
