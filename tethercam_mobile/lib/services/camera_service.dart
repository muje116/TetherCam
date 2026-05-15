import 'dart:io' show Platform;

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';

class CameraService {
  CameraController? _controller;
  List<CameraDescription> _cameras = [];
  bool _isInitialized = false;

  bool get isInitialized => _isInitialized;
  CameraController? get controller => _controller;

  Future<void> initialize() async {
    _cameras = await availableCameras();
    if (_cameras.isEmpty) return;

    await _initCamera(_cameras.first);
  }

  Future<void> _initCamera(CameraDescription camera) async {
    _controller = CameraController(
      camera,
      ResolutionPreset.high,
      enableAudio: true,
      imageFormatGroup: Platform.isAndroid ? ImageFormatGroup.yuv420 : ImageFormatGroup.bgra8888,
    );

    try {
      await _controller!.initialize();
      _isInitialized = true;
    } catch (e) {
      debugPrint('Camera initialization error: $e');
    }
  }

  Future<void> toggleCamera() async {
    if (_cameras.length < 2) return;
    
    final lensDirection = _controller!.description.lensDirection;
    CameraDescription newCamera;
    
    if (lensDirection == CameraLensDirection.front) {
      newCamera = _cameras.firstWhere((c) => c.lensDirection == CameraLensDirection.back);
    } else {
      newCamera = _cameras.firstWhere((c) => c.lensDirection == CameraLensDirection.front);
    }

    await _controller!.dispose();
    await _initCamera(newCamera);
  }

  Future<void> toggleCameraState(bool enabled) async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    if (enabled) {
      await _controller!.resumePreview();
    } else {
      await _controller!.pausePreview();
    }
  }

  Future<void> toggleMicState(bool enabled) async {
    // The camera plugin does not expose runtime mic mute/unmute controls for preview.
    // Keep this as a no-op and route mic control through the WebRTC audio track instead.
    debugPrint('toggleMicState($enabled) not supported by camera plugin; control via WebRTC track.');
  }

  Future<void> dispose() async {
    await _controller?.dispose();
    _isInitialized = false;
  }
}
