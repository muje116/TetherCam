import mDNS from 'multicast-dns';
import { EventEmitter } from 'node:events';
import os from 'node:os';

export interface DiscoveredDevice {
  name: string;
  ip: string;
  port: number;
  lastSeen: number;
}

export class DiscoveryService extends EventEmitter {
  private mdns: any;
  private serviceName = '_TetherCam._tcp.local';
  private discoveredDevices: Map<string, DiscoveredDevice> = new Map();

  constructor() {
    super();
    this.mdns = mDNS();
  }

  start() {
    console.log('[DiscoveryService] Starting mDNS discovery and advertisement');

    // Advertise this desktop instance
    this.advertise();

    // Listen for other TetherCam services (mobile apps)
    this.mdns.on('response', (response: any) => {
      this.handleResponse(response);
    });

    // Periodically query for services
    setInterval(() => {
      this.query();
    }, 10000);

    this.query();
  }

  private advertise() {
    const hostname = os.hostname();

    this.mdns.on('query', (query: any) => {
      const isSearchingForUs = query.questions.some((q: any) => q.name === this.serviceName);
      if (isSearchingForUs) {
        const primaryAddress = this.getPrimaryLocalAddress();
        this.mdns.respond({
          answers: [
            {
              name: this.serviceName,
              type: 'PTR',
              data: `${hostname}.${this.serviceName}`
            },
            {
              name: `${hostname}.${this.serviceName}`,
              type: 'SRV',
              data: { port: 4747, target: `${hostname}.local` }
            },
            {
              name: `${hostname}.local`,
              type: 'A',
              data: primaryAddress
            }
          ]
        });
      }
    });
  }

  private query() {
    this.mdns.query({
      questions: [
        {
          name: this.serviceName,
          type: 'PTR'
        }
      ]
    });
  }

  private handleResponse(response: any) {
    const ptr = response.answers.find((a: any) => a.type === 'PTR' && a.name === this.serviceName);
    if (!ptr) return;

    const srv = response.answers.find((a: any) => a.type === 'SRV' && a.name === ptr.data);
    const aRecord = response.answers.find((a: any) => a.type === 'A' && a.name === (srv ? srv.data.target : ''));

    if (srv && aRecord) {
      const device: DiscoveredDevice = {
        name: ptr.data.split('.')[0],
        ip: aRecord.data,
        port: srv.data.port,
        lastSeen: Date.now()
      };

      const id = `${device.ip}:${device.port}`;
      if (!this.discoveredDevices.has(id)) {
        this.discoveredDevices.set(id, device);
        this.emit('device-discovered', device);
      } else {
        this.discoveredDevices.set(id, device);
      }
    }
  }

  private getLocalAddresses(): string[] {
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

  private getPrimaryLocalAddress(): string {
    const candidates = this.getAddressCandidates();
    if (candidates.length === 0) {
      return '127.0.0.1';
    }

    const scoreCandidate = (candidate: { interfaceName: string; address: string }): number => {
      const iface = candidate.interfaceName.toLowerCase();
      const ip = candidate.address;
      let score = 0;

      if (iface.includes('wi-fi') || iface.includes('wifi') || iface.includes('wlan')) score += 80;
      if (iface.includes('ethernet') || iface.includes('en')) score += 40;

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

      if (/^192\.168\./.test(ip)) score += 30;
      if (/^10\./.test(ip)) score += 20;
      if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 15;
      if (ip.startsWith('169.254.')) score -= 100;

      return score;
    };

    const sorted = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    return sorted[0].address;
  }

  getDiscoveredDevices(): DiscoveredDevice[] {
    // Filter out stale devices (not seen for 30s)
    const now = Date.now();
    for (const [id, device] of this.discoveredDevices.entries()) {
      if (now - device.lastSeen > 30000) {
        this.discoveredDevices.delete(id);
      }
    }
    return Array.from(this.discoveredDevices.values());
  }

  stop() {
    this.mdns.destroy();
  }
}
