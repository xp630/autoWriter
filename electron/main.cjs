// Electron 主进程
// 启动 BrowserWindow + 加载 Vite dev server（开发）或 dist HTML（生产）

const { app, BrowserWindow, ipcMain, shell, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { registerIpc } = require('./ipc.cjs');

const isDev = process.env.NODE_ENV === 'development';
const isTestMode = process.env.AUTOWRITER_TEST_MODE === '1';

// 注册自定义协议 aw-img:// → 映射到 userData/uploads（安全地渲染本地图片）
function registerImgProtocol() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'aw-img', privileges: { supportFetchAPI: false, standard: true, secure: true, stream: true } },
  ]);
  app.whenReady().then(() => {
    const uploadsDir = path.join(app.getPath('userData'), 'uploads');
    protocol.handle('aw-img', (request) => {
      try {
        const url = new URL(request.url);
        const rawName = (url.hostname || url.host || url.pathname.replace(/^\//, ''));
        const filename = decodeURIComponent(rawName.replace(/^img\//, ''));
        const filePath = path.join(uploadsDir, filename);
        if (!filePath.startsWith(uploadsDir + path.sep)) {
          return new Response('forbidden', { status: 403 });
        }
        if (!require('node:fs').existsSync(filePath)) {
          return new Response('not found', { status: 404 });
        }
        return net.fetch('file://' + filePath);
      } catch (err) {
        return new Response('not found', { status: 404 });
      }
    });
  });
}

// 测试钩子 —— 捕获所有已注册的 IPC handler，暴露给 Playwright
function registerTestHooks() {
  const handlerRegistry = new Map();
  const registeredChannels = new Set();

  // 包装 ipcMain.handle，把 listener 复制一份到我们的注册表
  // （不能覆盖 ipcMain.handle，否则会破坏真实 IPC 路径）
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    handlerRegistry.set(channel, listener);
    registeredChannels.add(channel);
    return originalHandle(channel, listener);
  };

  // 测试专用 handler
  ipcMain.handle('test:list-channels', () => Array.from(registeredChannels).sort());

  ipcMain.handle('test:invoke', async (event, channel, ...args) => {
    const handler = handlerRegistry.get(channel);
    if (!handler) {
      const known = Array.from(handlerRegistry.keys()).sort().join(', ');
      throw new Error(`Channel "${channel}" 未注册。已知: ${known}`);
    }
    return await handler(event, ...args);
  });

  ipcMain.handle('test:reset-db', async () => {
    // 不能直接 resetDb()——会关闭 db，但 ipc.cjs 在 registerIpc() 时已经把 db 作为闭包常量捕获了
    // 改为清表（保留 schema），next getDb() 不需要重建
    const Database = require('better-sqlite3');
    const { app: electronApp } = require('electron');
    const dbPath = path.join(electronApp.getPath('userData'), 'autoWriter.db');
    const db = new Database(dbPath);
    try {
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
      db.exec('PRAGMA foreign_keys = OFF');
      for (const t of tables) {
        if (t.name.startsWith('sqlite_')) continue;
        db.exec(`DELETE FROM "${t.name}"`);
      }
      // 重置 autoincrement
      db.exec(`DELETE FROM sqlite_sequence`);
      db.exec('PRAGMA foreign_keys = ON');
    } finally {
      db.close();
    }
    return { ok: true };
  });

  ipcMain.handle('test:userdata', () => app.getPath('userData'));

  // 测试用：执行任意 SQL（生产环境下不注册）—— 用于构造测试夹具
  ipcMain.handle('test:exec-sql', (_e, sql, params) => {
    const Database = require('better-sqlite3');
    const dbPath = path.join(app.getPath('userData'), 'autoWriter.db');
    const db = new Database(dbPath);
    try {
      const stmt = db.prepare(sql);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(...(params || []));
      }
      return stmt.run(...(params || []));
    } finally {
      db.close();
    }
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'autoWriter · AI 文章生成',
    backgroundColor: '#0a0a12',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

registerImgProtocol();

// ===== 测试模式：注册 test:* meta-handlers（必须在 registerIpc 之前）=====
if (isTestMode) {
  registerTestHooks();
  console.log('[main] Test mode enabled — _test API exposed via preload');
}

// ===== IPC handlers（main ↔ renderer）=====
registerIpc();
ipcMain.handle('app:get-version', () => app.getVersion());

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
