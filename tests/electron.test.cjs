const { _electron:electron }=require('./playwright.cjs');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=path.join(root,'test-results','electron-'+Date.now()),exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');
(async()=>{
 let app,p,errors=[];
 async function launch(){app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:data}});p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));await p.waitForLoadState('domcontentloaded');await p.waitForFunction(()=>typeof DesktopState==='object'&&window.vocabHost?.call('load')?.value?.state&&document.getElementById('start-new'));}
 const get=()=>p.evaluate(async()=>{await window.VocabPersistence.flush();const r=window.vocabHost.call('load');return DesktopState.documentState(r.value)});
 await launch();let s=await get();assert.equal(s.words.length,1493);assert(s.words.every(w=>w.phonetic.trim()));
 await p.locator('#start-new').click();
 // Decode the shipped files through real Electron Audio, including the slow
 // candidate at rate 1, before continuing the persistence regression.
 await p.evaluate(()=>{const OriginalAudio=Audio;window.Audio=function(file){const audio=new OriginalAudio(file);window.packagedAudio=audio;return audio;};});
 await p.locator('#play-audio').click();await p.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('正常速度'));
 await p.locator('#audio-rate').selectOption('0.75');await p.locator('#play-audio').click();await p.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('慢速'));
 const audio=await p.evaluate(()=>{const data=JSON.parse(document.getElementById('audio-data').textContent),card=data.entries['jf-0001']['en-GB'];return {src:packagedAudio.src,rate:packagedAudio.playbackRate,ready:packagedAudio.readyState,slow:card.slow?.file};});
 assert(audio.ready>=2);assert(audio.src.endsWith(audio.slow||'jf-0001.m4a'));assert.equal(audio.rate,audio.slow?1:0.75);await p.locator('#audio-rate').selectOption('1');
 await p.locator('[data-grade="good"]').click();s=await get();assert.equal(s.history.length,1);assert.equal(s.dailyPlan.done,1);await p.locator('#mark-mastered').click();s=await get();assert.equal(s.cards[s.words[1].id].mastered,true);await app.close();
 await launch();s=await get();assert.equal(s.history.length,2);assert.equal(s.cards[s.words[1].id].due,null);assert.equal(s.session.cursor,2);
 await p.locator('#continue-session').click();await p.locator('#undo').click();s=await get();assert.equal(s.cards[s.words[1].id].mastered,false);assert.equal(s.session.cursor,1);
 await p.locator('#tab-library').click();await p.locator('#search').fill('abstract');await p.locator('#word-list [data-open]').first().click();await p.locator('#detail-note').fill('桌面 SQLite 冷启动保留');await p.locator('#save-detail').click();await p.evaluate(()=>window.VocabPersistence.flush());await p.reload();s=await get();assert.equal(s.cards[s.words.find(w=>w.word==='abstract').id].note,'桌面 SQLite 冷启动保留');
 assert.equal(await p.locator('[id^=usb-]').count(),0);
 assert.equal(await p.evaluate(()=>typeof window.vocabHost.callAsync),'function');
 assert(await p.evaluate(()=>typeof require==='undefined'));assert(await p.evaluate(()=>window.vocabHost.call('anything').ok===false));
 await p.screenshot({path:path.join(root,'test-results/electron-window.png'),fullPage:true});assert.deepEqual(errors,[]);await app.close();
 assert(fs.existsSync(path.join(data,'progress.sqlite')));console.log('PASS real Electron SQLite save, quit/reopen, ongoing cursor, mastery undo, personal note, isolated renderer, asynchronous save and Windows-only surface.');
})().catch(e=>{console.error(e);process.exit(1)});
