// Probe native ygl CLI contracts in an isolated home. Usage: node scripts/probe-ygl-wrapper.mjs --ygl-entry <installed-bin.cjs>
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {nativeClient} from './lib/native-ygl.mjs';

const root=await fs.realpath(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);let entry=process.env.RETOUCH_YGL_ENTRY;
for(let n=0;n<args.length;n++) {if(args[n]==='--ygl-entry'&&args[n+1])entry=args[++n];else throw new Error('Unknown probe argument: '+args[n]);}
if(!entry)throw new Error('Supply --ygl-entry <installed-bin.cjs>.');
const parent=path.join(root,'tmp/native-wrapper-probe');await fs.mkdir(parent,{recursive:true});
if(!(await fs.realpath(parent)).startsWith(root+path.sep))throw new Error('Probe output escapes project');
const runRoot=await fs.mkdtemp(path.join(parent,'run-')),home=path.join(runRoot,'ygl'),calls=[];
const client=await nativeClient(entry,{home,cwd:runRoot,session:'native-wrapper-probe'}),binding=client.binding;
async function call(label,args) {
  const result={label,args,...await client.call(args)};calls.push(result);
  return result;
}
const nativeId=result=>result.exit_code===0?(result.json?.id??result.json?.artifact?.id??result.json?.task?.id??null):null;
const projectName='native-wrapper-probe',tree='native-wrapper-probe-tree';
await call('db.init',['db','init']);
const project=await call('project.new',['project','new',projectName,'-q','Isolated contract probe for an ecommerce wrapper; no real image request.']);
await call('agent.brief.start',['agent','brief','--project',projectName]);
for(const group of ['task','produce','kb','db'])await call('help.'+group,[group,'--help']);
await call('tree.new',['tree','new',tree,'--project',projectName]);
await call('node.add.v1',['node','add','goal','--tree',tree,'--name','Retouch goal metadata probe','--tags','风格:极简,材质:原木','--payload',JSON.stringify({schema_version:'retouch.probe/v1',rating:null,unknown_requests:[]})]);
const task=await call('task.add',['task','add','Verify native project-artifact-relation contracts','--project',projectName,'--node',tree+'/goal']);
const taskReplay=await call('task.add.replay',['task','add','Verify native project-artifact-relation contracts','--project',projectName,'--node',tree+'/goal']);
const spec=await call('produce.spec',['produce','spec','Retouch specification probe','--project',projectName,'--body','A probe specification: preserve actual image provenance, keep unknown requests unknown, and never invoke image tools while rebuilding context.']);
const design=await call('produce.design',['produce','design','Native wrapper architecture probe','--project',projectName,'--design-type','arch','--body','# Native wrapper\n## 上下文\nReuse ygl instead of a second ledger.\n## 决策\nWrap the public CLI.\n## 后果\nMissing primitives remain explicit gaps.']);
await call('produce.spec.v2',['produce','spec','Retouch specification probe','--project',projectName,'--body','Version two: actual native CLI context and explicit reference provenance.']);
await call('produce.spec.v2.replay',['produce','spec','Retouch specification probe','--project',projectName,'--body','Version two: actual native CLI context and explicit reference provenance.']);
const note=await call('kb.add.tags',['kb','add','--title','Retouch metadata and feedback probe','--body',JSON.stringify({project_id:nativeId(project),rating:null,conclusion:'probe only'}),'--tags','retouch,风格:极简,材质:原木']);
if(nativeId(spec))await call('rel.spec',['rel','add','node:'+tree+'/goal','artifact:'+nativeId(spec),'--rel','decided-by']);
if(nativeId(design))await call('rel.design',['rel','add','node:'+tree+'/goal','artifact:'+nativeId(design),'--rel','decided-by']);
if(nativeId(note))await call('rel.kb',['rel','add','node:'+tree+'/goal','kb:'+nativeId(note),'--rel','evidenced-by']);
await call('rel.list',['rel','list','--src','node:'+tree+'/goal']);
await call('produce.list',['produce','list','--project',projectName]);
await call('task.list',['task','list','--project',projectName]);
await call('kb.search',['kb','search','材质 原木']);
await call('node.add.v2.same-key',['node','add','goal','--tree',tree,'--name','Retouch goal metadata probe','--tags','风格:简约','--payload',JSON.stringify({schema_version:'retouch.probe/v1',rating:4})]);
await call('node.show.after-update',['node','show','goal','--tree',tree]);
await call('node.index',['node','index','--tree',tree]);
await call('node.validate',['node','validate','--tree',tree]);
await call('node.export',['node','export','--tree',tree]);
await call('db.workspace.list',['db','workspace','list']);
if(nativeId(task))await call('task.done',['task','done',nativeId(task),'--project',projectName]);
if(nativeId(taskReplay)&&nativeId(taskReplay)!==nativeId(task))await call('task.done.replay-probe',['task','done',nativeId(taskReplay),'--project',projectName]);
await call('agent.brief.end',['agent','brief','--project',projectName]);
await call('doctor',['doctor']);
const essential=['db.init','project.new','task.add','produce.spec','produce.design','kb.add.tags','rel.list','node.index','node.validate','node.export','doctor'];
const result=label=>calls.find(c=>c.label===label)?.json;
const jsonObject=value=>typeof value==='string'?JSON.parse(value):value;
const checks={
  project_identity:typeof nativeId(project)==='string',
  task_owned_by_native_project:result('task.add')?.project_id===nativeId(project)&&result('task.add')?.kind==='task',
  spec_owned_by_native_project:result('produce.spec')?.project_id===nativeId(project)&&result('produce.spec')?.kind==='spec',
  design_type_is_arch:jsonObject(result('produce.design')?.meta??'{}')?.design_type==='arch',
  native_node_tags:String(result('node.add.v1')?.tags??'').split(',').includes('风格:极简'),
  native_kb_tags:String(result('kb.add.tags')?.tags??'').split(',').includes('材质:原木'),
  native_relations:Array.isArray(result('rel.list'))&&[['task',nativeId(task),'tracked-by'],['artifact',nativeId(spec),'decided-by'],['artifact',nativeId(design),'decided-by'],['kb',nativeId(note),'evidenced-by']].every(([type,id,rel])=>result('rel.list').some(r=>r.dst===type+':'+id&&r.rel===rel)),
  native_index_validated:Array.isArray(result('node.validate')?.issues)&&result('node.validate').issues.length===0,
  task_completion:result('task.done')?.to==='done',
};
const failures=[...calls.filter(c=>essential.includes(c.label)&&(c.exit_code!==0||c.json===null)).map(c=>c.label),...Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name)];
const workspaceResult=result('db.workspace.list'),updatedNode=result('node.show.after-update')?.node;
const gaps=[];
if(!(Array.isArray(workspaceResult)||Array.isArray(workspaceResult?.workspaces)))gaps.push({capability:'registered_workspace_listing',observed:'No validated workspace list JSON; rc0 alone does not prove support.'});
if(jsonObject(updatedNode?.payload??'{}')?.rating!==4||String(updatedNode?.tags??'')!=='风格:简约')gaps.push({capability:'metadata_update_via_node_add',observed:'Repeated node add did not apply the new payload/tags; use a verified native update or versioned profile.'});
if(nativeId(taskReplay)!==nativeId(task)||!result('task.add.replay')?.duplicate)gaps.push({capability:'idempotent_task_add',observed:'Repeated task add is not a proven idempotent task-creation primitive.'});
if(nativeId({exit_code:0,json:result('produce.spec.v2')})!==nativeId({exit_code:0,json:result('produce.spec.v2.replay')}))gaps.push({capability:'idempotent_spec_replay',observed:'Repeated produce spec created another native artifact/version.'});
gaps.push({capability:'scoped_zip_identity_import_and_image_receipts',observed:'Not validated by this probe; native transaction/import and receipt contracts must be verified or extended before migration.'});
const legacyLedger=await fs.access(path.join(runRoot,'ledger.sqlite')).then(()=>true,()=>false);
if(legacyLedger)failures.push('unexpected_legacy_ledger');
const report={schema:'retouch.native-wrapper-probe/v1',verdict:failures.length?'FAIL':gaps.length?'PASS_WITH_GAPS':'PASS',core_verdict:failures.length?'FAIL':'PASS',recorded_at:new Date().toISOString(),binding,run_root:runRoot,home,project_id:nativeId(project),checks,failures,gaps,image_generation:'NOT_RUN',paid_api_calls:'NOT_RUN',legacy_ledger_created:legacyLedger,calls};
const evidence=path.join(runRoot,'evidence.json');await fs.writeFile(evidence,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await fs.mkdir(path.join(root,'docs/verification'),{recursive:true});await fs.writeFile(path.join(root,'docs/verification/ygl-wrapper-probe.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({verdict:report.verdict,checks,failures,gaps,evidence})+'\n');
process.exitCode=failures.length?1:0;
