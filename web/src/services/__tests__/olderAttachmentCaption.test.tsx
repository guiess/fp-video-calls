import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatConversationScreen from "../../screens/ChatConversationScreen";
import ChatAttachment from "../../components/ChatAttachment";
import { translations } from "../../i18n/translations";

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  language: "en" as "en" | "ru",
  apiFetch: vi.fn(),
}));
vi.mock("react", async importOriginal => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (callback: unknown) => callback,
    useState: (initial: unknown) => {
      const index = harness.index++;
      if (!(index in harness.states)) harness.states[index] = initial;
      return [harness.states[index], (update: unknown) => {
        harness.states[index] = typeof update === "function" ? update(harness.states[index]) : update;
      }];
    },
  };
});
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "synthetic-conversation" }) }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: { uid: "alice" } }) }));
vi.mock("../../i18n/LanguageContext", async () => {
  const { translations } = await import("../../i18n/translations");
  return { useLanguage: () => ({ t: translations[harness.language] }) };
});
vi.mock("../api", () => ({ apiFetch: harness.apiFetch, getBaseUrl: () => "https://synthetic.invalid" }));
vi.mock("../chatSocket", () => ({ subscribeChatEvents: vi.fn(), emitTyping: vi.fn() }));
vi.mock("../contacts", () => ({ fetchContacts: vi.fn(), addContact: vi.fn() }));

function findElement(node: ReactElement, predicate: (element: ReactElement) => boolean): ReactElement | undefined {
  if (predicate(node)) return node;
  const children = (node.props as { children?: unknown }).children;
  for (const child of [children].flat(Infinity)) {
    if (child && typeof child === "object" && "type" in child) {
      const found = findElement(child as ReactElement, predicate);
      if (found) return found;
    }
  }
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("actual older-page attachment loader and renderer", () => {
  it.each(["en", "ru"] as const)("preserves encoded older captions and unavailable status in %s", async language => {
    harness.language = language;
    harness.states = [null, [{ id: "newer", type: "text", senderUid: "alice", timestamp: 1000, ciphertext: "bmV3ZXI=" }], "", false, false];
    harness.index = 0;
    const ciphertext = btoa(encodeURIComponent("Original caption"));
    const older = {
      id: "older", senderUid: "alice", type: "file", ciphertext,
      iv: "iv", encryptedKeys: {}, timestamp: 500, mediaUrl: null, fileName: null,
      attachmentError: "ATTACHMENT_UNAVAILABLE",
    };
    harness.apiFetch.mockResolvedValue({ ok: true, json: async () => ({ messages: [older], hasMore: false }) });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
    const tree = ChatConversationScreen();
    const scroll = findElement(tree, element => typeof (element.props as { onScroll?: unknown }).onScroll === "function")!;
    (scroll.props as { onScroll: (event: unknown) => void }).onScroll({ currentTarget: { scrollTop: 0 } });
    await vi.waitFor(() => expect((harness.states[1] as unknown[]).length).toBe(2));
    expect(harness.apiFetch).toHaveBeenCalledWith("/api/chat/conversations/synthetic-conversation/messages?limit=50&before=1000");
    harness.index = 0;
    const updatedTree = ChatConversationScreen();
    const attachment = findElement(updatedTree, element =>
      element.type === ChatAttachment && (element.props as { message: { id: string } }).message.id === "older")!;
    const html = renderToStaticMarkup(attachment);
    expect(html).toContain("Original caption");
    expect(html).toContain(translations[language].attachmentUnavailable);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img");
    expect((harness.states[1] as Array<{ ciphertext: string; type: string }>)[0]).toMatchObject({ ciphertext, type: "file" });
  });
});
