import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_bluetooth_serial/flutter_bluetooth_serial.dart';

class BluetoothDeviceInfo {
  final String name;
  final String address;

  BluetoothDeviceInfo({required this.name, required this.address});
}

class BluetoothDiscoveryService {
  final FlutterBluetoothSerial _bt = FlutterBluetoothSerial.instance;
  StreamSubscription<BluetoothDiscoveryResult>? _discoverySub;
  StreamController<BluetoothDeviceInfo>? _discoveryController;

  Future<bool> get isAvailable async {
    try {
      return await _bt.isAvailable ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> get isEnabled async {
    try {
      return await _bt.isEnabled ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> requestEnable() async {
    try {
      return await _bt.requestEnable() ?? false;
    } catch (_) {
      return false;
    }
  }

  Stream<BluetoothDeviceInfo> discover() {
    _discoveryController = StreamController<BluetoothDeviceInfo>.broadcast();

    try {
      _discoverySub = _bt.startDiscovery().listen((result) {
        if (result.device.name != null && result.device.name!.isNotEmpty) {
          _discoveryController?.add(BluetoothDeviceInfo(
            name: result.device.name!,
            address: result.device.address,
          ));
        }
      }, onError: (error) {
        debugPrint('BT discovery error: $error');
        _discoveryController?.addError(error);
      }, onDone: () {
        _discoveryController?.close();
      });
    } catch (error) {
      debugPrint('BT start discovery error: $error');
      _discoveryController?.addError(error);
    }

    return _discoveryController!.stream;
  }

  Future<List<BluetoothDeviceInfo>> getBondedDevices() async {
    try {
      final devices = await _bt.getBondedDevices();
      return devices
          .where((d) => d.name != null && d.name!.isNotEmpty)
          .map((d) => BluetoothDeviceInfo(name: d.name!, address: d.address))
          .toList();
    } catch (_) {
      return [];
    }
  }

  void stopDiscovery() {
    _discoverySub?.cancel();
    _bt.cancelDiscovery();
  }

  void dispose() {
    stopDiscovery();
    _discoveryController?.close();
  }
}
