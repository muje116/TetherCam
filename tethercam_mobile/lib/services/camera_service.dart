import 'dart:io' show Platform;
import 'dart:ui' show Offset;
import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';

class CameraService {
  CameraController? _controller;
  List<CameraDescription> _cameras = [];
  bool _isInitialized = false;
  bool _torchEnabled = false;
  bool _isFrontCamera = false;
  double _currentZoom = 1.0;
  double _maxZoom = 1.0;

  bool get isInitialized => _isInitialized;
  CameraController? get controller => _controller;
  bool get torchEnabled => _torchEnabled;
  bool get isFrontCamera => _isFrontCamera;
  double get currentZoom => _currentZoom;
  double get maxZoom => _maxZoom;

  Future<void> initialize({CameraDescription? camera, ResolutionPreset preset = ResolutionPreset.veryHigh}) async {
    _cameras = await availableCameras();
    if (_cameras.isEmpty) return;
    await _initCamera(camera ?? _cameras.first, preset: preset);
  }

  Future<void> _initCamera(CameraDescription camera, {ResolutionPreset preset = ResolutionPreset.veryHigh}) async {
    _isFrontCamera = camera.lensDirection == CameraLensDirection.front;

    _controller = CameraController(
      camera,
      preset,
      enableAudio: true,
      imageFormatGroup: Platform.isAndroid ? ImageFormatGroup.yuv420 : ImageFormatGroup.bgra8888,
    );

    try {
      await _controller!.initialize();
      _maxZoom = await _controller!.getMaxZoomLevel() ?? 1.0;
      _currentZoom = 1.0;
      _torchEnabled = false;
      _isInitialized = true;
    } catch (e) {
      debugPrint('Camera initialization error: $e');
    }
  }

  Future<void> setResolutionPreset(ResolutionPreset preset) async {
    if (_controller == null) return;
    final current = _controller!.description;
    await _controller!.dispose();
    _isInitialized = false;
    await _initCamera(current, preset: preset);
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
    _isInitialized = false;
    await _initCamera(newCamera);
  }

  Future<void> toggleTorch() async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    if (_isFrontCamera) return;

    _torchEnabled = !_torchEnabled;
    try {
      await _controller!.setFlashMode(_torchEnabled ? FlashMode.torch : FlashMode.off);
    } catch (e) {
      debugPrint('Torch toggle error: $e');
      _torchEnabled = !_torchEnabled;
    }
  }

  Future<void> setZoom(double zoom) async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    final clamped = zoom.clamp(1.0, _maxZoom);
    try {
      await _controller!.setZoomLevel(clamped);
      _currentZoom = clamped;
    } catch (e) {
      debugPrint('Zoom error: $e');
    }
  }

  Future<void> setFocusPoint(double x, double y) async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    try {
      await _controller!.setFocusPoint(Offset(x, y));
      await _controller!.setExposurePoint(Offset(x, y));
    } catch (e) {
      debugPrint('Tap-to-focus error: $e');
    }
  }

  Future<void> resetFocus() async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    try {
      await _controller!.setFocusPoint(null);
      await _controller!.setExposurePoint(null);
    } catch (e) {
      debugPrint('Reset focus error: $e');
    }
  }

  Future<void> setExposure(double offset) async {
    if (_controller == null || !_controller!.value.isInitialized) return;
    try {
      await _controller!.setExposureOffset(offset);
    } catch (e) {
      debugPrint('Exposure error: $e');
    }
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
    debugPrint('toggleMicState($enabled) not supported by camera plugin; control via WebRTC track.');
  }

  Future<void> dispose() async {
    await _controller?.dispose();
    _isInitialized = false;
  }
}
