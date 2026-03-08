package com.fpvideocalls.viewmodel

import android.app.Application
import android.content.Intent
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.fpvideocalls.data.FirestoreRepository
import com.fpvideocalls.model.User
import com.fpvideocalls.util.Constants
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    application: Application,
    private val firebaseAuth: FirebaseAuth,
    private val firestoreRepository: FirestoreRepository,
    private val firebaseMessaging: FirebaseMessaging
) : AndroidViewModel(application) {

    private val _user = MutableStateFlow<User?>(null)
    val user: StateFlow<User?> = _user.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** Exposed so the screen can launch the sign-in intent */
    private val _signInIntent = MutableStateFlow<Intent?>(null)
    val signInIntent: StateFlow<Intent?> = _signInIntent.asStateFlow()

    private var googleSignInClient: GoogleSignInClient? = null

    private val authListener = FirebaseAuth.AuthStateListener { auth ->
        val firebaseUser = auth.currentUser
        if (firebaseUser != null) {
            val appUser = User(
                uid = firebaseUser.uid,
                displayName = firebaseUser.displayName ?: "User",
                email = firebaseUser.email ?: "",
                photoURL = firebaseUser.photoUrl?.toString()
            )
            _user.value = appUser
            viewModelScope.launch {
                try {
                    firestoreRepository.upsertUser(appUser)
                    // Delete stale token and force FCM to issue a fresh one
                    firebaseMessaging.deleteToken().await()
                    val token = firebaseMessaging.token.await()
                    Log.d("AuthViewModel", "FCM token refreshed: ${token.take(20)}...")
                    firestoreRepository.updateFcmToken(appUser.uid, token)
                } catch (e: Exception) {
                    Log.w("AuthViewModel", "Upsert/FCM failed", e)
                }
            }
        } else {
            _user.value = null
        }
        _loading.value = false
    }

    init {
        firebaseAuth.addAuthStateListener(authListener)
    }

    override fun onCleared() {
        super.onCleared()
        firebaseAuth.removeAuthStateListener(authListener)
    }

    fun signInWithGoogle(activity: android.app.Activity) {
        _error.value = null
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(Constants.GOOGLE_WEB_CLIENT_ID)
            .requestEmail()
            .build()
        val client = GoogleSignIn.getClient(activity, gso)
        googleSignInClient = client
        // Sign out first so the account picker always appears
        client.signOut().addOnCompleteListener {
            _signInIntent.value = client.signInIntent
        }
    }

    fun handleSignInResult(data: Intent?) {
        viewModelScope.launch {
            try {
                val task = GoogleSignIn.getSignedInAccountFromIntent(data)
                val account = task.getResult(ApiException::class.java)
                val idToken = account.idToken
                if (idToken != null) {
                    val firebaseCredential = GoogleAuthProvider.getCredential(idToken, null)
                    firebaseAuth.signInWithCredential(firebaseCredential).await()
                } else {
                    _error.value = "No ID token received from Google."
                }
            } catch (e: ApiException) {
                Log.e("AuthViewModel", "Google sign-in failed: statusCode=${e.statusCode}", e)
                _error.value = "Google sign-in failed (code ${e.statusCode}). Please try again."
            } catch (e: Exception) {
                Log.e("AuthViewModel", "Google sign-in failed", e)
                _error.value = e.message ?: "Sign-in failed. Please try again."
            }
        }
    }

    fun consumeSignInIntent() {
        _signInIntent.value = null
    }

    fun signOut() {
        viewModelScope.launch {
            try {
                val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestIdToken(Constants.GOOGLE_WEB_CLIENT_ID)
                    .requestEmail()
                    .build()
                val client = googleSignInClient ?: GoogleSignIn.getClient(getApplication(), gso)
                // Best-effort revoke/signOut with timeout — don't block Firebase signOut
                try {
                    kotlinx.coroutines.withTimeoutOrNull(3000) {
                        try { client.revokeAccess().await() } catch (_: Exception) {}
                        try { client.signOut().await() } catch (_: Exception) {}
                    }
                } catch (_: Exception) {}
                firebaseAuth.signOut()
            } catch (e: Exception) {
                Log.w("AuthViewModel", "Sign-out failed", e)
                // Always sign out of Firebase even if Google fails
                try { firebaseAuth.signOut() } catch (_: Exception) {}
            }
        }
    }

    fun clearError() {
        _error.value = null
    }
}
