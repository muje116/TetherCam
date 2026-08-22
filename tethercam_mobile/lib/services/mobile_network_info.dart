import 'dart:io';
import 'dart:async';

class MobileNetworkInfo {
  static Future<String?> getWifiIpAddress() async {
    try {
      final interfaces = await NetworkInterface.list();
      for (final interface in interfaces) {
        if (interface.name.toLowerCase().contains('wlan') ||
            interface.name.toLowerCase().contains('wifi') ||
            interface.name.toLowerCase().contains('eth')) {
          for (final addr in interface.addresses) {
            if (addr.type == InternetAddressType.IPv4 &&
                !addr.isLoopback &&
                !addr.address.startsWith('169.254.')) {
              return addr.address;
            }
          }
        }
      }

      for (final interface in interfaces) {
        for (final addr in interface.addresses) {
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

  static Future<bool> isUsbConnected() async {
    try {
      final socket = await Socket.connect(
        '127.0.0.1',
        4747,
        timeout: const Duration(seconds: 2),
      );
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<ConnectionMethod> detectConnectionMethod() async {
    final usbAvailable = await isUsbConnected();
    if (usbAvailable) {
      return ConnectionMethod.usb;
    }
    final wifiIp = await getWifiIpAddress();
    if (wifiIp != null) {
      return ConnectionMethod.wifi;
    }
    return ConnectionMethod.unknown;
  }
}

enum ConnectionMethod { usb, wifi, unknown }
