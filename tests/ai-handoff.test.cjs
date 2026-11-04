'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../shared/ai-handoff.js'),M=require('../shared/materials.js'),D=require('../shared/desktop-state.js');
const initial=()=>structuredClone(require('./fixtures/legacy-documents.json')[0].expected);
function makeResult(task,fields={sentence:'Alpha comes first.',translation:'阿尔法排在第一。'}){const t=task.items[0];return {format:A.RESULT,schema:1,taskId:task.id,items:[{id:t.id,word:t.word,baseFingerprint:t.baseFingerprint,status:'candidate',fields}]};}

test('task exports only public vocabulary context and remains usable after a cold reopen',()=>{
 const s=initial();s.cards['jf-0'].note='SECRET_NOTE';s.cards['jf-0'].memoryScene='SECRET_SCENE';const task=A.createTask(s,['jf-0']);assert.equal(task.items.length,1);
 const exported=A.prompt(task);for(const secret of ['SECRET_NOTE','SECRET_SCENE','profileId','history','cards','offline-v1'])assert(!exported.includes(secret));
 A.registerTask(s,task);const reopened=D.documentState(D.createDocument(s,'pc'));assert.deepEqual(A.findTask(reopened,task.id).items,task.items);assert(exported.includes('原创'));assert(exported.includes('baseFingerprint'));
});

test('preview is read only, field opt-out works and adoption preserves cards and source identity',()=>{
 const s=initial(),before=structuredClone(s),task=A.createTask(s,['jf-0']),result=makeResult(task);
 const plan=A.preview(s,task,result,{'jf-0':{fields:{translation:false}}});assert(plan.canApply);assert.deepEqual(Object.keys(plan.rows[0].changes),['sentence']);assert.deepEqual(s,before);
 const next=A.apply(s,task,result,{'jf-0':{fields:{translation:false}}});assert.equal(next.words[0].sentence,'Alpha comes first.');assert.equal(next.words[0].translation,undefined);assert.deepEqual(next.cards,before.cards);assert.deepEqual(next.history,before.history);D.validateState(next);
});

test('existing values are protected and reviewed results require explicit field adoption',()=>{
 const s=initial(),task=A.createTask(s,['jf-0'],{fields:['phonetic']}),result=makeResult(task,{phonetic:'/ˈælfə/'});assert(!A.preview(s,task,result).canApply);
 assert(!A.preview(s,task,result,{'jf-0':{fields:{phonetic:true}}}).canApply);
 const decisions={'jf-0':{fields:{phonetic:true},replaceFields:['phonetic']}};assert.equal(A.apply(s,task,result,decisions).words[0].phonetic,'/ˈælfə/');
 const reviewed=makeResult(A.createTask(s,['jf-0']));reviewed.items[0].status='review';const task2={...task,...A.createTask(s,['jf-0'])};reviewed.taskId=task2.id;assert(!A.preview(s,task2,reviewed).canApply);assert(A.preview(s,task2,reviewed,{'jf-0':{fields:{sentence:true}}}).canApply);
});

test('unknown IDs, changed spelling/meaning, unsafe fields and invalid spelling plans cannot be adopted',()=>{
 const s=initial(),task=A.createTask(s,['jf-0']),before=structuredClone(s);
 for(const modify of [r=>r.items[0].id='unknown',r=>r.items[0].word='Alpha',r=>r.items[0].fields.meaning='changed',r=>r.items.push(r.items[0]),r=>r.items[0].fields.sentence='<img src=x onerror=bad>']){const r=makeResult(task);modify(r);assert.throws(()=>A.apply(s,task,r));assert.deepEqual(s,before);}
 const invalid=makeResult(task,{schemes:[{id:'s1',anchor:'线索',scene:'画面',parts:[{text:'beta',cue:'不对应'}]}]});assert.throws(()=>A.apply(s,task,invalid),/精确还原/);
 s.words[0].meaning='后来选择的义项';assert.throws(()=>A.apply(s,task,makeResult(task)),/义/);
});

test('old AI results never overwrite edited material and repeat adoption adds no duplicate schemes',()=>{
 const s=initial(),task=A.createTask(s,['jf-0']),result=makeResult(task);M.updateWord(s,'jf-0',{sentence:'My later edit.'});const before=structuredClone(s);assert.equal(A.preview(s,task,result).rows[0].status,'stale');assert.throws(()=>A.apply(s,task,result),/资料已变化/);assert.deepEqual(s,before);
 const original=initial(),task2=A.createTask(original,['jf-0']),scheme={id:'s1',anchor:'alpha 的字母线索',scene:'与给定义项联系',parts:[{text:'alpha',cue:'字母整体'}],reference:'原创助记'};
 const result2=makeResult(task2,{schemes:[scheme]});const adopted=A.apply(original,task2,result2);assert.equal(M.entry(adopted,'jf-0').schemes.length,1);const again=A.apply(adopted,task2,result2);assert.deepEqual(again,adopted);assert(!A.preview(adopted,task2,result2).canApply);
});

test('unavailable rows do not invent content and fenced JSON is accepted with bounded batches',()=>{
 const s=initial(),task=A.createTask(s,['jf-0']),result=makeResult(task,{});result.items[0].status='unavailable';assert(!A.preview(s,task,result).canApply);assert.deepEqual(A.apply(s,task,result),s);
 assert.deepEqual(A.parseResult('```json\n'+JSON.stringify(result)+'\n```'),result);assert.throws(()=>A.createTask(s,['jf-0','jf-1'],{maxItems:1}),/最多/);
 assert.throws(()=>A.createTask(s,['jf-0'],{fields:['meaning']}),/待补字段/);
});

test('effective built-in usage is protected and a later content update invalidates its task',()=>{
 const s=initial();let shipped='The shipped example.';const options={resolve:w=>({sentence:w.sentence||shipped,schemes:[{anchor:'已审阅的内置方案'}]})};
 const task=A.createTask(s,['jf-0'],{...options,fields:['sentence','schemes']});assert.equal(task.items[0].existing.sentence,shipped);const result=makeResult(task,{sentence:'An alternative example.'});assert(!A.preview(s,task,result,{},options).canApply);
 const yes={'jf-0':{fields:{sentence:true},replaceFields:['sentence']}};assert(A.preview(s,task,result,yes,options).canApply);shipped='The later shipped example.';assert.equal(A.preview(s,task,result,yes,options).rows[0].status,'stale');assert.throws(()=>A.apply(s,task,result,yes,options),/资料已变化/);
});

test('partial adoption can be repeated and remaining fields adopted until the user edits again',()=>{
 const s=initial(),task=A.createTask(s,['jf-0']),result=makeResult(task),choice={'jf-0':{fields:{translation:false}}};
 const partial=A.apply(s,task,result,choice);assert.deepEqual(A.apply(partial,task,result,choice),partial);const finished=A.apply(partial,task,result);assert.equal(finished.words[0].translation,'阿尔法排在第一。');assert.deepEqual(A.apply(finished,task,result),finished);
 M.updateWord(partial,'jf-0',{sentence:'A later user edit.'});assert.throws(()=>A.apply(partial,task,result),/资料已变化/);
 const options={resolve:w=>({sentence:w.sentence||'',translation:w.translation||'',collocations:M.entry(s,w.id).collocations||[]})};
 const resolvedTask=A.createTask(s,['jf-0'],options),resolvedResult=makeResult(resolvedTask);const resolvedPartial=A.apply(s,resolvedTask,resolvedResult,choice,options);const liveOptions={resolve:w=>({sentence:w.sentence||'',translation:w.translation||'',collocations:M.entry(resolvedPartial,w.id).collocations||[]})};
 assert.deepEqual(A.apply(resolvedPartial,resolvedTask,resolvedResult,choice,liveOptions),resolvedPartial);assert.equal(A.apply(resolvedPartial,resolvedTask,resolvedResult,{},liveOptions).words[0].translation,'阿尔法排在第一。');
});
