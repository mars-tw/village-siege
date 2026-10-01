import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {crc32} from 'node:zlib';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const walk=async directory=>(await Promise.all((await fs.readdir(directory,{withFileTypes:true})).map(async entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]))).flat();
const art=path.join(root,'apps/client/public/assets/original/frontier');
const files=(await walk(art)).filter(file=>/\/(?:characters|monsters|landscape)\//.test(file.replaceAll('\\','/')) && file.endsWith('.png'));
let before=0,after=0;
for(const file of process.argv.includes('--metadata-only')?[]:files){
 const input=await fs.readFile(file);before+=input.length;
 const output=await sharp(input).png({palette:true,colors:256,quality:95,dither:0.25,effort:10,compressionLevel:9}).toBuffer();
 const chosen=output.length<input.length?output:input;
 // Indexed PNG transparency ignores palette RGB, but keeping it black avoids
 // color fringes in downstream tools and preserves the art validator contract.
 const chunks=[];
 for(let offset=8;offset<chosen.length;){const length=chosen.readUInt32BE(offset);chunks.push({offset,length,type:chosen.toString('ascii',offset+4,offset+8)});offset+=length+12;}
 const palette=chunks.find(chunk=>chunk.type==='PLTE'),alpha=chunks.find(chunk=>chunk.type==='tRNS');
 if(palette && alpha){
  for(let index=0;index<alpha.length;index++)if(chosen[alpha.offset+8+index]===0)chosen.fill(0,palette.offset+8+index*3,palette.offset+11+index*3);
  chosen.writeUInt32BE(crc32(chosen.subarray(palette.offset+4,palette.offset+8+palette.length)),palette.offset+8+palette.length);
 }
 after+=chosen.length;await fs.writeFile(file,chosen);
}
const digest=async relative=>createHash('sha256').update(await fs.readFile(path.join(root,relative))).digest('hex');
for(const file of (await walk(path.join(root,'docs/art/frontier'))).filter(file=>file.endsWith('.json'))){
 const data=JSON.parse(await fs.readFile(file,'utf8'));
 const refresh=async value=>{
  if(!value || typeof value!=='object')return;
  for(const child of Object.values(value))if(child && typeof child==='object')await refresh(child);
  const relative=value.runtime??value.file??value.path;
  if(typeof relative==='string' && relative.startsWith('apps/client/public/assets/original/frontier/')){
   if(value.sha256!==undefined)value.sha256=await digest(relative);
   if(value.runtimeSHA256!==undefined)value.runtimeSHA256=await digest(relative);
   if(value.bytes!==undefined)value.bytes=(await fs.stat(path.join(root,relative))).size;
  }
 };
 await refresh(data);
 if(data.records || data.nativeAssets || data.normalized){data.runtimeEncoding={tool:'scripts/optimize-frontier-runtime-art.mjs',format:'indexed PNG',colors:256,quality:95,dither:0.25,transparentPaletteRgb:'black',sourceMastersUnchanged:true};}
 await fs.writeFile(file,JSON.stringify(data,null,2)+'\n');
}
console.log(`Frontier PNG runtime: ${before} -> ${after} bytes; source masters preserved.`);
