import 'dart:convert';
import 'dart:async';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'dart:io';
import 'dart:math';

enum ConnectionStatus { disconnected, connecting, connected, error }

class SignalingClient {
  WebSocketChannel? _channel;
  final StreamController<ConnectionStatus> _statusController = StreamController<ConnectionStatus>.broadcast();
  final StreamController<Map<String, dynamic>> _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<String> _errorController = StreamController<String>.broadcast();
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

  Stream<ConnectionStatus> get statusStream => _statusController.stream;
  Stream<Map<String, dynamic>> get messageStream => _messageController.stream;
  Stream<String> get errorStream => _errorController.stream;
  String? get deviceId => _deviceId;

  Future<void> connect(String ip, int port) async {
    _lastIp = ip;
    _lastPort = port;
    _intentionalDisconnect = false;
    _reconnectAttempt = 0;

    await _doConnect(ip, port);
  }

  Future<void> _doConnect(String ip, int port) async {
    final url = 'ws://$ip:$port';
    _connectionType = _resolveConnectionType(ip);
    print('[PHASE] CONNECT -> $url');
    _statusController.add(ConnectionStatus.connecting);

    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      _connectTimeoutTimer?.cancel();
      _connectTimeoutTimer = Timer(const Duration(seconds: 8), () {
        if (_deviceId == null) {
          _errorController.add('Connection timed out after 8s to $url');
          _statusController.add(ConnectionStatus.error);
          disconnect();
          _scheduleReconnect();
        }
      });

      _channel!.stream.listen(
        (data) {
          final message = jsonDecode(data);
          _messageController.add(message);
          if (message['type'] == 'registered') {
            _deviceId = message['deviceId'] as String?;
            _connectTimeoutTimer?.cancel();
            _reconnectAttempt = 0;
            print('[PHASE] REGISTER OK -> deviceId=$_deviceId');
            _statusController.add(ConnectionStatus.connected);
            _startStatusReporting();
          }
        },
        onError: (err) {
          _errorController.add('WebSocket error: $err');
          _statusController.add(ConnectionStatus.error);
          _scheduleReconnect();
        },
        onDone: () {
          _connectTimeoutTimer?.cancel();
          _statusReportTimer?.cancel();
          _statusController.add(ConnectionStatus.disconnected);
          if (!_intentionalDisconnect) {
            _scheduleReconnect();
          }
        },
      );

      await _register();
    } catch (e) {
      _errorController.add('Connect failed: $e');
      _connectTimeoutTimer?.cancel();
      _statusController.add(ConnectionStatus.error);
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_intentionalDisconnect || _lastIp == null) return;
    _reconnectTimer?.cancel();

    final delay = min(pow(2, _reconnectAttempt).toInt(), _maxReconnectDelay);
    _reconnectAttempt++;
    print('[Reconnect] Scheduling reconnect in ${delay}s (attempt $_reconnectAttempt)');

    _reconnectTimer = Timer(Duration(seconds: delay), () {
      if (!_intentionalDisconnect && _lastIp != null && _lastPort != null) {
        print('[Reconnect] Attempting reconnect...');
        _doConnect(_lastIp!, _lastPort!);
      }
    });
  }

  void onConnectionLost() {
    if (_deviceId != null && !_intentionalDisconnect) {
      _scheduleReconnect();
    }
  }

  void _startStatusReporting() {
    _statusReportTimer?.cancel();
    _statusReportTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_deviceId == null) return;
      final batteryInfo = await _getBatteryInfo();
      final tempInfo = await _getTemperatureInfo();
      send({
        'type': 'device-status',
        'deviceId': _deviceId,
        'battery': batteryInfo.level,
        'temperature': tempInfo,
        'streamSettings': {
          'resolution': '720p',
          'fps': 30,
          'bitrate': 4000,
          'codec': 'H.264',
        },
      });
    });
  }

  Future<({double level})> _getBatteryInfo() async {
    double level = 1.0;
    if (Platform.isAndroid) {
      try {
        final result = await Process.run('dumpsys', ['battery']);
        final stdout = result.stdout as String;
        final levelMatch = RegExp(r'level:\s*(\d+)').firstMatch(stdout);
        if (levelMatch != null) {
          level = int.parse(levelMatch.group(1)!) / 100.0;
        }
      } catch (_) {}
    }
    return (level: level);
  }

  Future<int> _getTemperatureInfo() async {
    int temp = 25;
    if (Platform.isAndroid) {
      try {
        final result = await Process.run('dumpsys', ['battery']);
        final stdout = result.stdout as String;
        final tempMatch = RegExp(r'temperature:\s*(\d+)').firstMatch(stdout);
        if (tempMatch != null) {
          temp = (int.parse(tempMatch.group(1)!) / 10).round();
        }
      } catch (_) {}
    }
    return temp;
  }

  Future<void> _register() async {
    final deviceInfo = DeviceInfoPlugin();
    String name = 'Unknown';
    String model = 'Unknown';
    String platform = Platform.isAndroid ? 'android' : 'ios';

    if (Platform.isAndroid) {
      final androidInfo = await deviceInfo.androidInfo;
      name = androidInfo.host;
      model = androidInfo.model;
    } else if (Platform.isIOS) {
      final iosInfo = await deviceInfo.iosInfo;
      name = iosInfo.name;
      model = iosInfo.model;
    }

    print('[PHASE] REGISTER SEND -> name=$name model=$model platform=$platform');
    send({
      'type': 'register',
      'name': name,
      'model': model,
      'platform': platform,
      'connectionType': _connectionType,
    });
  }

  String _resolveConnectionType(String ip) {
    final host = ip.toLowerCase();
    if (host == '127.0.0.1' || host == 'localhost' || host == '::1') {
      return 'usb';
    }
    return 'wifi';
  }

  void send(Map<String, dynamic> message) {
    print('[SIGNAL SEND] ${message['type']}');
    _channel?.sink.add(jsonEncode(message));
  }

  void disconnect() {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _connectTimeoutTimer?.cancel();
    _statusReportTimer?.cancel();
    _channel?.sink.close();
    _deviceId = null;
    _statusController.add(ConnectionStatus.disconnected);
  }
}
