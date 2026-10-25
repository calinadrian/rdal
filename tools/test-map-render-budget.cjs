// Exercise map rendering without showing a window over the user's game.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || root);
app.setPath('userData', require('./test-profile.cjs').testProfile('map-render-budget'));
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', minimap: false, hotkey: '`' }));
ipcMain.handle('preferences:get', () => ({}));
ipcMain.handle('update:get', () => ({ status: 'idle', current: require(path.join(target, 'package.json')).version }));
ipcMain.on('preferences:commit', e => { e.returnValue = { ok: true }; });
const timer = setTimeout(() => { console.error('Render budget timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1180, height: 720, show: false,
    webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error(message); });
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html'));
    await new Promise(r => setTimeout(r, 500));
    await win.webContents.executeJavaScript(`
      window.testFrames=0;
      window.testNow=0;window.testPins=[];window.testAngles=[];window.testPlayerAngle=false;
      Object.defineProperty(performance,'now',{configurable:true,value:()=>testNow});
      document.hasFocus=()=>false;
      const originalFill=CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect=function(...args){if(this.canvas.id==='map')testFrames++;return originalFill.apply(this,args)};
      const originalArc=CanvasRenderingContext2D.prototype.arc,originalRotate=CanvasRenderingContext2D.prototype.rotate;
      CanvasRenderingContext2D.prototype.arc=function(x,y,r,...args){if(this.canvas.id==='map' && r===22){testPins.push({x,y});testPlayerAngle=true}return originalArc.call(this,x,y,r,...args)};
      CanvasRenderingContext2D.prototype.rotate=function(angle){if(this.canvas.id==='map' && testPlayerAngle){testAngles.push(angle);testPlayerAngle=false}return originalRotate.call(this,angle)};
      const originalRAF=window.requestAnimationFrame;
      window.requestAnimationFrame=fn=>{if(fn.name==='loop'){window.testMapLoop=fn;return 0}return originalRAF(fn)};
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
      selectModule('map');
      window.testMe={ok:true,world:'L_World',x:124000,y:139000,z:0,yaw:0};
      MapView.setPlayer(testMe);MapView.setFollow(false);
      true;
    `);
    await new Promise(r => setTimeout(r, 400));
    const measured = await win.webContents.executeJavaScript(`(()=>{
      const run=start=>{const before=testFrames;for(let i=0;i<180;i++){testNow=start+i*1000/360;MapView.redraw();testMapLoop(testNow)}return testFrames-before};
      const visible=run(1000);
      testNow=2000;window.dispatchEvent(new MouseEvent('mousemove'));const pointer=run(2000);
      document.body.classList.add('game-map');const fullscreen=run(6000);
      MapView.setPlayer({...testMe,yaw:179});MapView.centerOnPlayer(.6);testNow=8000;testMapLoop(testNow);
      const start=MapView.screenOf(testMe),target={...testMe,x:testMe.x+1200,yaw:-179};
      MapView.setPlayer(target);const end=MapView.screenOf(target);
      testNow=8017;testMapLoop(testNow);const first=testPins.at(-1),angle=(testAngles.at(-1)*180/Math.PI-90+360)%360;
      testNow=8034;testMapLoop(testNow);const second=testPins.at(-1);
      const interpolated=first.x>start.x && first.x<end.x && second.x>first.x && second.x<end.x;
      const livePosition=MapView.minimapScene(27000).player.x===target.x;
      const jump={...testMe,x:testMe.x+10000,yaw:45};MapView.setPlayer(jump);testNow=8051;testMapLoop(testNow);
      const teleported=Math.abs(testPins.at(-1).x-MapView.screenOf(jump).x)<.000001;
      document.body.classList.remove('game-map');
      selectModule('quests');MapView.setPlayer({...jump,x:jump.x+100});const hiddenMap=run(10000);
      const scene=MapView.minimapScene(27000);
      selectModule('map');Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      MapView.redraw();const hiddenWindow=run(12000);
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});MapView.redraw();const resumed=run(14000);
      const freshResume=Math.abs(testPins.at(-1).x-MapView.screenOf({...jump,x:jump.x+100}).x)<.000001;
      return {visible,pointer,fullscreen,interpolated,angle,livePosition,teleported,hiddenMap,hiddenWindow,resumed,freshResume,sceneReady:scene.ok};
    })()`);
    console.log(JSON.stringify(measured));
    if (!process.env.ATLAS_PERF_BASELINE) {
      assert(measured.visible > 0 && measured.visible <= 11, 'While the game is played the visible map paints at most 20 FPS on a simulated 360 Hz display');
      assert(measured.pointer > 15 && measured.pointer <= 31, 'With the mouse on the app the map has a 60 FPS render budget');
      assert(measured.fullscreen >= 29 && measured.fullscreen <= 31,'Fullscreen map stays at 60 FPS without keyboard focus or mouse movement');
      assert(measured.interpolated,'The painted player moves between samples instead of jumping at the tracker rate');
      assert(measured.angle>179 && measured.angle<181,'The arrow turns across north by the shortest path');
      assert(measured.livePosition,'Navigation and the minimap retain the unmodified latest tracker coordinates');
      assert(measured.teleported && measured.freshResume,'Teleports and reopening the map snap to the latest position');
      assert.equal(measured.hiddenMap, 0, 'A closed map never paints its retained canvas');
      assert.equal(measured.hiddenWindow, 0, 'A hidden app window never paints its map');
      assert(measured.resumed > 0 && measured.resumed <= 31, 'Reopening paints the latest scene within the same budget');
      assert(measured.sceneReady, 'Minimap scene data remains available while the big map is closed');
      console.log('PASS: fullscreen 60 FPS without focus, background map 20 FPS, smooth visual position and wrapped heading, instant teleports, exact live data and zero hidden map redraws');
    }
    clearTimeout(timer);app.exit(0);
  } catch(error) { console.error(error);clearTimeout(timer);app.exit(1); }
});
