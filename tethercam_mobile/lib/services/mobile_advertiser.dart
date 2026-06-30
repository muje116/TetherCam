import 'package:bonsoir/bonsoir.dart';
import 'package:flutter/foundation.dart';
import 'invite_server.dart';

/// Advertises this phone on the LAN so the desktop can discover and invite it.
class MobileAdvertiser {
  BonsoirBroadcast? _broadcast;
  bool _running = false;

  Future<void> start({
    required String deviceName,
    required String ipAddress,
    String? bluetoothAddress,
  }) async {
    if (_running) return;

    try {
      final service = BonsoirService(
        name: deviceName,
        type: '_tethercam._tcp',
        port: InviteServer.invitePort,
        attributes: {
          'role': 'mobile',
          'ip': ipAddress,
          'app': 'TetherCam',
          if (bluetoothAddress != null && bluetoothAddress.isNotEmpty) 'bt': bluetoothAddress,
        },
      );

      _broadcast = BonsoirBroadcast(service: service);
      await _broadcast!.initialize();
      await _broadcast!.start();
      _running = true;
      debugPrint('[MobileAdvertiser] Broadcasting $deviceName at $ipAddress');
    } catch (e) {
      debugPrint('[MobileAdvertiser] Failed: $e');
    }
  }

  Future<void> stop() async {
    if (!_running) return;
    try {
      await _broadcast?.stop();
    } catch (_) {}
    _broadcast = null;
    _running = false;
  }
}
