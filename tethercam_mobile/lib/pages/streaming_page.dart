import 'dart:async';

import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../services/camera_service.dart';
import '../services/signaling_client.dart';
import '../services/webrtc_service.dart';
import '../services/discovery_service.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import '../services/notification_service.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:permission_handler/permission_handler.dart';

class StreamingPage extends StatefulWidget {
  final DiscoveredDesktop desktop;
  const StreamingPage({super.key, required this.desktop});

  @override
  State<StreamingPage> createState() => _StreamingPageState();
}

class _StreamingPageState extends State<StreamingPage> {
  static const bool _autoStartStream = bool.fromEnvironment(
    'TC_AUTO_START_STREAM',
    defaultValue: false,
  );
  final CameraService _cameraService = CameraService();
  final SignalingClient _signalingClient = SignalingClient();
  late WebRTCService _webRTCService;
  final RTCVideoRenderer _localRenderer = RTCVideoRenderer();

  bool _isStreaming = false;
  bool _isStartingStream = false;
  bool _isInitializingCamera = true;
  ConnectionStatus _status = ConnectionStatus.disconnected;
  String? _lastSocketError;
  bool _showQuickSettings = false;
  bool _isMuted = false;
  bool _useFrontCamera = false;
  double _zoomSliderValue = 1.0;
  double _exposureOffset = 0.0;
  int? _batteryLevel;
  final Battery _battery = Battery();
  StreamSubscription<BatteryState>? _batterySubscription;
  StreamSubscription<ConnectionStatus>? _statusSubscription;
  StreamSubscription<String>? _errorSubscription;
  StreamSubscription<Map<String, dynamic>>? _messageSubscription;
  int _selectedResolutionIndex = 2;
  int _selectedFpsIndex = 1;
  int _selectedBitrateIndex = 2;
  String? _latencyMs;
  String? _streamFps;

  static const _resolutions = ['480p', '720p', '1080p', '4K'];
  static const _resolutionValues = [
    ResolutionPreset.medium,
    ResolutionPreset.high,
    ResolutionPreset.veryHigh,
    ResolutionPreset.max,
  ];
  static const _resSizes = [
    StreamConfig(width: 640, height: 480),
    StreamConfig(width: 1280, height: 720),
    StreamConfig(width: 1920, height: 1080),
    StreamConfig(width: 3840, height: 2160),
  ];
  static const _fpsOptions = [15, 24, 30, 60];
  static const _bitrateOptions = [1000, 2500, 4000, 8000, 16000];
  static const _bitrateLabels = [
    '1 Mbps',
    '2.5 Mbps',
    '4 Mbps',
    '8 Mbps',
    '16 Mbps',
  ];
  @override
  void initState() {
    super.initState();
    _webRTCService = WebRTCService(_signalingClient);
    _webRTCService.onLocalStream = (stream) {
      _localRenderer.srcObject = stream;
      if (mounted) setState(() {});
    };
    _initialize();
    _initBattery();
    WakelockPlus.enable();
  }

  Future<void> _initBattery() async {
    try {
      final level = await _battery.batteryLevel;
      if (mounted) setState(() => _batteryLevel = level);
      _batterySubscription = _battery.onBatteryStateChanged.listen((_) async {
        final newLevel = await _battery.batteryLevel;
        if (mounted) setState(() => _batteryLevel = newLevel);
      });
    } catch (_) {
      // Battery information is optional; streaming should still work.
    }
  }

  Future<void> _initialize() async {
    var permissionsReady = false;
    try {
      await _localRenderer.initialize();
      permissionsReady = await _ensureMediaPermissions();
      if (!permissionsReady) {
        throw StateError(
          'Camera and microphone permissions are required to stream.',
        );
      }
      await _cameraService.initialize();
    } catch (error) {
      if (mounted) {
        setState(
          () => _lastSocketError = error.toString().replaceFirst(
            'Bad state: ',
            '',
          ),
        );
      }
    }
    if (mounted) {
      setState(() => _isInitializingCamera = false);
    }
    if (!permissionsReady || !mounted) return;

    _statusSubscription = _signalingClient.statusStream.listen((status) {
      if (mounted) {
        setState(() {
          _status = status;
        });
      }
    });
    _errorSubscription = _signalingClient.errorStream.listen((error) {
      if (mounted) {
        setState(() {
          _lastSocketError = error;
        });
      }
    });

    _messageSubscription = _signalingClient.messageStream.listen((
      message,
    ) async {
      if (message['type'] == 'command') {
        final command = message['command'] as String?;
        final payload = message['payload'];
        final payloadMap = payload is Map<String, dynamic>
            ? payload
            : <String, dynamic>{};

        switch (command) {
          case 'toggle-camera':
            if (_isStreaming) {
              await _webRTCService.switchCamera();
              _useFrontCamera = !_useFrontCamera;
            } else {
              await _cameraService.toggleCamera();
              _useFrontCamera = _cameraService.isFrontCamera;
            }
            if (mounted) setState(() {});
            break;
          case 'toggle-torch':
            if (_isStreaming) {
              final torchState = await _webRTCService.toggleTorch();
              if (torchState != null && mounted) setState(() {});
            } else {
              await _cameraService.toggleTorch();
              if (mounted) setState(() {});
            }
            break;
          case 'toggle-camera-state':
            final enabled = payloadMap['enabled'] is bool
                ? payloadMap['enabled'] as bool
                : true;
            if (_isStreaming) {
              _webRTCService.toggleVideoMute(!enabled);
            } else {
              await _cameraService.toggleCameraState(enabled);
            }
            break;
          case 'toggle-mic-state':
            final enabled = payloadMap['enabled'] is bool
                ? payloadMap['enabled'] as bool
                : true;
            if (_isStreaming) {
              _webRTCService.toggleAudioMute(!enabled);
            } else {
              await _cameraService.toggleMicState(enabled);
            }
            break;
          case 'set-resolution':
            final resStr = payloadMap['resolution'] as String?;
            if (resStr != null) {
              final idx = _resolutions.indexOf(resStr);
              if (idx >= 0) {
                await _selectResolution(idx);
              }
            }
            break;
          case 'set-fps':
            final fps = payloadMap['fps'] as int?;
            if (fps != null) {
              final idx = _fpsOptions.indexOf(fps);
              if (idx >= 0) {
                await _selectFps(idx);
              }
            }
            break;
          case 'set-bitrate':
            final bitrate = payloadMap['bitrate'] as int?;
            if (bitrate != null && _bitrateOptions.contains(bitrate)) {
              await _selectBitrate(_bitrateOptions.indexOf(bitrate));
            }
            break;
          case 'sdp-answer':
            final sdp = payload is String
                ? payload
                : (payloadMap['sdp'] as String? ?? '');
            if (sdp.isNotEmpty) {
              await _webRTCService.handleAnswer(sdp);
            }
            break;
          case 'ice-candidate':
            if (payloadMap.isNotEmpty) {
              await _webRTCService.handleIceCandidate(payloadMap);
            }
            break;
          case 'stream-stats':
            if (mounted) {
              setState(() {
                _latencyMs = '${payloadMap['latencyMs'] ?? '--'} ms';
                _streamFps = '${payloadMap['fps'] ?? '--'}';
              });
            }
            break;
          case 'request-stream':
            // Desktop is requesting we start or re-send the stream
            if (_status != ConnectionStatus.connected || _isStartingStream) {
              break;
            }
            if (_isStreaming) {
              await _restartStreaming();
            } else {
              await Future.delayed(const Duration(milliseconds: 200));
              if (mounted && !_isStreaming && !_isStartingStream) {
                unawaited(_toggleStream());
              }
            }
            break;
        }
      }
    });

    await _signalingClient.connect(widget.desktop.ip, widget.desktop.port);
    if (_autoStartStream) {
      await Future.delayed(const Duration(milliseconds: 800));
      if (mounted && _status == ConnectionStatus.connected && !_isStreaming) {
        unawaited(_toggleStream());
      }
    }
  }

  Future<bool> _ensureMediaPermissions() async {
    final statuses = await [Permission.camera, Permission.microphone].request();

    return statuses.values.every((status) => status.isGranted);
  }

  Map<String, dynamic> _streamSettings() => {
    'resolution': _resolutions[_selectedResolutionIndex],
    'fps': _fpsOptions[_selectedFpsIndex],
    'bitrate': _bitrateOptions[_selectedBitrateIndex],
    'codec': 'H.264',
  };

  void _updateStreamConfig() {
    final res = _resSizes[_selectedResolutionIndex];
    final config = StreamConfig(
      width: res.width,
      height: res.height,
      fps: _fpsOptions[_selectedFpsIndex],
      bitrate: _bitrateOptions[_selectedBitrateIndex],
    );
    _webRTCService.updateConfig(config);
    _signalingClient.updateStreamSettings(_streamSettings());
  }

  void _sendDeviceStatus() {
    _signalingClient.send({
      'type': 'device-status',
      'deviceId': _signalingClient.deviceId,
      'streamSettings': _streamSettings(),
    });
  }

  Future<void> _selectResolution(int index) async {
    if (index < 0 || index >= _resolutions.length) return;
    if (mounted) setState(() => _selectedResolutionIndex = index);
    _updateStreamConfig();
    if (!_isStreaming && _cameraService.isInitialized) {
      await _cameraService.setResolutionPreset(_resolutionValues[index]);
      if (mounted) setState(() {});
    } else if (_isStreaming) {
      await _restartStreaming();
    }
  }

  Future<void> _selectFps(int index) async {
    if (index < 0 || index >= _fpsOptions.length) return;
    if (mounted) setState(() => _selectedFpsIndex = index);
    _updateStreamConfig();
    if (_isStreaming) await _restartStreaming();
  }

  Future<void> _selectBitrate(int index) async {
    if (index < 0 || index >= _bitrateOptions.length) return;
    if (mounted) setState(() => _selectedBitrateIndex = index);
    _updateStreamConfig();
    if (_isStreaming) await _restartStreaming();
  }

  Future<void> _restartStreaming() async {
    if (!_isStreaming || _isStartingStream) return;
    if (mounted) setState(() => _isStartingStream = true);
    try {
      _updateStreamConfig();
      await _webRTCService
          .startStreaming(useFrontCamera: _useFrontCamera)
          .timeout(const Duration(seconds: 10));
      _sendDeviceStatus();
      if (mounted) {
        setState(() {
          _lastSocketError = null;
          _isStartingStream = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _lastSocketError = 'Stream restart failed: $error';
          _isStartingStream = false;
          _isStreaming = false;
        });
      }
      try {
        await _cameraService.initialize(
          preset: _resolutionValues[_selectedResolutionIndex],
        );
      } catch (_) {}
    }
  }

  Future<void> _toggleStream() async {
    if (_status != ConnectionStatus.connected || _isStartingStream) return;
    final wasStreaming = _isStreaming;
    if (mounted) setState(() => _isStartingStream = true);

    try {
      if (wasStreaming) {
        await _webRTCService.stop();
        await NotificationService.cancelStreamingNotification();
        await _cameraService.initialize(
          preset: _resolutionValues[_selectedResolutionIndex],
        );
        if (mounted) setState(() => _isStreaming = false);
      } else {
        final permissionsReady = await _ensureMediaPermissions();
        if (!permissionsReady) {
          if (mounted) {
            setState(() {
              _lastSocketError =
                  'Camera and microphone permissions are required to stream.';
              _isStartingStream = false;
            });
          }
          return;
        }

        final bool isFront = _cameraService.isFrontCamera;
        _useFrontCamera = isFront;
        _updateStreamConfig();
        await _cameraService.dispose();
        if (mounted) setState(() {});
        await Future.delayed(const Duration(milliseconds: 300));
        await _webRTCService
            .startStreaming(useFrontCamera: isFront)
            .timeout(const Duration(seconds: 10));
        await NotificationService.showStreamingNotification();
        _sendDeviceStatus();
        if (mounted) setState(() => _isStreaming = true);
      }
      if (mounted) {
        setState(() {
          _lastSocketError = null;
          _isStartingStream = false;
        });
      }
    } catch (error) {
      if (!wasStreaming) {
        try {
          await _cameraService.initialize(
            preset: _resolutionValues[_selectedResolutionIndex],
          );
        } catch (_) {}
      }
      if (mounted) {
        setState(() {
          _lastSocketError = 'Streaming failed: $error';
          _isStartingStream = false;
          _isStreaming = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _webRTCService.onLocalStream = null;
    _batterySubscription?.cancel();
    _statusSubscription?.cancel();
    _errorSubscription?.cancel();
    _messageSubscription?.cancel();
    unawaited(_cameraService.dispose());
    _signalingClient.dispose();
    unawaited(_webRTCService.stop());
    unawaited(_localRenderer.dispose());
    unawaited(WakelockPlus.disable());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_isInitializingCamera && !_isStreaming && !_isStartingStream) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      body: Stack(
        children: [
          GestureDetector(
            onTapUp: (details) {
              if (!_cameraService.isInitialized) return;
              final size = MediaQuery.of(context).size;
              final x = details.localPosition.dx / size.width;
              final y = details.localPosition.dy / size.height;
              _cameraService.setFocusPoint(x, y);
            },
            onDoubleTap: () {
              if (!_cameraService.isInitialized) return;
              _cameraService.resetFocus();
            },
            child: _isStreaming && _localRenderer.srcObject != null
                ? RTCVideoView(
                    _localRenderer,
                    mirror: _useFrontCamera,
                    objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                  )
                : _cameraService.isInitialized
                ? CameraPreview(_cameraService.controller!)
                : Container(
                    color: Colors.black,
                    alignment: Alignment.center,
                    child: Text(
                      _isStartingStream
                          ? 'Starting stream...'
                          : 'Camera preview unavailable',
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ),
          ),

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
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.circle,
                            size: 12,
                            color: _status == ConnectionStatus.connected
                                ? Colors.green
                                : Colors.red,
                          ),
                          const SizedBox(width: 8),
                          Text('Status: ${_status.name}'),
                        ],
                      ),
                    ),
                    Row(
                      children: [
                        if (_batteryLevel != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            margin: const EdgeInsets.only(right: 8),
                            decoration: BoxDecoration(
                              color: Colors.black54,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  Icons.battery_full,
                                  size: 14,
                                  color: _batteryLevel! > 20
                                      ? Colors.green
                                      : Colors.red,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  '$_batteryLevel%',
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                        if (_isStreaming && _streamFps != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.black54,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '$_streamFps FPS',
                              style: const TextStyle(fontSize: 12),
                            ),
                          ),
                        const SizedBox(width: 8),
                        if (_isStreaming && _latencyMs != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.black54,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '$_latencyMs',
                              style: const TextStyle(fontSize: 12),
                            ),
                          ),
                        const SizedBox(width: 8),
                        IconButton(
                          icon: const Icon(Icons.close, color: Colors.white),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                    ),
                  ],
                ),
                if (_lastSocketError != null && _lastSocketError!.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.red.withValues(alpha: 0.7),
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

          if (_showQuickSettings) _buildQuickSettingsPanel(),

          if (_cameraService.maxZoom > 1.0)
            Positioned(
              left: 20,
              top: 0,
              bottom: 0,
              child: RotatedBox(
                quarterTurns: -1,
                child: SizedBox(
                  width: 200,
                  child: Slider(
                    value: _zoomSliderValue,
                    min: 1.0,
                    max: _cameraService.maxZoom,
                    divisions: ((_cameraService.maxZoom - 1.0) * 10)
                        .round()
                        .clamp(1, 100),
                    label: '${_zoomSliderValue.toStringAsFixed(1)}x',
                    onChanged: (v) {
                      setState(() => _zoomSliderValue = v);
                      _cameraService.setZoom(v);
                    },
                  ),
                ),
              ),
            ),

          if (_cameraService.minExposureOffset !=
              _cameraService.maxExposureOffset)
            Positioned(
              right: 20,
              top: 0,
              bottom: 0,
              child: RotatedBox(
                quarterTurns: -1,
                child: SizedBox(
                  width: 200,
                  child: Slider(
                    value: _exposureOffset,
                    min: _cameraService.minExposureOffset,
                    max: _cameraService.maxExposureOffset,
                    divisions: 20,
                    label: 'EV ${_exposureOffset.toStringAsFixed(1)}',
                    onChanged: (v) {
                      setState(() => _exposureOffset = v);
                      _cameraService.setExposure(v);
                    },
                  ),
                ),
              ),
            ),

          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _ControlButton(
                      icon: Icons.tune,
                      onPressed: () => setState(
                        () => _showQuickSettings = !_showQuickSettings,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _ControlButton(
                      icon: Icons.flip_camera_android,
                      onPressed: () async {
                        if (_isStreaming) {
                          await _webRTCService.switchCamera();
                          _useFrontCamera = !_useFrontCamera;
                        } else {
                          await _cameraService.toggleCamera();
                          _useFrontCamera = _cameraService.isFrontCamera;
                        }
                        if (mounted) setState(() {});
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
                      icon:
                          _cameraService.torchEnabled ||
                              _webRTCService.torchEnabled
                          ? Icons.flash_on
                          : Icons.flash_off,
                      onPressed: () async {
                        if (_isStreaming) {
                          await _webRTCService.toggleTorch();
                        } else {
                          await _cameraService.toggleTorch();
                        }
                        if (mounted) setState(() {});
                      },
                    ),
                    _ControlButton(
                      icon: _isMuted ? Icons.mic_off : Icons.mic,
                      onPressed: () {
                        setState(() => _isMuted = !_isMuted);
                        _webRTCService.toggleAudioMute(_isMuted);
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickSettingsPanel() {
    return Positioned(
      bottom: 140,
      left: 20,
      right: 20,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.black87,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white24),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Quick Settings',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 20),
                  onPressed: () => setState(() => _showQuickSettings = false),
                ),
              ],
            ),
            const SizedBox(height: 8),
            _buildSettingRow(
              'Resolution',
              _resolutions,
              _selectedResolutionIndex,
              (i) {
                unawaited(_selectResolution(i));
              },
            ),
            _buildSettingRow(
              'FPS',
              _fpsOptions.map((f) => '$f').toList(),
              _selectedFpsIndex,
              (i) {
                unawaited(_selectFps(i));
              },
            ),
            _buildSettingRow('Bitrate', _bitrateLabels, _selectedBitrateIndex, (
              i,
            ) {
              unawaited(_selectBitrate(i));
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildSettingRow(
    String label,
    List<String> options,
    int selected,
    ValueChanged<int> onChanged,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text('$label: ', style: const TextStyle(fontSize: 13)),
          ),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: List.generate(options.length, (i) {
                  final isSelected = i == selected;
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: GestureDetector(
                      onTap: () => onChanged(i),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: isSelected ? Colors.indigo : Colors.white12,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: isSelected
                                ? Colors.indigoAccent
                                : Colors.white24,
                          ),
                        ),
                        child: Text(
                          options[i],
                          style: TextStyle(
                            fontSize: 12,
                            color: isSelected ? Colors.white : Colors.white70,
                          ),
                        ),
                      ),
                    ),
                  );
                }),
              ),
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
