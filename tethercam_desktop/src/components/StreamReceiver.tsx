import React, { useEffect, useRef, useState } from 'react';

interface StreamReceiverProps {
  deviceId: string;
  isVirtualCamActive?: boolean;
  onStatsUpdate?: (stats: { fps?: number; latencyMs?: number; bitrate?: number; packetLoss?: number }) => void;
}

const StreamReceiver: React.FC<StreamReceiverProps> = ({ deviceId, isVirtualCamActive = false, onStatsUpdate }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLive, setIsLive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (isVirtualCamActive) {
      console.log('[StreamReceiver] Background Virtual Camera mode active.');
      setIsLive(true); // eslint-disable-line react-hooks/set-state-in-effect

      const removeOffer = window.electronAPI.onSdpOffer(async (data: { deviceId?: string; clientIp?: string; sdp: string }) => {
        if (data.deviceId !== deviceId && data.clientIp !== deviceId) return;
        try {
          const answerSdp = await window.electronAPI.startVirtualCamera(deviceId, data.sdp);
          await window.electronAPI.sendCommand(deviceId, 'sdp-answer', answerSdp);
        } catch (err) {
          console.error('[StreamReceiver] Failed to start background virtual camera:', err);
        }
      });

      return () => {
        removeOffer();
      };
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        setIsLive(true);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.electronAPI.sendCommand(deviceId, 'ice-candidate', event.candidate);
      }
    };

    const removeOffer = window.electronAPI.onSdpOffer(async (data: { deviceId?: string; clientIp?: string; sdp: string }) => {
      if (data.deviceId !== deviceId && data.clientIp !== deviceId) return;
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      window.electronAPI.sendCommand(deviceId, 'sdp-answer', answer.sdp);
    });

    const removeIce = window.electronAPI.onIceCandidate(async (data: { deviceId?: string; clientIp?: string; candidate: RTCIceCandidateInit }) => {
      if (data.deviceId !== deviceId && data.clientIp !== deviceId) return;
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    });

    const removeSnapshot = window.electronAPI.onCaptureSnapshotRequest(async (snapshotDeviceId: string) => {
      if (snapshotDeviceId !== deviceId) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          const path = await window.electronAPI.saveSnapshot(dataUrl);
          console.log('[Snapshot] Saved:', path);
        }
      }
    });

    const statsInterval = setInterval(async () => {
      if (pc.connectionState === 'connected') {
        try {
          const stats = await pc.getStats();
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              onStatsUpdate?.({
                fps: report.framesPerSecond,
                latencyMs: report.jitter ? Math.round(report.jitter * 1000) : undefined,
                bitrate: report.bitrate ? Math.round(report.bitrate / 1000) : undefined,
                packetLoss: report.packetsLost ?? undefined,
              });
            }
          });
        } catch (_) {}
      }
    }, 2000);

    return () => {
      pc.close();
      pcRef.current = null;
      clearInterval(statsInterval);
      removeOffer();
      removeIce();
      removeSnapshot();
    };
  }, [deviceId, isVirtualCamActive, onStatsUpdate]);

  if (isVirtualCamActive) {
    return (
      <div className="stream-receiver virtual-cam-active-container" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', width: '100%',
        background: 'rgba(10, 10, 15, 0.95)', textAlign: 'center',
        color: '#fff', padding: '24px', boxSizing: 'border-box'
      }}>
        <div className="pulse-broadcast" style={{
          width: '64px', height: '64px', borderRadius: '50%',
          background: 'rgba(16, 185, 129, 0.2)', border: '2px solid #10b981',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.8rem', marginBottom: '16px',
          boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)',
        }}>
          📡
        </div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', fontWeight: 600, color: '#10b981' }}>
          Broadcasting to Virtual Camera
        </h3>
        <p className="subtext" style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0 0 20px 0', maxWidth: '300px' }}>
          Phone feed is routed directly through FFmpeg for low-latency streaming.
        </p>
        <div className="stats-mini" style={{
          background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '8px', padding: '12px 16px', fontSize: '0.78rem',
          textAlign: 'left', width: '100%', maxWidth: '320px',
          display: 'flex', flexDirection: 'column', gap: '6px'
        }}>
          <div style={{color: '#94a3b8'}}>RTSP: <code style={{color: '#a5b4fc'}}>tcp://127.0.0.1:8554</code></div>
        </div>
      </div>
    );
  }

  return (
    <div className="stream-receiver">
      {!isLive && <div className="loading-overlay">Waiting for stream...</div>}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="live-video"
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export default StreamReceiver;
