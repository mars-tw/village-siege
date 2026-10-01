import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Asset processing only: crop the generated sheet into production cells,
// preserving genuine alpha and adding consistent breathing room/pivots.
const source = process.argv[2];
if (!source) throw new Error('Pass the original generated PNG path');
const dest = resolve('apps/client/public/assets/original/frontier');
await mkdir(dest, { recursive: true });
let bounds = [
  [0,0,474,318], [499,0,386,318], [913,0,480,318], [1475,0,265,318],
  [0,319,474,252], [501,319,386,252], [931,319,462,252], [1430,288,344,283],
  [0,571,474,316], [474,571,474,316], [948,571,485,316], [1433,571,341,316],
];
if (process.argv.includes('--grid')) {
  const { width, height } = await sharp(source).metadata();
  bounds = Array.from({length:12},(_,i)=>{
    const x0=Math.floor(i%4*width/4),x1=Math.floor((i%4+1)*width/4);
    const y0=Math.floor(Math.floor(i/4)*height/3),y1=Math.floor((Math.floor(i/4)+1)*height/3);
    return [x0,y0,x1-x0,y1-y0];
  });
}
const cell = 384;
const layers = [];
for (let i = 0; i < bounds.length; i++) {
  const [left, top, width, height] = bounds[i];
  const { data, info } = await sharp(source).extract({left,top,width,height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // Image-generation alpha carries occasional chroma matte at the silhouette.
  // Remove only key-colored pixels connected to real transparency. Interior
  // orange roofing is preserved; this is reproducible export cleanup.
  const total=info.width*info.height,seen=new Uint8Array(total),queue=[];
  const key=(p)=>{const [r,g,b]=data.subarray(p*4,p*4+3);return (r>185&&g<70&&b<75&&r>g*2.8)||(r>190&&g>170&&b<70);};
  for(let p=0;p<total;p++)if(data[p*4+3]<8){seen[p]=1;queue.push(p);}
  for(let q=0;q<queue.length;q++){
    const p=queue[q],x=p%info.width,y=Math.floor(p/info.width);
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]]){
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=info.width||ny>=info.height)continue;
      const n=ny*info.width+nx;if(!seen[n]&&key(n)){seen[n]=1;data[n*4+3]=0;queue.push(n);}
    }
  }
  // Keep the main connected silhouette, removing neighboring-cell fragments.
  const componentIds=new Int32Array(total).fill(-1),components=[];
  for(let p=0;p<total;p++){
    if(data[p*4+3]<20||componentIds[p]!==-1)continue;
    const id=components.length,points=[p];componentIds[p]=id;
    for(let q=0;q<points.length;q++){
      const c=points[q],x=c%info.width,y=Math.floor(c/info.width);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]]){
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=info.width||ny>=info.height)continue;
        const n=ny*info.width+nx;if(componentIds[n]===-1&&data[n*4+3]>=20){componentIds[n]=id;points.push(n);}
      }
    }
    components.push(points);
  }
  const main=components.reduce((a,b)=>a.length>b.length?a:b,[]);
  const keep=new Uint8Array(total);for(const p of main)keep[p]=1;
  for(let p=0;p<total;p++)if(!keep[p])data[p*4+3]=0;
  const crop = await sharp(data,{raw:info}).png().toBuffer();
  const trimmed = await sharp(crop).trim({threshold: 5}).toBuffer();
  const resized = await sharp(trimmed).resize(330,300,{fit:'inside',withoutEnlargement:false}).png().toBuffer({resolveWithObject:true});
  const baseline = Math.round(cell * .85);
  layers.push({ input: resized.data, left: i % 4 * cell + Math.round((cell - resized.info.width) / 2), top: Math.floor(i / 4) * cell + baseline - resized.info.height });
}
await sharp({create:{width:cell*4,height:cell*3,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(layers).png().toFile(resolve(dest,'buildings.png'));
await copyFile(source, resolve(dest,'buildings-source.png'));
console.log('Normalized twelve transparent 384px cells, feet at y=326.');
