import test from 'node:test';
import assert from 'node:assert/strict';
import {createTable} from '@tanstack/react-table';
import {farmSort,farmTableOptions} from './farm-table.js';

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
test('restores per-pane ranking and consistently keeps unpriced farms after losses, zeros and gains',()=>{
  assert.deepEqual(rowIds([]),['first','second','loss','unpriced']);
  const saved = JSON.parse(JSON.stringify([{id:'hour',desc:false}]));
  assert.deepEqual(rowIds(saved),['loss','second','first','unpriced']);
  assert.deepEqual(rowIds([{id:'hour',desc:true}]),['second','first','loss','unpriced']);
  assert.deepEqual(rowIds([{id:'route',desc:false}]),['unpriced','first','second','loss']);
  assert.deepEqual(rowIds([{id:'obsolete',desc:true}]),rowIds([]));
});
