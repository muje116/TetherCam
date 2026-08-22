import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  static bool _initialized = false;
  static const int _streamingNotificationId = 4747;
  static const String _channelId = 'tethercam_streaming';
  static const String _channelName = 'Streaming';

  static Future<void> initialize() async {
    if (_initialized) return;
    const androidSettings = AndroidInitializationSettings(
      '@mipmap/ic_launcher',
    );
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    const settings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );
    await _plugin.initialize(settings);
    _initialized = true;

    final androidChannel = AndroidNotificationChannel(
      _channelId,
      _channelName,
      description: 'TetherCam streaming status',
      importance: Importance.low,
      playSound: false,
      enableVibration: false,
    );
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(androidChannel);
  }

  static Future<void> showStreamingNotification() async {
    await initialize();
    const androidDetails = AndroidNotificationDetails(
      _channelId,
      _channelName,
      channelDescription: 'TetherCam streaming status',
      importance: Importance.low,
      priority: Priority.low,
      ongoing: true,
      autoCancel: false,
      showWhen: false,
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: false,
      presentBadge: false,
      presentSound: false,
    );
    const details = NotificationDetails(
      android: androidDetails,
      iOS: iosDetails,
    );
    await _plugin.show(
      _streamingNotificationId,
      'TetherCam Streaming',
      'Streaming to desktop...',
      details,
    );
  }

  static Future<void> cancelStreamingNotification() async {
    await _plugin.cancel(_streamingNotificationId);
  }
}
