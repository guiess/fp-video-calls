package com.fpvideocalls.model

data class Group(
    val id: String = "",
    val name: String = "",
    val memberUids: List<String> = emptyList(),
    val memberNames: List<String> = emptyList(),
    val createdAt: Long = 0
)

data class RecentGroup(
    val id: String = "",
    val memberUids: List<String> = emptyList(),
    val memberNames: List<String> = emptyList(),
    val lastUsedAt: Long = 0
)
