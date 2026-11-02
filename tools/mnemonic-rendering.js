function memoryHTML(w,where='study') {
 const m=memoryFor(w),builtin=memoryIndex.get(normalize(w.word))||m,c=state.cards[w.id];
 const links=m.related.map(name=>state.words.find(x=>normalize(x.word)===normalize(name))).filter(Boolean);
 const inherited=!m.parts?.length&&Boolean(m.baseParts?.length);
 const parts=(m.parts?.length?m.parts:m.baseParts||[]).filter(p=>p.text.trim()&&p.text!=='-');
 const steps=m.spellingSteps||[];
 return `<div class="memory-top"><span class="method-pill">${escape(m.kind)}</span><span class="small muted">${escape(m.status||'个人线索')}${m.personal?' · 含个人修改':''}</span></div>
 ${m.personal?`<h3>我的线索</h3><p>${escape(c.memoryAnchor||'')}</p><p>${escape(c.memoryScene||'')}</p><details><summary>查看内置方案</summary>`:''}
 ${m.rejected?'<p>你已停用这条内置线索。可写入自己的熟词和故事。</p>':`<h3>${inherited?`① 先记基础词 ${escape(m.cueWord||m.base||'')}`:'① 拼写线索怎样搭起来'}</h3><p>${escape(builtin.anchor)}</p>
 ${parts.length?`<div class="cue-parts">${parts.map(p=>`<div class="cue-part"><strong>${escape(p.text)}</strong><span>${escape(p.cue)}</span>${p.from?`<details><summary class="small">核对借用步骤</summary><p class="small">${escape(p.from)} → ${escape(p.text)}<br>${escape(p.change)}</p></details>`:''}</div>`).join('')}</div>`:''}
 ${inherited&&m.baseScene?`<p class="base-scene"><strong>${escape(m.cueWord||m.base)} 的联想：</strong>${escape(m.baseScene)}</p>`:''}
 <h3>② 用线索连接本词意思</h3><p>${escape(builtin.scene)}</p>
 <h3>③ ${inherited?'从基础词还原本词':'核对拼写还原'}</h3>
 ${steps.length?`<div class="spelling-steps">${steps.map(step=>`<p class="rebuild"><strong>${escape(step.from)} → ${escape(step.to)}</strong><br>${escape(step.change)}<br><span class="small muted">${escape(step.to)}：${escape(step.meaning)}</span></p>`).join('')}</div>`:`<p class="rebuild">${escape(m.focus)}</p>`}`}
 ${m.personal?'</details>':''}
 <details><summary>方法与来源</summary><p class="small muted">${escape(m.reference)} 字母结构通过校验不代表这条线索对每个人都有效；不认识提示词时可停用或修改。</p></details>
 ${links.length?`<div class="row">${links.map(x=>`<button data-memory-open="${escape(x.id)}">${escape(x.word)}</button>`).join('')}</div>`:''}
 <div class="row"><button data-reject-cue="${escape(w.id)}">${m.rejected?'恢复内置线索':'这条线索不适合我'}</button>${where==='study'?`<button data-memory-open="${escape(w.id)}">写自己的巧记</button>`:''}</div>`;
}
