(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WordImport=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_BYTES=10*1024*1024,MAX_ROWS=10000,MAX_COLUMNS=128,MAX_CELL=12000;
 const FIELDS=['word','meaning','phonetic','sentence','translation','chapter','tags','source'];
 const CONTENT=['meaning','phonetic','sentence','translation','tags','source'];
 const LIMITS={word:120,meaning:4000,phonetic:500,sentence:4000,translation:4000,chapter:120,tags:1000,source:2000};
 const BAD=new Set(['__proto__','prototype','constructor']);
 const aliases={word:['word','words','term','english','vocabulary','英文','英语','单词','词汇','词条','常规','常规词汇','常规单词'],meaning:['meaning','definition','chinese','translationcn','释义','中文','中文释义','汉语','意思'],phonetic:['phonetic','ipa','pronunciation','音标','读音','英式音标'],sentence:['sentence','example','examplesentence','英文例句','例句','英文短句','短句'],translation:['translation','sentencetranslation','例句翻译','例句译文','例句中文','中文译文','译文'],chapter:['chapter','unit','list','group','章节','单元','分组','组别'],tags:['tags','tag','标签'],source:['source','来源','出处']};
 const bytes=s=>typeof TextEncoder!=='undefined'?new TextEncoder().encode(s).length:unescape(encodeURIComponent(s)).length;
 const assert=(ok,msg)=>{if(!ok)throw new Error('词表导入：'+msg);};
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const clean=x=>String(x??'').replace(/^\uFEFF/,'').normalize('NFC').trim();
 const key=x=>clean(x).replace(/[ \t]+/g,' ');
 const folded=x=>key(x).toLowerCase();
 const headerKey=x=>clean(x).toLowerCase().replace(/[\s_\-()（）:：]/g,'');
 function validateRows(rows){assert(Array.isArray(rows)&&rows.length<=MAX_ROWS+1,'每次最多导入 10,000 行词条，请拆分文件。');for(const row of rows){assert(Array.isArray(row)&&row.length<=MAX_COLUMNS,'表格列数过多，最多支持 128 列。');for(const cell of row)assert(typeof cell==='string'&&cell.length<=MAX_CELL,'单元格内容过长或格式无效。');}return rows;}
 function separatorValue(separator){const names={auto:null,tab:'\t',comma:',',pipe:'|',semicolon:';',line:''};if(separator===undefined||separator===null)return null;if(Object.hasOwn(names,separator))return names[separator];assert(['\t',',','|',';',''].includes(separator),'分隔符无效。');return separator;}
 function detectSeparator(text){
  // Only separators outside quoted cells count. A stable column count wins.
  const counts={ '\t':[],',':[],'|':[],';':[] };let quoted=false,current={'\t':0,',':0,'|':0,';':0},records=0,hasText=false;
  for(let i=0;i<Math.min(text.length,65536)&&records<20;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;hasText=true;continue;}if(!quoted&&ch==='\n'){if(hasText){for(const sep of Object.keys(counts))counts[sep].push(current[sep]);records++;}current={'\t':0,',':0,'|':0,';':0};hasText=false;}else{if(!quoted&&Object.hasOwn(current,ch))current[ch]++;if(!/\s/.test(ch))hasText=true;}}
  if(hasText)for(const sep of Object.keys(counts))counts[sep].push(current[sep]);
  let best='',score=0;for(const sep of ['\t','|',',',';']){const values=counts[sep],positive=values.filter(x=>x>0);if(!positive.length)continue;const frequencies=new Map();for(const n of positive)frequencies.set(n,(frequencies.get(n)||0)+1);const stable=Math.max(...frequencies.values());const value=stable*10+positive.length-values.length;if(value>score){score=value;best=sep;}}
  return best;
 }
 function parseText(text,options={}){
  assert(typeof text==='string','请提供文本内容。');assert(bytes(text)<=MAX_BYTES,'文件超过 10 MB，请拆分后导入。');text=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const chosen=separatorValue(options.separator),separator=chosen===null?detectSeparator(text):chosen;
  const rows=[],rowNumbers=[];let row=[],field='',quoted=false,closed=false,line=1,startLine=1;
  const pushField=()=>{assert(field.length<=MAX_CELL,'第 '+startLine+' 行单元格过长。');row.push(field);assert(row.length<=MAX_COLUMNS,'第 '+startLine+' 行列数超过 128。');field='';closed=false;};
  const pushRow=()=>{pushField();if(row.some(value=>clean(value))){rows.push(row);rowNumbers.push(startLine);assert(rows.length<=MAX_ROWS+1,'每次最多导入 10,000 行词条。');}row=[];};
  for(let i=0;i<text.length;i++){
   const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else{field+=ch;if(ch==='\n')line++;}continue;}
   if(ch==='\n'){pushRow();line++;startLine=line;continue;}
   if(separator&&ch===separator){pushField();continue;}
   if(closed){assert(/[ \t]/.test(ch),'第 '+line+' 行引号结束后存在无法识别的内容。');continue;}
   if(ch==='"'&&field.trim()===''){field='';quoted=true;continue;}
   field+=ch;assert(field.length<=MAX_CELL,'第 '+startLine+' 行单元格过长。');
  }
  assert(!quoted,'第 '+startLine+' 行引号没有闭合。');if(field.length||row.length||closed)pushRow();
  validateRows(rows);return {sheets:[{name:'文本',rows,rowNumbers,warnings:[]}],separator};
 }
 function checkWorkbookArchive(input){
  // XLSX is a ZIP container. Bound its declared expanded size before asking the
  // spreadsheet parser to inflate it, and do not misread a renamed text file.
  assert(input.length>=22&&input[0]===0x50&&input[1]===0x4b,'请使用有效的 .xlsx 文件；旧版 .xls 请先在 Excel 中另存为 .xlsx。');
  const view=new DataView(input.buffer,input.byteOffset,input.byteLength);let end=-1;
  for(let i=input.length-22;i>=Math.max(0,input.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===input.length){end=i;break;}
  assert(end>=0,'Excel 压缩目录损坏。');const entries=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  assert(view.getUint16(end+4,true)===0&&view.getUint16(end+6,true)===0&&entries===view.getUint16(end+8,true)&&entries<=4096&&offset+size<=end,'不支持此 Excel 压缩格式，请另存为新的 .xlsx。');
  let cursor=offset,expanded=0;for(let n=0;n<entries;n++){assert(cursor+46<=offset+size&&view.getUint32(cursor,true)===0x02014b50,'Excel 压缩目录损坏。');expanded+=view.getUint32(cursor+24,true);assert(expanded<=64*1024*1024,'Excel 展开后超过 64 MB，请删除无关内容或拆分文件。');cursor+=46+view.getUint16(cursor+28,true)+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);assert(cursor<=offset+size,'Excel 压缩目录损坏。');}
 }
 function parseWorkbook(data,options={}){
  const XLSX=options.XLSX||(typeof globalThis!=='undefined'?globalThis.XLSX:null);assert(XLSX&&typeof XLSX.read==='function','Excel 解析组件未加载，请重新打开软件。');
  let input;if(data instanceof ArrayBuffer)input=new Uint8Array(data);else if(ArrayBuffer.isView(data))input=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);else throw new Error('词表导入：Excel 文件内容无效。');
  assert(input.byteLength<=MAX_BYTES,'文件超过 10 MB，请拆分后导入。');checkWorkbookArchive(input);
  let workbook;try{workbook=XLSX.read(input,{type:'array',cellHTML:false,cellFormula:true,cellNF:false,cellText:true,bookVBA:false,bookFiles:false,sheetRows:MAX_ROWS+2});}catch(_){throw new Error('词表导入：无法读取 Excel，请检查文件是否损坏或受到密码保护。');}
  assert(Array.isArray(workbook.SheetNames)&&workbook.SheetNames.length<=64,'Excel 工作表过多，最多支持 64 个。');const sheets=[];
  for(const name of workbook.SheetNames){
   const sheet=workbook.Sheets[name];if(!sheet||!sheet['!ref']){sheets.push({name,rows:[],rowNumbers:[],warnings:[]});continue;}
   const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);assert(range.e.r-range.s.r+1<=MAX_ROWS+1,'工作表“'+name+'”超过 10,000 行，请拆分。');assert(range.e.c-range.s.c+1<=MAX_COLUMNS,'工作表“'+name+'”超过 128 列，请删去无关列。');
   const rows=[],rowNumbers=[],warnings=[];
   for(let r=range.s.r;r<=range.e.r;r++){const row=[];for(let c=range.s.c;c<=range.e.c;c++){const cell=sheet[XLSX.utils.encode_cell({r,c})];let value='';if(cell){if(cell.f&&cell.v===undefined)warnings.push('第 '+(r+1)+' 行第 '+(c+1)+' 列公式没有保存结果，请在 Excel 中另存为值。');if(cell.v!==undefined)value=String(cell.w??XLSX.utils.format_cell(cell));}row.push(value);}if(row.some(value=>clean(value))){rows.push(row);rowNumbers.push(r+1);}}
   validateRows(rows);sheets.push({name,rows,rowNumbers,warnings});
  }
  return {sheets,separator:null};
 }
 function guessColumns(rows){
  validateRows(rows);const first=rows.find(r=>r.some(x=>clean(x)))||[],mapping={};let hits=0;
  for(let column=0;column<first.length;column++){const name=headerKey(first[column]);for(const field of FIELDS){if(mapping[field]===undefined&&aliases[field].includes(name)){mapping[field]=column;hits++;break;}}}
  const header=mapping.word!==undefined||(hits>=2&&mapping.meaning!==undefined);if(!header){for(const k of Object.keys(mapping))delete mapping[k];mapping.word=0;if(first.length>1)mapping.meaning=1;if(first.length>2)mapping.sentence=2;}
  if(mapping.word===undefined)mapping.word=0;return {header,mapping};
 }
 function inputFor(row,mapping){const input={};for(const field of FIELDS){const index=mapping[field];input[field]=Number.isInteger(index)&&index>=0?clean(row[index]??''):'';}input.word=key(input.word);return input;}
 function validateInput(input){const errors=[];for(const f of FIELDS)if(input[f].length>LIMITS[f])errors.push(f+' 内容过长，最多 '+LIMITS[f]+' 字。');if(!input.word)errors.push('英文单词或短语为空。');else if(!/[A-Za-z\u00C0-\u024F]/.test(input.word)||/[\u3400-\u9fff<>\r\n!?;；！？]/.test(input.word)||/^https?:\/\//i.test(input.word)||input.word.split(/\s+/).length>16||(/\.$/.test(input.word)&&input.word.split(/\s+/).length>=5))errors.push('英文列应为单词或短语，请检查列对应关系。');return errors;}
 function decisionFor(value){if(typeof value==='string')return {action:value};if(object(value)&&Object.keys(value).every(k=>['action','wordId'].includes(k))&&typeof value.action==='string')return value;return {action:'auto'};}
 function preview(state,rows,options={}){
  validateRows(rows);assert(object(state)&&Array.isArray(state.words),'当前词库无效。');const mapping=options.mapping||guessColumns(rows).mapping;assert(object(mapping)&&Number.isInteger(mapping.word)&&mapping.word>=0&&mapping.word<MAX_COLUMNS,'请选择英文单词所在列。');
  for(const [field,index] of Object.entries(mapping)){assert(FIELDS.includes(field)&&!BAD.has(field),'无法识别的列用途。');assert(index===null||index===undefined||index===-1||Number.isInteger(index)&&index>=0&&index<MAX_COLUMNS,'列编号无效。');}
  const decisions=options.decisions||{},header=options.header===undefined?guessColumns(rows).header:Boolean(options.header),start=header?1:0;assert(rows.length-start<=MAX_ROWS,'每次最多导入 10,000 行词条。');
  const existing=state.words,exact=new Map(),similar=new Map();for(const w of existing){const k=key(w.word),f=folded(w.word);if(!exact.has(k))exact.set(k,[]);exact.get(k).push(w);if(!similar.has(f))similar.set(f,[]);similar.get(f).push(w);}
  const result=[],previous=new Map(),stats={total:0,new:0,linked:0,updated:0,skipped:0,errors:0,conflicts:0,drafts:0,duplicates:0};
  for(let i=start;i<rows.length;i++){
   if(!rows[i].some(value=>clean(value)))continue;const rowNumber=options.rowNumbers?.[i]??i+1,input=inputFor(rows[i],mapping),decision=decisionFor(decisions[rowNumber]);
   assert(['auto','keep','fill','replace','new','skip'].includes(decision.action),'第 '+rowNumber+' 行处理方式无效。');
   const row={rowNumber,input,action:'new',wordId:null,changes:{},conflicts:[],candidates:[],duplicateOf:null,draft:!input.meaning,errors:validateInput(input),warnings:[]};stats.total++;
   if(decision.action==='skip'){row.action='skip';row.errors=[];result.push(row);stats.skipped++;continue;}
   if(row.errors.length){row.action='error';result.push(row);stats.errors++;continue;}
   const matching=exact.get(key(input.word))||[],candidates=similar.get(folded(input.word))||[];row.candidates=candidates.map(w=>({id:w.id,word:w.word,meaning:w.meaning||''}));
   let target=null,prior=null;if(decision.wordId){target=existing.find(w=>w.id===decision.wordId);assert(target&&candidates.some(w=>w.id===target.id),'第 '+rowNumber+' 行选中的词条不是匹配候选。');}else if(matching.length===1)target=matching[0];
   if(!decision.wordId&&decision.action!=='new')prior=previous.get(key(input.word));
   if(prior){row.duplicateOf=prior.rowNumber;stats.duplicates++;target=prior.effective;row.wordId=prior.wordId;}
   else if(target){row.wordId=target.id;stats.duplicates++;}
   else if(candidates.length&&decision.action!=='new'){row.action='conflict';row.warnings.push(matching.length>1?'已有多个相同拼写的词条，请选择要关联的词条或独立新建。':'已有大小写不同的词条，请确认是否同一个词。');}
   if(decision.action==='new'){target=null;prior=null;row.duplicateOf=null;row.wordId=null;row.action='new';}
   if(target){
    for(const field of CONTENT){const before=clean(target[field]??''),after=input[field];if(!after||before===after)continue;if(!before)row.changes[field]=after;else row.conflicts.push({field,before,after});}
    if(decision.action==='keep'){row.changes={};row.action='link';}
    else if(decision.action==='replace'){for(const change of row.conflicts)row.changes[change.field]=change.after;row.action=Object.keys(row.changes).length?'update':'link';}
    else if(decision.action==='fill'){row.action=Object.keys(row.changes).length?'update':'link';if(row.conflicts.length)row.warnings.push('保留已有的非空资料，仅补空缺。');}
    else row.action=row.conflicts.length?'conflict':Object.keys(row.changes).length?'update':'link';
    row.draft=!clean(row.changes.meaning??target.meaning??'');
   }
   if(row.action==='new')previous.set(key(input.word),{rowNumber,wordId:null,effective:{...input}});
   else if(['link','update'].includes(row.action)){const effective={...target,...row.changes};previous.set(key(input.word),{rowNumber,wordId:row.wordId,effective});}
   result.push(row);if(row.action==='new')stats.new++;else if(row.action==='link')stats.linked++;else if(row.action==='update')stats.updated++;else if(row.action==='conflict')stats.conflicts++;
   if(row.draft&&['new','link','update'].includes(row.action))stats.drafts++;
  }
  assert(existing.length+stats.new<=10000,'导入后词库将超过 10,000 词，请减少本次词条数量。');
  return {rows:result,stats,canImport:stats.total>0&&stats.new+stats.linked+stats.updated>0&&stats.errors===0&&stats.conflicts===0};
 }
 return {parseText,parseWorkbook,guessColumns,preview,normalizeWord:key,FIELDS,CONTENT,MAX_BYTES,MAX_ROWS,MAX_COLUMNS,version:1};
});
