import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function check(dir) {
  for (const f of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,f.name);
    if(f.isDirectory()) check(path);
    else if(/\.m?js$/.test(f.name)) {
      const run=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});
      if(run.status!==0) process.exit(run.status??1);
    }
  }
}
for (const root of ['apps','packages','scripts']) check(root);
