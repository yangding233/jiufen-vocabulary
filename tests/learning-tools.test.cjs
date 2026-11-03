const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../shared/learning-tools.js');
test('spelling compares actual typed letters; case and outer whitespace are ignored',()=>{
 assert.equal(L.diffSpelling('Africa',' africa ').correct,true);
 for(const [word,typed,type] of [['rabbit','rabit','double-letter'],['a radio program','a radioprogram','space'],['cats','cat','ending'],['form','from','transposition'],['milk','milx','substitution']]){
  const r=L.diffSpelling(word,typed);assert.equal(r.correct,false);assert.ok(r.issues.some(x=>x.type===type),JSON.stringify(r));assert.equal(r.expected,word);assert.equal(r.typed,typed);
 }
 assert.ok(L.diffSpelling('bus stop','bus  stop').issues.some(x=>x.type==='space'));
});
test('legacy schedule remains exact and adaptive gains require independent recall',()=>{
 let c={streak:0,interval:0,lapses:0};for(const interval of [1,3,7,14,30,60,120,120]){c=L.nextSchedule(c,{grade:'good'});assert.equal(c.interval,interval);}
 const card={streak:3,interval:30,lapses:0},independent=L.nextSchedule(card,{grade:'good',scheduler:'adaptive-v1',recall:'independent'}),assisted=L.nextSchedule(card,{grade:'good',scheduler:'adaptive-v1',recall:'assisted'}),unknown=L.nextSchedule(card,{grade:'good',scheduler:'adaptive-v1'});
 assert.ok(independent.interval>assisted.interval&&independent.interval>unknown.interval);assert.equal(assisted.streak,3);assert.equal(unknown.streak,4);
 assert.ok(L.nextSchedule({...card,lapses:6},{grade:'good',scheduler:'adaptive-v1',recall:'independent'}).interval<independent.interval);
 assert.equal(L.nextSchedule(card,{grade:'again',scheduler:'adaptive-v1'}).interval,1);
 assert.deepEqual(card,{streak:3,interval:30,lapses:0});
 for(const lapses of [0,12,1000])for(const grade of ['again','hard','good'])for(const recall of ['independent','assisted','unverified']){const r=L.nextSchedule({streak:100,interval:365,lapses},{grade,recall,scheduler:'adaptive-v1'});assert.ok(r.interval>=1&&r.interval<=365);}
});
test('quality does not reinterpret historical good ratings as measured independent recall',()=>{
 const s={words:[{id:'w',word:'rabbit'}],cards:{w:{lapses:2,cueFeedback:'unknown'}},history:[{wordId:'w',grade:'good',kind:'review'},{wordId:'w',grade:'good',kind:'review',mode:'listening',recall:'assisted'},{wordId:'w',grade:'good',kind:'review',mode:'meaning',recall:'independent',spelling:{correct:true}},{wordId:'w',grade:'again',kind:'review',mode:'meaning',recall:'independent',spelling:{correct:false}},{wordId:'w',grade:'mastered',kind:'mastery'}]};
 const q=L.qualityStats(s);assert.equal(q.totalAttempts,4);assert.equal(q.unverified,1);assert.equal(q.assisted,1);assert.equal(q.independentAccuracy,.5);assert.equal(q.spellingAccuracy,.5);assert.equal(q.byMode.listening.accuracy,null);assert.equal(q.weakWords[0].word,'rabbit');assert.equal(q.cueFeedback.unknown,1);
});
test('forecast includes overdue reviews, new-word review load and rest-day policy without mutating progress',()=>{
 const s={settings:{dailyNew:2,studyDays:[1,2,3,4,5]},words:['a','b','c'].map(id=>({id})),cards:{a:{seen:true,planned:true,due:'2026-10-01',interval:3,streak:2,lapses:0},b:{seen:false,planned:true},c:{seen:false,planned:true}}},copy=JSON.stringify(s);
 const f=L.workloadForecast(s,{days:4,start:'2026-11-06'});assert.equal(f.days[0].reviewWords,1);assert.equal(f.days[0].newWords,2);assert.equal(f.days[1].newWords,0);assert.ok(f.days[1].reviewWords>=2);assert.equal(f.estimatedFinishDate,'2026-11-06');assert.ok(f.totalMinutes>0);assert.equal(JSON.stringify(s),copy);
 assert.equal(L.workloadForecast(s,{newPerDay:0}).estimatedFinishDate,null);
});

test('optional recall marking is not required for continued good-rating progress',()=>{let c={streak:0,interval:0,lapses:0};for(const interval of [1,3,7]){c=L.nextSchedule(c,{grade:'good',recall:'unverified',scheduler:'adaptive-v1'});assert.equal(c.interval,interval);}assert.equal(c.streak,3);});
