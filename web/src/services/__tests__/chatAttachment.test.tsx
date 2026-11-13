import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ChatAttachment from "../../components/ChatAttachment";
import { translations } from "../../i18n/translations";

describe("chat attachment rendering", () => {
  const resolveUrl = vi.fn((url: string) => `https://synthetic.invalid${url}`);
  const onImageClick = vi.fn();

  it.each(["en", "ru"] as const)("shows localized unavailable guidance without a download in %s", language => {
    for (const type of ["file", "image"]) {
      for (const mediaUrl of [null, "/api/chat/files/stale.txt"]) {
        resolveUrl.mockClear();
        const html = renderToStaticMarkup(
          <ChatAttachment
            message={{ type, mediaUrl, fileName: "receipt.txt", attachmentError: "ATTACHMENT_UNAVAILABLE" }}
            unavailableText={translations[language].attachmentUnavailable}
            resolveUrl={resolveUrl}
            onImageClick={onImageClick}
          />,
        );
        expect(html).toContain(translations[language].attachmentUnavailable);
        expect(html).toContain("receipt.txt");
        expect(html).toContain('role="status"');
        expect(html).not.toContain("<a ");
        expect(html).not.toContain("<img");
        expect(resolveUrl).not.toHaveBeenCalled();
      }
    }
  });

  it("keeps an existing decoded caption when the unavailable attachment has no filename", () => {
    const html = renderToStaticMarkup(
      <ChatAttachment message={{ type: "file", decryptedText: "Original caption", attachmentError: "ATTACHMENT_UNAVAILABLE" }}
        unavailableText={translations.en.attachmentUnavailable} resolveUrl={resolveUrl} onImageClick={onImageClick} />,
    );
    expect(html).toContain("Original caption");
    expect(html).toContain(translations.en.attachmentUnavailable);
  });

  it("keeps ordinary file names, sizes and download URLs", () => {
    const html = renderToStaticMarkup(
      <ChatAttachment message={{ type: "file", mediaUrl: "/api/chat/files/bound.txt?signature=synthetic", fileName: "receipt.txt", fileSize: 1024 }}
        unavailableText={translations.en.attachmentUnavailable} resolveUrl={resolveUrl} onImageClick={onImageClick} />,
    );
    expect(html).toContain('href="https://synthetic.invalid/api/chat/files/bound.txt?signature=synthetic"');
    expect(html).toContain("receipt.txt");
    expect(html).toContain("1.0 KB");
    expect(html).not.toContain(translations.en.attachmentUnavailable);
  });

  it("keeps ordinary image rendering", () => {
    const html = renderToStaticMarkup(
      <ChatAttachment message={{ type: "image", mediaUrl: "/api/chat/files/bound.jpg" }}
        unavailableText={translations.en.attachmentUnavailable} resolveUrl={resolveUrl} onImageClick={onImageClick} />,
    );
    expect(html).toContain('<img src="https://synthetic.invalid/api/chat/files/bound.jpg"');
    expect(html).not.toContain(translations.en.attachmentUnavailable);
  });

  it.each([undefined, null, "", "null"])("never turns a missing/null URL %j into a download", mediaUrl => {
    resolveUrl.mockClear();
    const html = renderToStaticMarkup(
      <ChatAttachment message={{ type: "file", mediaUrl }}
        unavailableText={translations.en.attachmentUnavailable} resolveUrl={resolveUrl} onImageClick={onImageClick} />,
    );
    expect(html).toBe("");
    expect(resolveUrl).not.toHaveBeenCalled();
  });

  it("does not replace ordinary text content with an attachment", () => {
    const html = renderToStaticMarkup(
      <ChatAttachment message={{ type: "text", decryptedText: "Normal message" }}
        unavailableText={translations.en.attachmentUnavailable} resolveUrl={resolveUrl} onImageClick={onImageClick} />,
    );
    expect(html).toBe("");
  });

  it("renders unavailable filenames as text, not markup or download actions", () => {
    const html = renderToStaticMarkup(
      <ChatAttachment message={{ type: "file", fileName: "<img src=malicious>", attachmentError: "ATTACHMENT_UNAVAILABLE" }}
        unavailableText={translations.en.attachmentUnavailable} resolveUrl={resolveUrl} onImageClick={onImageClick} />,
    );
    expect(html).toContain("&lt;img src=malicious&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
  });
});
