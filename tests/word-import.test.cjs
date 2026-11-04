const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../shared/word-import.js'),XLSX=require('../web/vendor/xlsx.full.min.js');
const state=()=>({words:[{id:'jf-one',word:'audience',meaning:'观众',phonetic:'/ˈɔːdiəns/',sentence:'',translation:'',tags:'',source:''},{id:'custom:us',word:'US',meaning:'美国',phonetic:'',sentence:''}],cards:{}});
const parsed=(text,opts={})=>I.parseText(text,opts).sheets[0];
const preview=(text,options={},s=state())=>{const p=parsed(text);return I.preview(s,p.rows,{...I.guessColumns(p.rows),rowNumbers:p.rowNumbers,...options});};
test('CSV quoting preserves commas, escaped quotes, multiline values and source record lines',()=>{
 const p=parsed('\uFEFFword,meaning,sentence\r\naudience,"观众,听众","She said ""hello""."\r\nnovel,小说,"First line\r\nSecond line"\r\nbranch,分支,Tree branch');
 assert.deepEqual(p.rowNumbers,[1,2,3,5]);assert.equal(p.rows[1][1],'观众,听众');assert.equal(p.rows[1][2],'She said "hello".');assert.equal(p.rows[2][2],'First line\nSecond line');
 assert.throws(()=>parsed('word,meaning\nnovel,"unclosed'),/引号没有闭合/);assert.throws(()=>parsed('novel,"book"oops'),/引号结束/);
});
test('TSV, pipes, a single English column and selected delimiter work',()=>{
 assert.equal(I.parseText('audience\t观众\nbranch\t分支').separator,'\t');assert.deepEqual(parsed('audience | 观众\nbranch | 分支').rows[0],['audience ',' 观众']);
 assert.deepEqual(parsed('audience\n\nbranch\n').rowNumbers,[1,3]);assert.equal(parsed('audience, people',{separator:'line'}).rows[0][0],'audience, people');
});
test('Chinese and English column names are guessed while headerless data keeps its first row',()=>{
 assert.deepEqual(I.guessColumns([['序号','常规','中文','英式音标','例句','例句翻译','章节','标签','来源']]),{header:true,mapping:{word:1,meaning:2,phonetic:3,sentence:4,translation:5,chapter:6,tags:7,source:8}});
 assert.deepEqual(I.guessColumns([['novel','小说','Read a novel.']]),{header:false,mapping:{word:0,meaning:1,sentence:2}});
});
test('English-only words become drafts; inflections and phrases remain separate',()=>{
 const p=preview('audiences\na radio program\nnovel');assert.equal(p.stats.new,3);assert.equal(p.stats.drafts,3);assert.equal(p.canImport,true);assert.equal(p.rows[1].input.word,'a radio program');
});
test('repeated import links existing word and fills only missing content without changing state',()=>{
 const s=state(),before=JSON.stringify(s),p=preview('word\tmeaning\tsentence\naudience\t观众\tMany people form an audience.',{},s);assert.equal(p.rows[0].action,'update');assert.deepEqual(p.rows[0].changes,{sentence:'Many people form an audience.'});assert.equal(p.rows[0].wordId,'jf-one');assert.equal(JSON.stringify(s),before);
 const repeat=preview('word\tmeaning\naudience\t观众');assert.equal(repeat.rows[0].action,'link');assert.equal(repeat.stats.new,0);
});
test('changed existing values require explicit keep/fill/replace decisions; empty cells never clear existing values',()=>{
 const text='word\tmeaning\tsentence\naudience\t听众\tListen to the audience.';
 assert.equal(preview(text).canImport,false);assert.equal(preview(text).rows[0].conflicts[0].before,'观众');
 assert.deepEqual(preview(text,{decisions:{2:'keep'}}).rows[0].changes,{});
 assert.deepEqual(preview(text,{decisions:{2:'fill'}}).rows[0].changes,{sentence:'Listen to the audience.'});
 assert.deepEqual(preview(text,{decisions:{2:'replace'}}).rows[0].changes,{sentence:'Listen to the audience.',meaning:'听众'});
 assert.deepEqual(preview('word\tmeaning\tsentence\naudience\t\t',{decisions:{2:'replace'}}).rows[0].changes,{});
});
test('within-file duplicates link the original row and differing duplicates require an explicit choice',()=>{
 const p=preview('word\tmeaning\nnovel\t小说\nnovel\t小说');assert.equal(p.stats.new,1);assert.equal(p.rows[1].action,'link');assert.equal(p.rows[1].duplicateOf,2);assert.equal(p.canImport,true);
 const changed=preview('word\tmeaning\nnovel\t小说\nnovel\t新颖的');assert.equal(changed.rows[1].action,'conflict');assert.equal(changed.canImport,false);
 const replaced=preview('word\tmeaning\nnovel\t小说\nnovel\t新颖的',{decisions:{3:'replace'}});assert.equal(replaced.rows[1].duplicateOf,2);assert.equal(replaced.rows[1].changes.meaning,'新颖的');
 const independent=preview('word\tmeaning\nnovel\t小说\nnovel\t新颖的',{decisions:{3:'new'}});assert.equal(independent.stats.new,2);assert.equal(independent.rows[1].duplicateOf,null);
 const filling=preview('word\tmeaning\tsentence\naudience\t观众\tFirst example.\naudience\t观众\tDifferent example.');assert.equal(filling.rows[1].action,'conflict');assert.equal(filling.rows[1].duplicateOf,2);
});
test('case-sensitive proper words are candidates, not silently merged; a selected candidate or independent new is explicit',()=>{
 const text='word\tmeaning\nus\t我们';assert.equal(preview(text).rows[0].action,'conflict');assert.equal(preview(text).rows[0].candidates[0].word,'US');
 assert.equal(preview(text,{decisions:{2:'new'}}).rows[0].action,'new');assert.equal(preview(text,{decisions:{2:{action:'keep',wordId:'custom:us'}}}).rows[0].wordId,'custom:us');
 const s=state();s.words.push({...s.words[0],id:'custom:audience'});assert.equal(preview('audience\t观众',{},s).rows[0].action,'conflict');
 assert.equal(preview('audience\t观众',{decisions:{1:{action:'keep',wordId:'custom:audience'}}},s).rows[0].wordId,'custom:audience');
});
test('row errors are shown before commit and explicit skip allows other valid rows',()=>{
 const text='word\tmeaning\n单词\twrong column\nnovel\t小说';const p=preview(text);assert.equal(p.rows[0].action,'error');assert.equal(p.rows[0].rowNumber,2);assert.equal(p.canImport,false);assert.equal(preview(text,{decisions:{2:'skip'}}).canImport,true);
 assert.equal(preview('Could you give me an example?').rows[0].action,'error');assert.equal(preview('<script>alert(1)</script>').rows[0].action,'error');
 // Markup in a definition stays literal text. Rendering must escape it.
 assert.equal(preview('novel\t<img src=x onerror=alert(1)>').rows[0].input.meaning,'<img src=x onerror=alert(1)>');
});
test('file and row limits fail before a giant preview can be applied',()=>{
 assert.throws(()=>I.parseText('x'.repeat(I.MAX_BYTES+1)),/10 MB/);assert.throws(()=>I.parseText(Array(10003).fill('novel').join('\n')),/10,000/);assert.throws(()=>I.preview(state(),[['novel']],{mapping:{word:-1}}),/所在列/);
 assert.throws(()=>I.preview(state(),[['novel']],{mapping:JSON.parse('{"word":0,"__proto__":0}')}),/无法识别/);
});
test('real XLSX reads multiple sheets, keeps spreadsheet row numbers and uses saved formula values only',()=>{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['word','meaning'],['novel','小说'],[],['branch','分支']]);sheet.C2={t:'n',f:'1+1',v:2};sheet.C4={t:'n',f:'1+2'};sheet['!ref']='A1:C4';
 XLSX.utils.book_append_sheet(book,sheet,'我的词表');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['audiences']]),'第二页');
 const data=XLSX.write(book,{type:'buffer',bookType:'xlsx'}),p=I.parseWorkbook(data,{XLSX});assert.equal(p.sheets.length,2);assert.deepEqual(p.sheets[0].rowNumbers,[1,2,4]);assert.equal(p.sheets[0].rows[1][2],'2');assert.equal(p.sheets[1].rows[0][0],'audiences');
 assert.throws(()=>I.parseWorkbook(new Uint8Array([1,2,3]),{XLSX:{read(){throw new Error('bad')}}}),/有效的 .xlsx/);
 assert.throws(()=>I.parseWorkbook(data,{XLSX:{read(){throw new Error('bad')}}}),/无法读取/);
 const oversized=Buffer.from(data);for(let i=0;i<oversized.length-46;i++)if(oversized.readUInt32LE(i)===0x02014b50){oversized.writeUInt32LE(70*1024*1024,i+24);break;}assert.throws(()=>I.parseWorkbook(oversized,{XLSX}),/64 MB/);
});
