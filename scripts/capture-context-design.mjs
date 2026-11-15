// Capture accepted design and optional hash-bound isolated validation. Usage: node scripts/capture-context-design.mjs --ygl-entry <bin.cjs> --home <design-home> --project <name> --tree <name> [--implementation-report <report.json>]
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeClient} from './lib/native-ygl.mjs';
import crypto from 'node:crypto';

const root=await fs.realpath(fileURLToPath(new URL('../',import.meta.url))),options={};
const args=process.argv.slice(2);
for(let n=0;n<args.length;n+=2){if(!['--ygl-entry','--home','--project','--tree','--implementation-report'].includes(args[n])||!args[n+1]||options[args[n]])throw new Error('Invalid or repeated capture option');options[args[n]]=args[n+1];}
for(const key of ['--ygl-entry','--home','--project','--tree'])if(!options[key])throw new Error('Missing '+key);
const home=await fs.realpath(options['--home']),project=options['--project'],tree=options['--tree'];
await fs.access(path.join(home,'ygl-trees.db'));
const client=await nativeClient(options['--ygl-entry'],{home,cwd:root,session:'retouch-design-capture'}),receipts=[];
let implementation=null,implementationRecord=null;
if(options['--implementation-report']){
  implementation=JSON.parse(await fs.readFile(options['--implementation-report'],'utf8'));
  if(implementation.verdict!=='PASS'||implementation.architecture!=='YGL_NATIVE_WRAPPER'||implementation.native_wrapper_evidence?.verdict!=='PASS')throw new Error('Need a passing native-wrapper implementation report');
  if(implementation.test_suite!=='FULL'||implementation.native_api_evidence?.verdict!=='PASS'||implementation.native_documents_evidence?.verdict!=='PASS'||implementation.native_issues_evidence?.verdict!=='PASS')throw new Error('Need full native, document, issues and API fixture evidence');
  if(implementation.native_engineering_evidence?.verdict!=='PASS')throw new Error('Need product/evidence/suite engineering contract evidence');
  if(implementation.source_stability!=='PASS')throw new Error('Need validation with matching start/end source snapshots');
  for(const item of implementation.snapshots){const file=path.resolve(root,item.file);if(!file.startsWith(root+path.sep)||crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==item.sha256)throw new Error('Implementation evidence is stale: '+item.file);}
}
async function call(label,args){const result=await client.call(args);if(result.exit_code!==0||result.json===null)throw new Error(label+' did not return a valid native receipt; inspect native records before any retry.');receipts.push({label,receipt:result.json});process.stdout.write(JSON.stringify({label,id:result.json?.id??null})+'\n');return result.json;}
await call('agent.brief.start',['agent','brief','--project',project]);
const projectData=await call('project.show',['project','show','--project',project]);
if(projectData.name!==project&&projectData.project?.name!==project)throw new Error('Native project binding mismatch');
const graph=await call('tree.export',['node','export','--tree',tree]);
for(const key of ['ygl-capability-audit','ygl-adapter','design-bundle-ready','contract-reviewed','knowledge-promotion'])if(!graph.nodes?.some(n=>n.key===key))throw new Error('Missing planned evolution node: '+key);
const listed=await call('produce.list',['produce','list','--project',project]);if(!Array.isArray(listed))throw new Error('Native artifacts must be an array');
async function capture(kind,title,file,designType){
  const content=await fs.readFile(path.join(root,file),'utf8');
  // Native list intentionally omits content; inspect candidate bodies before appending a version.
  for(const candidate of listed.filter(a=>a.kind===kind&&a.title===title).sort((a,b)=>b.version-a.version).slice(0,1)){
    const existing=typeof candidate.content==='string'?candidate:await call('inspect.'+kind,['produce','show',candidate.id,'--project',project]);
    if(existing.content===content){process.stdout.write(JSON.stringify({label:'reuse.'+kind,id:existing.id})+'\n');return existing;}
  }
  const args=['produce',kind,title,'--project',project,'-f',path.join(root,file)];if(designType)args.push('--design-type',designType);
  const artifact=await call('capture.'+kind,args);if(typeof artifact.id!=='string'||artifact.kind!==kind)throw new Error('Artifact identity mismatch');listed.push(artifact);return artifact;
}
const design=await capture('design','ADR-004 native ygl wrapper and dynamic context','docs/ADR-004-dynamic-context.md','arch');
const migration=await capture('spec','Native wrapper migration and architecture acceptance','docs/YGL-WRAPPER-MIGRATION.md');
const dynamic=await capture('spec','Dynamic context engineering business and methodology','docs/DYNAMIC-CONTEXT.md');
const apiSpec=await capture('spec','Explicit image API fallback, authorization and local recovery','docs/API-FALLBACK.md');
const documentSpec=await capture('spec','Native artifact authority, revision and readable exports','docs/ARCHITECTURE.md');
const issuesSpec=await capture('spec','Trial issues 3-10 acceptance and execution boundaries','docs/ISSUE-ACCEPTANCE.md');
const engineeringSpec=await capture('spec','E01-E07 product intent evidence and suite workflow contracts','docs/ENGINEERING-CONTRACTS.md');
const instruction='底层是对ygl-trees cli的高级封装，不可偏离独立实现';
const source=await call('source.user-decision',['research','source','add','--project',project,'--title','User implementation authorization: 2026-11-15','--url','retouch://ecom-retouch-flow/decisions/native-wrapper-approved-20261115','--content',instruction+'\n这一行为视为动态的上下文工程，\n统计范围：跨所有已登记工作区的项目。\n2026-11-15 用户确认“开始”：原生封装与缺口 → 工作流/ZIP 迁移 → 动态上下文。开发与隔离验证已授权，不包含真实数据迁移、共享插件部署或图像服务调用。']);
const evidence=await call('evidence.user-decision',['research','evidence','add',source.id,'--project',project,'--quote',instruction]);if(evidence.quote_verified!==true)throw new Error('User-decision quote was not verified');
const probe=JSON.parse(await fs.readFile(path.join(root,'docs/verification/ygl-wrapper-probe.json'),'utf8'));
if(probe.core_verdict!=='PASS'||probe.verdict!=='PASS_WITH_GAPS')throw new Error('Read the native probe before capturing its verdict');
const probeQuote='Native core contracts passed; required migration contracts still have gaps.';
const probeSource=await call('source.native-probe',['research','source','add','--project',project,'--title','Native wrapper CLI contract probe','--url','retouch://ecom-retouch-flow/probes/native-wrapper','--content',probeQuote+'\n'+JSON.stringify({version:probe.binding.version,checks:probe.checks,gaps:probe.gaps,image_generation:probe.image_generation,legacy_ledger_created:probe.legacy_ledger_created})]);
const probeEvidence=await call('evidence.native-probe',['research','evidence','add',probeSource.id,'--project',project,'--quote',probeQuote]);if(probeEvidence.quote_verified!==true)throw new Error('Probe quote was not verified');
for(const key of ['ygl-adapter','contract-reviewed','design-bundle-ready'])await call('rel.design.'+key,['rel','add','node:'+tree+'/'+key,'artifact:'+design.id,'--rel','decided-by']);
for(const key of ['ygl-adapter','contract-reviewed'])await call('rel.spec.'+key,['rel','add','node:'+tree+'/'+key,'artifact:'+migration.id,'--rel','decided-by']);
await call('rel.dynamic',['rel','add','node:'+tree+'/knowledge-promotion','artifact:'+dynamic.id,'--rel','decided-by']);
await call('rel.api-spec',['rel','add','node:'+tree+'/contract-reviewed','artifact:'+apiSpec.id,'--rel','decided-by']);
await call('rel.document-spec',['rel','add','node:'+tree+'/contract-reviewed','artifact:'+documentSpec.id,'--rel','decided-by']);
await call('rel.issues-spec',['rel','add','node:'+tree+'/contract-reviewed','artifact:'+issuesSpec.id,'--rel','decided-by']);
await call('rel.engineering-spec',['rel','add','node:'+tree+'/contract-reviewed','artifact:'+engineeringSpec.id,'--rel','decided-by']);
await call('rel.user-decision',['rel','add','node:'+tree+'/contract-reviewed','evidence:'+evidence.id,'--rel','evidenced-by']);
await call('rel.probe',['rel','add','node:'+tree+'/ygl-capability-audit','evidence:'+probeEvidence.id,'--rel','evidenced-by']);
const note=await call('kb.methodology',['kb','add','--title','动态上下文工程：原生标签二次分类与引用方法','--tags','retouch,dynamic-context,methodology,native-wrapper','--body','Scope: all registered ygl workspaces. Group effective project tags by category/style/material/operation/channel and cross them with actual user ratings and conclusions. Count distinct logical projects, state denominators and missing data, keep source versions and references. Frequency is not satisfaction or causal proof. Facts and methods stay in native ygl; do not create a second ledger or search engine. Native design '+design.id+'; migration spec '+migration.id+'; methodology spec '+dynamic.id+'. Roadmap accepted on 2026-11-15. Implementation evidence: '+(implementation?'isolated native-wrapper tests PASS; real AI and paid API NOT_RUN.':'not attached; do not claim implementation acceptance.')]);
if(note.verified!==true)throw new Error('Native KB write was not verified');
await call('rel.kb',['rel','add','node:'+tree+'/knowledge-promotion','kb:'+note.id,'--rel','derived-from']);
await call('rel.kb-source',['rel','add','kb:'+note.id,'artifact:'+dynamic.id,'--rel','derived-from']);
if(implementation){
  const summary={verdict:implementation.verdict,architecture:implementation.architecture,counts:implementation.counts,assertions:implementation.native_wrapper_evidence.assertions,api_assertions:implementation.native_api_evidence.assertions,documents:implementation.native_documents_evidence,issues:implementation.native_issues_evidence,engineering:implementation.native_engineering_evidence,scope:implementation.scope,snapshots:implementation.snapshots};
  const body='Isolated native-wrapper implementation tests passed; real AI image generation and paid APIs were not run.\n'+JSON.stringify(summary);
  const fingerprint=crypto.createHash('sha256').update(body).digest('hex');
  const s=await call('source.implementation',['research','source','add','--project',project,'--title','Native-wrapper implementation validation','--url','retouch://ecom-retouch-flow/implementation/'+fingerprint,'--content',body]);
  const e=await call('evidence.implementation',['research','evidence','add',s.id,'--project',project,'--quote','Isolated native-wrapper implementation tests passed; real AI image generation and paid APIs were not run.']);
  if(e.quote_verified!==true)throw new Error('Implementation quote was not verified');
  for(const key of ['ygl-adapter','contract-reviewed'])await call('rel.implementation.'+key,['rel','add','node:'+tree+'/'+key,'evidence:'+e.id,'--rel','evidenced-by']);
  const title='0.4.0 原生工作流与显式 API fallback 隔离验收';
  let task=listed.find(a=>a.kind==='task'&&a.title===title);
  if(!task)task=await call('task.implementation',['task','add',title,'--project',project,'--node',tree+'/ygl-adapter','--note','验收范围为原生 CLI、隔离工作区、本地图像协议夹具和源码 hash；不包含真实 AI、收费 API 或生产部署。']);
  await call('rel.implementation.task',['rel','add','task:'+task.id,'evidence:'+e.id,'--rel','evidenced-by']);
  await call('rel.implementation.document-spec',['rel','add','task:'+task.id,'artifact:'+documentSpec.id,'--rel','specified-by']);
  await call('rel.implementation.issues-spec',['rel','add','task:'+task.id,'artifact:'+issuesSpec.id,'--rel','specified-by']);
  await call('task.implementation.done',['task','done',task.id,'--project',project]);
  const engineeringTitle='E01-E07 产品意图、证据与套图流程契约隔离验收';
  let engineeringTask=listed.find(a=>a.kind==='task'&&a.title===engineeringTitle);
  if(!engineeringTask)engineeringTask=await call('task.engineering',['task','add',engineeringTitle,'--project',project,'--node',tree+'/contract-reviewed','--note','本地E编号；开发与隔离回归，不代表真实商品语义或新收费调用通过。']);
  await call('rel.engineering.task-spec',['rel','add','task:'+engineeringTask.id,'artifact:'+engineeringSpec.id,'--rel','specified-by']);
  await call('rel.engineering.task-evidence',['rel','add','task:'+engineeringTask.id,'evidence:'+e.id,'--rel','evidenced-by']);
  await call('task.engineering.done',['task','done',engineeringTask.id,'--project',project]);
  implementationRecord={source:s.id,evidence:e.id,task:task.id,engineering_task:engineeringTask.id};
}
const validated=await call('node.validate',['node','validate','--tree',tree]);if(!Array.isArray(validated.issues)||validated.issues.length)throw new Error('Native tree integrity is not clean');
await call('agent.brief.end',['agent','brief','--project',project]);await call('doctor',['doctor']);
const report={schema:'retouch.design-capture/v1',captured_at:new Date().toISOString(),project,tree,artifacts:{design:design.id,migration:migration.id,dynamic:dynamic.id,api:apiSpec.id,documents:documentSpec.id,issues:issuesSpec.id,engineering:engineeringSpec.id},evidence:{user:evidence.id,probe:probeEvidence.id},implementation:implementationRecord,kb:note.id,implementation_status:implementation?'NATIVE_WRAPPER_ISOLATED_TESTS_PASS':'ACCEPTED_IN_PROGRESS',maturity_unlocks:0,receipts};
await fs.writeFile(path.join(root,'docs/verification/native-design-capture.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({captured:true,artifacts:report.artifacts,evidence:report.evidence,kb:note.id,maturity_unlocks:0,implementation_status:report.implementation_status})+'\n');
