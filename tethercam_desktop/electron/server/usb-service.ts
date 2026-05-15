import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

const execAsync = promisify(exec);

export interface AdbDevice {
  id: string;
  model: string;
  status: string;
}

export class UsbService extends EventEmitter {
  constructor() {
    super();
  }

  async getConnectedDevices(): Promise<AdbDevice[]> {
    try {
      const { stdout } = await execAsync('adb devices -l');
      const lines = stdout.trim().split('\n');
      const devices: AdbDevice[] = [];

      // Skip the first line "List of devices attached"
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        const id = parts[0];
        const status = parts[1];
        
        // Extract model name from the long output
        const modelMatch = line.match(/model:(\S+)/);
        const model = modelMatch ? modelMatch[1] : 'Unknown';

        devices.push({ id, model, status });
      }

      return devices;
    } catch (err) {
      console.error('[UsbService] Error listing devices:', err);
      return [];
    }
  }

  async enableForwarding(deviceId: string, localPort: number, remotePort: number): Promise<boolean> {
    try {
      await execAsync(`adb -s ${deviceId} forward tcp:${localPort} tcp:${remotePort}`);
      console.log(`[UsbService] Port forwarding enabled: ${localPort} -> ${remotePort} for device ${deviceId}`);
      return true;
    } catch (err) {
      console.error('[UsbService] Error setting up port forwarding:', err);
      return false;
    }
  }

  async disableForwarding(localPort: number): Promise<void> {
    try {
      await execAsync(`adb forward --remove tcp:${localPort}`);
    } catch (err) {
      console.error('[UsbService] Error removing port forwarding:', err);
    }
  }
}
