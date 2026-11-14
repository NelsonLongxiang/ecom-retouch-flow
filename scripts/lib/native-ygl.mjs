// Verified native CLI transport for developer probes/capture; callers must supply an explicit home and cwd.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {yglBinding} from '../../src/adapters/ygl.ts';
const invoke=promisify(execFile);
export async function nativeClient(entry,{home,cwd,session}) {
  if(!home||!cwd||!session)throw new Error('Native CLI requires explicit home, cwd and session.');
  const binding=await yglBinding(entry);
  const env={...process.env,YGL_HOME:home,YGL_SESSION:session,YGL_EVAL_OFFLINE:'1',YGL_NO_UPDATE_CHECK:'1'};
  for(const key of Object.keys(env))if(/API_KEY|TOKEN|PASSWORD|SECRET/i.test(key)||['YGL_DB_URL','YGL_PG_URL','YGL_TREE','YGL_PROJECT','YGL_RUN_ID','DSH_SESSION_ID','YGL_TEST'].includes(key))delete env[key];
  async function call(args) {
    let stdout='',stderr='',exit=0;
    try{({stdout,stderr}=await invoke(process.execPath,[binding.entry,...args,'--home',home,'--json'],{cwd,env,windowsHide:true,timeout:30000,maxBuffer:8*1024*1024}));}
    catch(error){stdout=error.stdout??'';stderr=error.stderr??'';exit=typeof error.code==='number'?error.code:1;}
    let json=null;try{json=JSON.parse(stdout);}catch{}
    return {exit_code:exit,json,stderr:stderr.slice(0,2000),unparsed_stdout:json===null?stdout.slice(0,2000):null};
  }
  return {binding,call};
}
