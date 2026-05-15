export {};

declare global {
  interface DeviceInfo {
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

  interface ServerInfo {
    port: number;
    addresses: string[];
  }

  interface UsbDevice {
    id: string;
    model?: string;
    manufacturer?: string;
  }

  interface ElectronAPI {
    getDevices: () => Promise<DeviceInfo[]>;
    getServerInfo: () => Promise<ServerInfo>;
    getConnectionUrl: () => Promise<string>;
    disconnectDevice: (deviceId: string) => Promise<void>;
    getUsbDevices: () => Promise<UsbDevice[]>;
    enableUsbForwarding: (deviceId: string) => Promise<boolean>;
    sendCommand: (deviceId: string, command: string, payload?: unknown) => Promise<void>;
    onDeviceConnected: (callback: (device: DeviceInfo) => void) => () => void;
    onDeviceDiscovered: (callback: (device: { name: string; ip: string; port: number }) => void) => () => void;
    onDeviceDisconnected: (callback: (deviceId: string) => void) => () => void;
    onDeviceUpdated: (callback: (device: DeviceInfo) => void) => () => void;
    onStreamStats: (callback: (stats: unknown) => void) => () => void;
    onSdpOffer: (callback: (data: { deviceId?: string; clientIp?: string; sdp: string }) => void) => () => void;
    onIceCandidate: (callback: (data: { deviceId?: string; clientIp?: string; candidate: RTCIceCandidateInit }) => void) => () => void;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}
