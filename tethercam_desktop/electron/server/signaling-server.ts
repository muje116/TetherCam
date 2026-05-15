import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { ConnectionManager } from './connection-manager.js';

interface SignalingMessage {
  type: string;
  [key: string]: unknown;
}

export class SignalingServer extends EventEmitter {
  private app: express.Application;
  private server: http.Server;
  private wss: WebSocketServer;
  private port: number;
  private connectionManager: ConnectionManager;

  constructor(port: number, connectionManager: ConnectionManager) {
    super();
    this.port = port;
    this.connectionManager = connectionManager;

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupHttpRoutes();
    this.setupWebSocket();
  }

  /**
   * REST API endpoints for device synchronization.
   */
  private setupHttpRoutes(): void {
    // Health check / discovery endpoint
    this.app.get('/api/info', (_req, res) => {
      res.json({
        app: 'TetherCam',
        version: '1.0.0',
        platform: process.platform,
        hostname: os.hostname(),
        port: this.port,
      });
    });

    // List connected devices
    this.app.get('/api/devices', (_req, res) => {
      res.json(this.connectionManager.getDevices());
    });

    // Send a command to a specific device
    this.app.post('/api/devices/:deviceId/command', (req, res) => {
      const { deviceId } = req.params;
      const { command, payload } = req.body;
      const success = this.connectionManager.sendCommand(deviceId, command, payload);
      if (success) {
        res.json({ status: 'ok' });
      } else {
        res.status(404).json({ error: 'Device not found or not connected' });
      }
    });

    // Disconnect a device
    this.app.delete('/api/devices/:deviceId', (req, res) => {
      const { deviceId } = req.params;
      this.connectionManager.disconnectDevice(deviceId);
      res.json({ status: 'ok' });
    });

    // Get connection URL and QR data
    this.app.get('/api/connection-info', (_req, res) => {
      const addresses = this.getLocalAddresses();
      const primaryAddress = this.getPrimaryLocalAddress();
      res.json({
        addresses,
        port: this.port,
        url: `ws://${primaryAddress}:${this.port}`,
      });
    });
  }

  /**
   * WebSocket handler for real-time signaling and control.
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') ?? 'unknown';
      console.log(`[SignalingServer] WebSocket connection from ${clientIp}`);
      this.emit('log', `[SignalingServer] WebSocket connection from ${clientIp}`);

      let deviceId: string | null = null;

      ws.on('message', (data) => {
        try {
          const message: SignalingMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message, clientIp, deviceId, (id) => {
            deviceId = id;
          });
        } catch (err) {
          console.error('[SignalingServer] Invalid message:', err);
          this.emit('log', `[SignalingServer] Invalid message from ${clientIp}: ${String(err)}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        if (deviceId) {
          this.connectionManager.removeDevice(deviceId);
        }
        console.log(`[SignalingServer] WebSocket disconnected: ${clientIp}`);
        this.emit('log', `[SignalingServer] WebSocket disconnected: ${clientIp}`);
      });

      ws.on('error', (err) => {
        console.error(`[SignalingServer] WebSocket error from ${clientIp}:`, err.message);
        this.emit('log', `[SignalingServer] WebSocket error from ${clientIp}: ${err.message}`);
      });

      // Send server info on connect
      ws.send(JSON.stringify({
        type: 'server-info',
        hostname: os.hostname(),
        platform: process.platform,
        version: '1.0.0',
      }));
    });
  }

  /**
   * Route incoming WebSocket messages by type.
   */
  private handleMessage(
    ws: WebSocket,
    message: SignalingMessage,
    clientIp: string,
    activeDeviceId: string | null,
    setDeviceId: (id: string) => void
  ): void {
    switch (message.type) {
      case 'register': {
        // Mobile app registers itself
        const device = this.connectionManager.addDevice({
          name: (message.name as string) ?? 'Unknown Device',
          model: (message.model as string) ?? 'Unknown',
          platform: (message.platform as 'android' | 'ios') ?? 'android',
          ip: clientIp,
          connectionType: (message.connectionType as 'wifi' | 'usb' | 'hotspot') ?? 'wifi',
          ws,
        });
        setDeviceId(device.id);
        ws.send(JSON.stringify({
          type: 'registered',
          deviceId: device.id,
          message: 'Device registered successfully',
        }));
        this.emit('log', `[SignalingServer] Registered device '${device.name}' from ${clientIp}`);
        break;
      }

      case 'sdp-offer': {
        // WebRTC SDP Offer from mobile — forward to desktop renderer for processing
        console.log(`[SignalingServer] Received SDP offer from ${clientIp}`);
        const resolvedDeviceId = (message.deviceId as string) ?? activeDeviceId ?? undefined;
        this.emit('sdp-offer', {
          deviceId: resolvedDeviceId,
          sdp: message.sdp,
          clientIp,
        });
        break;
      }

      case 'ice-candidate': {
        // ICE candidate from mobile
        console.log(`[SignalingServer] Received ICE candidate from ${clientIp}`);
        const resolvedDeviceId = (message.deviceId as string) ?? activeDeviceId ?? undefined;
        this.emit('ice-candidate', {
          deviceId: resolvedDeviceId,
          candidate: message.candidate,
          clientIp,
        });
        break;
      }

      case 'device-status': {
        // Battery, temperature, stream settings updates
        const deviceId = message.deviceId as string;
        if (deviceId) {
          this.connectionManager.updateDevice(deviceId, {
            battery: message.battery as number,
            temperature: message.temperature as number,
            streamSettings: message.streamSettings as ConnectedDeviceStreamSettings,
          });
        }
        break;
      }

      case 'stream-stats': {
        // Live streaming statistics
        this.connectionManager.emit('stream-stats', {
          deviceId: message.deviceId,
          latencyMs: message.latencyMs,
          fps: message.fps,
          bitrate: message.bitrate,
          packetLoss: message.packetLoss,
          resolution: message.resolution,
        });
        break;
      }

      default:
        console.log(`[SignalingServer] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Start listening on the configured port.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(`[SignalingServer] HTTP + WebSocket server listening on 0.0.0.0:${this.port}`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  /**
   * Stop the server.
   */
  stop(): void {
    this.wss.clients.forEach((client) => client.close());
    this.server.close();
    console.log('[SignalingServer] Server stopped');
  }

  /**
   * Get all non-internal IPv4 addresses on this machine.
   */
  getLocalAddresses(): string[] {
    return this.getAddressCandidates().map((entry) => entry.address);
  }

  private getAddressCandidates(): Array<{ interfaceName: string; address: string }> {
    const interfaces = os.networkInterfaces();
    const addresses: Array<{ interfaceName: string; address: string }> = [];

    for (const name in interfaces) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const entry of iface) {
        if (entry.family === 'IPv4' && !entry.internal) {
          addresses.push({ interfaceName: name, address: entry.address });
        }
      }
    }

    return addresses;
  }

  /**
   * Pick the best address for phone-to-PC LAN connections.
   * Prioritize private LAN ranges and avoid link-local addresses when possible.
   */
  getPrimaryLocalAddress(): string {
    const candidates = this.getAddressCandidates();
    if (candidates.length === 0) {
      return '127.0.0.1';
    }

    const scoreCandidate = (candidate: { interfaceName: string; address: string }): number => {
      const iface = candidate.interfaceName.toLowerCase();
      const ip = candidate.address;
      let score = 0;

      // Strongly prefer real Wi-Fi/Ethernet interfaces.
      if (iface.includes('wi-fi') || iface.includes('wifi') || iface.includes('wlan')) score += 80;
      if (iface.includes('ethernet') || iface.includes('en')) score += 40;

      // De-prioritize likely virtual/VPN adapters.
      if (
        iface.includes('local area connection') ||
        iface.includes('openvpn') ||
        iface.includes('tailscale') ||
        iface.includes('hyper-v') ||
        iface.includes('vethernet') ||
        iface.includes('virtual') ||
        iface.includes('vmware') ||
        iface.includes('docker') ||
        iface.includes('loopback')
      ) {
        score -= 70;
      }

      // Prefer private LAN ranges.
      if (/^192\.168\./.test(ip)) score += 30;
      if (/^10\./.test(ip)) score += 20;
      if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 15;

      // Avoid link-local addresses.
      if (ip.startsWith('169.254.')) score -= 100;

      return score;
    };

    const sorted = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    return sorted[0].address;
  }

}

// Type for stream settings used in device-status messages
interface ConnectedDeviceStreamSettings {
  resolution: string;
  fps: number;
  bitrate: number;
  codec: string;
}
