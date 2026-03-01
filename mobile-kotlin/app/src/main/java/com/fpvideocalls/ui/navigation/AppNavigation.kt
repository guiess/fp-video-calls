package com.fpvideocalls.ui.navigation

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.fpvideocalls.R
import com.fpvideocalls.model.CallType
import com.fpvideocalls.model.Contact
import com.fpvideocalls.model.IncomingCallData
import com.fpvideocalls.service.ActiveCallService
import com.fpvideocalls.ui.screens.*
import com.fpvideocalls.ui.theme.*
import com.fpvideocalls.viewmodel.AuthViewModel
import com.fpvideocalls.viewmodel.CallNavigationEvent
import com.fpvideocalls.viewmodel.CallViewModel
import com.fpvideocalls.viewmodel.ChatListViewModel
import com.fpvideocalls.viewmodel.GroupsViewModel
import kotlinx.coroutines.delay

// Shared state for passing contacts between screens
private val pendingContacts = mutableListOf<Contact>()
private var pendingCallData: IncomingCallData? = null

@Composable
fun AppNavigation(
    intent: Intent? = null,
    authViewModel: AuthViewModel = hiltViewModel(),
    callViewModel: CallViewModel = hiltViewModel()
) {
    val user by authViewModel.user.collectAsState()
    val loading by authViewModel.loading.collectAsState()
    val navController = rememberNavController()

    // Handle FCM navigation events
    LaunchedEffect(Unit) {
        callViewModel.navigationEvents.collect { event ->
            when (event) {
                is CallNavigationEvent.ShowIncomingCall -> {
                    pendingCallData = event.data
                    navController.navigate(Routes.INCOMING_CALL) {
                        launchSingleTop = true
                    }
                }
                is CallNavigationEvent.DismissIncomingCall -> {
                    if (navController.currentDestination?.route == Routes.INCOMING_CALL) {
                        navController.popBackStack()
                    }
                }
                is CallNavigationEvent.AnswerCall -> {
                    val data = event.data
                    val displayName = user?.displayName ?: data.callerName
                    val userId = user?.uid ?: data.callerId
                    navController.navigate(
                        Routes.inCall(data.roomId, displayName, userId, data.callType.value, data.roomPassword)
                    ) {
                        popUpTo(Routes.MAIN) { inclusive = false }
                        launchSingleTop = true
                    }
                }
            }
        }
    }

    // Handle intent extras for killed-app notification tap
    LaunchedEffect(intent) {
        if (intent == null) return@LaunchedEffect
        val type = intent.getStringExtra("type")
        val action = intent.getStringExtra("action")

        if (type == "call_invite") {
            // Wait for nav graph to be ready (Activity may have just restarted)
            var retries = 0
            while (retries < 20) {
                try { navController.graph; break } catch (_: Exception) { }
                kotlinx.coroutines.delay(50)
                retries++
            }

            val callData = IncomingCallData(
                callUUID = intent.getStringExtra("callUUID") ?: "",
                roomId = intent.getStringExtra("roomId") ?: "",
                callerId = intent.getStringExtra("callerId") ?: "",
                callerName = intent.getStringExtra("callerName") ?: "Unknown",
                callerPhoto = intent.getStringExtra("callerPhoto")?.takeIf { it.isNotEmpty() },
                callType = CallType.fromString(intent.getStringExtra("callType")),
                roomPassword = intent.getStringExtra("roomPassword")?.takeIf { it.isNotEmpty() }
            )

            if (action == "ANSWER") {
                // Answered from notification — go directly to InCall, skip IncomingCallScreen
                val displayName = user?.displayName ?: callData.callerName
                val userId = user?.uid ?: callData.callerId
                try {
                    navController.navigate(
                        Routes.inCall(callData.roomId, displayName, userId, callData.callType.value, callData.roomPassword)
                    ) {
                        popUpTo(0) { inclusive = true }
                        launchSingleTop = true
                    }
                } catch (e: Exception) {
                    android.util.Log.w("AppNavigation", "Nav failed for ANSWER intent, retrying", e)
                    kotlinx.coroutines.delay(200)
                    try {
                        navController.navigate(
                            Routes.inCall(callData.roomId, displayName, userId, callData.callType.value, callData.roomPassword)
                        ) {
                            popUpTo(0) { inclusive = true }
                            launchSingleTop = true
                        }
                    } catch (_: Exception) {}
                }
            } else {
                // Tapped notification (not a specific action) — show IncomingCallScreen
                pendingCallData = callData
                try {
                    navController.navigate(Routes.INCOMING_CALL) {
                        launchSingleTop = true
                    }
                } catch (_: Exception) {}
            }

            // Clear the intent extras so we don't re-handle on recomposition
            intent.removeExtra("type")
        }

        // Handle RETURN_TO_CALL from active call notification
        if (intent.action == "RETURN_TO_CALL") {
            val callInfo = ActiveCallService.activeCallInfo
            if (callInfo != null) {
                navController.navigate(
                    Routes.inCall(callInfo.roomId, callInfo.displayName, callInfo.userId, callInfo.callType, callInfo.password)
                ) {
                    popUpTo(Routes.MAIN) { inclusive = false }
                    launchSingleTop = true
                }
            }
            // Clear the action so we don't re-handle on recomposition
            intent.action = null
        }
    }

    if (loading) {
        Box(
            modifier = Modifier.fillMaxSize().background(Background),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = Purple)
        }
        return
    }

    val startDestination = if (user != null) Routes.MAIN else Routes.SIGN_IN

    // Track active call for the return-to-call banner
    val isCallActive by ActiveCallService.isCallActive.collectAsState()
    val currentBackStack by navController.currentBackStackEntryAsState()
    val currentRoute = currentBackStack?.destination?.route
    val isOnCallScreen = currentRoute?.startsWith("in_call/") == true
            || currentRoute?.startsWith("outgoing_call/") == true
            || currentRoute == Routes.INCOMING_CALL

    Column(modifier = Modifier.fillMaxSize()) {
        // Return-to-call banner
        if (isCallActive && !isOnCallScreen) {
            ActiveCallBanner(
                onClick = {
                    // Check if outgoing call screen is in the back stack (still ringing)
                    val hasOutgoing = navController.currentBackStack.value.any {
                        it.destination.route?.startsWith("outgoing_call/") == true
                    }
                    if (hasOutgoing) {
                        // Pop back to the outgoing call screen
                        navController.popBackStack("outgoing_call/{callType}", inclusive = false)
                    } else {
                        val callInfo = ActiveCallService.activeCallInfo ?: return@ActiveCallBanner
                        navController.navigate(
                            Routes.inCall(callInfo.roomId, callInfo.displayName, callInfo.userId, callInfo.callType, callInfo.password)
                        ) {
                            popUpTo(Routes.MAIN) { inclusive = false }
                            launchSingleTop = true
                        }
                    }
                }
            )
        }

        NavHost(
            navController = navController,
            startDestination = startDestination,
            modifier = Modifier.weight(1f)
        ) {
        // Auth screens
        composable(Routes.SIGN_IN) {
            SignInScreen(
                onNavigateToGuestRoom = { navController.navigate(Routes.GUEST_ROOM_JOIN) }
            )
        }

        composable(Routes.GUEST_ROOM_JOIN) {
            RoomJoinScreen(
                isGuest = true,
                onBack = { navController.popBackStack() },
                onJoinRoom = { roomId, displayName, userId ->
                    navController.navigate(Routes.inCall(roomId, displayName, userId, "room"))
                }
            )
        }

        // Main tabs
        composable(Routes.MAIN) {
            MainScreen(navController = navController)
        }

        // In call
        composable(
            route = Routes.IN_CALL,
            arguments = listOf(
                navArgument("roomId") { type = NavType.StringType },
                navArgument("displayName") { type = NavType.StringType },
                navArgument("userId") { type = NavType.StringType },
                navArgument("callType") { type = NavType.StringType; defaultValue = "room" },
                navArgument("password") { type = NavType.StringType; nullable = true; defaultValue = null }
            )
        ) { backStackEntry ->
            InCallScreen(
                roomId = backStackEntry.arguments?.getString("roomId") ?: "",
                displayName = backStackEntry.arguments?.getString("displayName") ?: "",
                userId = backStackEntry.arguments?.getString("userId") ?: "",
                callType = backStackEntry.arguments?.getString("callType") ?: "room",
                password = backStackEntry.arguments?.getString("password"),
                onEndCall = {
                    navController.navigate(Routes.MAIN) {
                        popUpTo(0) { inclusive = true }
                        launchSingleTop = true
                    }
                }
            )
        }

        // Outgoing call
        composable(
            route = Routes.OUTGOING_CALL,
            arguments = listOf(
                navArgument("callType") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val callType = backStackEntry.arguments?.getString("callType") ?: "direct"
            val contacts = pendingContacts.toList()
            val currentUser by authViewModel.user.collectAsState()

            OutgoingCallScreen(
                contacts = contacts,
                callType = callType,
                onNavigateToInCall = { roomId, password ->
                    navController.navigate(
                        Routes.inCall(roomId, currentUser?.displayName ?: "Me", currentUser?.uid ?: "", callType, password)
                    ) {
                        popUpTo(Routes.MAIN) { inclusive = false }
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }

        // Incoming call
        composable(Routes.INCOMING_CALL) {
            val callData = pendingCallData ?: return@composable
            val currentUser by authViewModel.user.collectAsState()

            IncomingCallScreen(
                callData = callData,
                onAnswer = { roomId, callType, password, cameraOff ->
                    callViewModel.clearIncomingCall()
                    ActiveCallService.pendingCameraOff = cameraOff
                    navController.navigate(
                        Routes.inCall(roomId, currentUser?.displayName ?: "Me", currentUser?.uid ?: callData.callerId, callType, password)
                    ) {
                        popUpTo(Routes.MAIN) { inclusive = false }
                    }
                },
                onDecline = {
                    callViewModel.clearIncomingCall()
                    navController.popBackStack()
                }
            )
        }

        // Group call setup
        composable(Routes.GROUP_CALL_SETUP) {
            val groupsViewModel: GroupsViewModel = hiltViewModel()
            GroupCallSetupScreen(
                onBack = { navController.popBackStack() },
                onStartCall = { contacts ->
                    groupsViewModel.addRecentGroup(contacts)
                    pendingContacts.clear()
                    pendingContacts.addAll(contacts)
                    navController.navigate(Routes.preCall("group"))
                },
                groupsViewModel = groupsViewModel
            )
        }

        // Pre-call camera preview
        composable(
            route = Routes.PRE_CALL,
            arguments = listOf(
                navArgument("callType") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val callType = backStackEntry.arguments?.getString("callType") ?: "direct"
            val contacts = pendingContacts.toList()
            PreCallScreen(
                contacts = contacts,
                callType = callType,
                onStartCall = { cameraOff ->
                    ActiveCallService.pendingCameraOff = cameraOff
                    navController.navigate(Routes.outgoingCall(callType)) {
                        popUpTo(Routes.PRE_CALL) { inclusive = true }
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }

        // Chat conversation
        composable(
            route = Routes.CHAT_CONVERSATION,
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("displayName") { type = NavType.StringType },
                navArgument("participantUids") { type = NavType.StringType },
                navArgument("type") { type = NavType.StringType; defaultValue = "direct" }
            )
        ) { backStackEntry ->
            val convoId = backStackEntry.arguments?.getString("conversationId") ?: ""
            val displayName = backStackEntry.arguments?.getString("displayName") ?: ""
            val uidsStr = backStackEntry.arguments?.getString("participantUids") ?: ""
            val uids = uidsStr.split(",").filter { it.isNotEmpty() }
            val convoType = backStackEntry.arguments?.getString("type") ?: "direct"
            val isGroup = convoType == "group" || convoId.startsWith("newgroup_")
            val currentUser by authViewModel.user.collectAsState()
            ChatConversationScreen(
                conversationId = convoId,
                displayName = displayName,
                participantUids = uids,
                isGroup = isGroup,
                onBack = { navController.popBackStack() },
                onVideoCall = {
                    val otherUids = uids.filter { it != currentUser?.uid }
                    if (otherUids.isNotEmpty()) {
                        val contacts = otherUids.map { uid ->
                            Contact(uid = uid, displayName = displayName)
                        }
                        pendingContacts.clear()
                        pendingContacts.addAll(contacts)
                        navController.navigate(Routes.preCall(if (otherUids.size > 1) "group" else "direct"))
                    }
                }
            )
        }

        // New chat — contact picker
        composable(Routes.NEW_CHAT) {
            NewChatScreen(
                onContactSelected = { contact ->
                    val myUid = user?.uid ?: return@NewChatScreen
                    navController.navigate(
                        Routes.chatConversation(
                            conversationId = "new_${contact.uid}",
                            displayName = contact.displayName,
                            participantUids = listOf(myUid, contact.uid)
                        )
                    ) {
                        popUpTo(Routes.NEW_CHAT) { inclusive = true }
                    }
                },
                onNewGroup = {
                    navController.navigate(Routes.NEW_GROUP_CHAT)
                },
                onBack = { navController.popBackStack() }
            )
        }

        // New group chat — multi-contact picker + name
        composable(Routes.NEW_GROUP_CHAT) {
            NewGroupChatScreen(
                onGroupCreated = { groupName, selectedContacts ->
                    val myUid = user?.uid ?: return@NewGroupChatScreen
                    val allUids = listOf(myUid) + selectedContacts.map { it.uid }
                    navController.navigate(
                        Routes.chatConversation(
                            conversationId = "newgroup_${System.currentTimeMillis()}",
                            displayName = groupName,
                            participantUids = allUids,
                            type = "group"
                        )
                    ) {
                        popUpTo(Routes.NEW_CHAT) { inclusive = true }
                    }
                },
                onBack = { navController.popBackStack() }
            )
        }

        // Group info screen
        composable(
            route = Routes.GROUP_INFO,
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("groupName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val convoId = backStackEntry.arguments?.getString("conversationId") ?: ""
            val groupName = backStackEntry.arguments?.getString("groupName") ?: ""
            GroupInfoScreen(
                conversationId = convoId,
                groupName = groupName,
                initialParticipants = emptyList(),
                onBack = { navController.popBackStack() }
            )
        }
    }
    } // Column
}

@Composable
fun MainScreen(navController: NavHostController) {
    val tabNavController = rememberNavController()
    val currentEntry by tabNavController.currentBackStackEntryAsState()
    val currentRoute = currentEntry?.destination?.route

    val authViewModel: AuthViewModel = hiltViewModel()
    val user by authViewModel.user.collectAsState()

    val chatListViewModel: ChatListViewModel = hiltViewModel()
    val totalUnread by chatListViewModel.totalUnreadCount.collectAsState()

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = Surface,
                contentColor = OnSurface
            ) {
                NavigationBarItem(
                    selected = currentRoute == Routes.TAB_HOME,
                    onClick = {
                        tabNavController.navigate(Routes.TAB_HOME) {
                            popUpTo(Routes.TAB_HOME) { inclusive = true }
                            launchSingleTop = true
                        }
                    },
                    icon = { Icon(Icons.Default.Home, stringResource(R.string.nav_home)) },
                    label = { Text(stringResource(R.string.nav_home)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Purple,
                        selectedTextColor = Purple,
                        unselectedIconColor = TextTertiary,
                        unselectedTextColor = TextTertiary,
                        indicatorColor = Color.Transparent
                    )
                )
                NavigationBarItem(
                    selected = currentRoute == Routes.TAB_CHATS,
                    onClick = {
                        tabNavController.navigate(Routes.TAB_CHATS) {
                            popUpTo(Routes.TAB_HOME)
                            launchSingleTop = true
                        }
                    },
                    icon = {
                        BadgedBox(
                            badge = {
                                if (totalUnread > 0) {
                                    Badge { Text(if (totalUnread > 99) "99+" else totalUnread.toString()) }
                                }
                            }
                        ) {
                            Icon(Icons.Default.Chat, stringResource(R.string.nav_chats))
                        }
                    },
                    label = { Text(stringResource(R.string.nav_chats)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Purple,
                        selectedTextColor = Purple,
                        unselectedIconColor = TextTertiary,
                        unselectedTextColor = TextTertiary,
                        indicatorColor = Color.Transparent
                    )
                )
                NavigationBarItem(
                    selected = currentRoute == Routes.TAB_ROOMS,
                    onClick = {
                        tabNavController.navigate(Routes.TAB_ROOMS) {
                            popUpTo(Routes.TAB_HOME)
                            launchSingleTop = true
                        }
                    },
                    icon = { Icon(Icons.Default.MeetingRoom, stringResource(R.string.nav_room)) },
                    label = { Text(stringResource(R.string.nav_room)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Purple,
                        selectedTextColor = Purple,
                        unselectedIconColor = TextTertiary,
                        unselectedTextColor = TextTertiary,
                        indicatorColor = Color.Transparent
                    )
                )
                NavigationBarItem(
                    selected = currentRoute == Routes.TAB_OPTIONS,
                    onClick = {
                        tabNavController.navigate(Routes.TAB_OPTIONS) {
                            popUpTo(Routes.TAB_HOME)
                            launchSingleTop = true
                        }
                    },
                    icon = { Icon(Icons.Default.Settings, stringResource(R.string.nav_options)) },
                    label = { Text(stringResource(R.string.nav_options)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Purple,
                        selectedTextColor = Purple,
                        unselectedIconColor = TextTertiary,
                        unselectedTextColor = TextTertiary,
                        indicatorColor = Color.Transparent
                    )
                )
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = tabNavController,
            startDestination = Routes.TAB_HOME,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Routes.TAB_HOME) {
                HomeScreen(
                    onNavigateToContacts = {
                        tabNavController.navigate(Routes.TAB_CHATS) {
                            launchSingleTop = true
                        }
                    },
                    onNavigateToRooms = {
                        tabNavController.navigate(Routes.TAB_ROOMS) {
                            launchSingleTop = true
                        }
                    },
                    onNavigateToGroupCall = {
                        navController.navigate(Routes.GROUP_CALL_SETUP)
                    }
                )
            }
            composable(Routes.TAB_CHATS) {
                ChatsScreen(
                    chatListViewModel = chatListViewModel,
                    onOpenConversation = { convoId, displayName, uids, type ->
                        navController.navigate(Routes.chatConversation(convoId, displayName, uids, type))
                    },
                    onNewChat = {
                        navController.navigate(Routes.NEW_CHAT)
                    }
                )
            }
            composable(Routes.TAB_ROOMS) {
                RoomJoinScreen(
                    isGuest = false,
                    onJoinRoom = { roomId, displayName, userId ->
                        navController.navigate(Routes.inCall(roomId, displayName, userId, "room"))
                    }
                )
            }
            composable(Routes.TAB_OPTIONS) {
                OptionsScreen()
            }
        }
    }
}

@Composable
private fun ActiveCallBanner(onClick: () -> Unit) {
    var elapsedSeconds by remember { mutableLongStateOf(0L) }
    val startTime = remember { System.currentTimeMillis() }

    LaunchedEffect(Unit) {
        while (true) {
            elapsedSeconds = (System.currentTimeMillis() - startTime) / 1000
            delay(1000)
        }
    }

    val minutes = elapsedSeconds / 60
    val seconds = elapsedSeconds % 60
    val timeText = String.format("%d:%02d", minutes, seconds)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SuccessGreen)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        Text("🟢", fontSize = 10.sp)
        Spacer(Modifier.width(8.dp))
        Text(
            stringResource(R.string.tap_return_to_call),
            color = Color.White,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp
        )
        Spacer(Modifier.width(8.dp))
        Text(timeText, color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp)
    }
}
