package com.fpvideocalls.model

import com.fpvideocalls.data.CallApiService
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.ForwardingSource
import okio.buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class CallCancellationTransportTest {
    @Test fun `HTTP rejection is explicit and closes the response`() = runTest {
        var hasClosed = false
        val source = object : ForwardingSource(Buffer().writeUtf8("{}")) {
            override fun close() { hasClosed = true; super.close() }
        }.buffer()
        val body = object : ResponseBody() {
            override fun contentType() = null
            override fun contentLength() = 2L
            override fun source() = source
        }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(403).message("Forbidden").body(body).build()
        }.build()
        try {
            CallApiService(client).cancelCall(listOf("alice"), "room", "uuid")
            fail("Rejected cancellation must not appear successful")
        } catch (error: IOException) {
            assertEquals("Call cancellation rejected: HTTP 403", error.message)
        }
        assertTrue(hasClosed)
    }

    @Test fun `network failure propagates for scoped safe diagnostics`() = runTest {
        val client = OkHttpClient.Builder().addInterceptor { throw IOException("synthetic failure") }.build()
        try {
            CallApiService(client).cancelCall(listOf("alice"), "room", "uuid")
            fail("Network cancellation failure must propagate")
        } catch (error: IOException) {
            assertEquals("synthetic failure", error.message)
        }
    }

    @Test fun `invite UUID JSON type is validated rather than coerced before cancellation`() = runTest {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body("""{"callUUID":42}""".toResponseBody()).build()
        }.build()
        try {
            CallApiService(client).sendCallInvite("caller", "Caller", null, listOf("alice"), "room", "direct")
            fail("Malformed invite response must fail")
        } catch (error: IOException) {
            assertEquals("Call invite failed: invalid UUID", error.message)
        }
    }
}
