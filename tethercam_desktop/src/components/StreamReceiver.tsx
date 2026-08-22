import React, { useCallback, useEffect, useRef, useState } from 'react';

interface StreamReceiverProps {
  deviceId: string;
  isVirtualCamActive?: boolean;
  isRecording?: boolean;
  muted?: boolean;
  enableSnapshots?: boolean;
  onStatsUpdate?: (stats: StreamStats) => void;
}

interface StreamStats {
  fps?: number;
  jitterMs?: number;
  bitrate?: number;
  packetLoss?: number;
}

type StreamSubscriber = (stream: MediaStream | null, live: boolean) => void;
type StatsSubscriber = (stats: StreamStats) => void;

interface InboundVideoSample {
  timestamp: number;
  bytesReceived: number;
  packetsLost: number;
  packetsReceived: number;
}

interface StreamSession {
  deviceId: string;
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  isLive: boolean;
  subscribers: Set<StreamSubscriber>;
  statsSubscribers: Set<StatsSubscriber>;
  pendingIceCandidates: RTCIceCandidateInit[];
  lastHandledOffer: string | null;
  offerQueue: Promise<void>;
  reconnectRequested: boolean;
  startupTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  statsInterval: ReturnType<typeof setInterval>;
  lastInboundSample: InboundVideoSample | null;
  removeOffer: () => void;
  removeIce: () => void;
}

const streamSessions = new Map<string, StreamSession>();

function isActiveSession(session: StreamSession): boolean {
  return streamSessions.get(session.deviceId) === session;
}

function notifySession(session: StreamSession): void {
  for (const subscriber of session.subscribers) subscriber(session.stream, session.isLive);
}

function closeSession(deviceId: string): void {
  const session = streamSessions.get(deviceId);
  if (!session) return;

  clearTimeout(session.startupTimer ?? undefined);
  clearTimeout(session.reconnectTimer ?? undefined);
  clearTimeout(session.closeTimer ?? undefined);
  clearInterval(session.statsInterval);
  session.removeOffer();
  session.removeIce();
  session.pc.ontrack = null;
  session.pc.onicecandidate = null;
  session.pc.onconnectionstatechange = null;
  session.pc.close();
  session.stream?.getTracks().forEach((track) => track.stop());
  session.stream = null;
  session.isLive = false;
  streamSessions.delete(deviceId);
}

function sendFreshStreamRequest(session: StreamSession): void {
  void window.electronAPI.sendCommand(session.deviceId, 'request-stream', {}).then((ok) => {
    if (!ok && isActiveSession(session) && session.subscribers.size > 0) {
      session.reconnectRequested = false;
      requestFreshStream(session);
    }
  });
}

function replacePeerConnection(session: StreamSession): void {
  if (!isActiveSession(session) || session.subscribers.size === 0) return;

  const oldPc = session.pc;
  oldPc.ontrack = null;
  oldPc.onicecandidate = null;
  oldPc.onconnectionstatechange = null;
  oldPc.close();
  session.stream?.getTracks().forEach((track) => track.stop());
  session.stream = null;
  session.isLive = false;
  session.pendingIceCandidates = [];
  session.lastHandledOffer = null;
  session.lastInboundSample = null;
  session.pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  bindPeerConnection(session);
  notifySession(session);
  sendFreshStreamRequest(session);
}

function requestFreshStream(session: StreamSession): void {
  if (!isActiveSession(session) || session.subscribers.size === 0) return;
  if (session.reconnectRequested || session.reconnectTimer) return;

  session.reconnectRequested = true;
  session.isLive = false;
  notifySession(session);
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    replacePeerConnection(session);
  }, 500);
}

async function flushPendingIceCandidates(session: StreamSession): Promise<void> {
  if (!session.pc.remoteDescription) return;

  const pendingCandidates = [...session.pendingIceCandidates];
  session.pendingIceCandidates = [];
  for (const candidate of pendingCandidates) {
    await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

async function applyOffer(session: StreamSession, sdp: string): Promise<void> {
  if (!sdp || !isActiveSession(session)) return;
  if (session.lastHandledOffer === sdp) return;
  if (session.pc.signalingState !== 'stable') return;

  session.lastHandledOffer = sdp;
  try {
    await session.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    await flushPendingIceCandidates(session);
    const answer = await session.pc.createAnswer();
    await session.pc.setLocalDescription(answer);
    if (answer.sdp) await window.electronAPI.sendCommand(session.deviceId, 'sdp-answer', answer.sdp);
    await window.electronAPI.clearPendingOffer(session.deviceId);
  } catch (error) {
    session.lastHandledOffer = null;
    console.error('[StreamReceiver] Failed to apply SDP offer:', error);
  }
}

function publishInboundStats(session: StreamSession, report: RTCInboundRtpStreamStats): void {
  const timestamp = typeof report.timestamp === 'number' ? report.timestamp : Date.now();
  const bytesReceived = report.bytesReceived ?? 0;
  const packetsLost = report.packetsLost ?? 0;
  const packetsReceived = report.packetsReceived ?? 0;
  const previous = session.lastInboundSample;
  session.lastInboundSample = { timestamp, bytesReceived, packetsLost, packetsReceived };

  const stats: StreamStats = {
    fps: typeof report.framesPerSecond === 'number' ? Math.round(report.framesPerSecond * 10) / 10 : undefined,
    jitterMs: typeof report.jitter === 'number' ? Math.round(report.jitter * 1000 * 10) / 10 : undefined,
    packetLoss: packetsLost + packetsReceived > 0
      ? Math.round((packetsLost / (packetsLost + packetsReceived)) * 1000) / 10
      : undefined,
  };

  if (previous && timestamp > previous.timestamp && bytesReceived >= previous.bytesReceived) {
    const elapsedMs = timestamp - previous.timestamp;
    stats.bitrate = Math.round(((bytesReceived - previous.bytesReceived) * 8) / elapsedMs);
  }

  for (const subscriber of session.statsSubscribers) subscriber(stats);
}

function bindPeerConnection(session: StreamSession): void {
  const pc = session.pc;

  pc.ontrack = (event) => {
    if (!isActiveSession(session) || session.pc !== pc) return;

    if (event.streams[0]) {
      session.stream = event.streams[0];
    } else if (!session.stream) {
      session.stream = new MediaStream([event.track]);
    } else if (!session.stream.getTracks().some((track) => track.id === event.track.id)) {
      session.stream.addTrack(event.track);
    }

    if (event.track.kind === 'video') {
      session.isLive = true;
      session.reconnectRequested = false;
      clearTimeout(session.startupTimer ?? undefined);
      session.startupTimer = null;
      notifySession(session);
    }
  };

  pc.onconnectionstatechange = () => {
    if (!isActiveSession(session) || session.pc !== pc) return;

    if (pc.connectionState === 'connected') {
      session.reconnectRequested = false;
      clearTimeout(session.reconnectTimer ?? undefined);
      session.reconnectTimer = null;
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      requestFreshStream(session);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && isActiveSession(session)) {
      void window.electronAPI.sendCommand(session.deviceId, 'ice-candidate', event.candidate.toJSON());
    }
  };
}

function queueOffer(session: StreamSession, sdp: string): void {
  session.offerQueue = session.offerQueue
    .then(() => applyOffer(session, sdp))
    .catch((error) => console.error('[StreamReceiver] Offer queue failed:', error));
}

function getOrCreateSession(deviceId: string): StreamSession {
  const existing = streamSessions.get(deviceId);
  if (existing) {
    clearTimeout(existing.closeTimer ?? undefined);
    existing.closeTimer = null;
    return existing;
  }

  const session = {} as StreamSession;
  session.deviceId = deviceId;
  session.pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  session.stream = null;
  session.isLive = false;
  session.subscribers = new Set();
  session.statsSubscribers = new Set();
  session.pendingIceCandidates = [];
  session.lastHandledOffer = null;
  session.offerQueue = Promise.resolve();
  session.reconnectRequested = false;
  session.startupTimer = null;
  session.reconnectTimer = null;
  session.closeTimer = null;
  session.lastInboundSample = null;
  session.removeOffer = () => {};
  session.removeIce = () => {};
  session.statsInterval = setInterval(async () => {
    if (!isActiveSession(session) || session.pc.connectionState !== 'connected') return;
    try {
      const reports = await session.pc.getStats();
      reports.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          publishInboundStats(session, report as RTCInboundRtpStreamStats);
        }
      });
    } catch {
      // A peer can close while a stats request is in flight.
    }
  }, 2000);

  bindPeerConnection(session);
  streamSessions.set(deviceId, session);

  session.removeOffer = window.electronAPI.onSdpOffer((data) => {
    if (data.deviceId !== deviceId && data.clientIp !== deviceId) return;
    queueOffer(session, data.sdp);
  });

  session.removeIce = window.electronAPI.onIceCandidate(async (data) => {
    if (!isActiveSession(session) || (data.deviceId !== deviceId && data.clientIp !== deviceId)) return;
    try {
      if (!session.pc.remoteDescription) {
        session.pendingIceCandidates.push(data.candidate);
        return;
      }
      await session.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error('[StreamReceiver] Failed to add ICE candidate:', error);
    }
  });

  void window.electronAPI.getPendingOffer(deviceId).then((pending) => {
    if (pending && isActiveSession(session)) queueOffer(session, pending.sdp);
  }).catch(() => {});

  session.startupTimer = setTimeout(() => {
    session.startupTimer = null;
    if (isActiveSession(session) && session.pc.connectionState === 'new') requestFreshStream(session);
  }, 10_000);

  return session;
}

const StreamReceiver: React.FC<StreamReceiverProps> = ({
  deviceId,
  isVirtualCamActive = false,
  isRecording = false,
  muted = true,
  enableSnapshots = true,
  onStatsUpdate,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const onStatsUpdateRef = useRef(onStatsUpdate);

  useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate;
  }, [onStatsUpdate]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  useEffect(() => {
    if (isVirtualCamActive) {
      const removeOffer = window.electronAPI.onSdpOffer(async (data) => {
        if (data.deviceId !== deviceId && data.clientIp !== deviceId) return;
        try {
          const answerSdp = await window.electronAPI.startVirtualCamera(deviceId, data.sdp);
          if (answerSdp) await window.electronAPI.sendCommand(deviceId, 'sdp-answer', answerSdp);
        } catch (error) {
          console.error('[StreamReceiver] Failed to start background virtual camera:', error);
        }
      });

      void window.electronAPI.sendCommand(deviceId, 'request-stream', {});
      return () => removeOffer();
    }

    const session = getOrCreateSession(deviceId);
    const streamSubscriber: StreamSubscriber = (stream, live) => {
      setActiveStream(stream);
      setIsLive(live);
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
    };
    const statsSubscriber: StatsSubscriber = (stats) => onStatsUpdateRef.current?.(stats);

    session.subscribers.add(streamSubscriber);
    session.statsSubscribers.add(statsSubscriber);
    streamSubscriber(session.stream, session.isLive);

    const removeSnapshot = enableSnapshots
      ? window.electronAPI.onCaptureSnapshotRequest(async (snapshotDeviceId) => {
          if (snapshotDeviceId !== deviceId) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const context = canvas.getContext('2d');
          if (!context) return;
          context.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          const savedPath = await window.electronAPI.saveSnapshot(dataUrl);
          console.log('[Snapshot] Saved:', savedPath);
        })
      : undefined;

    return () => {
      removeSnapshot?.();
      session.subscribers.delete(streamSubscriber);
      session.statsSubscribers.delete(statsSubscriber);
      if (session.subscribers.size === 0) {
        session.closeTimer = setTimeout(() => closeSession(deviceId), 800);
      }
    };
  }, [deviceId, enableSnapshots, isVirtualCamActive]);

  useEffect(() => {
    if (!isRecording || !activeStream) {
      stopRecording();
      return;
    }
    if (mediaRecorderRef.current?.state === 'recording') return;

    try {
      const supportedMimeTypes = [
        'video/webm; codecs=vp9',
        'video/webm; codecs=vp8',
        'video/webm',
      ];
      const mimeType = supportedMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(activeStream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'video/webm' });
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `TetherCam_Record_${deviceId}_${Date.now()}.webm`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        }
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
      };
      recorder.start(1000);
    } catch (error) {
      console.error('[StreamReceiver] Error starting MediaRecorder:', error);
    }

    return stopRecording;
  }, [activeStream, deviceId, isRecording, stopRecording]);

  useEffect(() => () => stopRecording(), [stopRecording]);

  if (isVirtualCamActive) {
    return (
      <div className="stream-receiver virtual-cam-active-container" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', width: '100%',
        background: 'rgba(10, 10, 15, 0.95)', textAlign: 'center',
        color: '#fff', padding: '24px', boxSizing: 'border-box',
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
          The desktop output pipeline is negotiating the phone feed.
        </p>
        <div className="stats-mini" style={{
          background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '8px', padding: '12px 16px', fontSize: '0.78rem',
          textAlign: 'left', width: '100%', maxWidth: '320px',
          display: 'flex', flexDirection: 'column', gap: '6px',
        }}>
          <div style={{ color: '#94a3b8' }}>RTSP: <code style={{ color: '#a5b4fc' }}>tcp://127.0.0.1:8554</code></div>
        </div>
      </div>
    );
  }

  return (
    <div className="stream-receiver">
      {!isLive && <div className="loading-overlay">Waiting for stream...</div>}
      <video ref={videoRef} autoPlay playsInline muted={muted} className="live-video" />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

export default StreamReceiver;
