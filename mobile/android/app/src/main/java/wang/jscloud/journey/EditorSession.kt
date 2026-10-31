package wang.jscloud.journey

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray
import java.util.UUID

/** All writes go through the store's account-scoped serial queue. */
class EditorSession(
    private val store: JourneyStore,
    private val key: String,
    private val kind: String,
    existing: JSONObject?,
    draft: JSONObject?,
) {
    private val tripId = store.tripId
    private val uid = store.user?.s("id")
    val objectId = existing?.s("id") ?: draft?.s("objectId")?.ifBlank { null } ?: UUID.randomUUID().toString()
    private var created by mutableStateOf(existing != null || draft?.optBoolean("created") == true)
    val hasObject: Boolean get() = created
    private var saved = existing?.o("payload")?.copyJson() ?: draft?.optJSONObject("savedPayload")

    fun save(draft: JSONObject, payload: JSONObject?, dirty: List<String>, close: (() -> Unit)? = null,
        onSaved: (JSONObject, List<String>) -> Unit = { _, _ -> }) {
        val fields = dirty.toList()
        store.launch {
            if (store.tripId != tripId || store.user?.s("id") != uid) return@launch
            // Preserve incomplete input before attempting to publish a complete payload.
            if (fields.isNotEmpty()) {
                store.saveDraft(key, draft.copyJson().put("objectId", objectId)
                    .put("created", created).put("savedPayload", saved ?: JSONObject.NULL).put("dirty", JSONArray(fields)), tripId, uid)
                if (payload != null) {
                    val patch = editorPatch(saved, payload, fields, created)
                    if (patch.length() > 0) {
                        store.mutate(if (created) "patch" else "create", objectId,
                            if (created) null else kind, patch, clearDraft = key)
                        created = true
                        saved = payload.copyJson()
                    } else store.clearEditorDraft(key)
                    withContext(Dispatchers.Main) { onSaved(draft, fields) }
                }
            }
            close?.invoke()
        }
    }
}

@Composable
fun EditorSaveStatus(s: JourneyStore, valid: Boolean) {
    Text(
        if (!valid) "填写完整后自动保存"
        else if (s.pending.isNotEmpty()) "已保存到此设备 · 正在同步"
        else if (s.status == "已同步") "已同步" else "已保存到此设备",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

internal fun editorPatch(saved: JSONObject?, payload: JSONObject, fields: List<String>, created: Boolean): JSONObject =
    if (!created) payload.copyJson() else JSONObject().apply {
        fields.forEach { field ->
            if (saved?.opt(field)?.toString() != payload.opt(field)?.toString()) put(field, payload.get(field))
        }
    }

internal fun restoreEditorDraft(current: JSONObject, draft: JSONObject): JSONObject = current.copyJson().apply {
    editorDraftFields(draft).forEach { put(it, draft.o("payload").get(it)) }
}

internal fun editorDraftFields(draft: JSONObject): List<String> = draft.optJSONArray("dirty")?.let { fields ->
    (0 until fields.length()).map { fields.getString(it) }
} ?: draft.o("payload").keys().asSequence().toList()

internal fun expenseCanPublish(payload: JSONObject?, hasObject: Boolean, amount: String) =
    payload != null && (hasObject || payload.s("title").isNotBlank() || amount.isNotBlank())
