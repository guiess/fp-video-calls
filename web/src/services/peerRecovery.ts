export const DISCONNECT_GRACE_MS = 8_000;
export const ICE_RESTART_TIMEOUT_MS = 6_000;
export const RECOVERY_COOLDOWN_MS = 30_000;

export type PeerRegistryState = "connected" | "disconnected" | "terminal" | "usable";
export type PeerRecoveryState = "idle" | "grace" | "restarting" | "rebuilding" | "cooldown";

export type PeerConnectionStateView = Pick<
  RTCPeerConnection,
  "connectionState" | "iceConnectionState" | "signalingState"
>;

/** Classifies browser-specific peer states for registry and recovery decisions. */
export function classifyPeerConnection(peer: PeerConnectionStateView): PeerRegistryState {
  if (isTerminalState(peer)) return "terminal";
  if (peer.connectionState === "disconnected" || peer.iceConnectionState === "disconnected") {
    return "disconnected";
  }
  if (peer.connectionState === "connected"
    || peer.iceConnectionState === "connected"
    || peer.iceConnectionState === "completed") {
    return "connected";
  }
  return "usable";
}

function isTerminalState(peer: PeerConnectionStateView): boolean {
  return peer.connectionState === "failed"
    || peer.iceConnectionState === "failed"
    || peer.connectionState === "closed"
    || peer.iceConnectionState === "closed"
    || peer.signalingState === "closed";
}

/** Port implemented by the peer registry that performs transport recovery actions. */
export interface PeerRecoveryActions {
  isCurrent(targetId: string, generation: number): boolean;
  restartIce(targetId: string, generation: number, signal: AbortSignal): Promise<void>;
  rebuildPeer(targetId: string, generation: number, signal: AbortSignal): Promise<void>;
}

type RecoveryJob = {
  generation: number;
  state: "grace" | "restarting" | "rebuilding";
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  isRestartOfferSent: boolean;
};

/**
 * Serializes per-peer recovery without depending on React or browser rendering.
 * One job owns the disconnect grace, ICE restart timeout, rebuild, and cooldown.
 */
export class PeerRecoveryCoordinator {
  private jobs = new Map<string, RecoveryJob>();
  private cooldowns = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly actions: PeerRecoveryActions) {}

  /** Consumes an observed state for the current peer-connection generation. */
  observe(targetId: string, generation: number, state: PeerRegistryState): void {
    if (!this.actions.isCurrent(targetId, generation)) return;
    if (state === "connected") return this.handleConnected(targetId);
    if (this.cooldowns.has(targetId) || state === "usable") return;
    if (state === "disconnected") return this.scheduleGrace(targetId, generation);
    this.handleTerminalState(targetId, generation);
  }

  /** Cancels recovery and cooldown state when a peer leaves or is replaced. */
  cancelPeer(targetId: string): void {
    this.clearJob(targetId);
    const cooldown = this.cooldowns.get(targetId);
    if (cooldown) clearTimeout(cooldown);
    this.cooldowns.delete(targetId);
  }

  /** Cancels every peer recovery during room teardown. */
  cancelAll(): void {
    [...this.jobs.keys()].forEach((targetId) => this.clearJob(targetId));
    this.cooldowns.forEach((timer) => clearTimeout(timer));
    this.cooldowns.clear();
  }

  /** Exposes coarse state for deterministic unit tests and diagnostics adapters. */
  getState(targetId: string): PeerRecoveryState {
    if (this.cooldowns.has(targetId)) return "cooldown";
    return this.jobs.get(targetId)?.state ?? "idle";
  }

  private scheduleGrace(targetId: string, generation: number): void {
    if (this.jobs.has(targetId)) return;
    const job = this.createJob(generation, "grace");
    job.timer = setTimeout(() => this.startRestart(targetId, job), DISCONNECT_GRACE_MS);
    this.jobs.set(targetId, job);
  }

  private handleTerminalState(targetId: string, generation: number): void {
    const job = this.jobs.get(targetId);
    if (!job) return this.startRestart(targetId, this.createJob(generation, "restarting"));
    if (job.state === "grace") return this.startRestart(targetId, job);
    if (job.state === "restarting" && job.isRestartOfferSent) void this.escalate(targetId, job);
  }

  private startRestart(targetId: string, job: RecoveryJob): void {
    this.clearTimer(job);
    job.state = "restarting";
    this.jobs.set(targetId, job);
    job.timer = setTimeout(() => void this.escalate(targetId, job), ICE_RESTART_TIMEOUT_MS);
    void this.actions.restartIce(targetId, job.generation, job.controller.signal)
      .then(() => { job.isRestartOfferSent = true; })
      .catch(() => {
        if (!job.controller.signal.aborted) void this.escalate(targetId, job);
      });
  }

  private async escalate(targetId: string, job: RecoveryJob): Promise<void> {
    if (this.jobs.get(targetId) !== job || job.state !== "restarting") return;
    this.clearTimer(job);
    job.controller.abort();
    job.controller = new AbortController();
    job.state = "rebuilding";
    try {
      await this.actions.rebuildPeer(targetId, job.generation, job.controller.signal);
    } finally {
      if (this.jobs.get(targetId) === job) this.startCooldown(targetId);
    }
  }

  private handleConnected(targetId: string): void {
    const job = this.jobs.get(targetId);
    if (!job) return;
    if (job.state === "grace") return this.clearJob(targetId);
    this.startCooldown(targetId);
  }

  private startCooldown(targetId: string): void {
    this.clearJob(targetId);
    const timer = setTimeout(() => this.cooldowns.delete(targetId), RECOVERY_COOLDOWN_MS);
    this.cooldowns.set(targetId, timer);
  }

  private clearJob(targetId: string): void {
    const job = this.jobs.get(targetId);
    if (!job) return;
    this.clearTimer(job);
    job.controller.abort();
    this.jobs.delete(targetId);
  }

  private clearTimer(job: RecoveryJob): void {
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
  }

  private createJob(
    generation: number,
    state: RecoveryJob["state"],
  ): RecoveryJob {
    return {
      generation,
      state,
      controller: new AbortController(),
      timer: null,
      isRestartOfferSent: false,
    };
  }
}
