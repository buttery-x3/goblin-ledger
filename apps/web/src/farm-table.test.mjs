import test from 'node:test';
import assert from 'node:assert/strict';
import {createTable} from '@tanstack/react-table';
import {farmRowsForActor,farmSort,farmTableOptions} from './farm-table.js';

const routes = [
  {id:'unpriced',name:'Cave A',rateCopperPerHour:null,sessionGoldCopper:null},
  {id:'second',name:'Cave B',rateCopperPerHour:100,sessionGoldCopper:0},
  {id:'first',name:'Cave A',rateCopperPerHour:100,sessionGoldCopper:200},
  {id:'loss',name:'Mine',rateCopperPerHour:-100,sessionGoldCopper:-100},
];
function rowIds(saved) {
  const options=farmTableOptions(routes,farmSort(saved),()=>{});
  const instance=createTable({...options,onStateChange:()=>{},renderFallbackValue:null});
  instance.setOptions(previous=>({...previous,state:{...instance.initialState,...previous.state}}));
  return instance.getRowModel().rows.map(r=>r.id);
}
test('character farm rankings withhold blocked or stale session amounts while retaining route evidence',()=>{
  const actor={id:'reed',name:'Reed',level:8,professions:[]};
  const farm={id:'linen',actorId:'reed',mobLevels:[11,13],runCount:2,rateCopperPerHour:500,sessionGoldCopper:250,loops:1,requiredUnitsPerHour:17};
  const [blocked]=farmRowsForActor([farm],actor.id,actor);
  assert.deepEqual([blocked.access.state,blocked.runCount,blocked.sessionGoldCopper,blocked.rateCopperPerHour,blocked.loops,blocked.requiredUnitsPerHour],['check',2,null,null,null,null]);
  const ready={...actor,level:20};
  assert.equal(farmRowsForActor([farm],actor.id,ready)[0].sessionGoldCopper,250);
  assert.equal(farmRowsForActor([{...farm,actorId:null}],actor.id,ready)[0].sessionGoldCopper,null);
});

test('restores per-pane ranking and consistently keeps unpriced farms after losses, zeros and gains',()=>{
  assert.deepEqual(rowIds([]),['first','second','loss','unpriced']);
  const saved = JSON.parse(JSON.stringify([{id:'hour',desc:false}]));
  assert.deepEqual(rowIds(saved),['loss','second','first','unpriced']);
  assert.deepEqual(rowIds([{id:'hour',desc:true}]),['second','first','loss','unpriced']);
  assert.deepEqual(rowIds([{id:'route',desc:false}]),['unpriced','first','second','loss']);
  assert.deepEqual(rowIds([{id:'obsolete',desc:true}]),rowIds([]));
});
