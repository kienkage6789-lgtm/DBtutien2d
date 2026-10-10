import type { AutoAnchor, AutoSupervisorSnapshot } from '../headless/auto-supervisor.js';
import type { VendorRunner, VendorRunnerSnapshot } from '../headless/vendor-runner.js';
import type { WalkOperation, WalkRequest } from '../headless/walk-navigator.js';
import type { GameGateway, GatewayLifecycle, GatewayState } from './game-gateway.js';

/** Thin composition adapter; all safety gates, waiters, and protocol behavior stay in VendorRunner. */
export class VendorGateway implements GameGateway {
  public readonly daily;

  public constructor(public readonly runner: VendorRunner) {
    this.daily = runner.dailyClient;
  }

  public start(): Promise<void> { return this.runner.start(); }
  public stop(): Promise<void> { return this.runner.stop(); }
  public getLifecycle(): GatewayLifecycle { return this.runner.getLifecycle(); }
  public onDisconnect(listener: () => void): () => void { return this.runner.onDisconnect(listener); }
  public getFrameMetrics() { return this.runner.getFrameMetrics(); }

  public getState(): GatewayState {
    const snapshot: VendorRunnerSnapshot = this.runner.getSnapshot();
    return {
      lifecycle: snapshot.lifecycle,
      connection: snapshot.connection,
      mapId: snapshot.mapId,
      khu: snapshot.khu,
      x: snapshot.x,
      y: snapshot.y,
      hp: snapshot.vitals.fresh ? snapshot.hp : null,
      maxHp: snapshot.vitals.fresh ? snapshot.maxHp : null,
      mp: snapshot.vitals.fresh ? snapshot.mp : null,
      maxMp: snapshot.vitals.fresh ? snapshot.maxMp : null,
      isDown: snapshot.vitals.fresh ? snapshot.downed : null,
      hurtCount: snapshot.hurtCount,
      autoActive: snapshot.autoRequested || snapshot.supervisor.phase !== 'idle',
      soKhu: snapshot.soKhu,
      reachableMaps: snapshot.mapId ? this.runner.getReachableMaps().maps.map((map) => map.mapId) : [],
      walkOperation: snapshot.moveTo,
    };
  }

  public walkTo(request: WalkRequest): WalkOperation { return this.runner.moveTo(request); }
  public cancelWalk(operationId: string, reason = 'user_cancelled'): boolean {
    return this.runner.cancelMoveTo(reason, operationId);
  }
  public startAuto(anchor?: AutoAnchor): Promise<AutoSupervisorSnapshot> { return this.runner.startAuto(anchor); }
  public stopAuto(): AutoSupervisorSnapshot { return this.runner.stopAuto(); }
  public getKhuInfo() { return this.runner.getKhuInfo(); }
  public requestKhuList() { return this.runner.requestKhuList(); }
  public changeKhu(khu: number) { return this.runner.changeKhu(khu); }
}
