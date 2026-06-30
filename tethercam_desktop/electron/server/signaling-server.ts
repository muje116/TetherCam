import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { ConnectionManager } from './connection-manager.js';
import { getAddressCandidates as getNetworkCandidates, getPrimaryLocalAddress as resolvePrimaryAddress, getAllLocalAddresses as resolveAllAddresses } from './network-utils.js';

let _dirname = '';
try {
  _dirname = __dirname;
} catch (e) {
  _dirname = path.dirname(fileURLToPath(import.meta.url));
}

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
  /** Cache the latest SDP offer per deviceId so late-mounting renderers can replay it */
  private pendingOffers: Map<string, { sdp: string; clientIp: string }> = new Map();

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
    this.setupStaticRoutes();
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
   * Serve static built files from the /dist folder.
   */
  private setupStaticRoutes(): void {
    const distPath = path.join(_dirname, '../../dist');
    this.app.use(express.static(distPath));

    // SPA fallback — serve index.html for any non-API route
    this.app.use((req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
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

      // Start ping/pong keepalive
      const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        }
      }, 15000);
      ws.on('pong', () => {});
      ws.on('close', () => clearInterval(pingInterval));
      ws.on('error', () => clearInterval(pingInterval));
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
          connectionType: (message.connectionType as 'wifi' | 'usb' | 'hotspot' | 'bluetooth') ?? 'wifi',
          ws,
        });
        setDeviceId(device.id);
        // Send request-stream so the phone starts WebRTC immediately
        setTimeout(() => {
          this.connectionManager.sendCommand(device.id, 'request-stream', {});
          this.emit('log', `[SignalingServer] Sent request-stream to '${device.name}'`);
        }, 500);
        ws.send(JSON.stringify({
          type: 'registered',
          deviceId: device.id,
          message: 'Device registered successfully',
        }));
        this.emit('log', `[SignalingServer] Registered device '${device.name}' from ${clientIp}`);
        break;
      }

      case 'sdp-offer': {
        // WebRTC SDP Offer from mobile — cache it and forward to desktop renderer
        console.log(`[SignalingServer] Received SDP offer from ${clientIp}`);
        const resolvedDeviceId = (message.deviceId as string) ?? activeDeviceId ?? undefined;
        const offerSdp = message.sdp as string;
        if (resolvedDeviceId && offerSdp) {
          this.pendingOffers.set(resolvedDeviceId, { sdp: offerSdp, clientIp });
        }
        this.emit('sdp-offer', {
          deviceId: resolvedDeviceId,
          sdp: offerSdp,
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

  getLocalAddresses(): string[] {
    return resolveAllAddresses();
  }

  getPrimaryLocalAddress(): string {
    return resolvePrimaryAddress();
  }

  /** Returns and clears a cached SDP offer for a device (so late-mounting renderers can replay it) */
  getPendingOffer(deviceId: string): { sdp: string; clientIp: string } | null {
    const offer = this.pendingOffers.get(deviceId) ?? null;
    if (offer) this.pendingOffers.delete(deviceId);
    return offer;
  }

}

// Type for stream settings used in device-status messages
interface ConnectedDeviceStreamSettings {
  resolution: string;
  fps: number;
  bitrate: number;
  codec: string;
}
