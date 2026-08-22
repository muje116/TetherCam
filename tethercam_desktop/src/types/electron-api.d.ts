export {};

declare global {
  interface DeviceInfo {
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

  interface ServerInfo {
    port: number;
    addresses: string[];
  }

  interface UsbDevice {
    id: string;
    model?: string;
    manufacturer?: string;
    status?: string;
  }

  interface StreamStats {
    fps?: number;
    jitterMs?: number;
    bitrate?: number;
    packetLoss?: number;
  }

  interface SdpOfferEvent {
    deviceId?: string;
    clientIp?: string;
    sdp: string;
  }

  interface IceCandidateEvent {
    deviceId?: string;
    clientIp?: string;
    candidate: RTCIceCandidateInit;
  }

  interface DiscoveredPhone {
    name: string;
    ip: string;
    port: number;
    lastSeen: number;
    role: 'mobile' | 'desktop' | 'unknown';
    invitePort: number;
    bluetoothAddress?: string;
  }

  interface ElectronAPI {
    getDevices: () => Promise<DeviceInfo[]>;
    getServerInfo: () => Promise<ServerInfo>;
    getConnectionUrl: () => Promise<string>;
    getAllAddresses: () => Promise<string[]>;
    disconnectDevice: (deviceId: string) => Promise<void>;
    getUsbDevices: () => Promise<UsbDevice[]>;
    enableUsbForwarding: (deviceId: string) => Promise<boolean>;
    launchPhoneApp: (deviceId: string) => Promise<boolean>;
    getDiagnosticLogs: () => Promise<string[]>;
    sendCommand: (deviceId: string, command: string, payload?: unknown) => Promise<boolean>;
    startVirtualCamera: (deviceId: string, offer: string) => Promise<string>;
    stopVirtualCamera: () => Promise<boolean>;
    captureSnapshot: (deviceId: string) => Promise<boolean>;
    saveSnapshot: (dataUrl: string) => Promise<string>;
    getPendingOffer: (deviceId: string) => Promise<{ sdp: string; clientIp: string } | null>;
    clearPendingOffer: (deviceId: string) => Promise<void>;
    getDiscoveredDevices: () => Promise<DiscoveredPhone[]>;
    scanForDevices: () => Promise<DiscoveredPhone[]>;
    invitePhone: (phoneIp: string) => Promise<{ ok: boolean; error?: string }>;
    probePhone: (phoneIp: string) => Promise<boolean>;
    openProjector: (deviceId: string) => Promise<void>;
    closeProjector: () => Promise<void>;
    toggleProjectorAlwaysOnTop: () => Promise<boolean>;
    resizeProjector: (width: number, height: number) => Promise<void>;
    snapProjector: (position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => Promise<void>;
    onDeviceConnected: (callback: (device: DeviceInfo) => void) => () => void;
    onDeviceDiscovered: (callback: (device: DiscoveredPhone) => void) => () => void;
    onDeviceDisconnected: (callback: (deviceId: string) => void) => () => void;
    onDeviceUpdated: (callback: (device: DeviceInfo) => void) => () => void;
    onStreamStats: (callback: (stats: StreamStats) => void) => () => void;
    onSdpOffer: (callback: (data: SdpOfferEvent) => void) => () => void;
    onIceCandidate: (callback: (data: IceCandidateEvent) => void) => () => void;
    onDiagnosticLog: (callback: (line: string) => void) => () => void;
    onCaptureSnapshotRequest: (callback: (deviceId: string) => void) => () => void;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}
