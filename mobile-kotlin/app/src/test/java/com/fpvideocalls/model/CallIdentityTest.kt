package com.fpvideocalls.model

import org.junit.Assert.*
import org.junit.Test

class CallIdentityTest {
    @Test fun `canonical cancellation requires UUID and room and never treats empty UUID as wildcard`() {
        val current = CallIdentity("call-B", "shared-room")
        assertTrue(CallIdentityPolicy.matches(current, current))
        assertFalse(CallIdentityPolicy.matches(current, CallIdentity("call-A", "shared-room")))
        assertFalse(CallIdentityPolicy.matches(current, CallIdentity("call-B", "other-room")))
        assertFalse(CallIdentityPolicy.matchesUUID("call-B", ""))
        assertFalse(CallIdentityPolicy.matchesUUID("call-B", null))
        assertFalse(CallIdentityPolicy.matchesUUID(null, "call-B"))
    }

    @Test fun `invalid canonical identifiers are rejected without room fallback`() {
        assertNull(CallIdentityPolicy.parse("", "room"))
        assertNull(CallIdentityPolicy.parse("x".repeat(129), "room"))
        assertNull(CallIdentityPolicy.parse("uuid", ""))
        assertNull(CallIdentityPolicy.parse("bad\u0000uuid", "room"))
    }
}
