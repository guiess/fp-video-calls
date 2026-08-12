export type MutableRemoteStream = Pick<
  MediaStream,
  "addTrack" | "getTracks" | "removeTrack"
>;

/** Clears UI lifecycle callbacks owned by an obsolete remote track. */
export function clearRemoteTrackHandlers(track: MediaStreamTrack): void {
  track.onmute = null;
  track.onunmute = null;
  track.onended = null;
}

/** Detaches obsolete track callbacks without allocating a replacement stream. */
export function clearRemoteStream(stream: MutableRemoteStream | undefined): void {
  stream?.getTracks().forEach(clearRemoteTrackHandlers);
}

/** Creates an empty generation stream after detaching every obsolete track callback. */
export function resetRemoteStream(
  current: MutableRemoteStream | undefined,
  createStream: () => MediaStream = () => new MediaStream(),
): MediaStream {
  clearRemoteStream(current);
  return createStream();
}

/** Keeps at most one remote track of each media kind in the generation stream. */
export function replaceRemoteTrack(
  stream: MutableRemoteStream,
  track: MediaStreamTrack,
): void {
  const sameKind = stream.getTracks().filter((candidate) => candidate.kind === track.kind);
  if (sameKind.some((candidate) => candidate.id === track.id)) return;
  for (const obsolete of sameKind) {
    clearRemoteTrackHandlers(obsolete);
    stream.removeTrack(obsolete);
  }
  stream.addTrack(track);
}
