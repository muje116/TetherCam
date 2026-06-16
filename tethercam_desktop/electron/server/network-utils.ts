import os from 'node:os';

export interface NetworkCandidate {
  interfaceName: string;
  address: string;
}

export function getAddressCandidates(): NetworkCandidate[] {
  const interfaces = os.networkInterfaces();
  const addresses: NetworkCandidate[] = [];

  for (const name in interfaces) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const entry of iface) {
      if (entry.family === 'IPv4') {
        addresses.push({ interfaceName: name, address: entry.address });
      }
    }
  }

  return addresses;
}

export function getPrimaryLocalAddress(): string {
  const candidates = getAddressCandidates();
  if (candidates.length === 0) {
    return '127.0.0.1';
  }

  const scoreCandidate = (candidate: NetworkCandidate): number => {
    const iface = candidate.interfaceName.toLowerCase();
    const ip = candidate.address;
    let score = 0;

    if (iface.includes('wi-fi') || iface.includes('wifi') || iface.includes('wlan') || iface.includes('wireless')) score += 80;
    if (/^en\d/.test(iface) || iface.includes('ethernet')) score += 40;

    if (
      iface.includes('openvpn') ||
      iface.includes('tailscale') ||
      iface.includes('hyper-v') ||
      iface.includes('vethernet') ||
      iface.includes('virtual') ||
      iface.includes('vmware') ||
      iface.includes('docker') ||
      iface.includes('loopback') ||
      iface.includes('bluetooth')
    ) {
      score -= 70;
    }

    if (ip === '127.0.0.1' || ip === '::1') score -= 100;
    if (/^192\.168\./.test(ip)) score += 30;
    if (/^10\./.test(ip)) score += 20;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 15;
    if (ip.startsWith('169.254.')) score -= 100;

    return score;
  };

  const sorted = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  return sorted[0].address;
}

export function getConnectionUrl(): string {
  return `ws://${getPrimaryLocalAddress()}:4747`;
}

export function getAllLocalAddresses(): string[] {
  return getAddressCandidates().map((c) => c.address).filter((a) => a !== '127.0.0.1' && a !== '::1');
}
