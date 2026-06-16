import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import StreamReceiver from './components/StreamReceiver';
import './App.css';

interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  status: 'discovered' | 'connected';
}

interface StreamStats {
  fps?: number;
  latencyMs?: number;
  bitrate?: number;
  packetLoss?: number;
}

const ProjectorView: React.FC<{ deviceId: string }> = ({ deviceId }) => {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);

  return (
    <div className="projector-stage">
      <StreamReceiver deviceId={deviceId} />
      <div className="projector-overlay-container">
        <div className="projector-drag-handle" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          ⋮⋮ TetherCam Projector
        </div>
        <div className="projector-controls">
          <button className={`btn-control-icon ${isAlwaysOnTop ? 'active' : ''}`} title="Always on Top"
            onClick={async () => { const active = await window.electronAPI.toggleProjectorAlwaysOnTop(); setIsAlwaysOnTop(active); }}>
            📌
          </button>
          <div className="snap-group">
            <button className="btn-control-mini" onClick={() => window.electronAPI.snapProjector('top-left')}>↖</button>
            <button className="btn-control-mini" onClick={() => window.electronAPI.snapProjector('top-right')}>↗</button>
            <button className="btn-control-mini" onClick={() => window.electronAPI.snapProjector('bottom-left')}>↙</button>
            <button className="btn-control-mini" onClick={() => window.electronAPI.snapProjector('bottom-right')}>↘</button>
          </div>
          <button className="btn-control-close" onClick={() => window.electronAPI.closeProjector()}>✕</button>
        </div>
      </div>
    </div>
  );
};

const MainView: React.FC = () => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [connectionUrl, setConnectionUrl] = useState<string>('');
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [connectedDevices, setConnectedDevices] = useState<DeviceInfo[]>([]);
  const [serverInfo, setServerInfo] = useState<{ port: number; addresses: string[] } | null>(null);
  const [allAddresses, setAllAddresses] = useState<string[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [usbStatus, setUsbStatus] = useState<string>('USB not scanned');
  const [searchStatus, setSearchStatus] = useState<string>('');
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [streamStats, setStreamStats] = useState<Record<string, StreamStats>>({});
  const [isVirtualCamActive, setIsVirtualCamActive] = useState<boolean>(false);

  const toggleVirtualCam = useCallback(async () => {
    if (!selectedDeviceId) return;
    if (isVirtualCamActive) {
      await window.electronAPI.stopVirtualCamera();
      setIsVirtualCamActive(false);
    } else {
      setIsVirtualCamActive(true);
    }
  }, [selectedDeviceId, isVirtualCamActive]);

  useEffect(() => {
    if (!isVirtualCamActive) return;
    return () => { void window.electronAPI.stopVirtualCamera(); };
  }, [isVirtualCamActive]);

  const scanUsbAndForward = useCallback(async () => {
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
  }, []);

  const searchDevices = useCallback(async () => {
    setSearchStatus('Searching...');
    const activeDevices = await window.electronAPI.getDevices();
    setConnectedDevices(activeDevices);
    setSelectedDeviceId((prev) => prev ?? (activeDevices[0]?.id ?? null));
    await scanUsbAndForward();
    setSearchStatus(`Found ${activeDevices.length} connected device(s)`);
  }, [scanUsbAndForward]);

  const handleSnapshot = useCallback(async () => {
    if (!selectedDeviceId) return;
    await window.electronAPI.captureSnapshot(selectedDeviceId);
  }, [selectedDeviceId]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const url = await window.electronAPI.getConnectionUrl();
      if (cancelled) return;
      setConnectionUrl(url);
      const qrData = await QRCode.toDataURL(url);
      if (cancelled) return;
      setQrCodeUrl(qrData);

      const info = await window.electronAPI.getServerInfo();
      if (cancelled) return;
      setServerInfo(info);
      const addrs = await window.electronAPI.getAllAddresses();
      if (cancelled) return;
      setAllAddresses(addrs);

      const activeDevices = await window.electronAPI.getDevices();
      if (cancelled) return;
      setConnectedDevices(activeDevices);
      if (activeDevices.length > 0) {
        setSelectedDeviceId((prev) => prev ?? activeDevices[0].id);
      }

      await scanUsbAndForward();
      if (cancelled) return;
      const logs = await window.electronAPI.getDiagnosticLogs();
      setDiagnosticLogs(logs.slice(-30));
    };

    void init();
    return () => { cancelled = true; };
  }, [scanUsbAndForward]);

  useEffect(() => {
    const removeDiscovered = window.electronAPI.onDeviceDiscovered((device: { name: string; ip: string; port: number }) => {
      setDiscoveredDevices((prev) => {
        if (prev.find((d) => d.ip === device.ip)) return prev;
        return [...prev, { ...device, status: 'discovered' as const, id: `${device.ip}:${device.port}` }];
      });
    });

    const removeConnected = window.electronAPI.onDeviceConnected((device: DeviceInfo) => {
      setConnectedDevices((prev) => {
        if (prev.some((d) => d.id === device.id)) return prev;
        return [...prev, device];
      });
      setSelectedDeviceId((prev) => prev ?? device.id);
    });

    const removeDisconnected = window.electronAPI.onDeviceDisconnected((deviceId: string) => {
      setConnectedDevices((prev) => prev.filter((d) => d.id !== deviceId));
      setSelectedDeviceId((prev) => (prev === deviceId ? null : prev));
    });

    const removeUpdated = window.electronAPI.onDeviceUpdated((device: DeviceInfo) => {
      setConnectedDevices((prev) => {
        const existing = prev.find((d) => d.id === device.id);
        if (existing) {
          return prev.map((d) => d.id === device.id ? device : d);
        }
        return [...prev, device];
      });
    });

    const removeDiag = window.electronAPI.onDiagnosticLog((line: string) => {
      setDiagnosticLogs((prev) => [...prev.slice(-29), line]);
    });

    return () => {
      removeDiscovered();
      removeConnected();
      removeDisconnected();
      removeUpdated();
      removeDiag();
    };
  }, []);

  const selectedDevice = connectedDevices.find((d) => d.id === selectedDeviceId);
  const currentStats = selectedDeviceId ? streamStats[selectedDeviceId] : undefined;

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
            <p className="connect-url">Scan or use: <strong>{connectionUrl || 'loading...'}</strong></p>
            {allAddresses.length > 1 && (
              <div className="all-addresses">
                <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>All available IPs:</p>
                {allAddresses.map((addr) => (
                  <code key={addr} className="addr-item" style={{ fontSize: '0.68rem', color: '#a5b4fc', display: 'block' }}>
                    ws://{addr}:4747
                  </code>
                ))}
              </div>
            )}

            <div className="discovery-list">
              <h4>Discovered</h4>
              <button className="btn-secondary-sm" onClick={searchDevices}>Search Devices</button>
              {searchStatus && <p className="search-status">{searchStatus}</p>}
              {discoveredDevices.length === 0 ? (
                <p className="empty-msg">Searching...</p>
              ) : (
                discoveredDevices.map((device) => (
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
            <button className="btn-secondary-sm" onClick={() => { void scanUsbAndForward(); }}>
              Scan & Forward
            </button>
          </section>

          <section className="obs-controls glass animate-fade">
            <h3>Stream Output</h3>
            {selectedDeviceId ? (
              <>
                <button className={`btn-virtual-cam ${isVirtualCamActive ? 'active' : ''}`} onClick={toggleVirtualCam}>
                  {isVirtualCamActive ? '🔴 Stop Virtual Cam' : '🟢 Start Virtual Cam'}
                </button>
                <button className="btn-secondary-sm" style={{ marginTop: '6px' }}
                  onClick={() => window.electronAPI.openProjector(selectedDeviceId)}>
                  📺 Open Borderless Projector
                </button>
                <button className="btn-secondary-sm" style={{ marginTop: '6px' }} onClick={handleSnapshot}>
                  📸 Capture Snapshot
                </button>
                <div className="integration-help">
                  <p style={{ margin: '0 0 4px 0', fontSize: '0.72rem', fontWeight: 600 }}>RTSP for OBS Media Source:</p>
                  <code style={{ fontSize: '0.68rem', display: 'block', wordBreak: 'break-all', margin: '0 0 8px 0', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '4px' }}>
                    tcp://127.0.0.1:8554
                  </code>
                  <p style={{ margin: '0 0 4px 0', fontSize: '0.72rem', fontWeight: 600 }}>Browser Source (Preview):</p>
                  <code style={{ fontSize: '0.68rem', display: 'block', wordBreak: 'break-all', margin: '0', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '4px' }}>
                    {`http://localhost:4747/?projector=true&deviceId=${selectedDeviceId}`}
                  </code>
                </div>
              </>
            ) : (
              <p className="empty-msg" style={{ fontSize: '0.75rem' }}>Select a device to enable output options.</p>
            )}
          </section>

          <section className="usb-section glass animate-fade">
            <h3>Diagnostics</h3>
            <div className="diagnostic-panel">
              {diagnosticLogs.length === 0 ? (
                <p className="search-status">No logs yet</p>
              ) : (
                diagnosticLogs.map((line, index) => (
                  <p key={`${index}-${line}`} className="diag-line">{line}</p>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="main-stage">
          <div className="focus-area glass">
            {selectedDeviceId ? (
              <div className="focused-stream">
                <StreamReceiver
                  deviceId={selectedDeviceId}
                  isVirtualCamActive={isVirtualCamActive}
                  onStatsUpdate={(stats) => setStreamStats((prev) => ({ ...prev, [selectedDeviceId]: stats }))}
                />
                {currentStats && (
                  <div className="stream-stats-overlay">
                    <span>{currentStats.fps ?? '--'} FPS</span>
                    <span>{currentStats.latencyMs ?? '--'} ms</span>
                    <span>{currentStats.bitrate ?? '--'} kbps</span>
                    {currentStats.packetLoss != null && <span>Loss: {currentStats.packetLoss}</span>}
                  </div>
                )}
                <div className="focus-controls">
                  <div className="device-meta">
                    <h2>{selectedDevice?.name ?? 'Device'}</h2>
                    <p>{selectedDevice?.model}</p>
                    {selectedDevice && (
                      <div className="device-stats">
                        <span>🔋 {selectedDevice.battery}%</span>
                        <span>🌡️ {selectedDevice.temperature}°C</span>
                        <span>📡 {selectedDevice.ip}</span>
                      </div>
                    )}
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
            {connectedDevices.map((device) => (
              <div
                key={device.id}
                className={`device-card-mini glass ${selectedDeviceId === device.id ? 'selected' : ''}`}
                onClick={() => setSelectedDeviceId(device.id)}
              >
                <div className="mini-preview">
                  <StreamReceiver deviceId={device.id} isVirtualCamActive={false} />
                </div>
                <div className="mini-info">
                  <span>{device.name}</span>
                  <span className="platform-tag">{device.platform}</span>
                  <span className="platform-tag">🔋{device.battery}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const isProjector = searchParams.get('projector') === 'true';
  const projectorDeviceId = searchParams.get('deviceId');

  if (isProjector && projectorDeviceId) {
    return <ProjectorView deviceId={projectorDeviceId} />;
  }

  return <MainView />;
};

export default App;
