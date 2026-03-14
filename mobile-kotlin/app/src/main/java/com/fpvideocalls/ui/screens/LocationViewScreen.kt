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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.fpvideocalls.R
import com.fpvideocalls.model.LocationPoint
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.LocationViewModel
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.*

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
                // Merge sequential nearby locations for map pins
                val mergedPins = remember(currentLocation, history) {
                    val allEntries = mutableListOf<LocationPoint>()
                    currentLocation?.let { allEntries.add(it) }
                    allEntries.addAll(history)
                    mergeSequentialLocations(allEntries)
                }

                // Map center: latest location or first history entry
                val mapCenter = remember(currentLocation, history) {
                    currentLocation?.let { GeoPoint(it.lat, it.lng) }
                        ?: history.firstOrNull()?.let { GeoPoint(it.lat, it.lng) }
                }

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Embedded Map — shows merged location pins on OpenStreetMap
                    if (mapCenter != null && mergedPins.isNotEmpty()) {
                        item {
                            LocationMapView(
                                pins = mergedPins,
                                center = mapCenter
                            )
                        }
                    }

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

                        items(history, key = { it.id.ifEmpty { "${it.timestamp}_${it.lat}" } }) { point ->
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

// ---- Map merging data & logic ----

/**
 * A merged location pin for the map view. Sequential nearby entries
 * are combined into a single pin with a time range.
 */
data class MergedLocation(
    val lat: Double,
    val lng: Double,
    val startTime: Long,
    val endTime: Long?,
    val isCurrent: Boolean
)

/** Earth's mean radius in meters. */
private const val EARTH_RADIUS_M = 6_371_000.0

/** Merge threshold: locations closer than this (meters) are "same place". */
private const val MERGE_THRESHOLD_M = 50.0

/** Maximum entries to display on the map. */
private const val MAX_MAP_ENTRIES = 10

/**
 * Haversine distance in meters between two GPS coordinates.
 */
internal fun haversineDistance(
    lat1: Double, lng1: Double,
    lat2: Double, lng2: Double
): Double {
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLng / 2).pow(2)
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))
}

/**
 * Merge sequential nearby location entries into pins with time ranges.
 *
 * @param locations Sorted by timestamp DESC (Firestore order).
 * @return Merged locations in chronological order (oldest first).
 */
internal fun mergeSequentialLocations(
    locations: List<LocationPoint>
): List<MergedLocation> {
    if (locations.isEmpty()) return emptyList()

    val recent = locations.take(MAX_MAP_ENTRIES).reversed()
    val merged = mutableListOf<MergedLocation>()
    var current = MergedLocation(
        lat = recent[0].lat,
        lng = recent[0].lng,
        startTime = recent[0].timestamp,
        endTime = null,
        isCurrent = false
    )

    for (i in 1 until recent.size) {
        val entry = recent[i]
        val distance = haversineDistance(
            current.lat, current.lng,
            entry.lat, entry.lng
        )
        if (distance < MERGE_THRESHOLD_M) {
            current = current.copy(endTime = entry.timestamp)
        } else {
            merged.add(current)
            current = MergedLocation(
                lat = entry.lat,
                lng = entry.lng,
                startTime = entry.timestamp,
                endTime = null,
                isCurrent = false
            )
        }
    }
    merged.add(current)
    merged[merged.lastIndex] = merged.last().copy(isCurrent = true)
    return merged
}

/**
 * Format a merged pin's time for the marker info window.
 * Single point: "15 Jan, 10:30"
 * Time range:   "15 Jan, 10:00 – 10:20"
 */
private fun formatMapTime(startTime: Long, endTime: Long?): String {
    val dateFmt = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())
    val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    return if (endTime == null) {
        dateFmt.format(Date(startTime))
    } else {
        "${dateFmt.format(Date(startTime))} – ${timeFmt.format(Date(endTime))}"
    }
}

// ---- Embedded Map Composable ----

/**
 * Embedded OpenStreetMap (osmdroid) showing merged location pins.
 * Current location uses a blue marker; history pins use default red.
 */
@Composable
private fun LocationMapView(
    pins: List<MergedLocation>,
    center: GeoPoint
) {
    val context = LocalContext.current
    val purpleColor = Purple

    // Initialize osmdroid configuration once
    DisposableEffect(Unit) {
        Configuration.getInstance().load(
            context,
            context.getSharedPreferences("osmdroid", android.content.Context.MODE_PRIVATE)
        )
        onDispose { }
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Surface)
    ) {
        AndroidView(
            modifier = Modifier
                .fillMaxWidth()
                .height(300.dp)
                .clip(RoundedCornerShape(12.dp)),
            factory = { ctx ->
                MapView(ctx).apply {
                    setTileSource(TileSourceFactory.MAPNIK)
                    setMultiTouchControls(true)
                    controller.setZoom(14.0)
                    controller.setCenter(center)
                }
            },
            update = { mapView ->
                mapView.overlays.clear()
                mapView.controller.setCenter(center)

                for (pin in pins) {
                    val marker = Marker(mapView).apply {
                        position = GeoPoint(pin.lat, pin.lng)
                        setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                        title = if (pin.isCurrent) "📍 ${context.getString(R.string.current_location)}" else "📌 ${context.getString(R.string.location_history)}"
                        snippet = formatMapTime(pin.startTime, pin.endTime)

                        // Current location: blue circle icon; history: red default
                        if (pin.isCurrent) {
                            icon = createCircleDrawable(ctx = mapView.context, color = purpleColor)
                        }
                    }
                    mapView.overlays.add(marker)
                }
                mapView.invalidate()
            }
        )
    }
}

/**
 * Create a circle drawable for the current-location marker.
 * Uses Android's ShapeDrawable to avoid depending on external PNGs.
 */
private fun createCircleDrawable(
    ctx: android.content.Context,
    color: Color,
    sizeDp: Int = 20
): android.graphics.drawable.Drawable {
    val sizePx = (sizeDp * ctx.resources.displayMetrics.density).toInt()
    val shape = android.graphics.drawable.ShapeDrawable(
        android.graphics.drawable.shapes.OvalShape()
    ).apply {
        intrinsicWidth = sizePx
        intrinsicHeight = sizePx
        paint.color = color.toArgb()
        paint.isAntiAlias = true
        paint.style = android.graphics.Paint.Style.FILL
    }
    // Add white border via LayerDrawable
    val border = android.graphics.drawable.ShapeDrawable(
        android.graphics.drawable.shapes.OvalShape()
    ).apply {
        intrinsicWidth = sizePx
        intrinsicHeight = sizePx
        paint.color = android.graphics.Color.WHITE
        paint.isAntiAlias = true
        paint.style = android.graphics.Paint.Style.FILL
    }
    val insetPx = (2 * ctx.resources.displayMetrics.density).toInt()
    return android.graphics.drawable.LayerDrawable(arrayOf(border, shape)).apply {
        setLayerInset(1, insetPx, insetPx, insetPx, insetPx)
    }
}
