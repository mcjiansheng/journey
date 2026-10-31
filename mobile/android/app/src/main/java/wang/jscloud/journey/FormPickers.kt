package wang.jscloud.journey

import androidx.compose.material.icons.outlined.Search
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import java.time.LocalDate
import java.time.LocalTime

@Composable
fun DateField(label: String, value: String, set: (String) -> Unit, optional: Boolean = false) {
    val context = LocalContext.current
    TextButton({
        val date = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now())
        DatePickerDialog(context, { _, y, m, d -> set(LocalDate.of(y, m + 1, d).toString()) },
            date.year, date.monthValue - 1, date.dayOfMonth).show()
    }, modifier = Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface)
        Text(value.ifBlank { "选择日期" })
    }
    if (optional && value.isNotBlank()) TextButton({ set("") }) { Text("清除日期") }
}

@Composable
fun TimeField(label: String, value: String, set: (String) -> Unit, optional: Boolean = false) {
    val context = LocalContext.current
    TextButton({
        val time = runCatching { LocalTime.parse(value) }.getOrDefault(LocalTime.of(9, 0))
        TimePickerDialog(context, { _, h, m -> set("%02d:%02d".format(h, m)) },
            time.hour, time.minute, true).show()
    }, modifier = Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface)
        Text(value.ifBlank { if (optional) "暂不设置" else "选择时间" })
    }
    if (optional && value.isNotBlank()) TextButton({ set("") }) { Text("清除结束时间") }
}

@Composable
fun PlaceSearchField(value: String, set: (String) -> Unit, search: () -> Unit) {
    androidx.compose.material3.OutlinedTextField(value, set,
        label = { Text("搜索地点") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { if (value.isNotBlank()) search() }),
        trailingIcon = {
            IconButton(search, enabled = value.isNotBlank()) {
                Icon(androidx.compose.material.icons.Icons.Outlined.Search, "搜索地点")
            }
        })
}
