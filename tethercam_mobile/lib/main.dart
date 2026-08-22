import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'services/discovery_service.dart';
import 'services/mobile_network_info.dart';
import 'services/connection_coordinator.dart';
import 'services/bluetooth_discovery_service.dart';
import 'pages/streaming_page.dart';
import 'dart:async';
import 'dart:io';

void main() {
  runApp(const TetherCamApp());
}

class TetherCamApp extends StatelessWidget {
  const TetherCamApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TetherCam',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: Colors.indigo,
        useMaterial3: true,
      ),
      home: const DiscoveryPage(),
    );
  }
}

class DiscoveryPage extends StatefulWidget {
  const DiscoveryPage({super.key});

  @override
  State<DiscoveryPage> createState() => _DiscoveryPageState();
}

class _DiscoveryPageState extends State<DiscoveryPage> {
  static const String _autoEndpoint = String.fromEnvironment(
    'TC_AUTO_ENDPOINT',
    defaultValue: '',
  );
  final DiscoveryService _discoveryService = DiscoveryService();
  final BluetoothDiscoveryService _btService = BluetoothDiscoveryService();
  final ConnectionCoordinator _connectionCoordinator = ConnectionCoordinator();
  final List<DiscoveredDesktop> _desktops = [];
  final List<BluetoothDeviceInfo> _btDevices = [];
  final List<DiscoveredDesktop> _btDesktops = [];
  final TextEditingController _manualEndpointController =
      TextEditingController();
  bool _isSearching = false;
  bool _isBtSearching = false;
  bool _isProcessingScan = false;
  String? _myIp;
  bool _usbDetected = false;
  bool _btEnabled = false;
  bool _showBtPanel = false;
  StreamSubscription? _discoverySub;
  Timer? _discoveryStopTimer;

  @override
  void initState() {
    super.initState();
    _initNetwork();
    if (_autoEndpoint.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _manualEndpointController.text = _autoEndpoint;
        _connectToDesktop(_autoEndpoint, 'Manual');
      });
    }
    _startDiscovery();
    _connectionCoordinator.onDesktopInvite = (url, label) {
      if (!mounted) return;
      _connectToDesktop(url, label);
    };
    _connectionCoordinator.start();
  }

  Future<void> _initNetwork() async {
    final ip = await MobileNetworkInfo.getWifiIpAddress();
    final usb = await MobileNetworkInfo.isUsbConnected();

    bool btOn = false;
    try {
      final btAvail = await _btService.isAvailable;
      btOn = btAvail ? await _btService.isEnabled : false;
    } catch (_) {}

    if (mounted) {
      setState(() {
        _myIp = ip;
        _usbDetected = usb;
        _btEnabled = btOn;
      });
      if (usb) _autoConnectUsb();
    }
  }

  Future<void> _autoConnectUsb() async {
    if (!mounted) return;
    _connectToDesktop('127.0.0.1:4747', 'USB (ADB)');
  }

  void _startDiscovery() {
    setState(() {
      _desktops.clear();
      _isSearching = true;
    });

    _discoverySub?.cancel();
    _discoveryStopTimer?.cancel();
    _discoverySub = _discoveryService.findDesktops().listen((desktop) {
      if (!_desktops.any((d) => d.ip == desktop.ip)) {
        setState(() {
          _desktops.add(desktop);
        });
      }
    }, onError: (error) {
      if (!mounted) return;
      setState(() => _isSearching = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Network discovery failed: $error')),
      );
    }, onDone: () {
      if (mounted) setState(() => _isSearching = false);
    });

    _discoveryStopTimer = Timer(const Duration(seconds: 15), () {
      if (mounted) {
        setState(() {
          _isSearching = false;
        });
        _discoverySub?.cancel();
      }
    });
  }

  Future<void> _startBtDiscovery() async {
    final permissionsReady = await _ensureBluetoothPermissions();
    if (!permissionsReady) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Bluetooth permissions are required to scan nearby devices.',
          ),
          duration: Duration(seconds: 4),
        ),
      );
      return;
    }

    if (!_btEnabled) {
      final enabled = await _btService.requestEnable();
      if (!enabled) return;
      setState(() => _btEnabled = true);
    }

    setState(() {
      _btDevices.clear();
      _btDesktops.clear();
      _isBtSearching = true;
      _showBtPanel = true;
    });

    final bonded = await _btService.getBondedDevices();
    if (mounted) {
      setState(() => _btDevices.addAll(bonded));
      for (final d in bonded) {
        if (d.name.toLowerCase().contains('tethercam') ||
            d.name.toLowerCase().contains('pc') ||
            d.name.toLowerCase().contains('desktop') ||
            d.name.toLowerCase().contains('laptop')) {
          _btDesktops.add(
            DiscoveredDesktop(name: d.name, ip: d.address, port: 4747),
          );
        }
      }
    }

    _btService.discover().listen(
      (device) {
        if (mounted && !_btDevices.any((d) => d.address == device.address)) {
          setState(() => _btDevices.add(device));
          if (device.name.toLowerCase().contains('tethercam') ||
              device.name.toLowerCase().contains('pc')) {
            _btDesktops.add(
              DiscoveredDesktop(
                name: device.name,
                ip: device.address,
                port: 4747,
              ),
            );
          }
        }
      },
      onDone: () {
        if (mounted) setState(() => _isBtSearching = false);
      },
      onError: (_) {
        if (mounted) setState(() => _isBtSearching = false);
      },
    );

    Future.delayed(const Duration(seconds: 12), () {
      _btService.stopDiscovery();
      if (mounted) setState(() => _isBtSearching = false);
    });
  }

  Future<bool> _ensureBluetoothPermissions() async {
    if (!Platform.isAndroid) return true;

    final statuses = await [
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.locationWhenInUse,
    ].request();

    return statuses.values.every(
      (status) => status.isGranted || status.isLimited,
    );
  }

  @override
  void dispose() {
    _discoverySub?.cancel();
    _discoveryStopTimer?.cancel();
    _btService.dispose();
    _connectionCoordinator.stop();
    _manualEndpointController.dispose();
    super.dispose();
  }

  Uri? _parseEndpoint(String raw) {
    raw = raw.trim();
    if (raw.startsWith('ws://') ||
        raw.startsWith('wss://') ||
        raw.startsWith('tethercam://')) {
      return Uri.tryParse(raw);
    }
    if (raw.contains(':')) return Uri.tryParse('ws://$raw');
    return Uri.tryParse('ws://$raw:4747');
  }

  void _connectToDesktop(String raw, String label) {
    final uri = _parseEndpoint(raw);
    final port = uri?.hasPort == true ? uri!.port : 4747;
    if (uri == null || uri.host.isEmpty || port < 1 || port > 65535) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid desktop address, for example 192.168.1.10:4747.')),
      );
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => StreamingPage(
          desktop: DiscoveredDesktop(name: label, ip: uri.host, port: port),
        ),
      ),
    );
  }

  void _connectManual() =>
      _connectToDesktop(_manualEndpointController.text.trim(), 'Manual');

  void _connectBtDevice(BluetoothDeviceInfo device) {
    final deviceToken = device.name.toLowerCase().split(' ').first;
    DiscoveredDesktop? wifiMatch;
    for (final d in _desktops) {
      if (d.name.toLowerCase().contains(deviceToken)) {
        wifiMatch = d;
        break;
      }
    }

    if (wifiMatch != null) {
      _connectToDesktop('${wifiMatch.ip}:${wifiMatch.port}', wifiMatch.name);
      return;
    }

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${device.name}: use WiFi scan or manual IP. Desktop can also tap Invite while this app is open.',
        ),
        duration: const Duration(seconds: 5),
      ),
    );
    _startDiscovery();
  }

  void _connectUsb() => _connectToDesktop('127.0.0.1:4747', 'USB (ADB)');

  Future<void> _scanQr() async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SizedBox(
        height: 460,
        child: Column(
          children: [
            const SizedBox(height: 12),
            const Text('Scan Desktop QR', style: TextStyle(fontSize: 18)),
            const SizedBox(height: 8),
            const Text('Point camera at the QR on desktop'),
            const SizedBox(height: 12),
            Expanded(
              child: MobileScanner(
                onDetect: (cap) {
                  if (_isProcessingScan) return;
                  final v = cap.barcodes.isNotEmpty
                      ? cap.barcodes.first.rawValue
                      : null;
                  if (v == null || v.trim().isEmpty) return;
                  _isProcessingScan = true;
                  Navigator.of(ctx).pop();
                  _connectToDesktop(v.trim(), 'QR');
                  Future.delayed(
                    const Duration(milliseconds: 600),
                    () => _isProcessingScan = false,
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF0F0F1A), Color(0xFF1A1A2E)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  children: [
                    _buildIpBanner(),
                    if (_usbDetected) _buildUsbBanner(),
                    const SizedBox(height: 16),
                    _buildConnectionCard(),
                    const SizedBox(height: 16),
                    if (_showBtPanel) _buildBluetoothPanel(),
                    if (_showBtPanel) const SizedBox(height: 16),
                    _buildDiscoveredList(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF6366F1), Color(0xFFA855F7)],
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.camera_alt, color: Colors.white, size: 20),
          ),
          const SizedBox(width: 12),
          const Text(
            'TetherCam',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
          const Spacer(),
          IconButton(
            icon: Icon(
              Icons.bluetooth,
              color: _btEnabled ? Colors.blueAccent : Colors.grey,
            ),
            onPressed: () => setState(() => _showBtPanel = !_showBtPanel),
          ),
        ],
      ),
    );
  }

  Widget _buildIpBanner() {
    if (_myIp == null) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0x286366F1), Color(0x28A855F7)],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: const Color(0xFF6366F1).withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.wifi, color: Color(0xFF818CF8), size: 22),
          ),
          const SizedBox(width: 14),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Phone IP Address',
                style: TextStyle(fontSize: 12, color: Colors.grey),
              ),
              const SizedBox(height: 2),
              Text(
                _myIp!,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.copy, size: 18, color: Colors.grey),
            onPressed: () => _copyToClipboard(_myIp!),
          ),
        ],
      ),
    );
  }

  Widget _buildUsbBanner() {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.green.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.green.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          const Icon(Icons.usb, color: Colors.green, size: 18),
          const SizedBox(width: 8),
          const Text(
            'USB device detected — auto-connecting...',
            style: TextStyle(color: Colors.green, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildConnectionCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E32).withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Connect to Desktop',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _ActionCard(
                  icon: Icons.wifi_find,
                  label: 'WiFi',
                  subtitle: 'Find on network',
                  color: const Color(0xFF6366F1),
                  isLoading: _isSearching,
                  onTap: _startDiscovery,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _ActionCard(
                  icon: Icons.bluetooth_searching,
                  label: 'Bluetooth',
                  subtitle: 'Scan nearby',
                  color: const Color(0xFF3B82F6),
                  isLoading: _isBtSearching,
                  onTap: _startBtDiscovery,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _ActionCard(
                  icon: Icons.qr_code_scanner,
                  label: 'QR Code',
                  subtitle: 'Scan desktop screen',
                  color: const Color(0xFF8B5CF6),
                  onTap: _scanQr,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _ActionCard(
                  icon: Icons.usb,
                  label: 'USB',
                  subtitle: _usbDetected ? 'Detected' : 'ADB cable',
                  color: Colors.green,
                  onTap: _connectUsb,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _manualEndpointController,
                  style: const TextStyle(fontSize: 14),
                  decoration: InputDecoration(
                    hintText: 'Enter IP address...',
                    hintStyle: const TextStyle(
                      color: Colors.grey,
                      fontSize: 13,
                    ),
                    filled: true,
                    fillColor: Colors.white.withValues(alpha: 0.05),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                  ),
                  onSubmitted: (_) => _connectManual(),
                ),
              ),
              const SizedBox(width: 10),
              Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF6366F1), Color(0xFFA855F7)],
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: IconButton(
                  icon: const Icon(Icons.arrow_forward, color: Colors.white),
                  onPressed: _connectManual,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBluetoothPanel() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E32).withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.bluetooth, color: Color(0xFF3B82F6), size: 20),
              const SizedBox(width: 8),
              const Text(
                'Bluetooth Devices',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              if (_isBtSearching)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          if (_btDevices.isEmpty && !_isBtSearching)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'No devices found. Tap Bluetooth above to scan.',
                style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
              ),
            )
          else
            ...List.generate(_btDevices.length, (i) {
              final d = _btDevices[i];
              final tetherCamMatch =
                  d.name.toLowerCase().contains('tethercam') ||
                  d.name.toLowerCase().contains('pc');
              return ListTile(
                dense: true,
                leading: Icon(
                  tetherCamMatch ? Icons.computer : Icons.devices,
                  color: tetherCamMatch ? const Color(0xFF6366F1) : Colors.grey,
                  size: 22,
                ),
                title: Text(d.name, style: const TextStyle(fontSize: 14)),
                subtitle: Text(
                  d.address,
                  style: const TextStyle(fontSize: 11, color: Colors.grey),
                ),
                trailing: tetherCamMatch
                    ? Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF6366F1), Color(0xFFA855F7)],
                          ),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Text(
                          'Connect',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      )
                    : null,
                onTap: tetherCamMatch ? () => _connectBtDevice(d) : null,
              );
            }),
        ],
      ),
    );
  }

  Widget _buildDiscoveredList() {
    if (_desktops.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(vertical: 32),
        child: Column(
          children: [
            Icon(Icons.cast_connected, size: 48, color: Colors.grey.shade700),
            const SizedBox(height: 12),
            Text(
              'No desktops found on network',
              style: TextStyle(fontSize: 14, color: Colors.grey.shade500),
            ),
            const SizedBox(height: 16),
            TextButton.icon(
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Search Again'),
              onPressed: _startDiscovery,
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Discovered Desktops',
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 10),
        ...List.generate(_desktops.length, (i) {
          final d = _desktops[i];
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E32).withValues(alpha: 0.6),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white10),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: () => _connectToDesktop('${d.ip}:${d.port}', d.name),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFF6366F1).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.computer,
                      color: Color(0xFF818CF8),
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          d.name,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          '${d.ip}:${d.port}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.grey,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: Colors.grey, size: 20),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  Future<void> _copyToClipboard(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Copied $text'),
        duration: const Duration(seconds: 2),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;
  final bool isLoading;

  const _ActionCard({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.color,
    required this.onTap,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isLoading ? null : onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Column(
          children: [
            if (isLoading)
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2, color: color),
              )
            else
              Icon(icon, color: color, size: 24),
            const SizedBox(height: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
            Text(
              subtitle,
              style: TextStyle(fontSize: 10, color: Colors.grey.shade500),
            ),
          ],
        ),
      ),
    );
  }
}
