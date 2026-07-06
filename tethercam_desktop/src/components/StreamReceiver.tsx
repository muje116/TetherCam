import React, { useEffect, useRef, useState } from 'react';

interface StreamReceiverProps {
  deviceId: string;
  isVirtualCamActive?: boolean;
  isRecording?: boolean;
  muted?: boolean;
  onStatsUpdate?: (stats: { fps?: number; latencyMs?: number; bitrate?: number; packetLoss?: number }) => void;
}

/** Debounce PC teardown so React StrictMode remounts don't kill an active WebRTC session */
const closeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function agentLog(location: string, message: string, data: Record<string, unknown>, hypothesisId: string) {
  const payload = { sessionId: 'da00e2', location, message, data, hypothesisId };
  window.electronAPI.debugLog(payload).catch(() => {});
  fetch('http://127.0.0.1:7471/ingest/c7b9a979-3097-4a1a-bbbd-7ee829dcc96d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'da00e2' },
    body: JSON.stringify({ ...payload, timestamp: Date.now() }),
  }).catch(() => {});
}

const StreamReceiver: React.FC<StreamReceiverProps> = ({ deviceId, isVirtualCamActive = false, isRecording = false, muted = true, onStatsUpdate }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLive, setIsLive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const lastHandledOfferRef = useRef<string | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const onStatsUpdateRef = useRef(onStatsUpdate);

  useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate;
  }, [onStatsUpdate]);

  useEffect(() => {
    // #region agent log
    agentLog('StreamReceiver.tsx:mount', 'StreamReceiver effect mounted', { deviceId, isVirtualCamActive }, 'B');
    // #endregion

    const pendingClose = closeTimers.get(deviceId);
    if (pendingClose) {
      clearTimeout(pendingClose);
      closeTimers.delete(deviceId);
      // #region agent log
      agentLog('StreamReceiver.tsx:mount', 'Cancelled pending PC close (StrictMode remount)', { deviceId }, 'B');
      // #endregion
    }

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

    const sendAnswer = async (sdp: string) => {
      await window.electronAPI.sendCommand(deviceId, 'sdp-answer', sdp);
    };

    const flushPendingIceCandidates = async () => {
      if (!pc.remoteDescription) {
        return;
      }

      const pendingCandidates = [...pendingIceCandidatesRef.current];
      pendingIceCandidatesRef.current = [];

      for (const candidate of pendingCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    const applyOffer = async (sdp: string) => {
      if (!sdp) {
        return;
      }

      if (lastHandledOfferRef.current === sdp && pc.signalingState !== 'stable') {
        lastHandledOfferRef.current = null;
      }

      if (!sdp || lastHandledOfferRef.current === sdp) {
        // #region agent log
        agentLog('StreamReceiver.tsx:applyOffer:skip', 'Offer skipped (empty or duplicate)', { deviceId, hasSdp: !!sdp, signalingState: pc.signalingState }, 'C');
        // #endregion
        return;
      }

      if (pc.signalingState !== 'stable') {
        console.warn('[StreamReceiver] Ignoring duplicate or overlapping offer for', deviceId);
        // #region agent log
        agentLog('StreamReceiver.tsx:applyOffer:unstable', 'Offer rejected - signaling not stable', { deviceId, signalingState: pc.signalingState }, 'C');
        // #endregion
        return;
      }

      lastHandledOfferRef.current = sdp;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        await flushPendingIceCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (answer.sdp) {
          await sendAnswer(answer.sdp);
        }
        await window.electronAPI.clearPendingOffer(deviceId);
        // #region agent log
        agentLog('StreamReceiver.tsx:applyOffer:ok', 'SDP answer sent', { deviceId, answerLen: answer.sdp?.length ?? 0, connectionState: pc.connectionState, iceState: pc.iceConnectionState }, 'C');
        // #endregion
      } catch (error) {
        lastHandledOfferRef.current = null;
        // #region agent log
        agentLog('StreamReceiver.tsx:applyOffer:error', 'applyOffer failed', { deviceId, error: String(error) }, 'C');
        // #endregion
        throw error;
      }
    };

    pc.ontrack = (event) => {
      // #region agent log
      agentLog('StreamReceiver.tsx:ontrack', 'Media track received', { deviceId, trackKind: event.track?.kind, streamCount: event.streams?.length ?? 0, hasVideoRef: !!videoRef.current }, 'D');
      // #endregion
      if (videoRef.current) {
        if (event.streams && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        } else {
          if (!videoRef.current.srcObject) {
            videoRef.current.srcObject = new MediaStream([event.track]);
          } else {
            (videoRef.current.srcObject as MediaStream).addTrack(event.track);
          }
        }
        setIsLive(true);
      }
    };

    pc.onconnectionstatechange = () => {
      // #region agent log
      agentLog('StreamReceiver.tsx:connectionState', 'PC connection state changed', { deviceId, connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, signalingState: pc.signalingState }, 'D');
      // #endregion
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON();
        window.electronAPI.sendCommand(deviceId, 'ice-candidate', candidate);
      }
    };

    const removeOffer = window.electronAPI.onSdpOffer(async (data: { deviceId?: string; clientIp?: string; sdp: string }) => {
      const matched = data.deviceId === deviceId || data.clientIp === deviceId;
      // #region agent log
      agentLog('StreamReceiver.tsx:onSdpOffer', 'SDP offer received', { receiverDeviceId: deviceId, offerDeviceId: data.deviceId, clientIp: data.clientIp, matched, sdpLen: data.sdp?.length ?? 0 }, 'A');
      // #endregion
      if (!matched) return;
      try {
        await applyOffer(data.sdp);
      } catch (error) {
        console.error('[StreamReceiver] Failed to apply SDP offer:', error);
      }
    });

    const removeIce = window.electronAPI.onIceCandidate(async (data: { deviceId?: string; clientIp?: string; candidate: RTCIceCandidateInit }) => {
      if (data.deviceId !== deviceId && data.clientIp !== deviceId) return;
      try {
        if (!pc.remoteDescription) {
          pendingIceCandidatesRef.current.push(data.candidate);
          return;
        }

        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error('[StreamReceiver] Failed to add ICE candidate:', error);
      }
    });

    // Replay any offer that arrived before this component mounted (timing race fix)
    window.electronAPI.getPendingOffer(deviceId).then(async (pending) => {
      // #region agent log
      agentLog('StreamReceiver.tsx:getPendingOffer', 'Pending offer lookup', { deviceId, hasPending: !!pending, sdpLen: pending?.sdp?.length ?? 0, signalingState: pc.signalingState }, 'B');
      // #endregion
      if (pending && pc.signalingState === 'stable') {
        console.log('[StreamReceiver] Replaying cached SDP offer for', deviceId);
        try {
          await applyOffer(pending.sdp);
        } catch (error) {
          console.error('[StreamReceiver] Failed to replay cached SDP offer:', error);
        }
      }
    }).catch(() => {});

    let streamRequested = false;
    const reconnectTimer = setTimeout(() => {
      if (pc.connectionState === 'connected' || pcRef.current !== pc) return;
      if (streamRequested) return;
      streamRequested = true;
      lastHandledOfferRef.current = null;
      // #region agent log
      agentLog('StreamReceiver.tsx:reconnect', 'Requesting fresh stream from phone', { deviceId, connectionState: pc.connectionState, iceState: pc.iceConnectionState }, 'B');
      // #endregion
      void window.electronAPI.sendCommand(deviceId, 'request-stream', {});
    }, 3000);

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
              onStatsUpdateRef.current?.({
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
      clearTimeout(reconnectTimer);
      clearInterval(statsInterval);
      removeOffer();
      removeIce();
      removeSnapshot();

      const timer = setTimeout(() => {
        closeTimers.delete(deviceId);
        if (pcRef.current === pc) {
          pc.close();
          pcRef.current = null;
        }
        lastHandledOfferRef.current = null;
        pendingIceCandidatesRef.current = [];
      }, 800);
      closeTimers.set(deviceId, timer);
    };
  }, [deviceId, isVirtualCamActive]);

  useEffect(() => {
    if (isRecording) {
      if (videoRef.current && videoRef.current.srcObject) {
        try {
          const stream = videoRef.current.srcObject as MediaStream;
          const options = { mimeType: 'video/webm; codecs=vp9' };
          const mediaRecorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(options.mimeType) ? options : undefined);
          mediaRecorderRef.current = mediaRecorder;
          recordedChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `TetherCam_Record_${deviceId}_${new Date().getTime()}.webm`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }, 100);
          };

          mediaRecorder.start(1000);
          console.log('[StreamReceiver] Recording started');
        } catch (e) {
          console.error('[StreamReceiver] Error starting MediaRecorder:', e);
        }
      }
    } else {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        console.log('[StreamReceiver] Recording stopped');
      }
    }
  }, [isRecording, deviceId]);

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
        muted={muted}
        className="live-video"
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export default StreamReceiver;
