import 'dart:async';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_bluetooth_serial/flutter_bluetooth_serial.dart';
import 'dart:io';
import 'invite_server.dart';
import 'mobile_advertiser.dart';

typedef DesktopInviteHandler = void Function(String rawEndpoint, String label);

/// Keeps invite HTTP + mDNS advertisement running while the app is open.
class ConnectionCoordinator {
  final InviteServer _inviteServer = InviteServer();
  final MobileAdvertiser _advertiser = MobileAdvertiser();
  DesktopInviteHandler? onDesktopInvite;

  Future<void> start() async {
    _inviteServer.onInvite = (url) {
      onDesktopInvite?.call(url, 'Desktop Invite');
    };
    await _inviteServer.start();
    await _refreshAdvertisement();
  }

  Future<void> _refreshAdvertisement() async {
    final ip = await _resolveIp();
    if (ip == null) {
      debugPrint('[ConnectionCoordinator] No LAN IP — mDNS advertisement skipped');
      return;
    }

    final name = await _resolveDeviceName();
    final btAddress = await _resolveBluetoothAddress();

    await _advertiser.stop();
    await _advertiser.start(
      deviceName: name,
      ipAddress: ip,
      bluetoothAddress: btAddress,
    );
  }

  Future<String?> _resolveIp() async {
    try {
      final interfaces = await NetworkInterface.list();
      for (final iface in interfaces) {
        final lower = iface.name.toLowerCase();
        if (lower.contains('wlan') || lower.contains('wifi') || lower.contains('eth')) {
          for (final addr in iface.addresses) {
            if (addr.type == InternetAddressType.IPv4 &&
                !addr.isLoopback &&
                !addr.address.startsWith('169.254.')) {
              return addr.address;
            }
          }
        }
      }
      for (final iface in interfaces) {
        for (final addr in iface.addresses) {
          if (addr.type == InternetAddressType.IPv4 &&
              !addr.isLoopback &&
              !addr.address.startsWith('169.254.')) {
            return addr.address;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  Future<String> _resolveDeviceName() async {
    final info = DeviceInfoPlugin();
    if (Platform.isAndroid) {
      final android = await info.androidInfo;
      return android.model;
    }
    if (Platform.isIOS) {
      final ios = await info.iosInfo;
      return ios.name;
    }
    return 'TetherCam Phone';
  }

  Future<String?> _resolveBluetoothAddress() async {
    if (!Platform.isAndroid) return null;
    try {
      final local = await FlutterBluetoothSerial.instance.address;
      return local;
    } catch (_) {
      return null;
    }
  }

  Future<void> stop() async {
    await _advertiser.stop();
    await _inviteServer.stop();
  }
}
