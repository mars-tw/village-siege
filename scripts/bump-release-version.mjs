import fs from "node:fs";

const target = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(target ?? "")) throw new Error("Provide the release version.");
// Only workspace identity changes; preserve dependency versions and integrity.
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
lock.version = target;
for (const key of ["", "apps/client", "apps/server", "packages/shared"]) {
  lock.packages[key].version = target;
  if (lock.packages[key].dependencies?.["@village-siege/shared"]) lock.packages[key].dependencies["@village-siege/shared"] = target;
}
fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
console.log(`Workspace lock version ${target}; third-party entries preserved.`);
