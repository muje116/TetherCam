import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import StreamReceiver from './components/StreamReceiver';
import Logo from './components/Logo';
import './App.css';

interface PendingPhone {
  id: string;
  name: string;
  ip: string;
  port: number;
  invitePort: number;
  role: 'mobile' | 'desktop' | 'unknown';
  bluetoothAddress?: string;
  status: 'discovered' | 'inviting' | 'waiting';
}

interface StreamStats {
  fps?: number;
  jitterMs?: number;
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
  const [discoveredPhones, setDiscoveredPhones] = useState<PendingPhone[]>([]);
  const [phoneIpInput, setPhoneIpInput] = useState('');
  const [inviteStatus, setInviteStatus] = useState<string>('');
  const [usbDevices, setUsbDevices] = useState<{ id: string; model?: string; status?: string }[]>([]);
  const [connectedDevices, setConnectedDevices] = useState<DeviceInfo[]>([]);
  const [serverInfo, setServerInfo] = useState<{ port: number; addresses: string[] } | null>(null);
  const [allAddresses, setAllAddresses] = useState<string[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [usbStatus, setUsbStatus] = useState<string>('USB not scanned');
  const [searchStatus, setSearchStatus] = useState<string>('');
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [streamStats, setStreamStats] = useState<Record<string, StreamStats>>({});
  const [isVirtualCamActive, setIsVirtualCamActive] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [controlStatus, setControlStatus] = useState<string>('');

  const toggleVirtualCam = useCallback(async () => {
    if (!selectedDeviceId) return;
    try {
      if (isVirtualCamActive) {
        const stopped = await window.electronAPI.stopVirtualCamera();
        setIsVirtualCamActive(false);
        setControlStatus(stopped ? 'Virtual camera stopped' : 'Virtual camera was not running');
      } else {
        setIsVirtualCamActive(true);
        setControlStatus('Virtual camera starting…');
      }
    } catch (error) {
      setControlStatus(`Virtual camera error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedDeviceId, isVirtualCamActive]);

  useEffect(() => {
    if (!isVirtualCamActive) return;
    return () => { void window.electronAPI.stopVirtualCamera(); };
  }, [isVirtualCamActive]);

  const launchAppOnPhone = useCallback(async (deviceId: string) => {
    const ok = await window.electronAPI.launchPhoneApp(deviceId);
    if (ok) {
      setUsbStatus(`App launched on device — waiting for it to connect...`);
    } else {
      setUsbStatus(`Could not launch app — open TetherCam manually on the phone`);
    }
    return ok;
  }, []);

  const scanUsbAndForward = useCallback(async () => {
    const devices = await window.electronAPI.getUsbDevices();
    setUsbDevices(devices);
    if (devices.length === 0) {
      setUsbStatus('No USB phone detected');
      return;
    }
    let forwarded = 0;
    for (const dev of devices) {
      if (dev.status && dev.status !== 'device') continue;
      if (await window.electronAPI.enableUsbForwarding(dev.id)) {
        forwarded += 1;
      }
    }
    setUsbStatus(`USB forwarded: ${forwarded}/${devices.length} — launching app...`);
    for (const dev of devices) {
      if (dev.status && dev.status !== 'device') continue;
      await launchAppOnPhone(dev.id);
    }
  }, [launchAppOnPhone]);

  const scanNetworkPhones = useCallback(async () => {
    setSearchStatus('Scanning network...');
    const found = await window.electronAPI.scanForDevices();
    setDiscoveredPhones((prev) => {
      const merged = new Map(prev.map((p) => [p.id, p]));
      for (const phone of found) {
        const id = `${phone.ip}:${phone.invitePort}`;
        merged.set(id, {
          id,
          name: phone.name,
          ip: phone.ip,
          port: phone.port,
          invitePort: phone.invitePort,
          role: phone.role,
          bluetoothAddress: phone.bluetoothAddress,
          status: merged.get(id)?.status ?? 'discovered',
        });
      }
      return Array.from(merged.values());
    });
    setSearchStatus(`Found ${found.length} phone(s) on LAN`);
  }, []);

  const invitePhone = useCallback(async (phoneIp: string, label?: string) => {
    setInviteStatus(`Inviting ${label ?? phoneIp}...`);
    const result = await window.electronAPI.invitePhone(phoneIp);
    if (result.ok) {
      setInviteStatus(`Invite sent to ${label ?? phoneIp} — waiting for connection`);
      setDiscoveredPhones((prev) =>
        prev.map((p) => (p.ip === phoneIp ? { ...p, status: 'waiting' as const } : p)),
      );
    } else {
      setInviteStatus(`Invite failed: ${result.error ?? 'phone unreachable (is the app open?)'}`);
    }
  }, []);

  const addPhoneManually = useCallback(async () => {
    const ip = phoneIpInput.trim();
    if (!ip) return;
    const reachable = await window.electronAPI.probePhone(ip);
    const id = `${ip}:4748`;
    setDiscoveredPhones((prev) => {
      if (prev.some((p) => p.ip === ip)) return prev;
      return [
        ...prev,
        {
          id,
          name: reachable ? 'Phone (manual)' : 'Phone (unverified)',
          ip,
          port: 4748,
          invitePort: 4748,
          role: 'mobile' as const,
          status: 'discovered' as const,
        },
      ];
    });
    await invitePhone(ip, 'manual phone');
  }, [phoneIpInput, invitePhone]);

  const searchDevices = useCallback(async () => {
    setSearchStatus('Searching...');
    const activeDevices = await window.electronAPI.getDevices();
    setConnectedDevices(activeDevices);
    setSelectedDeviceId((prev) => prev ?? (activeDevices[0]?.id ?? null));
    await scanUsbAndForward();
    await scanNetworkPhones();
    setSearchStatus(`Connected: ${activeDevices.length} · scan complete`);
  }, [scanUsbAndForward, scanNetworkPhones]);

  const handleSnapshot = useCallback(async () => {
    if (!selectedDeviceId) return;
    const requested = await window.electronAPI.captureSnapshot(selectedDeviceId);
    setControlStatus(requested ? 'Snapshot requested — check your Pictures folder' : 'Snapshot failed');
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
      await scanNetworkPhones();
      if (cancelled) return;
      const logs = await window.electronAPI.getDiagnosticLogs();
      setDiagnosticLogs(logs.slice(-30));
    };

    void init();
    return () => { cancelled = true; };
  }, [scanUsbAndForward, scanNetworkPhones]);

  useEffect(() => {
    const removeDiscovered = window.electronAPI.onDeviceDiscovered((device) => {
      const id = `${device.ip}:${device.invitePort}`;
      setDiscoveredPhones((prev) => {
        if (prev.find((d) => d.id === id)) {
          return prev.map((d) => (d.id === id ? { ...d, ...device, id, status: d.status } : d));
        }
        return [
          ...prev,
          {
            id,
            name: device.name,
            ip: device.ip,
            port: device.port,
            invitePort: device.invitePort,
            role: device.role,
            bluetoothAddress: device.bluetoothAddress,
            status: 'discovered' as const,
          },
        ];
      });
    });

    const removeConnected = window.electronAPI.onDeviceConnected((device: DeviceInfo) => {
      setConnectedDevices((prev) => {
        if (prev.some((d) => d.id === device.id)) return prev;
        return [...prev, device];
      });
      setSelectedDeviceId((prev) => prev ?? device.id);
      setDiscoveredPhones((prev) => prev.filter((p) => p.ip !== device.ip));
      setInviteStatus(`${device.name} connected via ${device.connectionType}`);
    });

    const removeDisconnected = window.electronAPI.onDeviceDisconnected((deviceId: string) => {
      setConnectedDevices((prev) => prev.filter((d) => d.id !== deviceId));
      setSelectedDeviceId((prev) => (prev === deviceId ? null : prev));
      setStreamStats((prev) => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
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

  const sendDeviceCommand = useCallback(async (command: string, payload?: unknown) => {
    if (!selectedDeviceId) return false;
    const ok = await window.electronAPI.sendCommand(selectedDeviceId, command, payload);
    setControlStatus(ok ? `${command} sent` : 'Device is no longer connected');
    return ok;
  }, [selectedDeviceId]);

  const disconnectSelectedDevice = useCallback(async () => {
    if (!selectedDeviceId) return;
    await window.electronAPI.disconnectDevice(selectedDeviceId);
    setControlStatus('Device disconnected');
  }, [selectedDeviceId]);

  return (
    <div className="app-container">
      <div className="bg-blob bg-blob--1"></div>
      <div className="bg-blob bg-blob--2"></div>
      <div className="grid-bg"></div>

      <header className="app-header">
        <div className="header-left">
          <Logo size={32} />
          <h1 className="gradient-text">TetherCam</h1>
        </div>
        <div className="status-badge">
          <div className="pulse"></div>
          {connectionUrl ? connectionUrl.replace('ws://', '') : `${serverInfo?.addresses?.[0] ?? 'loading'}:${serverInfo?.port ?? 4747}`}
        </div>
      </header>

      <main className="dashboard">
        <aside className="sidebar">
          <section className="glass animate-fade connect-section">
            <h3>Connect</h3>
            <div className="qr-container">
              {qrCodeUrl && <img src={qrCodeUrl} alt="QR" />}
            </div>
            <p className="connect-url">Scan or use: <strong>{connectionUrl || 'loading...'}</strong></p>
            {allAddresses.length > 1 && (
              <div className="all-addresses">
                <p className="addr-hint">All available IPs:</p>
                {allAddresses.map((addr) => (
                  <code key={addr} className="addr-item">ws://{addr}:4747</code>
                ))}
              </div>
            )}

            <div className="discovery-list">
              <div className="discovery-header">
                <h4>Add Phone</h4>
                <button className="btn-secondary-sm" onClick={searchDevices}>Scan All</button>
              </div>
              {searchStatus && <p className="search-status">{searchStatus}</p>}
              {inviteStatus && <p className="search-status">{inviteStatus}</p>}

              <div className="manual-add-row">
                <input
                  type="text"
                  className="manual-ip-input"
                  placeholder="Phone IP (e.g. 192.168.1.42)"
                  value={phoneIpInput}
                  onChange={(e) => setPhoneIpInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addPhoneManually()}
                />
                <button className="btn-primary-sm" onClick={() => void addPhoneManually()}>Invite</button>
              </div>

              {discoveredPhones.length === 0 ? (
                <p className="empty-msg">No phones found — open TetherCam on your phone, then Scan All</p>
              ) : (
                discoveredPhones.map((phone) => (
                  <div key={phone.id} className="device-item-mini">
                    <div className="device-info-left">
                      <span>{phone.name}</span>
                      <span className="platform-tag">{phone.ip}</span>
                      {phone.bluetoothAddress && (
                        <span className="platform-tag" title="Bluetooth address">BT</span>
                      )}
                    </div>
                    <button
                      className="btn-primary-sm"
                      style={{ padding: '2px 12px', fontSize: '11px' }}
                      onClick={() => void invitePhone(phone.ip, phone.name)}
                    >
                      {phone.status === 'waiting' ? 'Waiting…' : 'Invite'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="glass animate-fade">
            <h3>Connected Devices</h3>
            {connectedDevices.length === 0 ? (
              <p className="empty-msg">No devices connected. Add a phone via WiFi, USB, or Bluetooth pairing + Invite.</p>
            ) : (
              <div className="connected-list">
                {connectedDevices.map((device) => (
                  <div
                    key={device.id}
                    className={`device-item-mini clickable ${selectedDeviceId === device.id ? 'selected' : ''}`}
                    onClick={() => setSelectedDeviceId(device.id)}
                  >
                    <div className="device-info-left">
                      <span className="pulse-indicator online"></span>
                      <strong>{device.name || 'Phone'}</strong>
                      <span className="platform-tag">{device.platform || 'Unknown'}</span>
                    </div>
                    <span className="device-battery">🔋{device.battery || 0}%</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="glass animate-fade">
            <h3>USB (ADB)</h3>
            <p className="usb-status">{usbStatus}</p>
            {usbDevices.length > 0 && (
              <div className="connected-list" style={{ marginBottom: 8 }}>
                {usbDevices.map((dev) => {
                  const alreadyConnected = connectedDevices.some(
                    (c) => c.connectionType === 'usb' && (c.ip === '127.0.0.1' || c.model === dev.model || c.name.includes(dev.model ?? dev.id))
                  );
                  return (
                    <div key={dev.id} className="device-item-mini">
                      <div className="device-info-left">
                        {alreadyConnected ? (
                          <span className="pulse-indicator online"></span>
                        ) : (
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--muted)', display: 'inline-block' }} />
                        )}
                        <span>{dev.model ?? dev.id}</span>
                        <span className="platform-tag">{dev.status ?? 'unknown'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {alreadyConnected ? (
                          <span className="platform-tag" style={{ color: 'var(--accent2)' }}>Connected</span>
                        ) : (
                          <button
                            className="btn-primary-sm"
                            style={{ padding: '2px 10px', fontSize: '11px' }}
                            onClick={() => void launchAppOnPhone(dev.id)}
                          >
                            Launch App
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="btn-secondary-sm" style={{ width: '100%' }} onClick={() => { void scanUsbAndForward(); }}>
              Scan, Forward & Launch
            </button>
          </section>

          <section className="glass animate-fade obs-controls">
            <h3>Stream Output</h3>
            {selectedDeviceId ? (
              <>
                <button className={`btn-virtual-cam ${isVirtualCamActive ? 'active' : ''}`} onClick={toggleVirtualCam}>
                  {isVirtualCamActive ? '🔴 Stop Virtual Cam' : '🟢 Start Virtual Cam'}
                </button>
                <button className="btn-secondary-sm" style={{ width: '100%', marginTop: '6px' }}
                  onClick={() => window.electronAPI.openProjector(selectedDeviceId)}>
                  📺 Open Borderless Projector
                </button>
                <button className="btn-secondary-sm" style={{ width: '100%', marginTop: '6px' }} onClick={handleSnapshot}>
                  📸 Capture Snapshot
                </button>
                <button className={`btn-secondary-sm ${isRecording ? 'recording' : ''}`} style={{ width: '100%', marginTop: '6px' }} onClick={() => setIsRecording(!isRecording)}>
                  {isRecording ? '⏹️ Stop Recording' : '⏺️ Record Stream'}
                </button>
                <div className="integration-help">
                  <p className="integration-title">📡 Desktop output</p>
                  <ol>
                    <li>Use <strong>Borderless Projector</strong> as a browser or window source</li>
                    <li>In OBS → Add <strong>Browser Source</strong>:<br/>
                      <code>http://localhost:4747/?projector=true&deviceId={selectedDeviceId}</code>
                    </li>
                    <li>Or use the experimental <strong>Virtual Cam</strong> output at:<br/>
                      <code>tcp://127.0.0.1:8554</code>
                    </li>
                  </ol>
                  <p className="integration-note">If a command cannot be delivered, the status message above will say so.</p>
                </div>
              </>
            ) : (
              <p className="empty-msg">Select a device to enable output options.</p>
            )}
          </section>

          <section className="glass animate-fade">
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
          <div className="focus-area glass" id="focus-area-container">
            {selectedDeviceId ? (
              <div className="focused-stream">
                <StreamReceiver
                  deviceId={selectedDeviceId}
                  isVirtualCamActive={isVirtualCamActive}
                  isRecording={isRecording}
                  onStatsUpdate={(stats) => setStreamStats((prev) => ({ ...prev, [selectedDeviceId]: stats }))}
                />
                {currentStats && (
                  <div className="stream-stats-overlay">
                    <span>{currentStats.fps ?? '--'} FPS</span>
                    <span>{currentStats.jitterMs ?? '--'} ms jitter</span>
                    <span>{currentStats.bitrate ?? '--'} kbps</span>
                    {currentStats.packetLoss != null && <span>Loss: {currentStats.packetLoss}%</span>}
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
                    <button className="btn-icon" title="Toggle Camera" onClick={() => void sendDeviceCommand('toggle-camera-state')}>
                      📹
                    </button>
                    <button className="btn-icon" title="Toggle Mic" onClick={() => void sendDeviceCommand('toggle-mic-state')}>
                      🎙️
                    </button>
                    <button className="btn-icon" title="Flip" onClick={() => void sendDeviceCommand('toggle-camera')}>
                      🔄
                    </button>
                    <button className="btn-icon" title="Flash" onClick={() => void sendDeviceCommand('toggle-torch')}>
                      🔦
                    </button>
                    <button className="btn-icon" title="Fullscreen" onClick={() => {
                      const el = document.getElementById('focus-area-container');
                      if (document.fullscreenElement) {
                        document.exitFullscreen();
                      } else {
                        el?.requestFullscreen();
                      }
                    }}>
                      ⛶
                    </button>
                    <button className="btn-icon" title="Popout (Open in New Window)" onClick={() => window.electronAPI.openProjector(selectedDeviceId)}>
                      🪟
                    </button>
                    <button className="btn-icon" title="Disconnect" onClick={() => void disconnectSelectedDevice()}>
                      ⏏️
                    </button>
                  </div>
                </div>
                {controlStatus && <p className="search-status control-status">{controlStatus}</p>}
              </div>
            ) : (
              <div className="no-selection">
                <Logo size={64} />
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
                  <StreamReceiver
                    deviceId={device.id}
                    isVirtualCamActive={isVirtualCamActive && selectedDeviceId === device.id}
                    muted={true}
                    enableSnapshots={selectedDeviceId !== device.id}
                  />
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
