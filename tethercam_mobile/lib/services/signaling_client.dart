import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

enum ConnectionStatus { disconnected, connecting, connected, error }

class SignalingClient {
  WebSocketChannel? _channel;
  final StreamController<ConnectionStatus> _statusController =
      StreamController<ConnectionStatus>.broadcast();
  final StreamController<Map<String, dynamic>> _messageController =
      StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<String> _errorController =
      StreamController<String>.broadcast();
  String? _deviceId;
  String _connectionType = 'wifi';
  Timer? _connectTimeoutTimer;
  Timer? _statusReportTimer;
  Timer? _reconnectTimer;
  String? _lastIp;
  int? _lastPort;
  int _reconnectAttempt = 0;
  static const int _maxReconnectDelay = 30;
  bool _intentionalDisconnect = false;
  bool _disposed = false;
  int _connectionGeneration = 0;
  bool _activeConnectionEnded = false;
  Map<String, dynamic> _streamSettings = {
    'resolution': '720p',
    'fps': 30,
    'bitrate': 4000,
    'codec': 'H.264',
  };

  Stream<ConnectionStatus> get statusStream => _statusController.stream;
  Stream<Map<String, dynamic>> get messageStream => _messageController.stream;
  Stream<String> get errorStream => _errorController.stream;
  String? get deviceId => _deviceId;

  Future<void> connect(String ip, int port) async {
    _disposed = false;
    _lastIp = ip;
    _lastPort = port;
    _intentionalDisconnect = false;
    _reconnectAttempt = 0;
    _reconnectTimer?.cancel();

    // Invalidate callbacks from a previous socket before closing it.
    _connectionGeneration++;
    final previousChannel = _channel;
    _channel = null;
    _deviceId = null;
    await previousChannel?.sink.close();
    await _doConnect(ip, port);
  }

  Future<void> _doConnect(String ip, int port) async {
    if (_disposed || _intentionalDisconnect) return;

    final generation = ++_connectionGeneration;
    _activeConnectionEnded = false;
    final previousChannel = _channel;
    _channel = null;
    await previousChannel?.sink.close();

    final url = 'ws://$ip:$port';
    _connectionType = _resolveConnectionType(ip);
    debugPrint('[PHASE] CONNECT -> $url');
    _statusController.add(ConnectionStatus.connecting);

    try {
      final channel = WebSocketChannel.connect(Uri.parse(url));
      _channel = channel;
      _connectTimeoutTimer?.cancel();
      _connectTimeoutTimer = Timer(const Duration(seconds: 8), () {
        if (generation == _connectionGeneration && _deviceId == null) {
          _handleConnectionEnded(
            generation,
            'Connection timed out after 8s to $url',
          );
        }
      });

      channel.stream.listen(
        (data) => _handleMessage(generation, data),
        onError: (error) =>
            _handleConnectionEnded(generation, 'WebSocket error: $error'),
        onDone: () => _handleConnectionEnded(generation, null),
      );

      await _register(channel, generation);
    } catch (error) {
      _handleConnectionEnded(generation, 'Connect failed: $error');
    }
  }

  void _handleMessage(int generation, dynamic data) {
    if (_disposed || generation != _connectionGeneration || data is! String) {
      return;
    }

    try {
      final decoded = jsonDecode(data);
      if (decoded is! Map) {
        throw const FormatException('Signaling message is not an object');
      }
      final message = Map<String, dynamic>.from(decoded);
      _messageController.add(message);
      if (message['type'] == 'registered') {
        _deviceId = message['deviceId'] as String?;
        _connectTimeoutTimer?.cancel();
        _reconnectAttempt = 0;
        debugPrint('[PHASE] REGISTER OK -> deviceId=$_deviceId');
        _statusController.add(ConnectionStatus.connected);
        _startStatusReporting();
      }
    } catch (error) {
      _errorController.add('Invalid signaling message: $error');
    }
  }

  void _handleConnectionEnded(int generation, String? error) {
    if (_disposed ||
        generation != _connectionGeneration ||
        _activeConnectionEnded) {
      return;
    }
    _activeConnectionEnded = true;
    _connectTimeoutTimer?.cancel();
    _statusReportTimer?.cancel();
    final channel = _channel;
    _channel = null;
    _deviceId = null;
    unawaited(channel?.sink.close() ?? Future<void>.value());

    if (error != null) {
      _errorController.add(error);
      _statusController.add(ConnectionStatus.error);
    } else {
      _statusController.add(ConnectionStatus.disconnected);
    }
    if (!_intentionalDisconnect) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed ||
        _intentionalDisconnect ||
        _lastIp == null ||
        _lastPort == null) {
      return;
    }
    _reconnectTimer?.cancel();

    final delay = min(pow(2, _reconnectAttempt).toInt(), _maxReconnectDelay);
    _reconnectAttempt++;
    debugPrint(
      '[Reconnect] Scheduling reconnect in ${delay}s (attempt $_reconnectAttempt)',
    );
    _reconnectTimer = Timer(Duration(seconds: delay), () {
      _reconnectTimer = null;
      if (!_intentionalDisconnect &&
          !_disposed &&
          _lastIp != null &&
          _lastPort != null) {
        unawaited(_doConnect(_lastIp!, _lastPort!));
      }
    });
  }

  void onConnectionLost() {
    if (_deviceId != null && !_intentionalDisconnect) _scheduleReconnect();
  }

  void updateStreamSettings(Map<String, dynamic> settings) {
    _streamSettings = Map<String, dynamic>.from(settings);
    if (_deviceId != null) _sendDeviceStatus();
  }

  void _startStatusReporting() {
    _statusReportTimer?.cancel();
    _statusReportTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_deviceId == null) return;
      final batteryInfo = await _getBatteryInfo();
      final temperature = await _getTemperatureInfo();
      _sendDeviceStatus(battery: batteryInfo.level, temperature: temperature);
    });
  }

  void _sendDeviceStatus({int? battery, int? temperature}) {
    send({
      'type': 'device-status',
      'deviceId': _deviceId,
      ...?battery == null ? null : {'battery': battery},
      ...?temperature == null ? null : {'temperature': temperature},
      'streamSettings': _streamSettings,
    });
  }

  Future<({int level})> _getBatteryInfo() async {
    int level = 100;
    if (Platform.isAndroid) {
      try {
        final result = await Process.run('dumpsys', ['battery']);
        final stdout = result.stdout as String;
        final levelMatch = RegExp(r'level:\s*(\d+)').firstMatch(stdout);
        if (levelMatch != null) {
          level = int.parse(levelMatch.group(1)!);
        }
      } catch (_) {}
    }
    return (level: level);
  }

  Future<int> _getTemperatureInfo() async {
    int temperature = 25;
    if (Platform.isAndroid) {
      try {
        final result = await Process.run('dumpsys', ['battery']);
        final stdout = result.stdout as String;
        final temperatureMatch = RegExp(
          r'temperature:\s*(\d+)',
        ).firstMatch(stdout);
        if (temperatureMatch != null) {
          temperature = (int.parse(temperatureMatch.group(1)!) / 10).round();
        }
      } catch (_) {}
    }
    return temperature;
  }

  Future<void> _register(WebSocketChannel channel, int generation) async {
    final deviceInfo = DeviceInfoPlugin();
    String name = 'Unknown';
    String model = 'Unknown';
    String platform = Platform.isAndroid ? 'android' : 'ios';

    if (Platform.isAndroid) {
      final androidInfo = await deviceInfo.androidInfo;
      name = androidInfo.host.isNotEmpty ? androidInfo.host : androidInfo.model;
      model = androidInfo.model;
    } else if (Platform.isIOS) {
      final iosInfo = await deviceInfo.iosInfo;
      name = iosInfo.name;
      model = iosInfo.model;
    }

    if (generation != _connectionGeneration || _disposed) return;
    debugPrint(
      '[PHASE] REGISTER SEND -> name=$name model=$model platform=$platform',
    );
    channel.sink.add(
      jsonEncode({
        'type': 'register',
        'name': name,
        'model': model,
        'platform': platform,
        'connectionType': _connectionType,
      }),
    );
  }

  String _resolveConnectionType(String ip) {
    final host = ip.toLowerCase();
    if (host == '127.0.0.1' || host == 'localhost' || host == '::1') {
      return 'usb';
    }
    return 'wifi';
  }

  bool send(Map<String, dynamic> message) {
    final channel = _channel;
    if (channel == null || _disposed) return false;
    try {
      debugPrint('[SIGNAL SEND] ${message['type']}');
      channel.sink.add(jsonEncode(message));
      return true;
    } catch (error) {
      debugPrint('[SignalingClient] Send failed: $error');
      return false;
    }
  }

  void disconnect() {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _connectTimeoutTimer?.cancel();
    _statusReportTimer?.cancel();
    _connectionGeneration++;
    final channel = _channel;
    _channel = null;
    _deviceId = null;
    unawaited(channel?.sink.close() ?? Future<void>.value());
    if (!_statusController.isClosed) {
      _statusController.add(ConnectionStatus.disconnected);
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    disconnect();
    unawaited(_statusController.close());
    unawaited(_messageController.close());
    unawaited(_errorController.close());
  }
}
