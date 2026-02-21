package com.fpvideocalls.model

data class Contact(
    val uid: String,
    val displayName: String,
    val photoURL: String? = null,
    val addedAt: Long? = null
)
