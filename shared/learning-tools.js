(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LearningTools=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MODES=['mnemonic','context','cloze','meaning','listening'];
 const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
 const integer=x=>Number.isSafeInteger(x)&&x>=0?x:0;
 const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const addDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 function nextSchedule(card,event){
  const streak=integer(card.streak),interval=integer(card.interval),lapses=integer(card.lapses);
  if(!['again','hard','good'].includes(event.grade))throw new Error('不能为这个反馈安排复习。');
  if(event.scheduler!=='adaptive-v1'){
   if(event.scheduler!==undefined&&event.scheduler!==null)throw new Error('不支持的复习算法。');
   if(event.grade==='good'){const n=Math.min(streak+1,7);return {streak:n,interval:[1,3,7,14,30,60,120][n-1],lapses};}
   return {streak:event.grade==='again'?0:Math.max(0,streak-1),interval:1,lapses:lapses+(event.grade==='again'?1:0)};
  }
  if(event.grade==='again')return {streak:0,interval:1,lapses:lapses+1};
  const penalty=1+Math.min(lapses,12)*0.12;
  if(event.grade==='hard')return {streak:Math.max(0,streak-1),interval:clamp(Math.round(interval*0.45/penalty),1,7),lapses};
  const recall=event.recall||'unverified';
  if(recall==='assisted'||event.spelling?.correct===false)return {streak,interval:clamp(Math.round(interval*0.65/penalty),1,7),lapses};
  if(recall!=='independent'){const n=Math.min(streak+1,7);return {streak:n,interval:[1,3,7,14,30,60,120][n-1],lapses};}
  const proposed=interval===0?1:interval<3?3:interval<7?7:Math.round(interval*2.2);
  return {streak:Math.min(streak+1,100000),interval:clamp(Math.round(proposed/penalty),1,365),lapses};
 }
 function diffSpelling(expected,typed){
  if(typeof expected!=='string'||typeof typed!=='string')throw new Error('拼写检查需要两个字符串。');
  const a=expected.normalize('NFC').trim().toLowerCase(),b=typed.normalize('NFC').trim().toLowerCase();
  if(a===b)return {correct:true,issues:[],expected,typed};
  if(a.length>256||b.length>512)return {correct:false,issues:[{type:'extra',label:'输入过长，请核对单词或短语。',expectedText:a,typedText:b.slice(0,512)}],expected,typed};
  const d=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
   d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
   if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
  }
  let i=a.length,j=b.length;const changes=[];
  while(i||j){
   if(i&&j&&a[i-1]===b[j-1]&&d[i][j]===d[i-1][j-1]){i--;j--;continue;}
   if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]&&d[i][j]===d[i-2][j-2]+1){changes.push({type:'transposition',expectedIndex:i-2,typedIndex:j-2,expectedText:a.slice(i-2,i),typedText:b.slice(j-2,j)});i-=2;j-=2;continue;}
   if(i&&d[i][j]===d[i-1][j]+1){changes.push({type:'missing',expectedIndex:i-1,typedIndex:j,expectedText:a[i-1],typedText:''});i--;continue;}
   if(j&&d[i][j]===d[i][j-1]+1){changes.push({type:'extra',expectedIndex:i,typedIndex:j-1,expectedText:'',typedText:b[j-1]});j--;continue;}
   changes.push({type:'substitution',expectedIndex:i-1,typedIndex:j-1,expectedText:a[i-1],typedText:b[j-1]});i--;j--;
  }
  const issues=changes.reverse().map(c=>{
   let type=c.type,label;
   if(/\s/.test(c.expectedText+c.typedText)){type='space';label=c.type==='missing'?'漏写空格':c.type==='extra'?'多写空格':'空格位置有误';}
   else if(c.type==='missing'&&(a[c.expectedIndex-1]===c.expectedText||a[c.expectedIndex+1]===c.expectedText)){type='double-letter';label='漏写双写字母 '+c.expectedText;}
   else if(c.type==='extra'&&(b[c.typedIndex-1]===c.typedText||b[c.typedIndex+1]===c.typedText)){type='double-letter';label='多写重复字母 '+c.typedText;}
   else if(c.type==='missing'&&c.expectedIndex>=a.length-3&&b===a.slice(0,b.length)){type='ending';label='词尾漏写 '+c.expectedText;}
   else if(c.type==='extra'&&c.typedIndex>=b.length-3&&a===b.slice(0,a.length)){type='ending';label='词尾多写 '+c.typedText;}
   else label=c.type==='missing'?'漏写字母 '+c.expectedText:c.type==='extra'?'多写字母 '+c.typedText:c.type==='transposition'?'相邻字母顺序颠倒：'+c.typedText+' → '+c.expectedText:'字母不同：'+c.typedText+' → '+c.expectedText;
   return {...c,type,label};
  });
  return {correct:false,issues,expected,typed};
 }
 function qualityStats(state){
  const result={totalAttempts:0,independent:0,assisted:0,unverified:0,independentGood:0,independentAccuracy:null,spellingAttempts:0,spellingCorrect:0,spellingAccuracy:null,byMode:{},weakWords:[],cueFeedback:{unknown:0,complex:0,irrelevant:0,none:0}};
  const perWord=new Map();
  for(const e of state.history||[]){
   if(e.kind==='mastery')continue;
   result.totalAttempts++;const recall=['independent','assisted'].includes(e.recall)?e.recall:'unverified';result[recall]++;
   const mode=MODES.includes(e.mode)?e.mode:'unrecorded',m=result.byMode[mode]||(result.byMode[mode]={attempts:0,independent:0,assisted:0,unverified:0,independentGood:0,accuracy:null});
   m.attempts++;m[recall]++;
   if(recall==='independent'&&e.grade==='good'&&e.spelling?.correct!==false){result.independentGood++;m.independentGood++;}
   if(e.spelling&&typeof e.spelling.correct==='boolean'){result.spellingAttempts++;if(e.spelling.correct)result.spellingCorrect++;}
   const w=perWord.get(e.wordId)||{attempts:0,again:0,assisted:0};w.attempts++;if(e.grade==='again')w.again++;if(recall==='assisted')w.assisted++;perWord.set(e.wordId,w);
  }
  result.independentAccuracy=result.independent?result.independentGood/result.independent:null;
  result.spellingAccuracy=result.spellingAttempts?result.spellingCorrect/result.spellingAttempts:null;
  for(const m of Object.values(result.byMode))m.accuracy=m.independent?m.independentGood/m.independent:null;
  for(const w of state.words||[]){const c=state.cards?.[w.id]||{},counts=perWord.get(w.id)||{attempts:0,again:0,assisted:0},feedback=c.cueFeedback||'none';if(Object.hasOwn(result.cueFeedback,feedback))result.cueFeedback[feedback]++;
   if(!c.mastered&&!c.suspended&&(integer(c.lapses)>0||counts.again||['unknown','complex','irrelevant'].includes(feedback)))result.weakWords.push({id:w.id,word:w.word,lapses:integer(c.lapses),...counts,lastGrade:c.lastGrade||null,cueFeedback:feedback});
  }
  result.weakWords.sort((a,b)=>(b.lapses+b.again)-(a.lapses+a.again)||b.assisted-a.assisted||(a.id<b.id?-1:a.id>b.id?1:0));return result;
 }
 function workloadForecast(state,options={}){
  const days=clamp(Number.isInteger(options.days)?options.days:7,1,60),start=options.start||today();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||isNaN(Date.parse(start+'T12:00:00Z')))throw new Error('预测起始日期无效。');
  const settings=state.settings||{},studyDays=Array.isArray(settings.studyDays)&&settings.studyDays.length?settings.studyDays:[0,1,2,3,4,5,6];
  const perDay=clamp(Math.round(options.newPerDay??settings.dailyNew??50),0,500),newSeconds=clamp(Number(options.secondsPerNew)||35,5,300),reviewSeconds=clamp(Number(options.secondsPerReview)||12,3,120);
  const cards=(state.words||[]).map(w=>({...state.cards?.[w.id],id:w.id})).filter(c=>c.planned!==false&&!c.suspended&&!c.mastered);
  let unseen=cards.filter(c=>!c.seen).length;const remainingNew=unseen,known=cards.filter(c=>c.seen&&typeof c.due==='string'),output=[];
  for(let n=0;n<days;n++){
   const date=addDays(start,n),isStudyDay=studyDays.includes(new Date(date+'T12:00:00Z').getUTCDay()),review=known.filter(c=>c.due<=date),newWords=isStudyDay?Math.min(unseen,perDay):0;
   // Rest days introduce no new words. Reviews remain visible on their actual due day.
   for(const c of review){Object.assign(c,nextSchedule(c,{grade:'good',recall:'independent',scheduler:settings.adaptiveReview?'adaptive-v1':undefined}));c.due=addDays(date,c.interval);}
   for(let k=0;k<newWords;k++){const c=nextSchedule({streak:0,interval:0,lapses:0},{grade:'good',recall:'independent',scheduler:settings.adaptiveReview?'adaptive-v1':undefined});known.push({...c,due:addDays(date,c.interval)});}
   unseen-=newWords;const total=review.length+newWords,minutes=Math.ceil((newWords*newSeconds+review.length*reviewSeconds)/60);
   output.push({date,newWords,reviewWords:review.length,total,minutes,isStudyDay});
  }
  let estimatedFinishDate=remainingNew===0?start:null;
  if(remainingNew&&perDay&&studyDays.length){let remaining=remainingNew;for(let n=0;n<36600;n++){const date=addDays(start,n);if(studyDays.includes(new Date(date+'T12:00:00Z').getUTCDay()))remaining-=perDay;if(remaining<=0){estimatedFinishDate=date;break;}}}
  return {days:output,totalNew:output.reduce((s,d)=>s+d.newWords,0),totalReviews:output.reduce((s,d)=>s+d.reviewWords,0),totalMinutes:output.reduce((s,d)=>s+d.minutes,0),remainingNew,estimatedFinishDate,assumption:'预计新学量按学习日安排；到期复习按每天完成且独立答对推算。用时仅为估计，不包含当轮重现。'};
 }
 return {diffSpelling,qualityStats,workloadForecast,nextSchedule,version:1};
});
