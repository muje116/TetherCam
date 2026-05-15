import React, { useEffect, useRef, useState } from 'react';

interface StreamReceiverProps {
  deviceId: string;
}

const StreamReceiver: React.FC<StreamReceiverProps> = ({ deviceId }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.ontrack = (event) => {
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0];
        setIsLive(true);
        console.log('[PHASE] FIRST_FRAME');
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.electronAPI.sendCommand(deviceId, 'ice-candidate', event.candidate);
      }
    };

    // Listen for signaling from main
    const removeOffer = window.electronAPI.onSdpOffer(async (data: { deviceId?: string; clientIp?: string; sdp: string }) => {
      if (data.deviceId !== deviceId && data.clientIp !== deviceId) return; // Basic filter

      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[PHASE] ANSWER_SEND');

      window.electronAPI.sendCommand(deviceId, 'sdp-answer', answer.sdp);
    });

    const removeIce = window.electronAPI.onIceCandidate(async (data: { deviceId?: string; clientIp?: string; candidate: RTCIceCandidateInit }) => {
      if (data.deviceId !== deviceId && data.clientIp !== deviceId) return;
      console.log('[PHASE] ICE_RECV_DESKTOP');
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    });

    return () => {
      pc.close();
      removeOffer();
      removeIce();
    };
  }, [deviceId]);

  return (
    <div className="stream-receiver">
      {!isLive && <div className="loading-overlay">Waiting for stream...</div>}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted // Muted to avoid feedback loops initially
        className="live-video"
      />
    </div>
  );
};

export default StreamReceiver;
