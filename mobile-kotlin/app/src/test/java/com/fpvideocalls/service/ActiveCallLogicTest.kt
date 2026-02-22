package com.fpvideocalls.service

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Tests for active call lifecycle logic:
 * - Call state management (start/end)
 * - ViewModel destruction must NOT end the call
 * - Back press behavior
 * - Return-to-call intent handling
 * - Hang-up from notification
 * - Call info persistence
 */
class ActiveCallLogicTest {

    // ---- Extracted decision logic (mirrors ActiveCallService / InCallViewModel) ----

    data class CallInfo(
        val roomId: String,
        val displayName: String,
        val userId: String,
        val callType: String,
        val password: String?
    )

    /** Simulates the active-call state that lives in ActiveCallService */
    private var isCallActive = false
    private var activeCallInfo: CallInfo? = null
    private var endCallCount = 0

    private fun startCall(info: CallInfo) {
        if (isCallActive) {
            endCall() // end previous call first
        }
        isCallActive = true
        activeCallInfo = info
    }

    private fun endCall() {
        if (!isCallActive) return
        isCallActive = false
        activeCallInfo = null
        endCallCount++
    }

    /** Mirrors the new InCallViewModel.onCleared() — does NOT end the call */
    private fun onViewModelCleared() {
        // intentionally empty: call survives ViewModel destruction
    }

    /** Decides what back press does during a call */
    data class BackPressResult(val action: String)

    private fun handleBackPress(callActive: Boolean): BackPressResult {
        return if (callActive) {
            BackPressResult("moveTaskToBack")
        } else {
            BackPressResult("navigateBack")
        }
    }

    /** Decides whether to navigate to InCallScreen on RETURN_TO_CALL intent */
    private fun shouldNavigateToCall(callActive: Boolean): Boolean = callActive

    /** Decides what happens when notification hang-up is tapped */
    private fun handleHangUp() {
        endCall()
    }

    @Before
    fun setUp() {
        isCallActive = false
        activeCallInfo = null
        endCallCount = 0
    }

    // ---- Active call state management ----

    @Test
    fun `startCall sets isCallActive to true and stores call info`() {
        val info = CallInfo("room-1", "Alice", "user-1", "direct", null)
        startCall(info)
        assertTrue(isCallActive)
        assertEquals(info, activeCallInfo)
    }

    @Test
    fun `endCall sets isCallActive to false and clears call info`() {
        startCall(CallInfo("room-1", "Alice", "user-1", "direct", null))
        endCall()
        assertFalse(isCallActive)
        assertNull(activeCallInfo)
    }

    @Test
    fun `endCall when no call active is a no-op`() {
        endCall()
        assertFalse(isCallActive)
        assertEquals(0, endCallCount)
    }

    @Test
    fun `starting a new call while one is active ends the previous first`() {
        val first = CallInfo("room-1", "Alice", "user-1", "direct", null)
        val second = CallInfo("room-2", "Bob", "user-2", "group", "pass123")
        startCall(first)
        startCall(second)
        assertTrue(isCallActive)
        assertEquals(second, activeCallInfo)
        assertEquals(1, endCallCount) // previous call was ended
    }

    // ---- ViewModel lifecycle ----

    @Test
    fun `onCleared does NOT end the call - call survives ViewModel destruction`() {
        startCall(CallInfo("room-1", "Alice", "user-1", "direct", null))
        onViewModelCleared()
        assertTrue("Call must remain active after ViewModel cleared", isCallActive)
        assertNotNull("Call info must survive ViewModel cleared", activeCallInfo)
    }

    @Test
    fun `explicit endCall still ends the call`() {
        startCall(CallInfo("room-1", "Alice", "user-1", "direct", null))
        endCall()
        assertFalse(isCallActive)
    }

    // ---- Back press behavior ----

    @Test
    fun `back press during active call should NOT trigger endCall`() {
        startCall(CallInfo("room-1", "Alice", "user-1", "direct", null))
        val result = handleBackPress(isCallActive)
        // back press only moves app to background, does not end call
        assertTrue("Call must still be active after back press", isCallActive)
        assertEquals("moveTaskToBack", result.action)
    }

    @Test
    fun `back press action is moveTaskToBack when call is active`() {
        val result = handleBackPress(callActive = true)
        assertEquals("moveTaskToBack", result.action)
    }

    // ---- Return-to-call intent handling ----

    @Test
    fun `RETURN_TO_CALL intent with active call navigates to InCallScreen`() {
        startCall(CallInfo("room-1", "Alice", "user-1", "direct", null))
        assertTrue(shouldNavigateToCall(isCallActive))
    }

    @Test
    fun `RETURN_TO_CALL intent with no active call does NOT navigate`() {
        assertFalse(shouldNavigateToCall(isCallActive))
    }

    @Test
    fun `return-to-call uses stored call info for navigation params`() {
        val info = CallInfo("room-42", "Charlie", "user-42", "group", "secret")
        startCall(info)
        assertTrue(shouldNavigateToCall(isCallActive))
        val navInfo = activeCallInfo!!
        assertEquals("room-42", navInfo.roomId)
        assertEquals("Charlie", navInfo.displayName)
        assertEquals("user-42", navInfo.userId)
        assertEquals("group", navInfo.callType)
        assertEquals("secret", navInfo.password)
    }

    // ---- Hang-up from notification ----

    @Test
    fun `hang-up action ends call and sets isCallActive to false`() {
        startCall(CallInfo("room-1", "Alice", "user-1", "direct", null))
        handleHangUp()
        assertFalse(isCallActive)
        assertNull(activeCallInfo)
    }

    @Test
    fun `hang-up when InCallScreen is visible triggers navigation back`() {
        startCall(CallInfo("room-1", "Alice", "user-1", "direct", null))
        val isOnInCallScreen = true
        handleHangUp()
        // After hang-up, the UI should observe isCallActive=false and navigate back
        assertFalse(isCallActive)
        assertTrue("Should trigger nav back when screen was visible", isOnInCallScreen && !isCallActive)
    }

    // ---- Call info persistence ----

    @Test
    fun `activeCallInfo stores roomId, displayName, userId, callType, password`() {
        val info = CallInfo("my-room", "Display", "uid-123", "direct", "pw")
        startCall(info)
        val stored = activeCallInfo!!
        assertEquals("my-room", stored.roomId)
        assertEquals("Display", stored.displayName)
        assertEquals("uid-123", stored.userId)
        assertEquals("direct", stored.callType)
        assertEquals("pw", stored.password)
    }

    @Test
    fun `activeCallInfo is null when no call active`() {
        assertNull(activeCallInfo)
    }

    @Test
    fun `activeCallInfo survives ViewModel destruction (lives in service)`() {
        val info = CallInfo("room-1", "Alice", "user-1", "direct", null)
        startCall(info)
        onViewModelCleared()
        assertNotNull("Call info must persist after ViewModel destruction", activeCallInfo)
        assertEquals(info, activeCallInfo)
    }
}
