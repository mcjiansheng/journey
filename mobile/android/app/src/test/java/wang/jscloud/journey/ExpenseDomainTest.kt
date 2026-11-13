package wang.jscloud.journey

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ExpenseDomainTest {
    private fun objects() = listOf(
        obj("id" to "d", "kind" to "day", "state" to "active", "payload" to obj("date" to "2026-11-04")),
        obj("id" to "a", "kind" to "activity", "state" to "active", "payload" to obj("title" to "午餐", "dayId" to "d")),
    )
    private fun expense(date: String? = null) = obj("title" to "", "activityId" to "a", "date" to date, "payment" to obj("status" to "paid"))
    @Test fun followsActivityUntilPaymentDateIsSet() {
        val objects = objects()
        assertEquals("2026-11-04", expenseDate(objects, expense()))
        objects[0].o("payload").put("date", "2026-11-05")
        assertEquals("2026-11-05", expenseDate(objects, expense()))
        assertEquals("2026-11-03", expenseDate(objects, expense("2026-11-03")))
        assertEquals("午餐", expenseTitle(objects, expense()))
    }
    @Test fun deletedAssociationIsUndatedButExplicitDateRemains() {
        for (target in 0..1) {
            val objects = objects()
            objects[target].put("state", "deleted")
            assertEquals("", expenseDate(objects, expense()))
            assertNull(linkedExpenseActivity(objects, expense()))
            assertEquals("已支付", expenseTitle(objects, expense()))
            assertEquals("2026-11-03", expenseDate(objects, expense("2026-11-03")))
        }
    }
    @Test fun datesUseJourneyOrdinalAndOutsidePaymentLabels() {
        val trip = obj("startDate" to "2026-10-30", "dayCount" to 9)
        assertTrue(expenseDateLabel(trip, "2026-11-04").startsWith("第 6 天 · 11/04"))
        assertTrue(expenseDateLabel(trip, "2026-10-29").startsWith("行前支付"))
        assertTrue(expenseDateLabel(trip, "2026-11-08").startsWith("行后支付"))
        assertEquals("未记录日期", expenseDateLabel(trip, ""))
    }
}
