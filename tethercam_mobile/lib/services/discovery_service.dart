import 'package:multicast_dns/multicast_dns.dart';

class DiscoveredDesktop {
  final String name;
  final String ip;
  final int port;

  DiscoveredDesktop({required this.name, required this.ip, required this.port});

  @override
  String toString() => 'DiscoveredDesktop(name: $name, ip: $ip, port: $port)';
}

class DiscoveryService {
  final String _serviceType = '_TetherCam._tcp.local';
  
  Stream<DiscoveredDesktop> findDesktops() async* {
    final MDnsClient client = MDnsClient();
    await client.start();

    await for (final PtrResourceRecord ptr in client.lookup<PtrResourceRecord>(
        ResourceRecordQuery.serverPointer(_serviceType))) {
      
      await for (final SrvResourceRecord srv in client.lookup<SrvResourceRecord>(
          ResourceRecordQuery.service(ptr.domainName))) {
        
        await for (final IPAddressResourceRecord ip in client.lookup<IPAddressResourceRecord>(
            ResourceRecordQuery.addressIPv4(srv.target))) {
          
          yield DiscoveredDesktop(
            name: ptr.domainName.split('.').first,
            ip: ip.address.address,
            port: srv.port,
          );
        }
      }
    }

    client.stop();
  }

  /// Advertise this mobile device so the desktop can find it.
  Future<void> advertise() async {
    // Note: multicast_dns package is primarily for lookup. 
    // Full advertisement might require a different package like 'bonsoir' 
    // but for now, we focus on mobile finding desktop first as it's the more common flow.
  }
}
