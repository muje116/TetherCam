package com.tethercam.tethercam_mobile

import android.os.Build
import android.security.NetworkSecurityPolicy
import android.util.Log
import java.net.Inet4Address
import java.net.InetAddress

/**
 * Allows ws:// signaling only to loopback, RFC1918, and IPv4 link-local hosts.
 */
object PrivateNetworkSecurity {
    private const val TAG = "PrivateNetworkSecurity"

    fun installPrivateCleartextPolicy() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return

        try {
            val base = NetworkSecurityPolicy.getInstance()
            val policy = PrivateHostNetworkSecurityPolicy(base)
            val setInstance = NetworkSecurityPolicy::class.java.getDeclaredMethod(
                "setInstance",
                NetworkSecurityPolicy::class.java,
            )
            setInstance.isAccessible = true
            setInstance.invoke(null, policy)
        } catch (e: Exception) {
            Log.w(TAG, "Could not install private-network cleartext policy: ${e.message}")
        }
    }

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

    private class PrivateHostNetworkSecurityPolicy(
        private val base: NetworkSecurityPolicy,
    ) : NetworkSecurityPolicy() {

        override fun isCleartextTrafficPermitted(hostname: String): Boolean {
            return isPrivateOrLocalHost(hostname) || base.isCleartextTrafficPermitted(hostname)
        }

        override fun isCleartextTrafficPermitted(hostname: String, port: Int): Boolean {
            return isPrivateOrLocalHost(hostname) || base.isCleartextTrafficPermitted(hostname, port)
        }

        override fun isCleartextTrafficPermitted(): Boolean {
            return base.isCleartextTrafficPermitted
        }
    }
}
