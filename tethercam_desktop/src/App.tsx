import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import StreamReceiver from './components/StreamReceiver';
import './App.css';

interface Device {
  id: string;
  name: string;
  ip: string;
  status: 'discovered' | 'connected';
}

const App: React.FC = () => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [connectionUrl, setConnectionUrl] = useState<string>('');
  const [discoveredDevices, setDiscoveredDevices] = useState<Device[]>([]);
  const [connectedDevices, setConnectedDevices] = useState<any[]>([]);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [usbStatus, setUsbStatus] = useState<string>('USB not scanned');
  const [searchStatus, setSearchStatus] = useState<string>('');

  const scanUsbAndForward = async () => {
    const usbDevices = await window.electronAPI.getUsbDevices();
    if (usbDevices.length === 0) {
      setUsbStatus('No USB phone detected');
      return;
    }
    let forwarded = 0;
    for (const dev of usbDevices) {
      if (await window.electronAPI.enableUsbForwarding(dev.id)) {
        forwarded += 1;
      }
    }
    setUsbStatus(`USB forwarded: ${forwarded}/${usbDevices.length}`);
  };

  const searchDevices = async () => {
    setSearchStatus('Searching...');
    const activeDevices = await window.electronAPI.getDevices();
    setConnectedDevices(activeDevices);
    if (activeDevices.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(activeDevices[0].id);
    }
    await scanUsbAndForward();
    setSearchStatus(`Found ${activeDevices.length} connected device(s)`);
  };

  useEffect(() => {
    const init = async () => {
      const url = await window.electronAPI.getConnectionUrl();
      setConnectionUrl(url);
      const qrData = await QRCode.toDataURL(url);
      setQrCodeUrl(qrData);

      const info = await window.electronAPI.getServerInfo();
      setServerInfo(info);

      const activeDevices = await window.electronAPI.getDevices();
      setConnectedDevices(activeDevices);
      if (activeDevices.length > 0) setSelectedDeviceId(activeDevices[0].id);

      await scanUsbAndForward();
    };

    init();

    const removeDiscovered = window.electronAPI.onDeviceDiscovered((device: any) => {
      setDiscoveredDevices(prev => {
        if (prev.find(d => d.ip === device.ip)) return prev;
        return [...prev, { ...device, status: 'discovered', id: `${device.ip}:${device.port}` }];
      });
    });

    const removeConnected = window.electronAPI.onDeviceConnected((device: any) => {
      setConnectedDevices(prev => [...prev, device]);
      if (!selectedDeviceId) setSelectedDeviceId(device.id);
    });

    const removeDisconnected = window.electronAPI.onDeviceDisconnected((deviceId: string) => {
      setConnectedDevices(prev => prev.filter(d => d.id !== deviceId));
      if (selectedDeviceId === deviceId) setSelectedDeviceId(null);
    });

    return () => {
      removeDiscovered();
      removeConnected();
      removeDisconnected();
    };
  }, [selectedDeviceId]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="gradient-text">TetherCam</h1>
        <div className="status-badge">
          <div className="pulse"></div>
          Server: {connectionUrl ? connectionUrl.replace('ws://', '') : `${serverInfo?.addresses?.[0] ?? 'loading'}:${serverInfo?.port ?? 4747}`}
        </div>
      </header>

      <main className="dashboard">
        <aside className="sidebar">
          <section className="connect-section glass animate-fade">
            <h3>Connect</h3>
            <div className="qr-container">
              {qrCodeUrl && <img src={qrCodeUrl} alt="QR" />}
            </div>
            <p className="connect-url">Scan or use: {connectionUrl || 'loading...'}</p>
            
            <div className="discovery-list">
              <h4>Discovered</h4>
              <button className="btn-secondary-sm" onClick={searchDevices}>Search Devices</button>
              {searchStatus && <p className="search-status">{searchStatus}</p>}
              {discoveredDevices.length === 0 ? (
                <p className="empty-msg">Searching...</p>
              ) : (
                discoveredDevices.map(device => (
                  <div key={device.id} className="device-item-mini">
                    <span>{device.name}</span>
                    <button className="btn-primary-xs">Pair</button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="usb-section glass animate-fade">
            <h3>USB (ADB)</h3>
            <p className="usb-status">{usbStatus}</p>
            <button className="btn-secondary-sm" onClick={async () => {
              await scanUsbAndForward();
            }}>Scan & Forward</button>
          </section>
        </aside>

        <section className="main-stage">
          <div className="focus-area glass">
            {selectedDeviceId ? (
              <div className="focused-stream">
                <StreamReceiver deviceId={selectedDeviceId} />
                <div className="focus-controls">
                  <div className="device-meta">
                    <h2>{connectedDevices.find(d => d.id === selectedDeviceId)?.name}</h2>
                    <p>{connectedDevices.find(d => d.id === selectedDeviceId)?.model}</p>
                  </div>
                  <div className="action-group">
                    <button className="btn-icon" title="Toggle Camera" onClick={() => window.electronAPI.sendCommand(selectedDeviceId, 'toggle-camera-state')}>
                      📹
                    </button>
                    <button className="btn-icon" title="Toggle Mic" onClick={() => window.electronAPI.sendCommand(selectedDeviceId, 'toggle-mic-state')}>
                      🎙️
                    </button>
                    <button className="btn-icon" title="Flip" onClick={() => window.electronAPI.sendCommand(selectedDeviceId, 'toggle-camera')}>
                      🔄
                    </button>
                    <button className="btn-icon" title="Flash" onClick={() => window.electronAPI.sendCommand(selectedDeviceId, 'toggle-torch')}>
                      🔦
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="no-selection">
                <p>Select a camera from the grid below</p>
              </div>
            )}
          </div>

          <div className="device-grid-mini">
            {connectedDevices.map(device => (
              <div 
                key={device.id} 
                className={`device-card-mini glass ${selectedDeviceId === device.id ? 'selected' : ''}`}
                onClick={() => setSelectedDeviceId(device.id)}
              >
                <div className="mini-preview">
                  <StreamReceiver deviceId={device.id} />
                </div>
                <div className="mini-info">
                  <span>{device.name}</span>
                  <span className="platform-tag">{device.platform}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;
