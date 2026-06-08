package com.tethercam.tethercam_mobile

import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        PrivateNetworkSecurity.installPrivateCleartextPolicy()
        super.onCreate(savedInstanceState)
    }
}
