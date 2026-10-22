const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const target=path.resolve(process.argv.filter(a=>!a.startsWith('--'))[2]||root);
app.setPath('userData', require('./test-profile.cjs').testProfile('map-landmarks')); // removed after the test ends
ipcMain.handle('db:get',()=>JSON.parse(fs.readFileSync(path.join(target,'data/db.json'))));
ipcMain.handle('settings:get',()=>({mode:'window',hotkey:'Control+Shift+L'}));
ipcMain.handle('preferences:get',()=>({}));
ipcMain.on('preferences:commit',e=>{e.returnValue={ok:true};});
const timer=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1280,height:850,show:true,webPreferences:{preload:path.join(target,'app/preload.js'),sandbox:false,backgroundThrottling:false}});
 try {
  await win.loadFile(path.join(target,'app/ui/index.html'));await new Promise(r=>setTimeout(r,600));
  const result=await win.webContents.executeJavaScript(`(async()=>{
   state.module='map';setMapMode(true);renderModules();
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   for(const c of db.map.categories){const box=document.querySelector('#count-'+c.id).closest('label').querySelector('input');if(box.checked!==['monster','travel'].includes(c.id))box.click();}
   window.landmarks={burrow:db.map.markers.find(m=>/burrow/i.test(m.n)),dungeon:db.map.markers.find(m=>m.enter&&m.c==='travel')};
   for(const [kind,marker] of Object.entries(landmarks)) {
    if(!marker.i.endsWith(kind==='burrow'?'AtlasBurrow.svg':'AtlasDungeon.svg'))throw Error('Wrong '+kind+' icon');
    const image=new Image();image.src='../../data/'+marker.i;await image.decode();
   }
   MapView.focusMarker(landmarks.burrow);await wait(500);
   const canvas=document.querySelector('#map'),ctx=canvas.getContext('2d'),arc=ctx.arc,draw=ctx.drawImage;
   let dots=0,burrows=0;
   ctx.arc=function(...a){if(a[2]===5)dots++;return arc.apply(this,a)};
   ctx.drawImage=function(img,...a){if(img.src?.endsWith('AtlasBurrow.svg')&&a[2]===26)burrows++;return draw.call(this,img,...a)};
   MapView.redraw();await wait(100);ctx.arc=arc;ctx.drawImage=draw;
   if(!dots||!burrows)throw Error('Expected small dots and readable burrows');
   const rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));await wait(60);
   if(!document.querySelector('#map-tip').textContent.includes('Kebbit burrow'))throw Error('Burrow tooltip broken');
   return {dots,burrows};
  })()`);
  fs.writeFileSync(path.join(root,'test-fixtures/map-kebbit-burrow.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`MapView.focusMarker(landmarks.dungeon)`);await new Promise(r=>setTimeout(r,500));
  fs.writeFileSync(path.join(root,'test-fixtures/map-dungeon-entrance.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`MapView.setLayer(db.map.dungeons.find(d=>d.id===landmarks.dungeon.enter))`);
  assert(await win.webContents.executeJavaScript(`MapView.layer().id===landmarks.dungeon.enter`));
  console.log('PASS: 10px spawn dots, distinct 26px SVG burrows and dungeons, SVG decoding, burrow hover and dungeon layer navigation',result);
  clearTimeout(timer);app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
