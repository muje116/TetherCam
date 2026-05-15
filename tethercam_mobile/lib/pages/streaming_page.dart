import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import '../services/camera_service.dart';
import '../services/signaling_client.dart';
import '../services/webrtc_service.dart';
import '../services/discovery_service.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

class StreamingPage extends StatefulWidget {
  final DiscoveredDesktop desktop;
  const StreamingPage({super.key, required this.desktop});

  @override
  State<StreamingPage> createState() => _StreamingPageState();
}

class _StreamingPageState extends State<StreamingPage> {
  static const bool _autoStartStream = bool.fromEnvironment('TC_AUTO_START_STREAM', defaultValue: false);
  final CameraService _cameraService = CameraService();
  final SignalingClient _signalingClient = SignalingClient();
  late WebRTCService _webRTCService;
  
  bool _isStreaming = false;
  ConnectionStatus _status = ConnectionStatus.disconnected;
  String? _lastSocketError;

  @override
  void initState() {
    super.initState();
    _webRTCService = WebRTCService(_signalingClient);
    _initialize();
    WakelockPlus.enable();
  }

  Future<void> _initialize() async {
    await _cameraService.initialize();
    if (mounted) setState(() {});
    
    _signalingClient.statusStream.listen((status) {
      if (mounted) {
        setState(() {
          _status = status;
        });
      }
    });
    _signalingClient.errorStream.listen((error) {
      if (mounted) {
        setState(() {
          _lastSocketError = error;
        });
      }
    });

    await _signalingClient.connect(widget.desktop.ip, widget.desktop.port);
    if (_autoStartStream) {
      await Future.delayed(const Duration(milliseconds: 800));
      if (mounted && _status == ConnectionStatus.connected && !_isStreaming) {
        _toggleStream();
      }
    }

    _signalingClient.messageStream.listen((message) async {
      if (message['type'] == 'command') {
        final command = message['command'] as String?;
        final payload = message['payload'];
        final payloadMap = payload is Map<String, dynamic> ? payload : <String, dynamic>{};

        switch (command) {
          case 'toggle-camera':
            await _cameraService.toggleCamera();
            if (mounted) setState(() {});
            break;
          case 'toggle-torch':
            // TODO: Implement torch in camera_service
            break;
          case 'toggle-camera-state':
            await _cameraService.toggleCameraState(payloadMap['enabled'] ?? true);
            break;
          case 'toggle-mic-state':
            await _cameraService.toggleMicState(payloadMap['enabled'] ?? true);
            break;
          case 'set-resolution':
            // TODO: Implement resolution change
            break;
          case 'sdp-answer':
            final sdp = payload is String ? payload : (payloadMap['sdp'] as String? ?? '');
            if (sdp.isNotEmpty) {
              await _webRTCService.handleAnswer(sdp);
            }
            break;
          case 'ice-candidate':
            if (payloadMap.isNotEmpty) {
              await _webRTCService.handleIceCandidate(payloadMap);
            }
            break;
        }
      }
    });
  }

  void _toggleStream() async {
    if (_status != ConnectionStatus.connected) return;
    if (_isStreaming) {
      await _webRTCService.stop();
    } else {
      await _webRTCService.startStreaming();
    }
    setState(() {
      _isStreaming = !_isStreaming;
    });
  }

  @override
  void dispose() {
    _cameraService.dispose();
    _signalingClient.disconnect();
    _webRTCService.stop();
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_cameraService.isInitialized) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      body: Stack(
        children: [
          // Camera Preview
          Positioned.fill(
            child: CameraPreview(_cameraService.controller!),
          ),

          // HUD Overlay
          Positioned(
            top: 40,
            left: 20,
            right: 20,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.circle,
                            size: 12,
                            color: _status == ConnectionStatus.connected ? Colors.green : Colors.red,
                          ),
                          const SizedBox(width: 8),
                          Text('Status: ${_status.name}'),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
                if (_lastSocketError != null && _lastSocketError!.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.red.withOpacity(0.7),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _lastSocketError!,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
              ],
            ),
          ),

          // Controls
          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _ControlButton(
                  icon: Icons.flip_camera_android,
                  onPressed: () async {
                    await _cameraService.toggleCamera();
                    setState(() {});
                  },
                ),
                GestureDetector(
                  onTap: _toggleStream,
                  child: Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: _isStreaming ? Colors.red : Colors.white,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 4),
                    ),
                    child: Icon(
                      _isStreaming ? Icons.stop : Icons.videocam,
                      size: 40,
                      color: _isStreaming ? Colors.white : Colors.black,
                    ),
                  ),
                ),
                _ControlButton(
                  icon: Icons.flash_on,
                  onPressed: () {
                    // TODO: Implement torch
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onPressed;

  const _ControlButton({required this.icon, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.black54,
        shape: BoxShape.circle,
      ),
      child: IconButton(
        icon: Icon(icon, color: Colors.white),
        onPressed: onPressed,
      ),
    );
  }
}
