function memorySchemeHTML(m,index,total) {
 const inherited=!m.parts?.length&&Boolean(m.baseParts?.length);
 const parts=(m.parts?.length?m.parts:m.baseParts||[]).filter(p=>p.text.trim()&&p.text!=='-');
 const steps=m.spellingSteps||[],heading=total>1?'h4':'h3';
 const number=['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'][index]||String(index+1)+'.';
 return `<section class="memory-scheme" data-memory-scheme="${index+1}">
 ${total>1?`<h3 class="memory-scheme-title">${number} 巧记 ${index+1}</h3>`:''}
 <${heading}>${inherited?`① 先记基础词 ${escape(m.cueWord||m.base||'')}`:'① 拼写线索怎样搭起来'}</${heading}><p>${escape(m.anchor)}</p>
 ${parts.length?`<div class="cue-parts">${parts.map(p=>`<div class="cue-part"><strong>${escape(p.text)}</strong><span>${escape(p.cue)}</span>${p.from?`<details><summary class="small">核对借用步骤</summary><p class="small">${escape(p.from)} → ${escape(p.text)}<br>${escape(p.change)}</p></details>`:''}</div>`).join('')}</div>`:''}
 ${inherited&&m.baseScene?`<p class="base-scene"><strong>${escape(m.cueWord||m.base)} 的联想：</strong>${escape(m.baseScene)}</p>`:''}
 <${heading}>② 用线索连接本词意思</${heading}><p>${escape(m.scene)}</p>
 <${heading}>③ ${inherited?'从基础词还原本词':'核对拼写还原'}</${heading}>
 ${steps.length?`<div class="spelling-steps">${steps.map(step=>`<p class="rebuild"><strong>${escape(step.from)} → ${escape(step.to)}</strong><br>${escape(step.change)}<br><span class="small muted">${escape(step.to)}：${escape(step.meaning)}</span></p>`).join('')}</div>`:`<p class="rebuild">${escape(m.focus)}</p>`}
 <details><summary>方法与来源</summary><p class="small muted">${escape(m.reference||'个人编写的记忆线索。')} 字母结构通过校验不代表这条线索对每个人都有效；不认识提示词时可停用或修改。</p></details>
 </section>`;
}
function memoryHTML(w,where='study') {
 const m=memoryFor(w),c=state.cards[w.id],schemes=builtinMemoriesFor(w);
 const links=(m.related||[]).map(name=>state.words.find(x=>normalize(x.word)===normalize(name))).filter(Boolean);
 const builtins=m.rejected?'<p>你已停用本词的内置线索。可写入自己的熟词和故事。</p>':schemes.length?schemes.map((scheme,index)=>memorySchemeHTML(scheme,index,schemes.length)).join(''):'<p>这个自加词暂无内置巧记。可以写下一个熟悉的词和联想画面。</p>';
 return `<div class="memory-top"><span class="method-pill">${escape(m.personal?'我的联想':m.kind)}</span><span class="small muted">${escape(m.personal?'个人线索优先显示':m.status||'个人线索')}</span></div>
 ${m.personal?`<h3>我的线索</h3>${c.memoryAnchor?`<p>${escape(c.memoryAnchor)}</p>`:''}${c.memoryScene?`<p>${escape(c.memoryScene)}</p>`:''}${m.rejected?builtins:schemes.length?`<details><summary>查看内置方案</summary>${builtins}</details>`:''}`:builtins}
 ${links.length?`<div class="row">${links.map(x=>`<button data-memory-open="${escape(x.id)}">${escape(x.word)}</button>`).join('')}</div>`:''}
 <div class="row"><button data-reject-cue="${escape(w.id)}">${m.rejected?'恢复内置线索':'这条线索不适合我'}</button>${where==='study'?`<button data-memory-open="${escape(w.id)}">写自己的巧记</button>`:''}</div>`;
}
