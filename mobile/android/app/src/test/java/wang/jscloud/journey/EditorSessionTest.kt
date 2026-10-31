package wang.jscloud.journey

import org.junit.Assert.*
import org.junit.Test

class EditorSessionTest {
    @Test fun firstSaveIncludesUntouchedDefaults() {
        val payload = obj("title" to "博物馆", "dayId" to "day-1", "notes" to "")
        val patch = editorPatch(null, payload, listOf("title"), false)
        assertEquals("day-1", patch.s("dayId"))
        assertTrue(patch.has("notes"))
    }

    @Test fun nextAutosaveDoesNotOverwriteCollaboratorsUntouchedFields() {
        val saved = obj("title" to "午餐", "notes" to "原备注")
        val current = obj("title" to "晚餐", "notes" to "其他成员更新的备注")
        val patch = editorPatch(saved, current, listOf("title"), true)
        assertEquals("晚餐", patch.s("title"))
        assertFalse(patch.has("notes"))
    }

    @Test fun completeAfterAutosaveDoesNotQueueDuplicatePatch() {
        val payload = obj("title" to "酒店", "notes" to "两晚")
        assertEquals(0, editorPatch(payload, payload.copyJson(), listOf("title", "notes"), true).length())
    }

    @Test fun clearingOptionalFieldIsAnExplicitNull() {
        val patch = editorPatch(obj("date" to "2026-11-06"), obj("date" to null), listOf("date"), true)
        assertTrue(patch.has("date"))
        assertTrue(patch.isNull("date"))
    }

    @Test fun recoveredIncompleteTimeDoesNotRestoreOldCollaboratorNotes() {
        val current = obj("title" to "新标题", "notes" to "同伴新备注", "time" to obj("mode" to "flexible"))
        val draft = obj("payload" to obj("title" to "旧标题", "notes" to "旧备注", "time" to obj("mode" to "precise")),
            "dirty" to org.json.JSONArray(listOf("time")))
        val restored = restoreEditorDraft(current, draft)
        assertEquals("同伴新备注", restored.s("notes"))
        assertEquals("新标题", restored.s("title"))
        assertEquals("precise", restored.o("time").s("mode"))
    }

    @Test fun existingEstimatedExpenseCanClearItsOnlyTitle() {
        val payload = obj("title" to "", "payment" to obj("status" to "estimated", "amountMinor" to null))
        assertTrue(expenseCanPublish(payload, true, ""))
        assertFalse(expenseCanPublish(payload, false, ""))
        val patch = editorPatch(obj("title" to "午饭"), payload, listOf("title"), true)
        assertTrue(patch.has("title"))
        assertEquals("", patch.s("title"))
    }
}
