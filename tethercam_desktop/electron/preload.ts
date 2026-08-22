import { contextBridge, ipcRenderer } from 'electron';

export interface DeviceInfo {
  id: string;
  name: string;
  model: string;
  platform: 'android' | 'ios';
  ip: string;
  connectionType: 'wifi' | 'usb' | 'hotspot' | 'bluetooth';
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
  deviceId?: string;
  fps?: number;
  latencyMs?: number;
  resolution?: string;
  jitterMs?: number;
  bitrate?: number;
  packetLoss?: number;
}

export interface SdpOfferEvent {
  deviceId?: string;
  clientIp?: string;
  sdp: string;
}

export interface IceCandidateEvent {
  deviceId?: string;
  clientIp?: string;
  candidate: RTCIceCandidateInit;
}

export interface UsbDevice {
  id: string;
  model?: string;
  manufacturer?: string;
  status?: string;
}

export interface ServerInfo {
  port: number;
  addresses: string[];
}

export interface DiscoveredPhone {
  name: string;
  ip: string;
  port: number;
  lastSeen: number;
  role: 'mobile' | 'desktop' | 'unknown';
  invitePort: number;
  bluetoothAddress?: string;
}

const electronAPI = {
  // Device management
  getDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('get-devices'),
  getServerInfo: (): Promise<ServerInfo> => ipcRenderer.invoke('get-server-info'),
  getConnectionUrl: (): Promise<string> => ipcRenderer.invoke('get-connection-url'),
  getAllAddresses: (): Promise<string[]> => ipcRenderer.invoke('get-all-addresses'),
  disconnectDevice: (deviceId: string): Promise<void> => ipcRenderer.invoke('disconnect-device', deviceId),
  getUsbDevices: (): Promise<UsbDevice[]> => ipcRenderer.invoke('get-usb-devices'),
  enableUsbForwarding: (deviceId: string): Promise<boolean> => ipcRenderer.invoke('enable-usb-forwarding', deviceId),
  launchPhoneApp: (deviceId: string): Promise<boolean> => ipcRenderer.invoke('launch-phone-app', deviceId),
  getDiagnosticLogs: (): Promise<string[]> => ipcRenderer.invoke('get-diagnostic-logs'),
  startVirtualCamera: (deviceId: string, offer: string): Promise<string> =>
    ipcRenderer.invoke('start-virtual-camera', deviceId, offer),
  stopVirtualCamera: (): Promise<boolean> => ipcRenderer.invoke('stop-virtual-camera'),
  captureSnapshot: (deviceId: string): Promise<boolean> => ipcRenderer.invoke('capture-snapshot', deviceId),
  saveSnapshot: (dataUrl: string): Promise<string> => ipcRenderer.invoke('save-snapshot', dataUrl),
  getPendingOffer: (deviceId: string): Promise<{ sdp: string; clientIp: string } | null> =>
    ipcRenderer.invoke('get-pending-offer', deviceId),
  clearPendingOffer: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke('clear-pending-offer', deviceId),
  getDiscoveredDevices: (): Promise<DiscoveredPhone[]> => ipcRenderer.invoke('get-discovered-devices'),
  scanForDevices: (): Promise<DiscoveredPhone[]> => ipcRenderer.invoke('scan-for-devices'),
  invitePhone: (phoneIp: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('invite-phone', phoneIp),
  probePhone: (phoneIp: string): Promise<boolean> => ipcRenderer.invoke('probe-phone', phoneIp),

  // Projector management
  openProjector: (deviceId: string): Promise<void> => ipcRenderer.invoke('open-projector', deviceId),
  closeProjector: (): Promise<void> => ipcRenderer.invoke('close-projector'),
  toggleProjectorAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('toggle-projector-always-on-top'),
  resizeProjector: (width: number, height: number): Promise<void> => ipcRenderer.invoke('resize-projector', width, height),
  snapProjector: (position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): Promise<void> =>
    ipcRenderer.invoke('snap-projector', position),

  // Remote control
  sendCommand: (deviceId: string, command: string, payload?: unknown): Promise<boolean> =>
    ipcRenderer.invoke('send-command', deviceId, command, payload),

  // Event listeners
  onDeviceConnected: (callback: (device: DeviceInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, device: DeviceInfo) => callback(device);
    ipcRenderer.on('device-connected', listener);
    return () => ipcRenderer.removeListener('device-connected', listener);
  },

  onDeviceDiscovered: (callback: (device: DiscoveredPhone) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, device: DiscoveredPhone) => callback(device);
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

  onSdpOffer: (callback: (data: SdpOfferEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: SdpOfferEvent) => callback(data);
    ipcRenderer.on('sdp-offer', listener);
    return () => ipcRenderer.removeListener('sdp-offer', listener);
  },

  onIceCandidate: (callback: (data: IceCandidateEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: IceCandidateEvent) => callback(data);
    ipcRenderer.on('ice-candidate', listener);
    return () => ipcRenderer.removeListener('ice-candidate', listener);
  },

  onDiagnosticLog: (callback: (line: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, line: string) => callback(line);
    ipcRenderer.on('diagnostic-log', listener);
    return () => ipcRenderer.removeListener('diagnostic-log', listener);
  },

  onCaptureSnapshotRequest: (callback: (deviceId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deviceId: string) => callback(deviceId);
    ipcRenderer.on('capture-snapshot-request', listener);
    return () => ipcRenderer.removeListener('capture-snapshot-request', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
