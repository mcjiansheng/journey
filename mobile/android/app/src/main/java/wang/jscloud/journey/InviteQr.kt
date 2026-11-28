package wang.jscloud.journey

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.delay
import org.json.JSONObject

class QrMatrix(val size: Int, val bits: BooleanArray)

fun encodeQrMatrix(content: String, size: Int = 256): QrMatrix {
    val hints =
        mapOf(
            EncodeHintType.CHARACTER_SET to "UTF-8",
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to 2,
        )
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size, hints)
    val width = matrix.width
    val height = matrix.height
    val bits = BooleanArray(width * height)
    for (y in 0 until height) {
        val offset = y * width
        for (x in 0 until width) {
            bits[offset + x] = matrix[x, y]
        }
    }
    return QrMatrix(width, bits)
}

private val qrDecodeHints =
    mapOf(
        DecodeHintType.TRY_HARDER to true,
        DecodeHintType.CHARACTER_SET to "UTF-8",
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
    )

private fun decodeLuminanceSource(source: LuminanceSource): String? {
    val reader = QRCodeReader()
    val direct = runCatching { reader.decode(BinaryBitmap(HybridBinarizer(source)), qrDecodeHints).text }.getOrNull()
    if (!direct.isNullOrBlank()) return direct
    return runCatching {
        reader.decode(BinaryBitmap(HybridBinarizer(source.invert())), qrDecodeHints).text
    }.getOrNull()?.takeIf { it.isNotBlank() }
}

fun decodeQrFromLuminance(luminance: ByteArray, width: Int, height: Int): String? {
    if (width <= 0 || height <= 0 || luminance.size < width * height) return null
    val source = PlanarYUVLuminanceSource(luminance, width, height, 0, 0, width, height, false)
    return decodeLuminanceSource(source)
}

fun renderQrBitmap(
    content: String,
    size: Int = 512,
    darkColor: Int = 0xFF185548.toInt(),
    lightColor: Int = 0xFFFFFFFF.toInt(),
): Bitmap {
    val matrix = encodeQrMatrix(content, size)
    val pixels = IntArray(matrix.size * matrix.size) { index -> if (matrix.bits[index]) darkColor else lightColor }
    return Bitmap.createBitmap(pixels, matrix.size, matrix.size, Bitmap.Config.ARGB_8888)
}

fun decodeQrFromBitmap(bitmap: Bitmap): String? {
    val maxSide = 1200
    val scaled =
        if (bitmap.width > maxSide || bitmap.height > maxSide) {
            val scale = maxSide.toFloat() / maxOf(bitmap.width, bitmap.height)
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * scale).toInt().coerceAtLeast(1),
                (bitmap.height * scale).toInt().coerceAtLeast(1),
                true,
            )
        } else bitmap
    val pixels = IntArray(scaled.width * scaled.height)
    scaled.getPixels(pixels, 0, scaled.width, 0, 0, scaled.width, scaled.height)
    return decodeLuminanceSource(RGBLuminanceSource(scaled.width, scaled.height, pixels))
}

private fun decodeImageProxyQr(image: ImageProxy): String? {
    val plane = image.planes.firstOrNull() ?: return null
    val buffer = plane.buffer
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    val width = image.width
    val height = image.height
    val bytes = ByteArray(width * height)
    if (pixelStride == 1 && rowStride == width) {
        buffer.get(bytes, 0, bytes.size)
    } else {
        val row = ByteArray(rowStride)
        for (y in 0 until height) {
            val remaining = buffer.remaining()
            if (remaining <= 0) break
            val count = minOf(rowStride, remaining)
            buffer.get(row, 0, count)
            for (x in 0 until width) {
                val srcIdx = x * pixelStride
                bytes[y * width + x] = if (srcIdx < count) row[srcIdx] else 0
            }
        }
    }
    return decodeQrFromLuminance(bytes, width, height)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InviteQrCard(invite: JSONObject, tripName: String, onShare: () -> Unit) {
    val ctx = LocalContext.current
    val url = invite.s("url")
    val code = invite.s("code")
    val qrBitmap = remember(url) { if (url.isNotBlank()) renderQrBitmap(url).asImageBitmap() else null }
    var copiedKey by remember { mutableStateOf("") }
    LaunchedEffect(copiedKey) {
        if (copiedKey.isNotEmpty()) {
            delay(2000)
            copiedKey = ""
        }
    }
    fun copyText(value: String, key: String, label: String) {
        val manager = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        manager.setPrimaryClip(ClipData.newPlainText(label, value))
        copiedKey = key
    }
    Panel {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            qrBitmap?.let { bitmap ->
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.padding(top = 4.dp),
                ) {
                    Image(
                        bitmap = bitmap,
                        contentDescription = "加入 ${tripName} 的邀请二维码",
                        modifier = Modifier.size(200.dp).padding(12.dp),
                    )
                }
            }
            Text(code, style = MaterialTheme.typography.headlineSmall)
            Text(
                "有效至 " +
                    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA)
                        .format(Date(invite.optLong("expiresAt"))),
                style = MaterialTheme.typography.bodySmall,
                color = LocalJourneyPalette.current.muted,
            )
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SecondaryButton({ copyText(code, "code", "邀请编码") }) {
                    Icon(
                        if (copiedKey == "code") Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(if (copiedKey == "code") "已复制编码" else "复制编码", maxLines = 1, softWrap = false)
                }
                SecondaryButton({ copyText(url, "url", "邀请链接") }) {
                    Icon(
                        if (copiedKey == "url") Icons.Outlined.Check else Icons.Outlined.Link,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(if (copiedKey == "url") "已复制链接" else "复制链接", maxLines = 1, softWrap = false)
                }
                SecondaryButton(onShare) {
                    Icon(Icons.Outlined.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("分享邀请", maxLines = 1, softWrap = false)
                }
            }
        }
    }
}

@Composable
fun QrScannerDialog(onScanned: (String) -> Unit, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val hasCameraFeature = remember {
        ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var permissionRequested by remember { mutableStateOf(false) }
    var scanError by remember { mutableStateOf("") }
    var settled by remember { mutableStateOf(false) }
    val currentOnScanned by rememberUpdatedState(onScanned)

    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            hasPermission = granted
            permissionRequested = true
            if (!granted) scanError = "未获得相机权限，可从相册选择二维码图片或直接粘贴邀请链接。"
        }

    val galleryLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            val decoded =
                runCatching {
                    ctx.contentResolver.openInputStream(uri)?.use { stream ->
                        val bmp = BitmapFactory.decodeStream(stream) ?: return@use null
                        decodeQrFromBitmap(bmp)
                    }
                }.getOrNull()
            if (!decoded.isNullOrBlank()) {
                settled = true
                currentOnScanned(decoded)
            } else {
                scanError = "图片里没有识别到二维码，请换一张或直接粘贴链接。"
            }
        }

    LaunchedEffect(hasCameraFeature) {
        if (hasCameraFeature && !hasPermission && !permissionRequested) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Sheet("扫描邀请二维码", onDismiss) {
        if (!hasCameraFeature) {
            Panel {
                Text("当前设备没有可用相机", style = MaterialTheme.typography.titleMedium)
                Text(
                    "可以从相册选择包含二维码的图片，或关闭后直接粘贴邀请链接。",
                    color = LocalJourneyPalette.current.muted,
                )
            }
        } else if (!hasPermission) {
            Panel {
                Text("需要相机权限以扫描二维码", style = MaterialTheme.typography.titleMedium)
                SecondaryButton({ permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                    Text("授予相机权限")
                }
            }
        } else {
            val previewView = remember { PreviewView(ctx) }
            val analyzerExecutor = remember { Executors.newSingleThreadExecutor() }
            Box(
                Modifier.fillMaxWidth()
                    .height(280.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.Black)
                    .semantics { contentDescription = "二维码相机取景框" }
            ) {
                AndroidView({ previewView }, modifier = Modifier.fillMaxSize())
            }
            DisposableEffect(lifecycleOwner, previewView) {
                val future = ProcessCameraProvider.getInstance(ctx)
                var provider: ProcessCameraProvider? = null
                val listener = Runnable {
                    runCatching {
                        provider = future.get()
                        val preview =
                            Preview.Builder().build().also {
                                it.surfaceProvider = previewView.surfaceProvider
                            }
                        val analysis =
                            ImageAnalysis.Builder()
                                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                .build()
                        analysis.setAnalyzer(analyzerExecutor) { image ->
                            try {
                                if (!settled) {
                                    val code = decodeImageProxyQr(image)
                                    if (!code.isNullOrBlank()) {
                                        settled = true
                                        ContextCompat.getMainExecutor(ctx).execute {
                                            currentOnScanned(code)
                                        }
                                    }
                                }
                            } finally {
                                image.close()
                            }
                        }
                        provider?.unbindAll()
                        provider?.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            analysis,
                        )
                    }.onFailure {
                        ContextCompat.getMainExecutor(ctx).execute {
                            scanError = "相机启动失败，可从相册选择二维码图片。"
                        }
                    }
                }
                future.addListener(listener, ContextCompat.getMainExecutor(ctx))
                onDispose {
                    runCatching { provider?.unbindAll() }
                    analyzerExecutor.shutdown()
                }
            }
        }
        if (scanError.isNotEmpty()) {
            Text(scanError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        SecondaryButton(
            onClick = { galleryLauncher.launch("image/*") },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.PhotoLibrary, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("从相册选择二维码")
        }
    }
}
