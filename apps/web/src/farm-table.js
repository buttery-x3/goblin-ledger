import {getCoreRowModel, getSortedRowModel} from '@tanstack/react-table';

import {activityAccess} from '../../../packages/domain/character-activities.mjs';

export function farmRowsForActor(routes, actorId, actor) {
  if (!actorId) return routes;
  return routes.map(route => {
    const access = actor ? activityAccess(route,actor) : {state:'check',reason:'Character requirements unavailable.'};
    if (access.state==='available' && route.actorId===actorId) return {...route,access};
    return {...route,access,rateCopperPerHour:null,sessionGoldCopper:null,loops:null,
      requiredUnitsPerHour:null,baselineTime:null};
  });
}

const columns = [
  {id:'route',accessorKey:'name',header:'Route',sortingFn:'text',sortDescFirst:false},
  {id:'hour',accessorFn:route=>route.rateCopperPerHour ?? undefined,header:'Net / h',sortingFn:'basic',sortUndefined:'last',sortDescFirst:true},
  {id:'session',accessorFn:route=>route.sessionGoldCopper ?? undefined,header:'Session',sortingFn:'basic',sortUndefined:'last',sortDescFirst:true},
];
const defaultSort = [{id:'session',desc:true}];
export function farmSort(saved) {
  const sort=saved?.[0];
  return columns.some(col=>col.id===sort?.id) && typeof sort.desc==='boolean' ? [sort] : defaultSort;
}

export function farmTableOptions(data, sorting, onSortingChange) {
  return {data,columns,getRowId:r=>r.id,state:{sorting},onSortingChange,
    enableMultiSort:false,enableSortingRemoval:false,autoResetAll:false,
    getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel()};
}
