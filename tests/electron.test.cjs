const { _electron:electron }=require('C:/Users/23353/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=path.join(root,'test-results','electron-'+Date.now()),exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');
(async()=>{
 let app,p,errors=[];
 async function launch(){app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:data}});p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));await p.waitForFunction(()=>window.vocabHost?.call('load')?.value?.baseline);}
 const get=()=>p.evaluate(()=>{const r=window.vocabHost.call('load');return OfflineSync.materialize(r.value)});
 await launch();let s=await get();assert.equal(s.words.length,1493);assert(s.words.every(w=>w.phonetic.trim()));
 await p.locator('#start-new').click();await p.locator('[data-grade="good"]').click();s=await get();assert.equal(s.history.length,1);assert.equal(s.dailyPlan.done,1);await p.locator('#mark-mastered').click();s=await get();assert.equal(s.cards[s.words[1].id].mastered,true);await app.close();
 await launch();s=await get();assert.equal(s.history.length,2);assert.equal(s.cards[s.words[1].id].due,null);assert.equal(s.session.cursor,2);
 await p.locator('#continue-session').click();await p.locator('#undo').click();s=await get();assert.equal(s.cards[s.words[1].id].mastered,false);assert.equal(s.session.cursor,1);
 await p.locator('#tab-library').click();await p.locator('#search').fill('abstract');await p.locator('#word-list [data-open]').first().click();await p.locator('#detail-note').fill('桌面 SQLite 冷启动保留');await p.locator('#save-detail').click();await p.reload();s=await get();assert.equal(s.cards[s.words.find(w=>w.word==='abstract').id].note,'桌面 SQLite 冷启动保留');
 await p.locator('#usb-probe').click();await p.waitForFunction(()=>/没有检测|无法|需要|检测到|缺少|USB/.test(document.getElementById('usb-message').textContent));
 assert(await p.evaluate(()=>typeof require==='undefined'));assert(await p.evaluate(()=>window.vocabHost.call('anything').ok===false));
 await p.screenshot({path:path.join(root,'test-results/electron-window.png'),fullPage:true});assert.deepEqual(errors,[]);await app.close();
 assert(fs.existsSync(path.join(data,'progress.sqlite')));console.log('PASS real Electron SQLite save, quit/reopen, ongoing cursor, mastery undo, personal note, isolated renderer and USB probe path.');
})().catch(e=>{console.error(e);process.exit(1)});
