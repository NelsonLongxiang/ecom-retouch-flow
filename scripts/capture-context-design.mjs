// Capture the reviewed source/proposed design into an existing native ygl project. Usage: node scripts/capture-context-design.mjs --ygl-entry <bin.cjs> --home <design-home> --project <name> --tree <name>
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeClient} from './lib/native-ygl.mjs';

const root=await fs.realpath(fileURLToPath(new URL('../',import.meta.url))),options={};
const args=process.argv.slice(2);
for(let n=0;n<args.length;n+=2){if(!['--ygl-entry','--home','--project','--tree'].includes(args[n])||!args[n+1]||options[args[n]])throw new Error('Invalid or repeated capture option');options[args[n]]=args[n+1];}
for(const key of ['--ygl-entry','--home','--project','--tree'])if(!options[key])throw new Error('Missing '+key);
const home=await fs.realpath(options['--home']),project=options['--project'],tree=options['--tree'];
await fs.access(path.join(home,'ygl-trees.db'));
const client=await nativeClient(options['--ygl-entry'],{home,cwd:root,session:'retouch-design-capture'}),receipts=[];
async function call(label,args){const result=await client.call(args);if(result.exit_code!==0||result.json===null)throw new Error(label+' did not return a valid native receipt; inspect native records before any retry.');receipts.push({label,receipt:result.json});process.stdout.write(JSON.stringify({label,id:result.json?.id??null})+'\n');return result.json;}
await call('agent.brief.start',['agent','brief','--project',project]);
const projectData=await call('project.show',['project','show','--project',project]);
if(projectData.name!==project&&projectData.project?.name!==project)throw new Error('Native project binding mismatch');
const graph=await call('tree.export',['node','export','--tree',tree]);
for(const key of ['ygl-capability-audit','ygl-adapter','design-bundle-ready','contract-reviewed','knowledge-promotion'])if(!graph.nodes?.some(n=>n.key===key))throw new Error('Missing planned evolution node: '+key);
const listed=await call('produce.list',['produce','list','--project',project]);if(!Array.isArray(listed))throw new Error('Native artifacts must be an array');
async function capture(kind,title,file,designType){
  const content=await fs.readFile(path.join(root,file),'utf8');
  const existing=listed.find(a=>a.kind===kind&&a.title===title&&a.content===content);
  if(existing){process.stdout.write(JSON.stringify({label:'reuse.'+kind,id:existing.id})+'\n');return existing;}
  const args=['produce',kind,title,'--project',project,'-f',path.join(root,file)];if(designType)args.push('--design-type',designType);
  const artifact=await call('capture.'+kind,args);if(typeof artifact.id!=='string'||artifact.kind!==kind)throw new Error('Artifact identity mismatch');listed.push(artifact);return artifact;
}
const design=await capture('design','ADR-004 native ygl wrapper and dynamic context','docs/ADR-004-dynamic-context.md','arch');
const migration=await capture('spec','Native wrapper migration and architecture acceptance','docs/YGL-WRAPPER-MIGRATION.md');
const dynamic=await capture('spec','Dynamic context engineering business and methodology','docs/DYNAMIC-CONTEXT.md');
const instruction='底层是对ygl-trees cli的高级封装，不可偏离独立实现';
const source=await call('source.user-decision',['research','source','add','--project',project,'--title','User decisions: native wrapper and dynamic context','--url','retouch://ecom-retouch-flow/decisions/native-wrapper','--content',instruction+'\n这一行为视为动态的上下文工程，\n统计范围：跨所有已登记工作区的项目。\nImplementation roadmap remains proposed pending the earlier requested confirmation.']);
const evidence=await call('evidence.user-decision',['research','evidence','add',source.id,'--project',project,'--quote',instruction]);if(evidence.quote_verified!==true)throw new Error('User-decision quote was not verified');
const probe=JSON.parse(await fs.readFile(path.join(root,'docs/verification/ygl-wrapper-probe.json'),'utf8'));
if(probe.core_verdict!=='PASS'||probe.verdict!=='PASS_WITH_GAPS')throw new Error('Read the native probe before capturing its verdict');
const probeQuote='Native core contracts passed; required migration contracts still have gaps.';
const probeSource=await call('source.native-probe',['research','source','add','--project',project,'--title','Native wrapper CLI contract probe','--url','retouch://ecom-retouch-flow/probes/native-wrapper','--content',probeQuote+'\n'+JSON.stringify({version:probe.binding.version,checks:probe.checks,gaps:probe.gaps,image_generation:probe.image_generation,legacy_ledger_created:probe.legacy_ledger_created})]);
const probeEvidence=await call('evidence.native-probe',['research','evidence','add',probeSource.id,'--project',project,'--quote',probeQuote]);if(probeEvidence.quote_verified!==true)throw new Error('Probe quote was not verified');
for(const key of ['ygl-adapter','contract-reviewed','design-bundle-ready'])await call('rel.design.'+key,['rel','add','node:'+tree+'/'+key,'artifact:'+design.id,'--rel','decided-by']);
for(const key of ['ygl-adapter','contract-reviewed'])await call('rel.spec.'+key,['rel','add','node:'+tree+'/'+key,'artifact:'+migration.id,'--rel','decided-by']);
await call('rel.dynamic',['rel','add','node:'+tree+'/knowledge-promotion','artifact:'+dynamic.id,'--rel','decided-by']);
await call('rel.user-decision',['rel','add','node:'+tree+'/contract-reviewed','evidence:'+evidence.id,'--rel','evidenced-by']);
await call('rel.probe',['rel','add','node:'+tree+'/ygl-capability-audit','evidence:'+probeEvidence.id,'--rel','evidenced-by']);
const note=await call('kb.methodology',['kb','add','--title','动态上下文工程：标签二次分类方法论（提案）','--tags','retouch,dynamic-context,methodology,proposal','--body','Scope: all registered ygl workspaces. Group effective project tags by category/style/material/operation/channel and cross them with actual user ratings and conclusions. Count distinct logical projects, state denominators and missing data, keep source versions and references. Frequency is not satisfaction or causal proof. Facts and methods stay in native ygl; do not create a second ledger or search engine. Native design '+design.id+'; migration spec '+migration.id+'; methodology spec '+dynamic.id+'. Roadmap and implementation remain proposed, not accepted as completed.']);
if(note.verified!==true)throw new Error('Native KB write was not verified');
await call('rel.kb',['rel','add','node:'+tree+'/knowledge-promotion','kb:'+note.id,'--rel','derived-from']);
await call('rel.kb-source',['rel','add','kb:'+note.id,'artifact:'+dynamic.id,'--rel','derived-from']);
const validated=await call('node.validate',['node','validate','--tree',tree]);if(!Array.isArray(validated.issues)||validated.issues.length)throw new Error('Native tree integrity is not clean');
await call('agent.brief.end',['agent','brief','--project',project]);await call('doctor',['doctor']);
const report={schema:'retouch.design-capture/v1',captured_at:new Date().toISOString(),project,tree,artifacts:{design:design.id,migration:migration.id,dynamic:dynamic.id},evidence:{user:evidence.id,probe:probeEvidence.id},kb:note.id,implementation_status:'PROPOSED_NOT_IMPLEMENTED',maturity_unlocks:0,receipts};
await fs.writeFile(path.join(root,'docs/verification/native-design-capture.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({captured:true,artifacts:report.artifacts,evidence:report.evidence,kb:note.id,maturity_unlocks:0,implementation_status:report.implementation_status})+'\n');
