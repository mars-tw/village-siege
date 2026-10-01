import fs from "node:fs";
import sharp from "sharp";
const order = ["townCenter","house","barracks","defenseTower","lumberCamp","farmstead","archeryRange","mageSanctum","gunWorkshop","beastStable","siegeWorkshop","copperLandmark"];
const source = "apps/client/public/assets/original/frontier/buildings.png";
const metadata = await sharp(source).metadata();
const width = metadata.width / 4, height = metadata.height / 3;
const result = {};
for (const [index, type] of order.entries()) {
  const { data } = await sharp(source).extract({left:index%4*width,top:Math.floor(index/4)*height,width,height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let top = height;
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) if(data[(y*width+x)*4+3]>=32) top=Math.min(top,y);
  result[type] = Number((top/height).toFixed(5));
}
fs.writeFileSync("apps/client/src/game/buildingArtBounds.ts", `// Measured alpha >= 32 from the original PNG; regenerate with prepare-building-bounds.mjs.\nimport type { BuildingType } from "@village-siege/shared";\nexport const BUILDING_OPAQUE_TOP: Partial<Record<BuildingType, number>> = ${JSON.stringify(result,null,2)};\n`);
console.log(JSON.stringify(result));
