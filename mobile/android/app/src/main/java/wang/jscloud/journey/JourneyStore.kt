package wang.jscloud.journey

import android.app.Application
import android.os.SystemClock
import android.util.AtomicFile
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

class JourneyStore(application: Application) : AndroidViewModel(application) {
    private val prefs =
        application.getSharedPreferences("journey-session-" + BuildConfig.BASE_URL.hashCode(), 0)
    private val cookies =
        SessionCookies(
            { prefs.getString("cookies", "[]")!! },
            { prefs.edit().putString("cookies", it).commit() },
        )
    val api = JourneyApi(BuildConfig.BASE_URL, cookies)
    private val mutex = Mutex()
    private var foreground = true

    fun setForeground(value: Boolean) {
        foreground = value
        if (!value) launch { saveContext() }
    }

    var user by mutableStateOf<JSONObject?>(null)
        private set

    var ready by mutableStateOf(false)
        private set

    var sessionExpired by mutableStateOf(false)
        private set

    var trips by mutableStateOf<List<JSONObject>>(emptyList())
        private set

    var snapshot by mutableStateOf<JSONObject?>(null)
        private set

    var tripId by mutableStateOf<String?>(null)
        private set

    var status by mutableStateOf("正在连接")
        private set

    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
        private set

    var page by mutableStateOf("行程")
    var selectedDay by mutableStateOf<String?>(null)
    var pending by mutableStateOf<List<JSONObject>>(emptyList())
        private set

    private var account = JSONObject()
    private var lease: JSONObject? = null
    private var leaseMono = 0L
    private var leaseWall = 0L
    private var uncertainty = 0L
    private var epoch = 0
    private val deviceId =
        prefs.getString("deviceId", null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).commit() }

    init {
        launch {
            try {
                restore()
            } finally {
                ready = true
            }
        }
        viewModelScope.launch {
            while (true) {
                delay(12000)
                if (foreground && user != null && !sessionExpired)
                    this@JourneyStore.launch {
                        ensureSession()
                        sync()
                        if (tripId == null) refreshTrips() else refreshCurrent()
                    }
            }
        }
    }

    private fun file(uid: String) =
        AtomicFile(
            File(
                getApplication<Application>().filesDir,
                "account-${BuildConfig.BASE_URL.hashCode()}-$uid.json",
            )
        )

    private fun readAccount(uid: String): JSONObject {
        val atomic = file(uid)
        if (!atomic.baseFile.exists() && !File(atomic.baseFile.path + ".bak").exists())
            return JSONObject()
        try {
            return JSONObject(atomic.openRead().bufferedReader().use { it.readText() })
        } catch (e: Exception) {
            throw IllegalStateException("本机旅程未能读取，原有修改已保留。请重新打开应用。", e)
        }
    }

    private fun persist() {
        val uid = user?.s("id") ?: return
        account.put("trips", JSONArray(trips))
        account.put("queue", JSONArray(pending))
        account.put("user", user)
        val atomic = file(uid)
        val output = atomic.startWrite()
        try {
            output.write(account.toString().toByteArray())
            atomic.finishWrite(output)
        } catch (e: Exception) {
            atomic.failWrite(output)
            throw e
        }
    }

    private fun installSession(s: JSONObject) {
        api.csrf = s.s("csrfToken")
        lease = null
        epoch++
        sessionExpired = false
        val nextUser = s.o("user")
        val nextAccount = readAccount(nextUser.s("id"))
        user = nextUser
        account = nextAccount
        trips = account.a("trips").rows()
        pending = account.a("queue").rows()
        tripId = null
        snapshot = null
        prefs.edit().putString("lastUser", user!!.s("id")).commit()
    }

    private suspend fun restore() {
        try {
            installSession(api.request("/api/session"))
            refreshTrips()
            acquireClock()
            sync()
            status = "已同步"
        } catch (e: ApiFailure) {
            if (e.status != 401) {
                prefs.getString("lastUser", null)?.let { uid ->
                    account = readAccount(uid)
                    if (account.has("user")) {
                        user = account.o("user")
                        trips = account.a("trips").rows()
                        pending = account.a("queue").rows()
                    }
                }
                status = "离线"
            } else status = "请登录"
        }
        ready = true
    }

    fun launch(task: suspend () -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            mutex.withLock {
                try {
                    task()
                } catch (e: Exception) {
                    if (e is ApiFailure && e.status == 401) sessionExpired = true
                    error = e.message ?: "操作失败"
                    status = if (e is ApiFailure && e.code == "NETWORK") "离线" else "需要处理"
                }
            }
        }
    }

    fun action(task: suspend () -> Unit) {
        if (busy) return
        busy = true
        launch {
            try {
                task()
            } finally {
                busy = false
            }
        }
    }

    suspend fun login(identifier: String, password: String, name: String, register: Boolean) {
        val body =
            obj("identifier" to identifier, "password" to password).apply {
                if (register) put("displayName", name)
            }
        installSession(
            api.request(if (register) "/api/auth/register" else "/api/auth/login", "POST", body)
        )
        persist()
        refreshTrips()
        acquireClock()
        sync()
    }

    suspend fun logout() {
        try {
            api.request("/api/auth/logout", "POST")
        } catch (e: ApiFailure) {
            if (e.status != 401) throw e
        }
        persist()
        epoch++
        user = null
        trips = emptyList()
        pending = emptyList()
        tripId = null
        snapshot = null
        lease = null
        api.csrf = ""
        cookies.clear()
        prefs.edit().remove("lastUser").commit()
    }

    suspend fun refreshTrips() {
        val r = api.request("/api/trips")
        trips = r.a("trips").rows()
        persist()
        status = "已同步"
    }

    suspend fun openTrip(id: String) {
        tripId = id
        selectedDay = null
        val context = account.o("contexts").o(id)
        page =
            when (context.s("page", "itinerary")) {
                "map" -> "地图"
                "ledger" -> "费用"
                "settings" -> "管理"
                else -> "行程"
            }
        selectedDay = context.s("dayId").ifBlank { null }
        snapshot = account.o("snapshots").optJSONObject(id)?.let { overlay(it) }
        refreshCurrent()
        api.request("/api/navigation", "PUT", obj("lastTripId" to id))
    }

    fun home() {
        launch {
            saveContext()
            tripId = null
            snapshot = null
        }
    }

    private fun saveContext() {
        val id = tripId ?: return
        val c = account.o("contexts")
        c.put(
            id,
            obj(
                "page" to
                    when (page) {
                        "地图" -> "map"
                        "费用" -> "ledger"
                        "管理" -> "settings"
                        else -> "itinerary"
                    },
                "dayId" to selectedDay,
            ),
        )
        account.put("contexts", c)
        persist()
    }

    suspend fun refreshCurrent() {
        val id = tripId ?: return
        try {
            val s = api.request("/api/trips/$id")
            storeSnapshot(id, s)
            status = if (pending.isEmpty()) "已同步" else "有待上传修改"
        } catch (e: ApiFailure) {
            if (e.status == 401) status = "请重新登录"
            throw e
        }
    }

    private fun storeSnapshot(id: String, s: JSONObject) {
        account.put("snapshots", account.o("snapshots").put(id, s))
        if (id == tripId) snapshot = overlay(s)
        persist()
    }

    fun objects(kind: String? = null) =
        snapshot?.a("objects")?.rows()?.filter { kind == null || it.s("kind") == kind }
            ?: emptyList()

    private fun overlay(s: JSONObject): JSONObject =
        projectSnapshot(s, pending, user?.s("id").orEmpty())

    private suspend fun acquireClock() {
        val start = SystemClock.elapsedRealtime()
        val wall = System.currentTimeMillis()
        val r = api.request("/api/clock", "POST", obj("deviceId" to deviceId))
        val end = SystemClock.elapsedRealtime()
        lease = r
        leaseMono = (start + end) / 2
        leaseWall = wall + (end - start) / 2
        uncertainty = (end - start) / 2 + 2
    }

    private fun clock(): JSONObject {
        val l =
            lease
                ?: return obj(
                    "leaseId" to "unavailable",
                    "elapsedMs" to 0,
                    "uncertaintyMs" to 0,
                    "uncertain" to true,
                )
        val elapsed = (SystemClock.elapsedRealtime() - leaseMono).coerceAtLeast(0)
        val uncertain =
            kotlin.math.abs((System.currentTimeMillis() - leaseWall) - elapsed) > 2000 ||
                l.optLong("serverTime") + elapsed > l.optLong("expiresAt")
        return obj(
                "leaseId" to l.s("leaseId"),
                "elapsedMs" to elapsed,
                "uncertaintyMs" to (uncertainty + kotlin.math.ceil(elapsed * 0.00005).toLong()),
            )
            .apply { if (uncertain) put("uncertain", true) }
    }

    suspend fun mutate(
        kind: String,
        objectId: String = UUID.randomUUID().toString(),
        objectType: String? = null,
        patch: JSONObject? = null,
        generation: Int? = null,
        expression: JSONObject? = null,
        clearDraft: String? = null,
    ) {
        val id = tripId ?: throw IllegalStateException("请先打开旅程")
        val op =
            obj(
                    "id" to UUID.randomUUID().toString(),
                    "objectId" to objectId,
                    "kind" to kind,
                    "clock" to clock(),
                )
                .apply {
                    if (objectType != null) put("objectType", objectType)
                    if (patch != null) put("patch", patch)
                    if (generation != null) put("generation", generation)
                    if (expression != null) put("expression", expression)
                }
        val candidate =
            pending +
                obj(
                    "tripId" to id,
                    "operation" to op,
                    "summary" to (patch?.s("title")?.ifBlank { null } ?: "旅程修改"),
                )
        val previous = pending
        val previousAccount = account.copyJson()
        pending = candidate
        if (clearDraft != null) account.o("drafts").o(id).remove(clearDraft)
        try {
            persist()
        } catch (e: Exception) {
            pending = previous
            account = previousAccount
            throw e
        }
        account.o("snapshots").optJSONObject(id)?.let { snapshot = overlay(it) }
        status = "有待上传修改"
        launch { sync() }
    }

    private suspend fun sync() {
        if (user == null) return
        val paused = mutableSetOf<String>()
        for (q in pending.toList()) {
            val id = q.s("tripId")
            if (id in paused) continue
            if (q.s("blocked").isNotEmpty()) {
                paused.add(id)
                continue
            }
            if (q.o("operation").o("clock").optBoolean("uncertain") && !q.optBoolean("unknown")) {
                q.put("blocked", "CLOCK_UNCERTAIN")
                paused.add(id)
                persist()
                continue
            }
            try {
                val op = q.o("operation")
                val r = api.request("/api/trips/$id/operations", "POST", op)
                if (r.o("receipt").s("operationId") != op.s("id") || !r.has("snapshot"))
                    throw ApiFailure("RECEIPT_UNKNOWN", "修改结果待确认，请重试")
                pending = pending.filter { it !== q }
                storeSnapshot(id, r.o("snapshot"))
                status = "已同步"
            } catch (e: ApiFailure) {
                if (e.code == "NETWORK" || e.code == "RECEIPT_UNKNOWN" || e.status >= 500) {
                    q.put("unknown", true)
                    status = "修改结果待确认"
                } else {
                    q.remove("unknown")
                    q.put("blocked", e.code)
                    q.put("message", e.message)
                    status = "有修改需要处理"
                    if (e.status == 401) {
                        status = "请重新登录"
                        sessionExpired = true
                    }
                    if (e.status == 403 || e.status == 404)
                        runCatching { storeSnapshot(id, api.request("/api/trips/$id")) }
                }
                paused.add(id)
                persist()
            }
        }
        pending = pending.toList()
        tripId?.let { id ->
            account.o("snapshots").optJSONObject(id)?.let { snapshot = overlay(it) }
        }
    }

    private suspend fun ensureSession() {
        val current = user?.s("id") ?: return
        val session = api.request("/api/session")
        if (session.o("user").s("id") != current)
            throw ApiFailure("SESSION_CHANGED", "账号已变化，请重新登录。未上传修改保留在原账号。", 401)
        api.csrf = session.s("csrfToken")
        if (lease == null) acquireClock()
        pending
            .filter { it.s("blocked") == "CSRF_REJECTED" }
            .forEach {
                it.remove("blocked")
                it.remove("message")
            }
    }

    suspend fun retry() {
        ensureSession()
        acquireClock()
        pending.filter { it.s("blocked") != "CLOCK_UNCERTAIN" }.forEach { it.remove("blocked") }
        sync()
        refreshTrips()
        refreshCurrent()
    }

    suspend fun recover(id: String, reapply: Boolean, expected: List<String>) {
        val tripQueue = pending.filter { it.s("tripId") == id }
        require(tripQueue.map { it.o("operation").s("id") } == expected) { "修改列表已更新，请重新查看" }
        require(tripQueue.none { it.optBoolean("unknown") }) { "请先重试以确认修改结果" }
        val backup = pending.map { it.copyJson() }
        if (reapply) {
            require(
                tripQueue.firstOrNull()?.let {
                    it.s("blocked") == "CLOCK_UNCERTAIN" ||
                        it.o("operation").o("clock").optBoolean("uncertain")
                } == true
            ) {
                "这组修改无法重新应用"
            }
            acquireClock()
            val c = clock()
            require(!c.optBoolean("uncertain")) { "请联网后重试" }
            val prefix = UUID.randomUUID().toString()
            tripQueue.forEachIndexed { i, q ->
                q.o("operation")
                    .put("id", "$prefix-${i.toString().padStart(8,'0')}")
                    .put("clock", c.copyJson())
                q.remove("blocked")
                q.remove("message")
            }
        } else pending = pending.filter { it.s("tripId") != id }
        try {
            persist()
        } catch (e: Exception) {
            pending = backup
            throw e
        }
        sync()
        refreshCurrent()
    }

    suspend fun moveActivity(objectId: String, direction: Int) {
        val row = objects("activity").find { it.s("id") == objectId } ?: return
        val rows = orderedActivities(objects(), row.o("payload").s("dayId")).toMutableList()
        val from = rows.indexOfFirst { it.s("id") == objectId }
        val to = from + direction
        if (to !in rows.indices) return
        val other = rows[to]
        rows[to] = rows[from]
        rows[from] = other
        rows.forEachIndexed { index, activity ->
            val rank = index * 1024.0
            if (activity.o("payload").optDouble("order") != rank)
                mutate("patch", activity.s("id"), patch = obj("order" to rank))
        }
    }

    suspend fun createTrip(form: JSONObject) {
        val s = api.request("/api/trips", "POST", form.put("id", UUID.randomUUID().toString()))
        refreshTrips()
        tripId = s.o("trip").s("id")
        storeSnapshot(tripId!!, s)
        selectedDay = null
        page = "行程"
    }

    suspend fun join(code: String) {
        val s = api.request("/api/invites/accept", "POST", obj("code" to code))
        refreshTrips()
        tripId = s.o("trip").s("id")
        storeSnapshot(tripId!!, s)
        page = "行程"
    }

    fun draft(key: String): JSONObject? =
        tripId?.let { account.o("drafts").o(it).optJSONObject(key)?.copyJson() }

    suspend fun saveDraft(
        key: String,
        value: JSONObject,
        id: String? = tripId,
        uid: String? = user?.s("id"),
    ) {
        if (uid != user?.s("id") || id == null) return
        val drafts = account.o("drafts")
        drafts.put(id, drafts.o(id).put(key, value))
        account.put("drafts", drafts)
        persist()
    }

    suspend fun profile(name: String, prefs: JSONObject) {
        user = api.request("/api/me", "PATCH", obj("displayName" to name, "preferences" to prefs))
        persist()
    }

    suspend fun management(
        path: String,
        method: String = "POST",
        body: JSONObject? = null,
    ): JSONObject {
        val r = api.request(path, method, body)
        refreshTrips()
        refreshCurrent()
        return r
    }

    suspend fun leave(confirm: Boolean) {
        val id = tripId ?: return
        require(pending.none { it.s("tripId") == id }) { "请先处理这段旅程的未上传修改，再退出" }
        api.request("/api/trips/$id/leave", "POST", obj("confirmPurge" to confirm))
        account.o("snapshots").remove(id)
        pending = pending.filter { it.s("tripId") != id }
        tripId = null
        snapshot = null
        refreshTrips()
    }
}
