export interface InvitationContext {
  readonly roomId: string;
  readonly calleeUids: readonly string[];
}

export type CancelInvitation = (context: InvitationContext, callUUID?: string) => Promise<void>;
const MAX_UUID_LENGTH = 128;
const INVALID_UUID_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** One immutable call generation; cancellation intent survives a delayed invite response. */
export class OutgoingInvitation {
  readonly context: InvitationContext;
  private callUUID?: string;
  private cancelled = false;
  private finished = false;
  private cancellation: Promise<void> = Promise.resolve();
  private cancelledUUID?: string;

  constructor(context: InvitationContext, private readonly sendCancel: CancelInvitation) {
    this.context = Object.freeze({
      roomId: context.roomId, calleeUids: Object.freeze([...context.calleeUids]),
    });
  }

  get isCancelled(): boolean { return this.cancelled; }

  /** Cancel once now, with the original destinations and any UUID already received. */
  cancel(): Promise<void> {
    if (this.finished) return Promise.resolve();
    if (this.cancelled) return this.cancellation;
    this.cancelled = true;
    this.cancelledUUID = this.callUUID;
    this.cancellation = this.sendCancel(this.context, this.callUUID);
    return this.cancellation;
  }

  /** If cancellation preceded the response, resend once with this attempt's exact UUID. */
  receiveUUID(callUUID: unknown): Promise<void> {
    if (typeof callUUID !== "string" || !callUUID || callUUID.length > MAX_UUID_LENGTH || INVALID_UUID_CHARACTERS.test(callUUID) ||
        (this.callUUID !== undefined && this.callUUID !== callUUID)) {
      throw new RangeError("Invalid or changed invitation UUID");
    }
    this.callUUID = callUUID;
    if (!this.cancelled) return Promise.resolve();
    if (this.cancelledUUID === callUUID) return this.cancellation;
    this.cancelledUUID = callUUID;
    this.cancellation = this.sendCancel(this.context, callUUID);
    return this.cancellation;
  }

  /** Answer/decline ends outgoing waiting without cancelling other group invitees. */
  finish(): void {
    if (!this.cancelled) this.finished = true;
  }
}
