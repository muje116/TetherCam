package com.tethercam.tethercam_mobile

import android.util.Log
import java.net.Inet4Address
import java.net.InetAddress

/**
 * Helper object to check if a hostname is a private or local host.
 * Note: Custom NetworkSecurityPolicy is not supported on modern Android versions
 * due to API restrictions. Cleartext traffic will be allowed via manifest configuration.
 */
object PrivateNetworkSecurity {
    private const val TAG = "PrivateNetworkSecurity"

    /**
     * Check if the given hostname is a private or local address.
     * This is used for informational purposes, but cleartext traffic policy
     * is now handled via AndroidManifest.xml networkSecurityConfig.
     */
    fun isPrivateOrLocalHost(hostname: String): Boolean {
        if (hostname.isEmpty()) return false
        if (hostname.equals("localhost", ignoreCase = true)) return true

        return try {
            val addr = InetAddress.getByName(hostname)
            addr.isLoopbackAddress || isPrivateOrLinkLocalIpv4(addr)
        } catch (_: Exception) {
            false
        }
    }

    private fun isPrivateOrLinkLocalIpv4(addr: InetAddress): Boolean {
        if (addr !is Inet4Address) return false
        val octets = addr.address
        val o0 = octets[0].toInt() and 0xff
        val o1 = octets[1].toInt() and 0xff
        return when (o0) {
            10 -> true
            127 -> true
            169 -> o1 == 254
            172 -> o1 in 16..31
            192 -> o1 == 168
            else -> false
        }
    }
}
