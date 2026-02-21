package com.fpvideocalls.model

data class User(
    val uid: String,
    val displayName: String,
    val email: String,
    val photoURL: String? = null
)
