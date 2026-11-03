'use strict';
// Build one checksummed, data-only content snapshot for both offline platforms.
const fs=require('node:fs'),path=require('node:path');
const ContentPack=require('../shared/content-pack.js');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),file=path.join(root,'web/index.html'),html=fs.readFileSync(file,'utf8');
const words=JSON.parse(html.match(/<script id="vocabulary-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const partial=process.argv.includes('--allow-incomplete'),check=process.argv.includes('--check');
const usageFile=path.join(root,'tools/usage/entries.json');
const usage=fs.existsSync(usageFile)?JSON.parse(fs.readFileSync(usageFile,'utf8')):[];
const usageMap=new Map(usage.map(x=>[x.id,x.usage]));
const alternativeFile=path.join(root,'tools/mnemonics/alternatives.json');
const alternatives=fs.existsSync(alternativeFile)?JSON.parse(fs.readFileSync(alternativeFile,'utf8')):[];
if(!partial){if(usage.length!==1493)throw Error('All 1493 reviewed usage cards are required');if(alternatives.length<120)throw Error('At least 120 reviewed alternative cues are required');}
const choices=new Map();
for(const alternative of alternatives){const {word,...plan}=alternative,key=word.toLowerCase();if(!words.some(w=>w.word.toLowerCase()===key))throw Error('Unknown alternative '+word);const items=choices.get(key)||[];items.push(plan);choices.set(key,items);}
const entries=words.map(w=>({id:w.id,word:w.word,memory:w.memory,...(usageMap.has(w.id)?{usage:usageMap.get(w.id)}:{}),...(choices.has(w.word.toLowerCase())?{alternatives:choices.get(w.word.toLowerCase())}:{})}));
const pack=ContentPack.create(entries,'2026-11-03.2',{expectedWords:words});
const audioPath=path.join(root,'web/audio-manifest.json');
const audio=fs.existsSync(audioPath)?JSON.parse(fs.readFileSync(audioPath,'utf8')):{entries:{}};
if(!partial&&Object.keys(audio.entries).length!==1493)throw Error('All offline pronunciations are required');
if(!partial){
 const slow=Object.values(audio.entries).some(variants=>Object.values(variants).some(card=>card.slow));
 for(const w of words)for(const locale of ['en-GB','en-US']){
  const card=audio.entries[w.id]?.[locale];if(!card)throw Error('Missing offline pronunciation '+w.id+'/'+locale);
  if(card.note!==undefined&&(typeof card.note!=='string'||card.note.length>200))throw Error('Invalid pronunciation note '+w.id);
  const records=[[card,'']];if(slow){if(!card.slow)throw Error('Missing slow pronunciation '+w.id+'/'+locale);records.push([card.slow,'-slow']);}
  for(const [record,suffix] of records){
   const expected=`audio/${locale}/${w.id}${suffix}.m4a`;
   if(record.file!==expected||typeof record.seconds!=='number'||!(record.seconds>.1&&record.seconds<20))throw Error('Invalid audio record '+expected);
   const data=fs.readFileSync(path.join(root,'web',expected));
   if(data.length<=256||data.toString('ascii',4,8)!=='ftyp'||crypto.createHash('sha256').update(data).digest('hex')!==record.sha256)throw Error('Audio content mismatch '+expected);
  }
 }
}
const json=JSON.stringify(pack),escaped=json.replace(/</g,'\\u003c');
let rendered=html.replace(/(<script id="learning-content" type="application\/json">)[\s\S]*?(<\/script>)/,()=>'<script id="learning-content" type="application/json">'+escaped+'</script>');
rendered=rendered.replace(/(<script id="audio-data" type="application\/json">)[\s\S]*?(<\/script>)/,()=>'<script id="audio-data" type="application/json">'+JSON.stringify(audio).replace(/</g,'\\u003c')+'</script>');
if(check){if(rendered!==html||fs.readFileSync(path.join(root,'web/content-pack.json'),'utf8')!==json+'\n')throw Error('Run node tools/build_content.cjs');}
else{fs.writeFileSync(file,rendered);fs.writeFileSync(path.join(root,'web/content-pack.json'),json+'\n');fs.writeFileSync(path.join(root,'web/content-meta.json'),JSON.stringify({version:pack.version,checksum:pack.checksum,entries:1493,usage:usage.length,alternatives:alternatives.length})+'\n');}
console.log(JSON.stringify({version:pack.version,entries:entries.length,usage:usage.length,alternatives:alternatives.length,audioWords:Object.keys(audio.entries).length,checksum:pack.checksum}));
