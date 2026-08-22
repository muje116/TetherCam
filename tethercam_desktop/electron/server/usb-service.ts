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
      // Forward: PC port -> Phone port
      await execAsync(`adb -s ${deviceId} forward tcp:${localPort} tcp:${remotePort}`);
      console.log(`[UsbService] ADB Forward enabled: tcp:${localPort} -> tcp:${remotePort}`);
      
      // Reverse: Phone port -> PC port (Required for phone WebSocket client to connect to localhost)
      try {
        await execAsync(`adb -s ${deviceId} reverse tcp:${localPort} tcp:${remotePort}`);
        console.log(`[UsbService] ADB Reverse enabled: tcp:${localPort} -> tcp:${remotePort}`);
      } catch (revErr) {
        console.warn(`[UsbService] Warning setting up ADB reverse (unsupported on very old Android versions):`, revErr);
      }
      
      return true;
    } catch (err) {
      console.error('[UsbService] Error setting up USB port forwarding:', err);
      return false;
    }
  }

  async launchApp(deviceId: string): Promise<boolean> {
    try {
      await execAsync(`adb -s ${deviceId} shell monkey -p com.tethercam.mobile -c android.intent.category.LAUNCHER 1`);
      console.log(`[UsbService] Launched TetherCam on ${deviceId}`);
      return true;
    } catch {
      try {
        await execAsync(`adb -s ${deviceId} shell am start -n com.tethercam.mobile/.MainActivity`);
        console.log(`[UsbService] Launched TetherCam on ${deviceId} (alt)`);
        return true;
      } catch (err2) {
        console.error(`[UsbService] Failed to launch app on ${deviceId}:`, err2);
        return false;
      }
    }
  }

  async disableForwarding(localPort: number, deviceId?: string): Promise<void> {
    try {
      const devArg = deviceId ? `-s ${deviceId} ` : '';
      await execAsync(`adb ${devArg} forward --remove tcp:${localPort}`);
      console.log(`[UsbService] Removed ADB Forward for tcp:${localPort}`);
    } catch (err) {
      console.error('[UsbService] Error removing ADB Forward:', err);
    }
    
    try {
      const devArg = deviceId ? `-s ${deviceId} ` : '';
      await execAsync(`adb ${devArg} reverse --remove tcp:${localPort}`);
      console.log(`[UsbService] Removed ADB Reverse for tcp:${localPort}`);
    } catch (err) {
      console.error('[UsbService] Error removing ADB Reverse:', err);
    }
  }
}
