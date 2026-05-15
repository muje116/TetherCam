import { contextBridge, ipcRenderer } from 'electron';

export interface DeviceInfo {
  id: string;
  name: string;
  model: string;
  platform: 'android' | 'ios';
  ip: string;
  connectionType: 'wifi' | 'usb' | 'hotspot';
  status: 'connected' | 'connecting' | 'disconnected' | 'buffering';
  streamSettings: {
    resolution: string;
    fps: number;
    bitrate: number;
    codec: string;
  };
  battery: number;
  temperature: number;
}

export interface StreamStats {
  deviceId: string;
  latencyMs: number;
  fps: number;
  bitrate: number;
  packetLoss: number;
  resolution: string;
}

export interface ServerInfo {
  port: number;
  addresses: string[];
}

const electronAPI = {
  // Device management
  getDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('get-devices'),
  getServerInfo: (): Promise<ServerInfo> => ipcRenderer.invoke('get-server-info'),
  getConnectionUrl: (): Promise<string> => ipcRenderer.invoke('get-connection-url'),
  disconnectDevice: (deviceId: string): Promise<void> => ipcRenderer.invoke('disconnect-device', deviceId),
  getUsbDevices: (): Promise<any[]> => ipcRenderer.invoke('get-usb-devices'),
  enableUsbForwarding: (deviceId: string): Promise<boolean> => ipcRenderer.invoke('enable-usb-forwarding', deviceId),

  // Remote control
  sendCommand: (deviceId: string, command: string, payload?: unknown): Promise<void> =>
    ipcRenderer.invoke('send-command', deviceId, command, payload),

  // Event listeners
  onDeviceConnected: (callback: (device: DeviceInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, device: DeviceInfo) => callback(device);
    ipcRenderer.on('device-connected', listener);
    return () => ipcRenderer.removeListener('device-connected', listener);
  },

  onDeviceDiscovered: (callback: (device: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, device: any) => callback(device);
    ipcRenderer.on('device-discovered', listener);
    return () => ipcRenderer.removeListener('device-discovered', listener);
  },

  onDeviceDisconnected: (callback: (deviceId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deviceId: string) => callback(deviceId);
    ipcRenderer.on('device-disconnected', listener);
    return () => ipcRenderer.removeListener('device-disconnected', listener);
  },

  onDeviceUpdated: (callback: (device: DeviceInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, device: DeviceInfo) => callback(device);
    ipcRenderer.on('device-updated', listener);
    return () => ipcRenderer.removeListener('device-updated', listener);
  },

  onStreamStats: (callback: (stats: StreamStats) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, stats: StreamStats) => callback(stats);
    ipcRenderer.on('stream-stats', listener);
    return () => ipcRenderer.removeListener('stream-stats', listener);
  },

  onSdpOffer: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('sdp-offer', listener);
    return () => ipcRenderer.removeListener('sdp-offer', listener);
  },

  onIceCandidate: (callback: (data: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('ice-candidate', listener);
    return () => ipcRenderer.removeListener('ice-candidate', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
