import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const facings=['e','ne','nw','w','sw','se'];
const native=(ids)=>ids.flatMap(id=>facings.map(facing=>`apps/client/public/assets/original/frontier/characters/${id}/facings/${facing}.png`));
const groups=[
 {width:96,height:112,files:native(['villager','warrior','archer'])},
 {width:112,height:112,files:native(['shieldBearer'])},
 {width:256,height:256,files:[
  ...['mage','musketeer','boarRider','heavyCrossbowman'].map(id=>`apps/client/public/assets/original/frontier/characters/${id}/action-sheet.png`),
  ...['miremaw','ashwing','rootback'].map(id=>`apps/client/public/assets/original/frontier/monsters/${id}/action-sheet.png`),
 ]},
];
for(const group of groups){
 const args=['scripts/validate-directional-action-sheets.mjs','--cell-width',String(group.width),'--cell-height',String(group.height),'--edge-padding','1','--reject-cross-sheet-reuse',...group.files];
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 if(result.status!==0) process.exit(result.status??1);
}
console.log('Frontier art: 24 six-facing sheets and 7 authored single-facing action sheets validated.');
