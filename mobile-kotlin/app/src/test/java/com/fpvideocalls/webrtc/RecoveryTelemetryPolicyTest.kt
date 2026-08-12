package com.fpvideocalls.webrtc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecoveryTelemetryPolicyTest {

    @Test
    fun `coarse recovery event contains only bounded operational fields`() {
        val event = RecoveryEvent(
            state = PeerRecoveryStatus.REPLACING,
            trigger = RecoveryTrigger.DISCONNECTED,
            attempt = 1,
            durationMillis = 12_345L,
            outcome = RecoveryOutcome.REPLACEMENT_SENT
        )

        val info = RecoveryTelemetryPolicy.format(event, "cellular")

        assertEquals(
            "recovery state=REPLACING trigger=DISCONNECTED attempt=1 " +
                "durationMs=12345 outcome=REPLACEMENT_SENT net=cellular",
            info
        )
        assertTrue(info.length <= RecoveryTelemetryPolicy.MAX_INFO_LENGTH)
        assertFalse(info.contains("peer"))
        assertFalse(info.contains("candidate"))
        assertFalse(info.contains("sdp", ignoreCase = true))
    }

    @Test
    fun `unexpected network labels are reduced to other`() {
        val event = RecoveryEvent(
            state = PeerRecoveryStatus.COOLDOWN,
            trigger = RecoveryTrigger.FAILED,
            attempt = 0,
            durationMillis = 15_000L,
            outcome = RecoveryOutcome.EXHAUSTED
        )

        assertTrue(RecoveryTelemetryPolicy.format(event, "user-supplied").endsWith("net=other"))
    }
}
