package com.fpvideocalls.util

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class RecentRoom(
    val roomId: String,
    val joinedAt: Long = System.currentTimeMillis()
)

object RecentRoomsStore {

    private const val PREFS = "recent_rooms"
    private const val KEY = "rooms"
    private const val MAX_ROOMS = 20

    fun getRecentRooms(context: Context): List<RecentRoom> {
        val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                RecentRoom(
                    roomId = obj.getString("roomId"),
                    joinedAt = obj.getLong("joinedAt")
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun addRoom(context: Context, roomId: String) {
        val rooms = getRecentRooms(context).toMutableList()
        rooms.removeAll { it.roomId == roomId }
        rooms.add(0, RecentRoom(roomId = roomId))
        if (rooms.size > MAX_ROOMS) rooms.subList(MAX_ROOMS, rooms.size).clear()
        save(context, rooms)
    }

    fun removeRoom(context: Context, roomId: String) {
        val rooms = getRecentRooms(context).toMutableList()
        rooms.removeAll { it.roomId == roomId }
        save(context, rooms)
    }

    private fun save(context: Context, rooms: List<RecentRoom>) {
        val arr = JSONArray()
        rooms.forEach { room ->
            arr.put(JSONObject().apply {
                put("roomId", room.roomId)
                put("joinedAt", room.joinedAt)
            })
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, arr.toString()).apply()
    }
}
