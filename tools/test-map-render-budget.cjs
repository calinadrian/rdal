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
      const originalFill=CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect=function(...args){if(this.canvas.id==='map')testFrames++;return originalFill.apply(this,args)};
      const originalRAF=window.requestAnimationFrame;
      window.requestAnimationFrame=fn=>{if(fn.name==='loop'){window.testMapLoop=fn;return 0}return originalRAF(fn)};
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
      selectModule('map');
      window.testMe={ok:true,world:'L_World',x:124000,y:139000,z:0,yaw:0};
      MapView.setPlayer(testMe);MapView.setNpcs([{...testMe,n:'Test alert',alert:true,hostile:true}]);
      true;
    `);
    await new Promise(r => setTimeout(r, 400));
    const measured = await win.webContents.executeJavaScript(`(()=>{
      const run=start=>{const before=testFrames;for(let i=0;i<180;i++)testMapLoop(start+i*1000/360);return testFrames-before};
      const visible=run(1000);
      selectModule('quests');MapView.setPlayer({...testMe,x:testMe.x+100});const hiddenMap=run(3000);
      const scene=MapView.minimapScene(27000);
      selectModule('map');Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      MapView.redraw();const hiddenWindow=run(5000);
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});MapView.redraw();const resumed=run(7000);
      return {visible,hiddenMap,hiddenWindow,resumed,sceneReady:scene.ok};
    })()`);
    console.log(JSON.stringify(measured));
    if (!process.env.ATLAS_PERF_BASELINE) {
      assert(measured.visible > 0 && measured.visible <= 31, 'Visible map has a 60 FPS render budget on a simulated 360 Hz display');
      assert.equal(measured.hiddenMap, 0, 'A closed map never paints its retained canvas');
      assert.equal(measured.hiddenWindow, 0, 'A hidden app window never paints its map');
      assert(measured.resumed > 0 && measured.resumed <= 31, 'Reopening paints the latest scene within the same budget');
      assert(measured.sceneReady, 'Minimap scene data remains available while the big map is closed');
      console.log('PASS: capped visible map rendering, no hidden map/window painting, fresh scene after reopening and independent minimap data');
    }
    clearTimeout(timer);app.exit(0);
  } catch(error) { console.error(error);clearTimeout(timer);app.exit(1); }
});
