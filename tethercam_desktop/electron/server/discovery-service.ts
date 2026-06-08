import mDNS from 'multicast-dns';
import { EventEmitter } from 'node:events';
import os from 'node:os';

export interface DiscoveredDevice {
  name: string;
  ip: string;
  port: number;
  lastSeen: number;
}

const SIGNALING_PORT = 4747;
const QUERY_INTERVAL_MS = 10_000;
/** Unsolicited announcements help Windows clients/phones that miss passive query replies. */
const ANNOUNCE_INTERVAL_MS = 3_000;

export class DiscoveryService extends EventEmitter {
  private mdns: ReturnType<typeof mDNS>;
  private serviceName = '_TetherCam._tcp.local';
  private discoveredDevices: Map<string, DiscoveredDevice> = new Map();
  private queryInterval: ReturnType<typeof setInterval> | null = null;
  private announceInterval: ReturnType<typeof setInterval> | null = null;
  private hostname = os.hostname();

  constructor() {
    super();
    this.mdns = mDNS();
  }

  start() {
    console.log('[DiscoveryService] Starting mDNS discovery and advertisement');

    this.advertise();

    this.mdns.on('response', (response: mDNS.ResponsePacket) => {
      this.handleResponse(response);
    });

    this.queryInterval = setInterval(() => this.query(), QUERY_INTERVAL_MS);
    this.announceInterval = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);

    this.query();
    this.announce();
  }

  /**
   * Respond to browse queries and periodically broadcast our service (Windows-friendly).
   */
  private advertise() {
    this.mdns.on('query', (query: mDNS.QueryPacket) => {
      const questions = query.questions ?? [];
      const wantsService = questions.some(
        (q) => q.name === this.serviceName || q.name === '_services._dns-sd._udp.local',
      );
      if (wantsService) {
        this.announce();
      }
    });
  }

  private buildAdvertisementRecords(primaryAddress: string) {
    const instanceName = `${this.hostname}.${this.serviceName}`;
    const hostTarget = `${this.hostname}.local`;

    return [
      {
        name: this.serviceName,
        type: 'PTR',
        ttl: 120,
        data: instanceName,
      },
      {
        name: instanceName,
        type: 'SRV',
        ttl: 120,
        data: { port: SIGNALING_PORT, target: hostTarget, priority: 0, weight: 0 },
      },
      {
        name: hostTarget,
        type: 'A',
        ttl: 120,
        data: primaryAddress,
      },
      {
        name: hostTarget,
        type: 'TXT',
        ttl: 120,
        data: Buffer.from(`app=TetherCam&port=${SIGNALING_PORT}`),
      },
    ];
  }

  /**
   * Proactive unsolicited mDNS announcement (not only on query).
   */
  private announce() {
    const primaryAddress = this.getPrimaryLocalAddress();
    const answers = this.buildAdvertisementRecords(primaryAddress);

    this.mdns.respond({ answers }, (err: Error | null) => {
      if (err) {
        console.warn('[DiscoveryService] Announce failed:', err.message);
      }
    });
  }

  private query() {
    this.mdns.query({
      questions: [{ name: this.serviceName, type: 'PTR' }],
    });
  }

  private handleResponse(response: mDNS.ResponsePacket) {
    const answers = [...(response.answers ?? []), ...(response.additionals ?? [])];
    const ptr = answers.find((a) => a.type === 'PTR' && a.name === this.serviceName);
    if (!ptr || typeof ptr.data !== 'string') return;

    const srv = answers.find((a) => a.type === 'SRV' && a.name === ptr.data);
    const srvTarget = srv && typeof srv.data === 'object' && srv.data !== null && 'target' in srv.data
      ? String((srv.data as { target: string }).target)
      : '';
    const aRecord = answers.find((a) => a.type === 'A' && a.name === srvTarget);

    if (srv && aRecord && typeof aRecord.data === 'string') {
      const port =
        typeof srv.data === 'object' && srv.data !== null && 'port' in srv.data
          ? Number((srv.data as { port: number }).port)
          : SIGNALING_PORT;

      const device: DiscoveredDevice = {
        name: ptr.data.split('.')[0],
        ip: aRecord.data,
        port,
        lastSeen: Date.now(),
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
    const now = Date.now();
    for (const [id, device] of this.discoveredDevices.entries()) {
      if (now - device.lastSeen > 30000) {
        this.discoveredDevices.delete(id);
      }
    }
    return Array.from(this.discoveredDevices.values());
  }

  stop() {
    if (this.queryInterval) {
      clearInterval(this.queryInterval);
      this.queryInterval = null;
    }
    if (this.announceInterval) {
      clearInterval(this.announceInterval);
      this.announceInterval = null;
    }
    this.mdns.destroy();
  }
}
