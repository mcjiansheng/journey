package wang.jscloud.journey

import java.util.UUID
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

class ApiTest {
    @Test
    fun cookieOriginAndCsrfAreSent() {
        val server = MockWebServer()
        server.start()
        try {
            var persisted = "[]"
            val cookies = SessionCookies({ persisted }, { persisted = it })
            val api = JourneyApi(server.url("/").toString().trimEnd('/'), cookies)
            server.enqueue(
                MockResponse()
                    .setHeader("Set-Cookie", "sid=real-session; HttpOnly; Path=/")
                    .setBody("{\"csrfToken\":\"csrf\"}")
            )
            val response =
                api.request(
                    "/api/auth/login",
                    "POST",
                    obj("identifier" to "user", "password" to "secret"),
                )
            server.takeRequest()
            api.csrf = response.s("csrfToken")
            server.enqueue(MockResponse().setBody("{\"ok\":true}"))
            api.request("/api/me", "PATCH", obj("displayName" to "Journey"))
            val request = server.takeRequest()
            assertEquals(server.url("/").toString().trimEnd('/'), request.getHeader("Origin"))
            assertEquals("csrf", request.getHeader("X-CSRF-Token"))
            assertEquals("sid=real-session", request.getHeader("Cookie"))
            assertTrue(persisted.contains("sid=real-session"))
            val restored = SessionCookies({ persisted }, { persisted = it })
            assertEquals("real-session", restored.loadForRequest(server.url("/")).single().value)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun unreadableSuccessRemainsUnknown() {
        val server = MockWebServer()
        server.start()
        try {
            val api =
                JourneyApi(server.url("/").toString().trimEnd('/'), SessionCookies({ "[]" }, {}))
            server.enqueue(MockResponse().setBody("not json"))
            try {
                api.request("/api/trips/t/operations", "POST", obj("id" to "stable"))
                fail()
            } catch (e: ApiFailure) {
                assertEquals("RECEIPT_UNKNOWN", e.code)
            }
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun realBackendIdempotentOperation() {
        val url = System.getenv("JOURNEY_TEST_BASE_URL")
        val identifier = System.getenv("JOURNEY_TEST_IDENTIFIER")
        val password = System.getenv("JOURNEY_TEST_PASSWORD")
        val trip = System.getenv("JOURNEY_TEST_TRIP_ID")
        assumeTrue(
            "Optional live fixture provided through environment",
            listOf(url, identifier, password, trip).all { !it.isNullOrBlank() },
        )
        var cookies = "[]"
        val api = JourneyApi(url!!, SessionCookies({ cookies }, { cookies = it }))
        val session =
            api.request(
                "/api/auth/login",
                "POST",
                obj("identifier" to identifier, "password" to password),
            )
        api.csrf = session.s("csrfToken")
        val start = System.nanoTime()
        val clock =
            api.request(
                "/api/clock",
                "POST",
                obj("deviceId" to "android-integration-${UUID.randomUUID()}"),
            )
        val operationId = UUID.randomUUID().toString()
        val objectId = UUID.randomUUID().toString()
        val operation =
            obj(
                "id" to operationId,
                "objectId" to objectId,
                "kind" to "create",
                "objectType" to "expense",
                "patch" to
                    obj(
                        "title" to "Android API验收",
                        "payment" to
                            obj("status" to "paid", "amountMinor" to 0, "currency" to "JPY"),
                    ),
                "clock" to
                    obj(
                        "leaseId" to clock.s("leaseId"),
                        "elapsedMs" to ((System.nanoTime() - start) / 1000000),
                        "uncertaintyMs" to 100,
                    ),
            )
        val first = api.request("/api/trips/$trip/operations", "POST", operation)
        val duplicate = api.request("/api/trips/$trip/operations", "POST", operation)
        assertEquals(operationId, first.o("receipt").s("operationId"))
        assertTrue(duplicate.o("receipt").optBoolean("duplicate"))
        assertEquals(
            1,
            duplicate.o("snapshot").a("objects").rows().count { it.s("id") == objectId },
        )
    }
}
