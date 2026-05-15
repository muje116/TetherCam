import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignalingServer } from './server/signaling-server.js';
import { ConnectionManager } from './server/connection-manager.js';
import { DiscoveryService } from './server/discovery-service.js';
import { MediaPipeline } from './server/media-pipeline.js';
import { UsbService } from './server/usb-service.js';

let _dirname = '';
try {
  _dirname = __dirname;
} catch (e) {
  _dirname = path.dirname(fileURLToPath(import.meta.url));
}

let mainWindow: BrowserWindow | null = null;
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
      return answer;
    }
    throw new Error('Media pipeline not initialized');
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
    const primaryAddr = signalingServer?.getPrimaryLocalAddress() ?? '127.0.0.1';
    return `ws://${primaryAddr}:${SIGNALING_PORT}`;
  });

  ipcMain.handle('get-diagnostic-logs', () => {
    return diagnosticLogs;
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
