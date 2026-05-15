import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'services/discovery_service.dart';
import 'pages/streaming_page.dart';
import 'dart:async';

void main() {
  runApp(const TetherCamApp());
}

class TetherCamApp extends StatelessWidget {
  const TetherCamApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TetherCam',
      theme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.indigo,
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
  static const String _autoEndpoint = String.fromEnvironment('TC_AUTO_ENDPOINT', defaultValue: '');
  final DiscoveryService _discoveryService = DiscoveryService();
  final List<DiscoveredDesktop> _desktops = [];
  final TextEditingController _manualEndpointController = TextEditingController();
  bool _isSearching = false;
  bool _isProcessingScan = false;
  StreamSubscription? _discoverySub;
  Timer? _discoveryStopTimer;

  @override
  void initState() {
    super.initState();
    if (_autoEndpoint.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _manualEndpointController.text = _autoEndpoint;
        _connectFromRawEndpoint(_autoEndpoint);
      });
    }
    _startDiscovery();
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
    });

    // Auto-stop after 15 seconds
    _discoveryStopTimer = Timer(const Duration(seconds: 15), () {
      if (mounted) {
        setState(() {
          _isSearching = false;
        });
        _discoverySub?.cancel();
      }
    });
  }

  @override
  void dispose() {
    _discoverySub?.cancel();
    _discoveryStopTimer?.cancel();
    _manualEndpointController.dispose();
    super.dispose();
  }

  Uri? _parseEndpoint(String raw) {
    Uri? uri;
    if (raw.startsWith('ws://') || raw.startsWith('wss://') || raw.startsWith('tethercam://')) {
      uri = Uri.tryParse(raw);
    } else if (raw.contains(':')) {
      uri = Uri.tryParse('ws://$raw');
    } else {
      uri = Uri.tryParse('ws://$raw:4747');
    }
    return uri;
  }

  void _connectFromRawEndpoint(String raw) {
    if (raw.isEmpty) return;
    final uri = _parseEndpoint(raw);

    if (uri == null || uri.host.isEmpty) return;
    final port = uri.hasPort ? uri.port : 4747;

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => StreamingPage(
          desktop: DiscoveredDesktop(name: 'Manual', ip: uri.host, port: port),
        ),
      ),
    );
  }

  void _connectManualEndpoint() => _connectFromRawEndpoint(_manualEndpointController.text.trim());

  void _connectUsbLocalhost() {
    _manualEndpointController.text = 'ws://127.0.0.1:4747';
    _connectFromRawEndpoint(_manualEndpointController.text.trim());
  }

  Future<void> _scanQrAndConnect() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return SizedBox(
          height: 460,
          child: Column(
            children: [
              const SizedBox(height: 12),
              const Text('Scan Desktop QR', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('Point camera at the QR shown on desktop'),
              const SizedBox(height: 12),
              Expanded(
                child: MobileScanner(
                  onDetect: (capture) {
                    if (_isProcessingScan) return;
                    final rawValue = capture.barcodes.isNotEmpty ? capture.barcodes.first.rawValue : null;
                    if (rawValue == null || rawValue.trim().isEmpty) return;

                    _isProcessingScan = true;
                    Navigator.of(context).pop();
                    _manualEndpointController.text = rawValue.trim();
                    _connectFromRawEndpoint(rawValue.trim());
                    Future.delayed(const Duration(milliseconds: 600), () {
                      _isProcessingScan = false;
                    });
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('TetherCam Connect'),
        actions: [
          if (_isSearching)
            const Center(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 16.0),
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: _startDiscovery,
            ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ElevatedButton.icon(
                  onPressed: _scanQrAndConnect,
                  icon: const Icon(Icons.qr_code_scanner),
                  label: const Text('Scan QR'),
                ),
                ElevatedButton.icon(
                  onPressed: _connectUsbLocalhost,
                  icon: const Icon(Icons.usb),
                  label: const Text('USB (ADB)'),
                ),
                ElevatedButton.icon(
                  onPressed: _startDiscovery,
                  icon: const Icon(Icons.wifi_find),
                  label: const Text('Find on Network'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _manualEndpointController,
              decoration: const InputDecoration(
                labelText: 'Manual endpoint (ws://ip:port, tethercam://ip:port, or ip)',
                border: OutlineInputBorder(),
              ),
              onSubmitted: (_) => _connectManualEndpoint(),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: ElevatedButton(
                onPressed: _connectManualEndpoint,
                child: const Text('Connect Manually'),
              ),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _desktops.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.cast_connected, size: 64, color: Colors.grey),
                          const SizedBox(height: 16),
                          const Text('No TetherCam Desktops found on LAN'),
                          const SizedBox(height: 16),
                          ElevatedButton(
                            onPressed: _startDiscovery,
                            child: const Text('Search Again'),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      itemCount: _desktops.length,
                      itemBuilder: (context, index) {
                        final desktop = _desktops[index];
                        return ListTile(
                          leading: const Icon(Icons.computer),
                          title: Text(desktop.name),
                          subtitle: Text('${desktop.ip}:${desktop.port}'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) => StreamingPage(desktop: desktop),
                              ),
                            );
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
