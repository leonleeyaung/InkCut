'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const bin=[process.env.INKCUT_FFMPEG,path.join(__dirname,'tools','ffmpeg.exe')].find(f=>f&&fs.existsSync(f))||'ffmpeg';
const probe=spawnSync(bin,['-version'],{encoding:'utf8',windowsHide:true});
if(probe.status!==0){console.error('找不到可运行的 FFmpeg。请把 ffmpeg.exe 放进 tools 文件夹，或把它加入 PATH。');process.exit(1);}
const manual=path.join(__dirname,'runtime','electron.exe');let electron;try{electron=fs.existsSync(manual)?manual:require('electron');if(!fs.existsSync(electron))throw Error();}catch{console.error('缺少 Electron。请在项目目录执行 npm.cmd ci，再重新启动。');process.exit(1);}
if(process.argv.includes('--check')){console.log(probe.stdout.split(/\r?\n/)[0], '\nElectron',(electron===manual?fs.readFileSync(path.join(__dirname,'runtime','version'),'utf8').trim():require('electron/package.json').version));process.exit(0);}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const r=spawnSync(electron,[__dirname],{env,stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??1);
