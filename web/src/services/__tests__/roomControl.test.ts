import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { WebRTCService } from "../webrtc";

const socket = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const fake = {
    connected: true, handlers,
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    io: { on: vi.fn() }, connect: vi.fn(), emit: vi.fn(),
    timeout: vi.fn(),
  };
  fake.timeout.mockReturnValue(fake);
  return fake;
});
vi.mock("socket.io-client", () => ({ default: () => socket }));

async function joinedService() {
  const service = new WebRTCService();
  await service.init({});
  socket.handlers.get("room_joined")?.({
    participants: [], roomInfo: { roomId: "room-1" }, primaryUserId: null,
  });
  return service;
}

beforeEach(() => {
  vi.clearAllMocks();
  socket.handlers.clear();
  socket.connected = true;
  socket.timeout.mockReturnValue(socket);
});

describe("joined socket room close", () => {
  it("closes via Socket.IO with an acknowledgement and no REST request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const service = await joinedService();
    socket.emit.mockImplementation((event, payload, ack) => ack?.(null, { ok: true }));
    await expect(service.closeRoom()).resolves.toBeUndefined();
    expect(socket.timeout).toHaveBeenCalledWith(5000);
    expect(socket.emit).toHaveBeenCalledWith("close_room", { roomId: "room-1" }, expect.any(Function));
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects before join or while disconnected, without queuing a close", async () => {
    const service = new WebRTCService();
    await service.init({});
    await expect(service.closeRoom()).rejects.toThrow("ROOM_SOCKET_REQUIRED");
    socket.handlers.get("room_joined")?.({ participants: [], roomInfo: { roomId: "room-1" } });
    socket.connected = false;
    await expect(service.closeRoom()).rejects.toThrow("ROOM_SOCKET_REQUIRED");
    expect(socket.emit).not.toHaveBeenCalledWith("close_room", expect.anything(), expect.anything());
  });

  it.each([
    [null, { ok: false, error: "ROOM_FORBIDDEN" }, "ROOM_FORBIDDEN"],
    [new Error("timeout"), undefined, "ROOM_CLOSE_TIMEOUT"],
    [null, undefined, "ROOM_CLOSE_FAILED"],
  ])("reports acknowledgement failures explicitly", async (failure, reply, message) => {
    const service = await joinedService();
    socket.emit.mockImplementation((event, payload, ack) => ack?.(failure, reply));
    await expect(service.closeRoom()).rejects.toThrow(message);
  });

  it("requires a fresh room_joined after a disconnect", async () => {
    const service = await joinedService();
    socket.handlers.get("disconnect")?.();
    await expect(service.closeRoom()).rejects.toThrow("ROOM_SOCKET_REQUIRED");
  });

  it.each(["../../components/RoomView.tsx", "../../DevApp.tsx"])(
    "wires %s to the joined service instead of REST", (file) => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const handler = source.slice(source.indexOf("async function closeRoomForEveryone()"), source.indexOf("function toggleMute()"));
      expect(handler).toContain("await svc.closeRoom()");
      expect(handler).not.toContain("fetch(");
      expect(handler).not.toContain("/close");
    },
  );
});
