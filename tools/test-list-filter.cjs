// Real Chromium text input regression: filtering must preserve the live editing node.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const args = process.argv.filter(arg => !arg.startsWith('--'));
const target = args[2] ? path.resolve(args[2]) : root;
app.setPath('userData', require('./test-profile.cjs').testProfile('filter')); // removed after the test ends
ipcMain.handle('db:get', () => JSON.parse(fs.readFileSync(path.join(target, 'data/db.json'))));
ipcMain.handle('settings:get', () => ({ mode: 'window', hotkey: 'Control+Shift+L' }));
ipcMain.handle('preferences:get', () => ({}));
ipcMain.on('preferences:commit', event => { event.returnValue = { ok: true }; });
setTimeout(() => { console.error('Filter test timed out'); app.exit(1); }, 15000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1180, height: 720, show: false,
    webPreferences: { preload: path.join(target, 'app/preload.js'), sandbox: false } });
  const js = code => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(target, 'app/ui/index.html'));
    await new Promise(r => setTimeout(r, 800));
    await js(`state.module = 'monsters'; state.filter = ''; render();
      window.editingFilter = document.querySelector('.list-filter input'); editingFilter.focus();`);
    const check = async (value, caret, expectedRow) => {
      const actual = await js(`({value: editingFilter.value, caret: editingFilter.selectionStart,
        focused: document.activeElement === editingFilter,
        sameNode: document.querySelector('.list-filter input') === editingFilter,
        stateValue: state.filter, rows: [...document.querySelectorAll('#list .list-item')].map(r => r.title)})`);
      if (actual.value !== value || actual.stateValue !== value || actual.caret !== caret || !actual.focused || !actual.sameNode
        || (expectedRow && !actual.rows.includes(expectedRow))) throw Error(JSON.stringify(actual));
    };
    for (const char of 'Wlf') await win.webContents.insertText(char);
    await check('Wlf', 3);
    await js('editingFilter.setSelectionRange(1, 1)');
    await win.webContents.insertText('o');
    await check('Wolf', 2, 'Wolf');
    // Live updates (e.g. quest progress) must also preserve a selection.
    await js('editingFilter.setSelectionRange(1, 3); renderList();');
    const end = await js('editingFilter.selectionEnd');
    if (end !== 3) throw Error('Refresh reset selection');
    await win.webContents.insertText('o');
    await check('Wof', 2);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    await new Promise(r => setTimeout(r, 80));
    await check('Wf', 1);
    await js("editingFilter.select(); document.execCommand('delete');");
    await check('', 0, 'Wolf');
    console.log('PASS: continuous typing, middle insertion, selection replacement, refresh, backspace, clearing and filtering');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
