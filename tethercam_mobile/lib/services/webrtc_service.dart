import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'signaling_client.dart';

enum VideoCodec { h264, h265 }

class StreamConfig {
  final int width;
  final int height;
  final int fps;
  final int bitrate;
  final VideoCodec codec;

  const StreamConfig({
    this.width = 1280,
    this.height = 720,
    this.fps = 30,
    this.bitrate = 4000,
    this.codec = VideoCodec.h264,
  });

  String get resolutionLabel {
    if (width >= 3840) return '4K';
    if (width >= 1920) return '1080p';
    if (width >= 1280) return '720p';
    return '480p';
  }

  StreamConfig copyWith({
    int? width,
    int? height,
    int? fps,
    int? bitrate,
    VideoCodec? codec,
  }) {
    return StreamConfig(
      width: width ?? this.width,
      height: height ?? this.height,
      fps: fps ?? this.fps,
      bitrate: bitrate ?? this.bitrate,
      codec: codec ?? this.codec,
    );
  }
}

class WebRTCService {
  RTCPeerConnection? _peerConnection;
  MediaStream? _localStream;
  final SignalingClient _signalingClient;
  StreamConfig _config = const StreamConfig();
  ValueChanged<MediaStream?>? onLocalStream;
  bool _torchEnabled = false;

  final List<RTCIceCandidate> _pendingIceCandidates = [];
  bool _isRemoteDescriptionSet = false;

  StreamConfig get config => _config;
  bool get torchEnabled => _torchEnabled;

  WebRTCService(this._signalingClient);

  void updateConfig(StreamConfig config) {
    _config = config;
  }

  Map<String, dynamic> get _iceServers => {
    'iceServers': [
      {'urls': 'stun:stun.l.google.com:19302'},
    ],
  };

  Map<String, dynamic> get _configConstraints => {
    'mandatory': {'OfferToReceiveAudio': false, 'OfferToReceiveVideo': false},
    'optional': [],
  };

  Future<void> startStreaming({bool useFrontCamera = false}) async {
    await stop();

    _isRemoteDescriptionSet = false;
    _pendingIceCandidates.clear();

    debugPrint('[PHASE] WEBRTC START');
    _peerConnection = await createPeerConnection(
      _iceServers,
      _configConstraints,
    );

    final Map<String, dynamic> mediaConstraints = {
      'audio': true,
      'video': {
        'mandatory': {
          'minWidth': _config.width,
          'minHeight': _config.height,
          'maxWidth': _config.width,
          'maxHeight': _config.height,
          'minFrameRate': _config.fps,
          'maxFrameRate': _config.fps,
        },
        'facingMode': useFrontCamera ? 'user' : 'environment',
        'optional': [],
      },
    };

    _localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    onLocalStream?.call(_localStream);

    for (final track in _localStream!.getTracks()) {
      await _peerConnection!.addTrack(track, _localStream!);
    }

    _peerConnection!.onIceCandidate = (candidate) {
      if (candidate.candidate == null) return;
      debugPrint('[PHASE] ICE SEND');
      _signalingClient.send({
        'type': 'ice-candidate',
        'deviceId': _signalingClient.deviceId,
        'candidate': {
          'sdpMLineIndex': candidate.sdpMLineIndex,
          'sdpMid': candidate.sdpMid,
          'candidate': candidate.candidate,
        },
      });
    };

    _peerConnection!.onIceConnectionState = (state) {
      debugPrint('[ICE] Connection state: $state');
      if (state == RTCIceConnectionState.RTCIceConnectionStateDisconnected ||
          state == RTCIceConnectionState.RTCIceConnectionStateFailed) {
        _signalingClient.onConnectionLost();
      }
    };

    final offer = await _peerConnection!.createOffer(_configConstraints);
    if (offer.sdp == null || offer.sdp!.isEmpty) {
      throw StateError('WebRTC createOffer returned an empty SDP.');
    }

    // Use the native offer unchanged. Manual SDP munging was producing
    // invalid session descriptions on Android and breaking setLocalDescription.
    await _peerConnection!.setLocalDescription(offer);
    debugPrint('[PHASE] OFFER SEND');

    final localDescription = await _peerConnection!.getLocalDescription();
    final localSdp = localDescription?.sdp;
    if (localSdp == null || localSdp.isEmpty) {
      throw StateError(
        'WebRTC localDescription SDP is empty after setLocalDescription.',
      );
    }

    _signalingClient.send({
      'type': 'sdp-offer',
      'deviceId': _signalingClient.deviceId,
      'sdp': localSdp,
    });
  }

  Future<void> handleAnswer(String sdp) async {
    if (_peerConnection == null || sdp.isEmpty) return;
    debugPrint('[PHASE] ANSWER RECV');
    await _peerConnection!.setRemoteDescription(
      RTCSessionDescription(sdp, 'answer'),
    );
    _isRemoteDescriptionSet = true;
    for (final candidate in _pendingIceCandidates) {
      debugPrint('[PHASE] Applying queued remote ICE candidate');
      await _peerConnection!.addCandidate(candidate);
    }
    _pendingIceCandidates.clear();
  }

  Future<void> handleIceCandidate(Map<String, dynamic> candidate) async {
    if (_peerConnection == null) return;
    final rtcCandidate = RTCIceCandidate(
      candidate['candidate'],
      candidate['sdpMid'],
      candidate['sdpMLineIndex'],
    );
    if (!_isRemoteDescriptionSet) {
      debugPrint(
        '[PHASE] Queuing remote ICE candidate (SDP answer not yet set)',
      );
      _pendingIceCandidates.add(rtcCandidate);
      return;
    }
    debugPrint('[PHASE] ICE RECV');
    await _peerConnection!.addCandidate(rtcCandidate);
  }

  Future<void> switchCamera() async {
    if (_localStream == null) return;
    final videoTracks = _localStream!.getVideoTracks();
    if (videoTracks.isNotEmpty) {
      await Helper.switchCamera(videoTracks.first);
      _torchEnabled = false;
    }
  }

  Future<bool?> toggleTorch() async {
    final videoTracks = _localStream?.getVideoTracks() ?? [];
    if (videoTracks.isEmpty) return null;

    final track = videoTracks.first;
    try {
      if (!await track.hasTorch()) return null;
      final nextState = !_torchEnabled;
      await track.setTorch(nextState);
      _torchEnabled = nextState;
      return _torchEnabled;
    } catch (error) {
      debugPrint('WebRTC torch toggle error: $error');
      return null;
    }
  }

  void toggleVideoMute(bool muted) {
    if (_localStream == null) return;
    for (final track in _localStream!.getVideoTracks()) {
      track.enabled = !muted;
    }
  }

  void toggleAudioMute(bool muted) {
    if (_localStream == null) return;
    for (final track in _localStream!.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  Future<void> stop() async {
    _isRemoteDescriptionSet = false;
    _pendingIceCandidates.clear();
    _torchEnabled = false;
    onLocalStream?.call(null);
    await _localStream?.dispose();
    _localStream = null;
    await _peerConnection?.close();
    _peerConnection = null;
  }
}
