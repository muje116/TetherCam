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

  StreamConfig get config => _config;

  WebRTCService(this._signalingClient);

  void updateConfig(StreamConfig config) {
    _config = config;
  }

  Map<String, dynamic> get _iceServers => {
    'iceServers': [
      {'url': 'stun:stun.l.google.com:19302'},
    ]
  };

  Map<String, dynamic> get _configConstraints => {
    'mandatory': {
      'OfferToReceiveAudio': false,
      'OfferToReceiveVideo': false,
    },
    'optional': [],
  };

  Future<void> startStreaming() async {
    await stop();

    debugPrint('[PHASE] WEBRTC START');
    _peerConnection = await createPeerConnection(_iceServers, _configConstraints);

    final Map<String, dynamic> mediaConstraints = {
      'audio': true,
      'video': {
        'mandatory': {
          'minWidth': _config.width.toString(),
          'minHeight': _config.height.toString(),
          'maxWidth': _config.width.toString(),
          'maxHeight': _config.height.toString(),
          'minFrameRate': _config.fps.toString(),
          'maxFrameRate': _config.fps.toString(),
        },
        'facingMode': 'user',
        'optional': [],
      }
    };

    _localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);

    _localStream!.getTracks().forEach((track) {
      _peerConnection!.addTrack(track, _localStream!);
    });

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
        }
      });
    };

    _peerConnection!.onIceConnectionState = (state) {
      debugPrint('[ICE] Connection state: $state');
      if (state == RTCIceConnectionState.RTCIceConnectionStateDisconnected ||
          state == RTCIceConnectionState.RTCIceConnectionStateFailed) {
        _signalingClient.onConnectionLost();
      }
    };

    RTCSessionDescription offer = await _peerConnection!.createOffer(_configConstraints);

    String sdp = offer.sdp!;

    if (_config.codec == VideoCodec.h264) {
      sdp = _preferCodec(sdp, 'H264');
    } else {
      sdp = _preferCodec(sdp, 'H265');
    }

    sdp = _setBitrate(sdp, _config.bitrate);

    await _peerConnection!.setLocalDescription(
      RTCSessionDescription(sdp, 'offer'),
    );
    debugPrint('[PHASE] OFFER SEND');

    _signalingClient.send({
      'type': 'sdp-offer',
      'deviceId': _signalingClient.deviceId,
      'sdp': sdp,
    });
  }

  String _preferCodec(String sdp, String codec) {
    if (codec == 'H264') {
      if (sdp.contains('H264')) {
        final lines = sdp.split('\n');
        final h264Payloads = <String>[];
        for (final line in lines) {
          if (line.startsWith('a=rtpmap:') && line.contains('H264')) {
            h264Payloads.add(line.split(':')[1].split(' ')[0]);
          }
        }
        if (h264Payloads.isNotEmpty) {
          final result = <String>[];
          for (final line in lines) {
            if (line.startsWith('m=video')) {
              result.add('${line.split(' ').take(3).join(' ')} ${h264Payloads.join(' ')}');
            } else {
              result.add(line);
            }
          }
          return result.join('\n');
        }
      }
    }
    return sdp;
  }

  String _setBitrate(String sdp, int bitrateKbps) {
    final lines = sdp.split('\n');
    final result = <String>[];
    bool videoSection = false;
    for (final line in lines) {
      if (line.startsWith('m=video')) {
        videoSection = true;
      } else if (line.startsWith('m=audio')) {
        videoSection = false;
      }
      if (videoSection && line.startsWith('a=mid')) {
        result.add(line);
        result.add('b=AS:$bitrateKbps');
        continue;
      }
      result.add(line);
    }
    return result.join('\n');
  }

  Future<void> handleAnswer(String sdp) async {
    if (_peerConnection == null || sdp.isEmpty) return;
    debugPrint('[PHASE] ANSWER RECV');
    await _peerConnection!.setRemoteDescription(
      RTCSessionDescription(sdp, 'answer'),
    );
  }

  Future<void> handleIceCandidate(Map<String, dynamic> candidate) async {
    if (_peerConnection == null) return;
    debugPrint('[PHASE] ICE RECV');
    await _peerConnection!.addCandidate(
      RTCIceCandidate(
        candidate['candidate'],
        candidate['sdpMid'],
        candidate['sdpMLineIndex'],
      ),
    );
  }

  void toggleAudioMute(bool muted) {
    if (_localStream == null) return;
    for (final track in _localStream!.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  Future<void> stop() async {
    await _localStream?.dispose();
    _localStream = null;
    await _peerConnection?.close();
    _peerConnection = null;
  }
}
