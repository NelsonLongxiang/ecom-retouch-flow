// Demonstrate native ygl orchestration with two local image fixtures; no model/API calls. Usage: node scripts/demo.mjs --ygl-entry <bin.cjs>
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {NativeClient} from '../src/native/client.ts';
import {registerMedia,completeRun,deliverRun,objectBytes} from '../src/native/files.ts';
import {digest} from '../src/native/plugin/commands.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--ygl-entry')throw new Error('Supply --ygl-entry <installed bin.cjs>');
const parent=path.join(root,'tmp/native-demo');await fs.mkdir(parent,{recursive:true});const runRoot=await fs.mkdtemp(path.join(parent,'run-'));
const c=await NativeClient.initialize(path.join(runRoot,'workspace'),args[1]);let index=0;const call=(a,b)=>c.call(a,b,'demo-'+(++index));
const project=(await call('project-new',{name:'两步局部修改演示',intent:'本地夹具演示：修改把手后修改门板，不调用模型',tags:['类目:家具','部位:把手','部位:门板']})).project.id;
const goal=(await call('goal-new',{project,title:'局部演示',scope:'两个矩形',preserve:['其余像素保持'],done_when:'夹具检查、演示接受与交付',source:'offline demonstration fixture'})).artifact;
const task=(await call('task-new',{project,goal:goal.id,title:'两步局部修改',brief:'仅验证原生编排和实际文件',expected_output:'演示图片',done_when:'夹具交付',kind:'image'})).task;
const source=path.join(runRoot,'original.png');await sharp({create:{width:320,height:240,channels:4,background:'#c8c1b0'}}).png().toFile(source);
const original=(await registerMedia(c,project,task.id,source,{role:'original'},'original')).artifact;
const plan=(await call('plan',{project,task:task.id,input:original.id,expected_revision:0,steps:[{id:'handle',prompt:'演示把手区域修改',needs:[],region:{x:152,y:110,width:15,height:45}},{id:'panel',prompt:'演示门板材质区域修改',needs:['handle'],region:{x:190,y:60,width:110,height:150}}]})).plan;
const grant=(await call('grant',{project,task:task.id,plan_id:plan.id,plan_hash:digest(JSON.parse(plan.content)),issuer:'host-human',confirmation:'仅用于本地协议演示的合成确认，不代表真实业务授权或用户验收',expires_at:new Date(Date.now()+3600000).toISOString()})).grant;
let execution=(await call('run-start',{project,task:task.id,grant:grant.id})).execution;const frames=[await fs.readFile(source)];
for(const color of ['#426484','#b58f64']){
  const revision=JSON.parse(execution.meta).revision;const dispatched=await call('run-dispatch',{project,id:execution.id,expected_revision:revision});
  if(dispatched.replayed||!dispatched.allow_execute)throw new Error('Demo refuses replayed dispatch');
  const output=path.join(runRoot,'fixture-'+frames.length+'.png');await sharp({create:{width:320,height:240,channels:4,background:color}}).png().toFile(output);
  execution=(await completeRun(c,project,execution.id,output,revision+1,'complete-'+frames.length)).execution;
  const candidate=await c.call('show',{project,id:JSON.parse(execution.meta).candidate}),meta=JSON.parse(candidate.meta);frames.push(await objectBytes(c.root,meta));
  execution=(await call('run-review',{project,id:execution.id,expected_revision:JSON.parse(execution.meta).revision,sha256:meta.sha256,verdict:'PASS',observations:'本地协议夹具；局部合成实际字节，不评价 AI 效果',reviewer:'offline-demo',source:'synthetic fixture'})).execution;
}
const last=await c.call('show',{project,id:JSON.parse(execution.meta).outputs.at(-1)});
execution=(await call('run-accept',{project,id:execution.id,expected_revision:JSON.parse(execution.meta).revision,sha256:JSON.parse(last.meta).sha256,statement:'演示夹具接受；不是真实用户商品图验收',source:'user'})).execution;
const delivered=await deliverRun(c,project,execution.id,path.join(runRoot,'delivery'),JSON.parse(execution.meta).revision,'deliver');
const preview=await sharp({create:{width:960,height:240,channels:4,background:'#ffffff'}}).composite(frames.map((input,i)=>({input,left:i*320,top:0}))).png().toBuffer();
await fs.mkdir(path.join(root,'docs/demo'),{recursive:true});await fs.writeFile(path.join(root,'docs/demo/offline-workflow.png'),preview);
const report={schema:'retouch.native-demo/v1',verdict:'PASS',architecture:'YGL_NATIVE_WRAPPER',project_id:project,execution:delivered.execution,workspace:c.root,image_ai_generation:'NOT_RUN',paid_api_calls:'NOT_RUN',quality_scope:'synthetic protocol fixtures only'};
await fs.mkdir(path.join(root,'docs/verification/runs'),{recursive:true});await fs.writeFile(path.join(root,'docs/verification/runs',path.basename(runRoot)+'-demo.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});await fs.writeFile(path.join(root,'docs/verification/offline-demo.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({verdict:'PASS',workspace:c.root,delivery:path.join(runRoot,'delivery'),preview:path.join(root,'docs/demo/offline-workflow.png'),image_ai_generation:'NOT_RUN'}));
