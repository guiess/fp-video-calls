package com.fpvideocalls.ui.navigation

import java.net.URLEncoder

object Routes {
    const val SIGN_IN = "sign_in"
    const val GUEST_ROOM_JOIN = "guest_room_join"
    const val MAIN = "main"
    const val IN_CALL = "in_call/{roomId}/{displayName}/{userId}?callType={callType}&password={password}"
    const val OUTGOING_CALL = "outgoing_call/{callType}"
    const val PRE_CALL = "pre_call/{callType}"
    const val INCOMING_CALL = "incoming_call"
    const val GROUP_CALL_SETUP = "group_call_setup"

    // Main tabs
    const val TAB_HOME = "tab_home"
    const val TAB_CHATS = "tab_chats"
    const val TAB_ROOMS = "tab_rooms"
    const val TAB_OPTIONS = "tab_options"

    // Chat
    const val CHAT_CONVERSATION = "chat_conversation/{conversationId}/{displayName}/{participantUids}?type={type}"
    const val NEW_CHAT = "new_chat"
    const val NEW_GROUP_CHAT = "new_group_chat"
    const val GROUP_INFO = "group_info/{conversationId}/{groupName}"

    fun inCall(roomId: String, displayName: String, userId: String, callType: String = "room", password: String? = null): String {
        val encName = URLEncoder.encode(displayName, "UTF-8")
        val encRoom = URLEncoder.encode(roomId, "UTF-8")
        val encUser = URLEncoder.encode(userId, "UTF-8")
        var route = "in_call/$encRoom/$encName/$encUser?callType=$callType"
        if (password != null) route += "&password=${URLEncoder.encode(password, "UTF-8")}"
        return route
    }

    fun outgoingCall(callType: String): String = "outgoing_call/$callType"
    fun preCall(callType: String): String = "pre_call/$callType"
    fun chatConversation(conversationId: String, displayName: String, participantUids: List<String>, type: String = "direct"): String {
        val encName = URLEncoder.encode(displayName, "UTF-8")
        val encUids = URLEncoder.encode(participantUids.joinToString(","), "UTF-8")
        return "chat_conversation/$conversationId/$encName/$encUids?type=$type"
    }
    fun groupInfo(conversationId: String, groupName: String): String {
        val encName = URLEncoder.encode(groupName, "UTF-8")
        return "group_info/$conversationId/$encName"
    }
}
