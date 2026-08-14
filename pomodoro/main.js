'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeImage,
  Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');

const WIN_WIDTH = 240;
const WIN_HEIGHT = 240;
const EDGE_MARGIN = 24;

let win = null;
let tray = null;
let state = null;

/* ------------------------------------------------------------------ *
 * 설정 저장 (창 위치 · 항상 위 · 시간 설정)
 * ------------------------------------------------------------------ */

function statePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function loadState() {
  const defaults = {
    bounds: null,
    alwaysOnTop: true,
    autoLaunch: false,
    durations: { focus: 25, short: 5, long: 15 },
    roundsBeforeLong: 4,
  };
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return {
      ...defaults,
      ...raw,
      durations: { ...defaults.durations, ...(raw.durations || {}) },
    };
  } catch {
    return defaults;
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch {
    /* 저장 실패는 조용히 무시 — 타이머 동작에는 지장 없음 */
  }
}

/* ------------------------------------------------------------------ *
 * 창 위치 — 기본값은 주 모니터 우측 상단
 * ------------------------------------------------------------------ */

function topRightPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIN_WIDTH - EDGE_MARGIN,
    y: workArea.y + EDGE_MARGIN,
  };
}

// 저장된 좌표가 지금 연결된 화면 밖이면(모니터를 뺐다면) 버린다.
function isOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return (
      bounds.x < a.x + a.width &&
      bounds.x + WIN_WIDTH > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + WIN_HEIGHT > a.y
    );
  });
}

function initialPosition() {
  if (state.bounds && isOnSomeDisplay(state.bounds)) return state.bounds;
  return topRightPosition();
}

/* ------------------------------------------------------------------ *
 * 항상 위 — 전체화면 앱 위에까지 뜨도록
 * ------------------------------------------------------------------ */

function applyAlwaysOnTop(flag) {
  if (!win) return;
  // 'screen-saver' 레벨이라야 macOS 전체화면 앱 위에도 올라온다.
  win.setAlwaysOnTop(flag, 'screen-saver');
  win.setVisibleOnAllWorkspaces(flag, { visibleOnFullScreen: true });
}

/* ------------------------------------------------------------------ *
 * 로그인 시 자동 시작 — 패키징된(설치된) 앱에서만 의미가 있다.
 * ------------------------------------------------------------------ */

function applyAutoLaunch(flag) {
  if (!app.isPackaged) return; // 개발 중(npm start)에는 건드리지 않는다
  app.setLoginItemSettings({
    openAtLogin: flag,
    // Windows 트레이 상주 앱이므로 시작 시 창을 감춰 두면 자연스럽다.
    args: flag ? ['--hidden'] : [],
  });
}

/* ------------------------------------------------------------------ *
 * 창 생성
 * ------------------------------------------------------------------ */

function createWindow() {
  const pos = initialPosition();

  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 창이 가려져도 타이머가 느려지지 않게
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    // 로그인 자동 시작일 때는 --hidden으로 실행되어 트레이에만 조용히 앉는다.
    if (!process.argv.includes('--hidden')) win.show();
    applyAlwaysOnTop(state.alwaysOnTop);
  });

  // 드래그로 옮긴 위치 기억
  win.on('moved', () => {
    const [x, y] = win.getPosition();
    state.bounds = { x, y };
    saveState();
  });

  win.on('closed', () => {
    win = null;
  });
}

/* ------------------------------------------------------------------ *
 * 트레이 (메뉴 막대 / 알림 영역)
 * ------------------------------------------------------------------ */

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return; // 아이콘이 없으면 트레이 없이 동작

  image = image.resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('월야 뽀모도로');

  const menu = Menu.buildFromTemplate([
    {
      label: '보이기 / 숨기기',
      click: () => {
        if (!win) return;
        win.isVisible() ? win.hide() : win.show();
      },
    },
    {
      label: '항상 맨 앞에',
      type: 'checkbox',
      checked: state.alwaysOnTop,
      click: (item) => {
        state.alwaysOnTop = item.checked;
        saveState();
        applyAlwaysOnTop(item.checked);
        win?.webContents.send('always-on-top-changed', item.checked);
      },
    },
    {
      label: '우측 상단으로 되돌리기',
      click: () => {
        if (!win) return;
        const { x, y } = topRightPosition();
        win.setPosition(x, y);
        state.bounds = { x, y };
        saveState();
      },
    },
    { type: 'separator' },
    {
      label: '로그인 시 자동 시작',
      type: 'checkbox',
      checked: state.autoLaunch,
      visible: app.isPackaged, // 개발 중(npm start)에는 의미가 없어 숨긴다
      click: (item) => {
        state.autoLaunch = item.checked;
        saveState();
        applyAutoLaunch(item.checked);
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });
}

/* ------------------------------------------------------------------ *
 * 렌더러 ↔ 메인 통신
 * ------------------------------------------------------------------ */

ipcMain.handle('get-config', () => ({
  alwaysOnTop: state.alwaysOnTop,
  durations: state.durations,
  roundsBeforeLong: state.roundsBeforeLong,
}));

ipcMain.handle('set-always-on-top', (_e, flag) => {
  state.alwaysOnTop = !!flag;
  saveState();
  applyAlwaysOnTop(state.alwaysOnTop);
  return state.alwaysOnTop;
});

ipcMain.handle('save-durations', (_e, durations) => {
  state.durations = { ...state.durations, ...durations };
  saveState();
  return state.durations;
});

ipcMain.on('hide-window', () => win?.hide());
ipcMain.on('quit-app', () => app.quit());

ipcMain.on('notify', (_e, { title, body }) => {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true }).show();
});

// 세션이 바뀌는 순간에는 창이 가려져 있어도 눈에 띄어야 한다.
ipcMain.on('flash', () => {
  if (!win) return;
  if (!win.isVisible()) win.show();
  win.setAlwaysOnTop(true, 'screen-saver');
  if (!state.alwaysOnTop) {
    // 잠깐만 끌어올리고 원래 설정으로 되돌린다.
    setTimeout(() => applyAlwaysOnTop(false), 4000);
  }
});

/* ------------------------------------------------------------------ *
 * 앱 수명 주기
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    state = loadState();

    // 독에 아이콘을 띄우지 않는 위젯형 앱 — 트레이로 제어한다.
    if (process.platform === 'darwin') app.dock?.hide();

    createWindow();
    createTray();

    // 설치본이 실행될 때마다 OS의 실제 로그인 항목 상태를 저장값과 맞춘다.
    if (app.isPackaged) applyAutoLaunch(state.autoLaunch);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else win?.show();
    });
  });

  // 트레이에 남아 있어야 하므로 창을 닫아도 종료하지 않는다.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
