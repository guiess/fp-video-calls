package com.fpvideocalls.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Map
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.LocationPoint
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.LocationViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Screen that displays a contact's current location and location history.
 * Uses real-time Firestore listener for live current location updates.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationViewScreen(
    contactUid: String,
    contactName: String,
    onBack: () -> Unit,
    viewModel: LocationViewModel = hiltViewModel()
) {
    val currentLocation by viewModel.currentLocation.collectAsState()
    val history by viewModel.locationHistory.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val error by viewModel.error.collectAsState()

    LaunchedEffect(contactUid) {
        viewModel.observeLocation(contactUid)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
    ) {
        TopAppBar(
            title = {
                Column {
                    Text(
                        contactName,
                        color = OnBackground,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        stringResource(R.string.view_location),
                        color = TextSecondary,
                        fontSize = 13.sp
                    )
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = stringResource(R.string.cd_back),
                        tint = OnBackground
                    )
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Surface)
        )

        when {
            isLoading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = Purple)
                }
            }
            error != null -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        stringResource(R.string.no_location_data),
                        color = TextSecondary,
                        fontSize = 16.sp
                    )
                }
            }
            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Current location card
                    item {
                        CurrentLocationCard(
                            location = currentLocation,
                            contactName = contactName
                        )
                    }

                    // History section header
                    if (history.isNotEmpty()) {
                        item {
                            Text(
                                stringResource(R.string.location_history),
                                color = OnBackground,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(top = 8.dp)
                            )
                        }

                        items(history, key = { it.timestamp }) { point ->
                            HistoryItem(
                                location = point,
                                contactName = contactName
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CurrentLocationCard(location: LocationPoint?, contactName: String) {
    val context = LocalContext.current

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.LocationOn,
                    contentDescription = null,
                    tint = Purple,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.current_location),
                    color = OnBackground,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(Modifier.height(12.dp))

            if (location != null) {
                Text(
                    formatCoordinates(location.lat, location.lng),
                    color = OnBackground,
                    fontSize = 14.sp
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.location_accuracy, location.accuracy.toInt()),
                    color = TextSecondary,
                    fontSize = 13.sp
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    formatTimestamp(location.timestamp),
                    color = TextSecondary,
                    fontSize = 13.sp
                )
                Spacer(Modifier.height(12.dp))

                Button(
                    onClick = { openInMaps(context, location.lat, location.lng, contactName) },
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Purple)
                ) {
                    Icon(Icons.Default.Map, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.open_in_maps), fontWeight = FontWeight.SemiBold)
                }
            } else {
                Text(
                    stringResource(R.string.no_location_data),
                    color = TextSecondary,
                    fontSize = 14.sp
                )
            }
        }
    }
}

@Composable
private fun HistoryItem(location: LocationPoint, contactName: String) {
    val context = LocalContext.current

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    formatTimestamp(location.timestamp),
                    color = OnBackground,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    formatCoordinates(location.lat, location.lng),
                    color = TextSecondary,
                    fontSize = 12.sp
                )
                Text(
                    stringResource(R.string.location_accuracy, location.accuracy.toInt()),
                    color = TextSecondary,
                    fontSize = 12.sp
                )
            }

            IconButton(onClick = { openInMaps(context, location.lat, location.lng, contactName) }) {
                Icon(Icons.Default.Map, stringResource(R.string.open_in_maps), tint = Purple)
            }
        }
    }
}

// ---- Helper functions ----

private fun openInMaps(context: android.content.Context, lat: Double, lng: Double, contactName: String) {
    val uri = Uri.parse("geo:0,0?q=$lat,$lng(${Uri.encode(contactName)})")
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        setPackage("com.google.android.apps.maps")
    }
    if (intent.resolveActivity(context.packageManager) != null) {
        context.startActivity(intent)
    } else {
        // Fallback: open without package restriction
        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
    }
}

private fun formatCoordinates(lat: Double, lng: Double): String {
    return "%.6f, %.6f".format(lat, lng)
}

private fun formatTimestamp(timestamp: Long): String {
    if (timestamp <= 0) return "—"
    return try {
        val sdf = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault())
        sdf.format(Date(timestamp))
    } catch (_: Exception) {
        "—"
    }
}
