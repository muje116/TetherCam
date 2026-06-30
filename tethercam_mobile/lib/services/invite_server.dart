import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';

typedef InviteCallback = void Function(String desktopUrl);

/// Lightweight HTTP server so the desktop can invite this phone to connect.
class InviteServer {
  static const int invitePort = 4748;

  HttpServer? _server;
  InviteCallback? onInvite;

  Future<void> start() async {
    if (_server != null) return;
    try {
      _server = await HttpServer.bind(InternetAddress.anyIPv4, invitePort, shared: true);
      debugPrint('[InviteServer] Listening on :$invitePort');
      _server!.listen(_handleRequest);
    } catch (e) {
      debugPrint('[InviteServer] Failed to start: $e');
    }
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
  }

  Future<void> _handleRequest(HttpRequest request) async {
    final path = request.uri.path;
    try {
      if (request.method == 'OPTIONS') {
        request.response
          ..statusCode = HttpStatus.noContent
          ..headers.add('Access-Control-Allow-Origin', '*')
          ..headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
          ..headers.add('Access-Control-Allow-Headers', 'Content-Type');
        await request.response.close();
        return;
      }

      request.response.headers.add('Access-Control-Allow-Origin', '*');
      request.response.headers.contentType = ContentType.json;

      if (path == '/api/info') {
        request.response.write(jsonEncode({
          'app': 'TetherCam Mobile',
          'role': 'mobile',
          'invitePort': invitePort,
        }));
      } else if (path == '/api/invite' && request.method == 'GET') {
        final url = request.uri.queryParameters['url'];
        if (url == null || url.isEmpty) {
          request.response.statusCode = HttpStatus.badRequest;
          request.response.write(jsonEncode({'error': 'Missing url parameter'}));
        } else {
          debugPrint('[InviteServer] Invite received: $url');
          onInvite?.call(url);
          request.response.write(jsonEncode({'status': 'ok', 'message': 'Connecting to desktop'}));
        }
      } else {
        request.response.statusCode = HttpStatus.notFound;
        request.response.write(jsonEncode({'error': 'Not found'}));
      }
    } catch (e) {
      request.response.statusCode = HttpStatus.internalServerError;
      request.response.write(jsonEncode({'error': e.toString()}));
    }
    await request.response.close();
  }
}
