import {getCoreRowModel, getSortedRowModel} from '@tanstack/react-table';

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
