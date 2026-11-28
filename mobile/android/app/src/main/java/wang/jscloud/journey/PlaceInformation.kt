package wang.jscloud.journey

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

data class PlacePhotoData(val url: String, val title: String)

data class PlaceInformationData(
    val type: String = "",
    val photo: PlacePhotoData? = null,
    val openingHours: String = "",
    val telephone: String = "",
    val telephoneUrl: String = "",
    val website: String = "",
    val introduction: String = "",
    val detailUrl: String = "",
) {
    val hasSummary: Boolean
        get() = photo != null || type.isNotEmpty() || openingHours.isNotEmpty()

    val hasDetails: Boolean
        get() =
            introduction.isNotEmpty() ||
                telephone.isNotEmpty() ||
                website.isNotEmpty() ||
                detailUrl.isNotEmpty()

    val isEmpty: Boolean
        get() = !hasSummary && !hasDetails
}

private fun placeText(value: Any?): String = if (value is String) value.trim() else ""

private val httpSchemePrefix = Regex("^https?://", RegexOption.IGNORE_CASE)
private val telephonePattern = Regex("^\\+?[\\d\\s()-]{3,30}$")
private val telephoneSplit = Regex("[;,；，]")
private val telephoneStrip = Regex("[\\s()-]")

/**
 * Accepts only absolute HTTP(S) URLs without embedded credentials, matching `safePlaceUrl` in
 * `app/src/place-information.js`.
 */
fun safePlaceUrl(value: Any?): String {
    val candidate = placeText(value)
    if (!httpSchemePrefix.containsMatchIn(candidate)) return ""
    val parsed = candidate.toHttpUrlOrNull() ?: return ""
    if (parsed.username.isNotEmpty() || parsed.password.isNotEmpty()) return ""
    return parsed.toString()
}

private fun photoUrl(value: Any?): String {
    val safe = safePlaceUrl(value)
    if (safe.isEmpty()) return ""
    val parsed = safe.toHttpUrlOrNull() ?: return ""
    val host = parsed.host
    if ((host.endsWith(".amap.com") || host.endsWith(".autonavi.com")) && parsed.scheme == "http") {
        val builder = parsed.newBuilder().scheme("https")
        if (parsed.port == 80) builder.port(443)
        return builder.build().toString()
    }
    return parsed.toString()
}

private fun encodeUriComponent(value: String): String {
    val unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    val bytes = value.toByteArray(Charsets.UTF_8)
    return buildString(bytes.size) {
        for (byte in bytes) {
            val code = byte.toInt() and 0xFF
            val ch = code.toChar()
            if (code < 0x80 && ch in unreserved) append(ch)
            else {
                append('%')
                append("0123456789ABCDEF"[code ushr 4])
                append("0123456789ABCDEF"[code and 0x0F])
            }
        }
    }
}

/**
 * Port of `normalizePlaceInformation` from `app/src/place-information.js` returning the exact JSON
 * shape verified against `mobile/fixtures/place-information.json`.
 */
fun normalizePlaceInformation(poi: JSONObject? = null): JSONObject {
    val p = poi ?: JSONObject()
    val detail =
        listOf("scenic", "dining", "cinema", "hotel")
            .asSequence()
            .mapNotNull { p.optJSONObject(it) }
            .firstOrNull() ?: JSONObject()

    val photos = mutableListOf<JSONObject>()
    fun collectPhotos(array: JSONArray?) {
        if (array == null) return
        for (i in 0 until array.length()) {
            array.optJSONObject(i)?.let { photos.add(it) }
        }
    }
    collectPhotos(p.optJSONArray("photos"))
    collectPhotos(detail.optJSONArray("photos"))

    var resolvedPhoto: JSONObject? = null
    for (entry in photos) {
        val url = photoUrl(entry.opt("url"))
        if (url.isNotEmpty()) {
            resolvedPhoto = obj("url" to url, "title" to placeText(entry.opt("title")))
            break
        }
    }

    val telephone = placeText(p.opt("tel"))
    val firstTelephone = telephone.split(telephoneSplit).firstOrNull().orEmpty().trim()
    val telephoneUrl =
        if (telephonePattern.matches(firstTelephone))
            "tel:" + firstTelephone.replace(telephoneStrip, "")
        else ""

    val type =
        placeText(p.opt("type"))
            .split(';')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .lastOrNull()
            .orEmpty()

    val id = placeText(p.opt("id"))
    val openingHours =
        listOf(
                p.opt("opentime2"),
                p.opt("open_time"),
                detail.opt("opentime"),
                detail.opt("openingtime"),
            )
            .map { placeText(it) }
            .firstOrNull { it.isNotEmpty() }
            .orEmpty()

    return obj(
        "type" to type,
        "photo" to (resolvedPhoto ?: JSONObject.NULL),
        "openingHours" to openingHours,
        "telephone" to telephone,
        "telephoneUrl" to telephoneUrl,
        "website" to safePlaceUrl(p.opt("website")),
        "introduction" to placeText(detail.opt("intro")),
        "detailUrl" to if (id.isNotEmpty()) "https://www.amap.com/place/${encodeUriComponent(id)}" else "",
    )
}

fun JSONObject.toPlaceInformationData(): PlaceInformationData {
    val photoObj = optJSONObject("photo")
    val photo =
        photoObj?.let {
            val url = it.s("url")
            if (url.isNotEmpty()) PlacePhotoData(url, it.s("title")) else null
        }
    return PlaceInformationData(
        type = s("type"),
        photo = photo,
        openingHours = s("openingHours"),
        telephone = s("telephone"),
        telephoneUrl = s("telephoneUrl"),
        website = s("website"),
        introduction = s("introduction"),
        detailUrl = s("detailUrl"),
    )
}

/**
 * Flattens AMap REST v3 `biz_ext` fields onto a shallow copy so `normalizePlaceInformation`
 * reads `opentime2` / `open_time` uniformly from both JSAPI and REST responses.
 */
fun flattenRestPoi(poi: JSONObject): JSONObject {
    val copy = poi.copyJson()
    val bizExt = copy.optJSONObject("biz_ext") ?: return copy
    for (key in listOf("opentime2", "open_time")) {
        if (placeText(copy.opt(key)).isEmpty() && placeText(bizExt.opt(key)).isNotEmpty()) {
            copy.put(key, bizExt.opt(key))
        }
    }
    return copy
}

private fun restPoiToPlace(poi: JSONObject): JSONObject {
    val ll = placeText(poi.opt("location")).split(',')
    val address = placeText(poi.opt("address")).ifEmpty { placeText(poi.opt("district")) }
    val category = placeText(poi.opt("type")).split(';').firstOrNull().orEmpty()
    val id = placeText(poi.opt("id")).ifEmpty { null }
    return obj(
        "name" to placeText(poi.opt("name")),
        "address" to address,
        "lng" to ll.getOrNull(0)?.toDoubleOrNull(),
        "lat" to ll.getOrNull(1)?.toDoubleOrNull(),
        "provider" to "amap",
        "providerPlaceId" to id,
        "category" to category,
        "sourceUrl" to "",
        "fetchedAt" to System.currentTimeMillis(),
        "coordSystem" to "GCJ-02",
    )
}

fun searchPlacesWithInfo(
    api: JourneyApi,
    query: String,
    city: String = "",
): List<Pair<JSONObject, PlaceInformationData>> {
    val r =
        api.request(
            "/_AMapService/v3/place/text?keywords=${JourneyApi.encode(query)}&city=${JourneyApi.encode(city)}&extensions=all&offset=20"
        )
    if (r.s("status") != "1") throw ApiFailure("SEARCH", r.s("info", "地点搜索失败"))
    return r.a("pois").rows().map { raw ->
        val flat = flattenRestPoi(raw)
        restPoiToPlace(flat) to normalizePlaceInformation(flat).toPlaceInformationData()
    }
}

fun fetchPlaceDetail(
    api: JourneyApi,
    providerPlaceId: String,
): Pair<JSONObject, PlaceInformationData>? {
    val id = providerPlaceId.trim()
    if (id.isEmpty()) return null
    val r =
        api.request(
            "/_AMapService/v3/place/detail?id=${JourneyApi.encode(id)}&extensions=all"
        )
    if (r.s("status") != "1") return null
    val raw = r.a("pois").rows().firstOrNull() ?: return null
    val flat = flattenRestPoi(raw)
    return restPoiToPlace(flat) to normalizePlaceInformation(flat).toPlaceInformationData()
}

private object PlacePhotoCache {
    private val cache = object : LruCache<String, Bitmap>(24) {}

    fun get(url: String): Bitmap? = synchronized(cache) { cache.get(url) }

    fun put(url: String, bitmap: Bitmap) {
        synchronized(cache) { cache.put(url, bitmap) }
    }
}

@Composable
private fun PlacePhoto(photo: PlacePhotoData, placeName: String, client: OkHttpClient) {
    var bitmap by remember(photo.url) { mutableStateOf<ImageBitmap?>(PlacePhotoCache.get(photo.url)?.asImageBitmap()) }
    LaunchedEffect(photo.url) {
        if (bitmap != null) return@LaunchedEffect
        val loaded =
            withContext(Dispatchers.IO) {
                runCatching {
                    val req = Request.Builder().url(photo.url).build()
                    client.newCall(req).execute().use { resp ->
                        if (!resp.isSuccessful) return@use null
                        val bytes = resp.body?.bytes() ?: return@use null
                        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@use null
                        PlacePhotoCache.put(photo.url, decoded)
                        decoded
                    }
                }.getOrNull()
            }
        if (loaded != null) bitmap = loaded.asImageBitmap()
    }
    bitmap?.let { img ->
        Image(
            bitmap = img,
            contentDescription = photo.title.ifEmpty { "${placeName}照片" },
            contentScale = ContentScale.Crop,
            modifier =
                Modifier.size(width = 88.dp, height = 72.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalJourneyPalette.current.icon),
        )
    }
}

@Composable
fun PlaceInformationSection(
    info: PlaceInformationData?,
    placeName: String,
    expanded: Boolean,
    client: OkHttpClient,
    modifier: Modifier = Modifier,
) {
    if (info == null || info.isEmpty) return
    val ctx = LocalContext.current
    val palette = LocalJourneyPalette.current
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (info.hasSummary) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                info.photo?.let { PlacePhoto(it, placeName, client) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (info.type.isNotEmpty()) {
                        Text(
                            info.type,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = palette.text,
                        )
                    }
                    if (info.openingHours.isNotEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(
                                Icons.Outlined.Schedule,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp).padding(top = 2.dp),
                                tint = palette.muted,
                            )
                            Text(
                                info.openingHours,
                                style = MaterialTheme.typography.bodySmall,
                                color = palette.muted,
                            )
                        }
                    }
                }
            }
        }
        if (expanded && info.hasDetails) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (info.introduction.isNotEmpty()) {
                    Text(
                        info.introduction,
                        style = MaterialTheme.typography.bodySmall,
                        color = palette.muted,
                    )
                }
                if (info.telephone.isNotEmpty()) {
                    Row(
                        modifier =
                            Modifier.then(
                                if (info.telephoneUrl.isNotEmpty())
                                    Modifier.clickable {
                                        runCatching {
                                            ctx.startActivity(
                                                Intent(Intent.ACTION_DIAL, Uri.parse(info.telephoneUrl))
                                            )
                                        }
                                    }
                                else Modifier
                            ),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.Phone,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = if (info.telephoneUrl.isNotEmpty()) palette.primary else palette.muted,
                        )
                        Text(
                            info.telephone,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (info.telephoneUrl.isNotEmpty()) palette.primary else palette.muted,
                            textDecoration =
                                if (info.telephoneUrl.isNotEmpty()) TextDecoration.Underline else TextDecoration.None,
                        )
                    }
                }
                if (info.website.isNotEmpty()) {
                    TextButton(
                        onClick = {
                            runCatching {
                                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(info.website)))
                            }
                        },
                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
                    ) {
                        Icon(Icons.Outlined.Public, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("地点网站")
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(14.dp))
                    }
                }
                if (info.detailUrl.isNotEmpty()) {
                    TextButton(
                        onClick = {
                            runCatching {
                                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(info.detailUrl)))
                            }
                        },
                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
                    ) {
                        Text("在高德地图查看")
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }
    }
}
