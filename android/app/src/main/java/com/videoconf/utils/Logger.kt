package com.videoconf.utils

import android.content.Context
import java.io.File
import java.io.FileWriter
import java.io.PrintWriter
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentLinkedQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

/**
 * In-memory and persistent logger with circular buffer to prevent memory overflow.
 * Stores debug/trace information in memory and persists to file.
 */
object Logger {
    private const val MAX_LOG_ENTRIES = 1000 // Увеличен для большей истории
    private const val MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
    private const val LOG_FILE_NAME = "videoconf_crash_logs.txt"
    private const val OLD_LOG_FILE_NAME = "videoconf_crash_logs_old.txt"
    
    private val logEntries = ConcurrentLinkedQueue<LogEntry>()
    private val dateFormat = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)
    private val fullDateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    
    private var context: Context? = null
    private var logFile: File? = null
    private val writeLock = Any()
    
    data class LogEntry(
        val timestamp: Long,
        val level: LogLevel,
        val tag: String,
        val message: String
    ) {
        fun format(): String {
            val time = dateFormat.format(Date(timestamp))
            return "$time [${level.name}] $tag: $message"
        }
        
        fun formatFull(): String {
            val time = fullDateFormat.format(Date(timestamp))
            return "$time [${level.name}] $tag: $message"
        }
    }
    
    enum class LogLevel {
        DEBUG, INFO, WARN, ERROR
    }
    
    /**
     * Initialize logger with application context for file persistence
     */
    fun init(ctx: Context) {
        context = ctx.applicationContext
        logFile = File(context!!.filesDir, LOG_FILE_NAME)
        
        // При старте приложения добавляем разделитель
        val separator = "\n${"=".repeat(80)}\n" +
                "APP STARTED: ${fullDateFormat.format(Date())}\n" +
                "${"=".repeat(80)}\n"
        writeToFile(separator, flush = true)
        
        i("Logger", "Persistent logging initialized. Log file: ${logFile?.absolutePath}")
        i("Logger", "Previous log size: ${logFile?.length() ?: 0} bytes")
    }
    
    fun d(tag: String, message: String) {
        log(LogLevel.DEBUG, tag, message)
        android.util.Log.d(tag, message)
    }
    
    fun i(tag: String, message: String) {
        log(LogLevel.INFO, tag, message)
        android.util.Log.i(tag, message)
    }
    
    fun w(tag: String, message: String) {
        log(LogLevel.WARN, tag, message)
        android.util.Log.w(tag, message)
    }
    
    fun e(tag: String, message: String, throwable: Throwable? = null) {
        val msg = if (throwable != null) "$message: ${throwable.message}" else message
        log(LogLevel.ERROR, tag, msg)
        if (throwable != null) {
            android.util.Log.e(tag, message, throwable)
        } else {
            android.util.Log.e(tag, message)
        }
    }
    
    private fun log(level: LogLevel, tag: String, message: String) {
        val entry = LogEntry(System.currentTimeMillis(), level, tag, message)
        logEntries.add(entry)
        
        // Remove oldest entries if we exceed max size
        while (logEntries.size > MAX_LOG_ENTRIES) {
            logEntries.poll()
        }
        
        // Write to file asynchronously
        // Пишем ВСЕ логи в файл для максимальной информативности
        writeToFileAsync(entry.formatFull() + "\n")
    }
    
    private fun writeToFileAsync(text: String) {
        GlobalScope.launch(Dispatchers.IO) {
            writeToFile(text)
        }
    }
    
    private fun writeToFile(text: String, flush: Boolean = false) {
        synchronized(writeLock) {
            try {
                val file = logFile ?: return
                
                // Проверяем размер файла и ротируем если нужно
                if (file.exists() && file.length() > MAX_FILE_SIZE) {
                    rotateLogFile()
                }
                
                // Append to file
                FileWriter(file, true).use { writer ->
                    writer.write(text)
                    if (flush) {
                        writer.flush()
                    }
                }
            } catch (e: Exception) {
                // Fallback to Android log if file write fails
                android.util.Log.e("Logger", "Failed to write to log file", e)
            }
        }
    }
    
    private fun rotateLogFile() {
        try {
            val file = logFile ?: return
            val oldFile = File(context!!.filesDir, OLD_LOG_FILE_NAME)
            
            // Удаляем старый backup если есть
            if (oldFile.exists()) {
                oldFile.delete()
            }
            
            // Переименовываем текущий в old
            if (file.exists()) {
                file.renameTo(oldFile)
            }
            
            android.util.Log.i("Logger", "Log file rotated")
        } catch (e: Exception) {
            android.util.Log.e("Logger", "Failed to rotate log file", e)
        }
    }
    
    /**
     * Write critical error to file immediately (for crashes)
     */
    fun logCrash(tag: String, message: String, throwable: Throwable) {
        val crashLog = buildString {
            append("\n")
            append("*".repeat(80))
            append("\n")
            append("CRASH DETECTED: ${fullDateFormat.format(Date())}\n")
            append("*".repeat(80))
            append("\n")
            append("Tag: $tag\n")
            append("Message: $message\n")
            append("Exception: ${throwable.javaClass.name}\n")
            append("Exception Message: ${throwable.message}\n")
            append("\nStack Trace:\n")
            append(throwable.stackTraceToString())
            append("\n")
            
            var cause = throwable.cause
            var level = 1
            while (cause != null && level <= 5) {
                append("\nCaused by (level $level):\n")
                append("  ${cause.javaClass.name}: ${cause.message}\n")
                append(cause.stackTraceToString())
                cause = cause.cause
                level++
            }
            
            append("*".repeat(80))
            append("\n\n")
        }
        
        // Записываем синхронно и с flush
        writeToFile(crashLog, flush = true)
        
        // Также в обычный лог
        e(tag, message, throwable)
    }
    
    fun getLogs(): List<LogEntry> {
        return logEntries.toList()
    }
    
    fun getLogsAsText(): String {
        return logEntries.joinToString("\n") { it.format() }
    }
    
    fun clear() {
        logEntries.clear()
    }
    
    fun getLogCount(): Int {
        return logEntries.size
    }
    
    /**
     * Get content of the persistent log file
     */
    fun getPersistedLogs(): String {
        return try {
            val file = logFile
            if (file?.exists() == true) {
                file.readText()
            } else {
                "No persisted logs found"
            }
        } catch (e: Exception) {
            "Error reading log file: ${e.message}"
        }
    }
    
    /**
     * Get old rotated log file
     */
    fun getOldPersistedLogs(): String {
        return try {
            val oldFile = File(context?.filesDir, OLD_LOG_FILE_NAME)
            if (oldFile.exists()) {
                oldFile.readText()
            } else {
                "No old logs found"
            }
        } catch (e: Exception) {
            "Error reading old log file: ${e.message}"
        }
    }
    
    /**
     * Clear all persisted logs
     */
    fun clearPersistedLogs() {
        try {
            logFile?.delete()
            File(context?.filesDir, OLD_LOG_FILE_NAME).delete()
            i("Logger", "Persisted logs cleared")
        } catch (e: Exception) {
            e("Logger", "Failed to clear persisted logs", e)
        }
    }
    
    fun getLogFilePath(): String? {
        return logFile?.absolutePath
    }
}