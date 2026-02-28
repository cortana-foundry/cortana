#!/usr/bin/env npx tsx
import fs from "fs";
import os from "os";
import path from "path";
import { copyFileSync, readFileSync } from "fs";

async function main(){
  const runtime=path.join(os.homedir(),".openclaw/cron/jobs.json");
  const repo="/Users/hd/openclaw/config/cron/jobs.json";
  if(!fs.existsSync(runtime)){console.log('{"error":"runtime jobs.json missing"}');process.exit(1);} 
  try{if(readFileSync(runtime,"utf8")===readFileSync(repo,"utf8")){console.log('{"synced":false,"reason":"already in sync"}');process.exit(0);}}catch{}
  copyFileSync(runtime,repo); console.log('{"synced":true,"from":"runtime","to":"repo"}');
}
main();
