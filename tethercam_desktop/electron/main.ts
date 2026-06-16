import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignalingServer } from './server/signaling-server.js';
import { ConnectionManager } from './server/connection-manager.js';
import { DiscoveryService } from './server/discovery-service.js';
import { MediaPipeline } from './server/media-pipeline.js';
import { UsbService } from './server/usb-service.js';
import { getConnectionUrl as resolveConnectionUrl, getAllLocalAddresses } from './server/network-utils.js';

let _dirname = '';
try {
  _dirname = __dirname;
} catch (e) {
  _dirname = path.dirname(fileURLToPath(import.meta.url));
}

let mainWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let signalingServer: SignalingServer | null = null;
let connectionManager: ConnectionManager | null = null;
let discoveryService: DiscoveryService | null = null;
let mediaPipeline: MediaPipeline | null = null;
let usbService: UsbService | null = null;
const diagnosticLogs: string[] = [];

const SIGNALING_PORT = 4747;

function pushDiagnosticLog(message: string) {
  const line = `${new Date().toISOString()} ${message}`;
  diagnosticLogs.push(line);
  if (diagnosticLogs.length > 200) {
    diagnosticLogs.shift();
  }
  mainWindow?.webContents.send('diagnostic-log', line);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'TetherCam',
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
    webPreferences: {
      preload: path.join(_dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the Vite dev server in development, or the built files in production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(_dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of closing
    if (tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Create a simple tray icon (16x16 transparent for now)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('TetherCam');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show TetherCam',
      click: () => mainWindow?.show(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

async function startServices() {
  connectionManager = new ConnectionManager();
  discoveryService = new DiscoveryService();
  mediaPipeline = new MediaPipeline();
  usbService = new UsbService();

  signalingServer = new SignalingServer(SIGNALING_PORT, connectionManager);
  await signalingServer.start();
  discoveryService.start();

  console.log(`[TetherCam] Signaling and Discovery services running`);
  pushDiagnosticLog('[TetherCam] Signaling and Discovery services running');

  // Forward connection events to the renderer
  connectionManager.on('device-connected', (device) => {
    mainWindow?.webContents.send('device-connected', device);
    pushDiagnosticLog(`[Connection] Device connected: ${device.name} (${device.ip})`);
  });

  discoveryService.on('device-discovered', (device) => {
    mainWindow?.webContents.send('device-discovered', device);
    pushDiagnosticLog(`[Discovery] Found ${device.name} at ${device.ip}:${device.port}`);
  });

  // Forward signaling messages
  signalingServer!.on('sdp-offer', (data) => {
    mainWindow?.webContents.send('sdp-offer', data);
    pushDiagnosticLog(`[Signaling] SDP offer from ${data.clientIp ?? 'unknown'}`);
  });

  signalingServer!.on('ice-candidate', (data) => {
    mainWindow?.webContents.send('ice-candidate', data);
    pushDiagnosticLog(`[Signaling] ICE candidate from ${data.clientIp ?? 'unknown'}`);
  });

  signalingServer!.on('log', (line) => {
    pushDiagnosticLog(String(line));
  });

  connectionManager.on('device-disconnected', (deviceId) => {
    mainWindow?.webContents.send('device-disconnected', deviceId);
    pushDiagnosticLog(`[Connection] Device disconnected: ${deviceId}`);
  });

  connectionManager.on('device-updated', (device) => {
    mainWindow?.webContents.send('device-updated', device);
  });

  connectionManager.on('stream-stats', (stats) => {
    mainWindow?.webContents.send('stream-stats', stats);
  });
}

// IPC Handlers
function setupIpcHandlers() {
  ipcMain.handle('get-devices', () => {
    return connectionManager?.getDevices() ?? [];
  });

  ipcMain.handle('get-server-info', () => {
    return {
      port: SIGNALING_PORT,
      addresses: signalingServer?.getLocalAddresses() ?? [],
    };
  });

  ipcMain.handle('send-command', (_event, deviceId: string, command: string, payload: unknown) => {
    return connectionManager?.sendCommand(deviceId, command, payload);
  });

  ipcMain.handle('disconnect-device', (_event, deviceId: string) => {
    return connectionManager?.disconnectDevice(deviceId);
  });

  ipcMain.handle('start-virtual-camera', async (_event, deviceId: string, offer: string) => {
    if (mediaPipeline) {
      const answer = await mediaPipeline.createPeerConnection(offer);
      pushDiagnosticLog(`[Virtual Camera] Started background WebRTC stream for ${deviceId}`);
      return answer;
    }
    throw new Error('Media pipeline not initialized');
  });

  ipcMain.handle('capture-snapshot', async (_event, deviceId: string) => {
    pushDiagnosticLog(`[Snapshot] Capture requested for ${deviceId}`);
    mainWindow?.webContents.send('capture-snapshot-request', deviceId);
    return true;
  });

  ipcMain.handle('save-snapshot', async (_event, dataUrl: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `TetherCam_snapshot_${timestamp}.png`;
    const { app } = await import('electron');
    const picturesPath = app.getPath('pictures');
    const filePath = path.join(picturesPath, filename);
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const fs = await import('node:fs');
    fs.writeFileSync(filePath, base64Data, 'base64');
    pushDiagnosticLog(`[Snapshot] Saved to ${filePath}`);
    return filePath;
  });

  ipcMain.handle('stop-virtual-camera', async () => {
    if (mediaPipeline) {
      mediaPipeline.stop();
      pushDiagnosticLog('[Virtual Camera] Stopped stream and background pipeline');
      return true;
    }
    return false;
  });


  ipcMain.handle('get-usb-devices', async () => {
    return await usbService?.getConnectedDevices() ?? [];
  });

  ipcMain.handle('enable-usb-forwarding', async (_event, deviceId: string) => {
    const ok = await usbService?.enableForwarding(deviceId, 4747, 4747) ?? false;
    pushDiagnosticLog(`[USB] Forwarding for ${deviceId}: ${ok ? 'ok' : 'failed'}`);
    return ok;
  });

  ipcMain.handle('get-connection-url', () => {
    return resolveConnectionUrl();
  });

  ipcMain.handle('get-all-addresses', () => {
    return getAllLocalAddresses();
  });

  ipcMain.handle('get-diagnostic-logs', () => {
    return diagnosticLogs;
  });

  // Projector Window Management IPCs
  ipcMain.handle('open-projector', (_event, deviceId: string) => {
    if (projectorWindow) {
      projectorWindow.focus();
      return;
    }

    projectorWindow = new BrowserWindow({
      width: 640,
      height: 360,
      minWidth: 320,
      minHeight: 180,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      backgroundColor: '#0a0a0f',
      webPreferences: {
        preload: path.join(_dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      projectorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?projector=true&deviceId=${deviceId}`);
    } else {
      const fileUrl = new URL(`file://${path.join(_dirname, '../dist/index.html')}`);
      fileUrl.searchParams.set('projector', 'true');
      fileUrl.searchParams.set('deviceId', deviceId);
      projectorWindow.loadURL(fileUrl.toString());
    }

    projectorWindow.on('closed', () => {
      projectorWindow = null;
    });
  });

  ipcMain.handle('close-projector', () => {
    if (projectorWindow) {
      projectorWindow.close();
      projectorWindow = null;
    }
  });

  ipcMain.handle('toggle-projector-always-on-top', () => {
    if (projectorWindow) {
      const state = !projectorWindow.isAlwaysOnTop();
      projectorWindow.setAlwaysOnTop(state, 'screen-saver');
      return state;
    }
    return false;
  });

  ipcMain.handle('resize-projector', (_event, width: number, height: number) => {
    if (projectorWindow) {
      projectorWindow.setSize(width, height, true);
    }
  });

  ipcMain.handle('snap-projector', (_event, position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    if (!projectorWindow) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    const winBounds = projectorWindow.getBounds();

    let newX = x;
    let newY = y;

    if (position === 'top-left') {
      newX = x;
      newY = y;
    } else if (position === 'top-right') {
      newX = x + width - winBounds.width;
      newY = y;
    } else if (position === 'bottom-left') {
      newX = x;
      newY = y + height - winBounds.height;
    } else if (position === 'bottom-right') {
      newX = x + width - winBounds.width;
      newY = y + height - winBounds.height;
    }

    projectorWindow.setBounds({ x: newX, y: newY, width: winBounds.width, height: winBounds.height }, true);
  });
}

app.whenReady().then(async () => {
  setupIpcHandlers();
  createWindow();
  createTray();
  await startServices();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  signalingServer?.stop();
  tray?.destroy();
  tray = null;
});
