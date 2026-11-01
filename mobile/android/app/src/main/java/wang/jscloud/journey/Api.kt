package wang.jscloud.journey

import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class ApiFailure(
    val code: String,
    override val message: String,
    val status: Int = 0,
    val details: Any? = null,
) : Exception(message)

class SessionCookies(private val read: () -> String, private val write: (String) -> Unit) :
    CookieJar {
    private val cookies = mutableListOf<Cookie>()

    init {
        runCatching {
            JSONArray(read()).rows().forEach { row ->
                Cookie.parse(
                        HttpUrl.Builder().scheme(row.s("scheme")).host(row.s("host")).build(),
                        row.s("value"),
                    )
                    ?.let { cookies.add(it) }
            }
        }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, incoming: List<Cookie>) {
        incoming.forEach { c ->
            cookies.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
            cookies.add(c)
        }
        write(
            JSONArray(
                    cookies.map {
                        obj(
                            "scheme" to (if (it.secure) "https" else "http"),
                            "host" to it.domain,
                            "value" to it.toString(),
                        )
                    }
                )
                .toString()
        )
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl) =
        cookies.filter { it.expiresAt > System.currentTimeMillis() && it.matches(url) }

    @Synchronized
    fun clear() {
        cookies.clear()
        write("[]")
    }
}

class JourneyApi(val baseUrl: String, cookies: CookieJar) {
    var csrf = ""
    private val origin = URI(baseUrl).let { "${it.scheme}://${it.authority}" }
    val client = OkHttpClient.Builder().cookieJar(cookies).callTimeout(30, TimeUnit.SECONDS).build()

    fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val builder =
            Request.Builder()
                .url(baseUrl.trimEnd('/') + path)
                .header("Accept", "application/json")
                .header("Origin", origin)
        if (method != "GET") {
            builder.header("X-CSRF-Token", csrf)
            builder.method(
                method,
                (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()),
            )
        }
        try {
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                val json =
                    try {
                        JSONObject(text)
                    } catch (_: Exception) {
                        throw ApiFailure("RECEIPT_UNKNOWN", "服务器回复未能读取，请重试确认", response.code)
                    }
                if (!response.isSuccessful) {
                    val e = json.o("error")
                    throw ApiFailure(
                        e.s("code", "HTTP_${response.code}"),
                        e.s("message", "请求失败"),
                        response.code,
                        e.opt("details"),
                    )
                }
                return json
            }
        } catch (e: IOException) {
            throw ApiFailure("NETWORK", "连接中断，修改已留在本机")
        }
    }

    fun search(query: String, city: String = ""): List<JSONObject> {
        val r =
            request(
                "/_AMapService/v3/place/text?keywords=${encode(query)}&city=${encode(city)}&extensions=all&offset=20"
            )
        if (r.s("status") != "1") throw ApiFailure("SEARCH", r.s("info", "地点搜索失败"))
        return r.a("pois").rows().map { p ->
            val ll = p.s("location").split(',')
            obj(
                "name" to p.s("name"),
                "address" to p.s("address"),
                "lng" to ll.getOrNull(0)?.toDoubleOrNull(),
                "lat" to ll.getOrNull(1)?.toDoubleOrNull(),
                "provider" to "amap",
                "providerPlaceId" to p.s("id"),
                "category" to p.s("type"),
                "sourceUrl" to "",
                "fetchedAt" to System.currentTimeMillis(),
                "coordSystem" to "GCJ-02",
            )
        }
    }

    companion object {
        fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    }
}
