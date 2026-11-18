import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function tests(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(f=>{
    if (f.name.startsWith('.') || ['node_modules','dist','coverage'].includes(f.name)) return [];
    const path=join(dir,f.name);
    return f.isDirectory() ? tests(path) : /\.test\.(?:mjs|cjs|js)$/.test(f.name) ? [path] : [];
  });
}
const files=tests('.');
if (!files.length) throw Error('No tests discovered.');
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});
process.exitCode=result.status??1;
