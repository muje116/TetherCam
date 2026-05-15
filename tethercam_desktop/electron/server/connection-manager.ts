import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';

export interface ConnectedDevice {
  id: string;
  name: string;
  model: string;
  platform: 'android' | 'ios';
  ip: string;
  connectionType: 'wifi' | 'usb' | 'hotspot';
  status: 'connected' | 'connecting' | 'disconnected' | 'buffering';
  connectedAt: Date;
  streamSettings: {
    resolution: string;
    fps: number;
    bitrate: number;
    codec: string;
  };
  battery: number;
  temperature: number;
  ws: import('ws').WebSocket | null;
}

export class ConnectionManager extends EventEmitter {
  private devices: Map<string, ConnectedDevice> = new Map();

  constructor() {
    super();
  }

  /**
   * Register a new device connection from a WebSocket handshake.
   */
  addDevice(info: {
    name: string;
    model: string;
    platform: 'android' | 'ios';
    ip: string;
    connectionType: 'wifi' | 'usb' | 'hotspot';
    ws: import('ws').WebSocket;
  }): ConnectedDevice {
    const id = uuidv4();
    const device: ConnectedDevice = {
      id,
      name: info.name,
      model: info.model,
      platform: info.platform,
      ip: info.ip,
      connectionType: info.connectionType,
      status: 'connected',
      connectedAt: new Date(),
      streamSettings: {
        resolution: '1080p',
        fps: 30,
        bitrate: 4000,
        codec: 'H.264',
      },
      battery: 100,
      temperature: 25,
      ws: info.ws,
    };

    this.devices.set(id, device);
    this.emit('device-connected', this.sanitizeDevice(device));

    console.log(`[ConnectionManager] Device connected: ${device.name} (${device.id})`);
    return device;
  }

  /**
   * Remove a device from the active connections.
   */
  removeDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = 'disconnected';
      if (device.ws && device.ws.readyState === 1) {
        device.ws.close();
      }
      this.devices.delete(deviceId);
      this.emit('device-disconnected', deviceId);
      console.log(`[ConnectionManager] Device disconnected: ${device.name} (${deviceId})`);
    }
  }

  /**
   * Update device metadata (battery, temp, stream settings, etc.)
   */
  updateDevice(deviceId: string, updates: Partial<ConnectedDevice>): void {
    const device = this.devices.get(deviceId);
    if (device) {
      Object.assign(device, updates);
      this.emit('device-updated', this.sanitizeDevice(device));
    }
  }

  /**
   * Send a control command to a specific device via WebSocket.
   */
  sendCommand(deviceId: string, command: string, payload?: unknown): boolean {
    const device = this.devices.get(deviceId);
    if (device?.ws && device.ws.readyState === 1) {
      device.ws.send(JSON.stringify({ type: 'command', command, payload }));
      console.log(`[ConnectionManager] Sent command '${command}' to ${device.name}`);
      return true;
    }
    return false;
  }

  /**
   * Disconnect a specific device.
   */
  disconnectDevice(deviceId: string): void {
    this.removeDevice(deviceId);
  }

  /**
   * Get list of all connected devices (sanitized for IPC).
   */
  getDevices(): ReturnType<typeof this.sanitizeDevice>[] {
    return Array.from(this.devices.values()).map((d) => this.sanitizeDevice(d));
  }

  /**
   * Find a device by ID.
   */
  getDevice(deviceId: string): ConnectedDevice | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * Strip non-serializable fields (ws) before sending over IPC.
   */
  private sanitizeDevice(device: ConnectedDevice) {
    const { ws, ...rest } = device;
    void ws; // suppress unused
    return rest;
  }
}
