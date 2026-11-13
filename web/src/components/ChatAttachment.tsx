import React from "react";

interface ChatAttachmentProps {
  message: {
    type: string;
    mediaUrl?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    decryptedText?: string;
    attachmentError?: string | null;
  };
  unavailableText: string;
  resolveUrl: (url: string) => string;
  onImageClick: (url: string) => void;
}

/** Render attachment status before considering any stale download/preview URL. */
export default function ChatAttachment({ message, unavailableText, resolveUrl, onImageClick }: ChatAttachmentProps) {
  if (message.attachmentError === "ATTACHMENT_UNAVAILABLE") {
    const caption = message.fileName || message.decryptedText;
    return (
      <div role="status" style={{ padding: "6px 0" }}>
        {caption && message.type !== "text" && <div style={{ fontSize: 14, fontWeight: 500 }}>{caption}</div>}
        <div style={{ fontSize: 13, color: "#707579" }}>{unavailableText}</div>
      </div>
    );
  }
  if (!["image", "file"].includes(message.type) ||
      typeof message.mediaUrl !== "string" || !message.mediaUrl || message.mediaUrl === "null") return null;
  const url = resolveUrl(message.mediaUrl);
  if (message.type === "image") {
    return (
      <div style={{ marginBottom: 4 }}>
        <img src={url} alt="Photo"
          style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 6, cursor: "pointer" }}
          onClick={() => onImageClick(url)} />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
        textDecoration: "none", color: "inherit", marginBottom: 2 }}>
      <div style={{ width: 44, height: 44, borderRadius: 8, background: "#3390ec", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#3390ec" }}>{message.fileName || "File"}</div>
        {message.fileSize && <div style={{ fontSize: 12, color: "#707579" }}>{(message.fileSize / 1024).toFixed(1)} KB</div>}
      </div>
    </a>
  );
}
