import 'dart:convert';
import 'dart:async';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'dart:io';

enum ConnectionStatus { disconnected, connecting, connected, error }

class SignalingClient {
  WebSocketChannel? _channel;
  final StreamController<ConnectionStatus> _statusController = StreamController<ConnectionStatus>.broadcast();
  final StreamController<Map<String, dynamic>> _messageController = StreamController<Map<String, dynamic>>.broadcast();
  String? _deviceId;
  String _connectionType = 'wifi';
  Timer? _connectTimeoutTimer;

  Stream<ConnectionStatus> get statusStream => _statusController.stream;
  Stream<Map<String, dynamic>> get messageStream => _messageController.stream;
  String? get deviceId => _deviceId;

  Future<void> connect(String ip, int port) async {
    final url = 'ws://$ip:$port';
    _connectionType = _resolveConnectionType(ip);
    print('[PHASE] CONNECT -> $url');
    _statusController.add(ConnectionStatus.connecting);

    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      _connectTimeoutTimer?.cancel();
      _connectTimeoutTimer = Timer(const Duration(seconds: 8), () {
        if (_deviceId == null) {
          _statusController.add(ConnectionStatus.error);
          disconnect();
        }
      });
      
      _channel!.stream.listen(
        (data) {
          final message = jsonDecode(data);
          _messageController.add(message);
          if (message['type'] == 'registered') {
            _deviceId = message['deviceId'] as String?;
            _connectTimeoutTimer?.cancel();
            print('[PHASE] REGISTER OK -> deviceId=$_deviceId');
            _statusController.add(ConnectionStatus.connected);
          }
        },
        onError: (err) {
          _statusController.add(ConnectionStatus.error);
        },
        onDone: () {
          _connectTimeoutTimer?.cancel();
          _statusController.add(ConnectionStatus.disconnected);
        },
      );

      // Send registration info
      await _register();
    } catch (e) {
      _connectTimeoutTimer?.cancel();
      _statusController.add(ConnectionStatus.error);
    }
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
    _connectTimeoutTimer?.cancel();
    _channel?.sink.close();
    _deviceId = null;
    _statusController.add(ConnectionStatus.disconnected);
  }
}
