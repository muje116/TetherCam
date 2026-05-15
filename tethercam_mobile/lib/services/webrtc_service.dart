import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'signaling_client.dart';

class WebRTCService {
  RTCPeerConnection? _peerConnection;
  MediaStream? _localStream;
  final SignalingClient _signalingClient;

  WebRTCService(this._signalingClient);

  final Map<String, dynamic> _iceServers = {
    'iceServers': [
      {'url': 'stun:stun.l.google.com:19302'},
    ]
  };

  final Map<String, dynamic> _config = {
    'mandatory': {
      'OfferToReceiveAudio': false,
      'OfferToReceiveVideo': false,
    },
    'optional': [],
  };

  Future<void> startStreaming() async {
    print('[PHASE] WEBRTC START');
    _peerConnection = await createPeerConnection(_iceServers, _config);

    // Get local camera/mic stream
    final Map<String, dynamic> mediaConstraints = {
      'audio': true,
      'video': {
        'mandatory': {
          'minWidth': '1280',
          'minHeight': '720',
          'minFrameRate': '30',
        },
        'facingMode': 'user',
        'optional': [],
      }
    };

    _localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    
    // Add tracks to peer connection
    _localStream!.getTracks().forEach((track) {
      _peerConnection!.addTrack(track, _localStream!);
    });

    // Handle ICE candidates
    _peerConnection!.onIceCandidate = (candidate) {
      if (candidate.candidate == null) return;
      print('[PHASE] ICE SEND');
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

    // Create and send offer
    RTCSessionDescription offer = await _peerConnection!.createOffer(_config);
    await _peerConnection!.setLocalDescription(offer);
    print('[PHASE] OFFER SEND');

    _signalingClient.send({
      'type': 'sdp-offer',
      'deviceId': _signalingClient.deviceId,
      'sdp': offer.sdp,
    });
  }

  Future<void> handleAnswer(String sdp) async {
    if (_peerConnection == null || sdp.isEmpty) return;
    print('[PHASE] ANSWER RECV');
    await _peerConnection!.setRemoteDescription(
      RTCSessionDescription(sdp, 'answer'),
    );
  }

  Future<void> handleIceCandidate(Map<String, dynamic> candidate) async {
    if (_peerConnection == null) return;
    print('[PHASE] ICE RECV');
    await _peerConnection!.addCandidate(
      RTCIceCandidate(
        candidate['candidate'],
        candidate['sdpMid'],
        candidate['sdpMLineIndex'],
      ),
    );
  }

  Future<void> stop() async {
    await _localStream?.dispose();
    await _peerConnection?.close();
  }
}
