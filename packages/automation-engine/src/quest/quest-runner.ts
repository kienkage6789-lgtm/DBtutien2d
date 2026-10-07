import { TuTienClient } from '@tutien2d/core-client';

export class QuestRunnerModule {
  private client: TuTienClient;
  private checkedInDay: string | null = null;
  private lastDailyTaskTime: number = 0;
  private lastCaveTime: number = 0;
  private lastMainQuestAttempt: number = 0;

  constructor(client: TuTienClient) {
    this.client = client;
  }

  /**
   * Run daily check-in (diemdanh)
   */
  public async performDailyCheckin(): Promise<boolean> {
    const today = new Date().toLocaleDateString('en-CA');
    if (this.checkedInDay === today) return false;

    try {
      const ack = await this.client.dailyCheckin();
      const alreadyDone = /đã|already/i.test(ack.why || '') && /điểm danh|check.?in|nhận|hôm nay|today/i.test(ack.why || '');
      if (ack.ok || alreadyDone) this.checkedInDay = today;
      return ack.ok;
    } catch (err: any) {
      this.client.log('warn', `Điểm danh lỗi: ${err.message}`);
      return false;
    }
  }

  /**
   * Run daily seed quest tasks (seed.*)
   */
  public async runDailyTasks(): Promise<void> {
    // Avoid running too often
    if (Date.now() - this.lastDailyTaskTime < 120000) return;
    this.lastDailyTaskTime = Date.now();

    const questSave = this.client.state.questSave;
    const seedQuest = questSave?.seedQuest;

    if (!seedQuest) return;

    const dailyTasks = ['cau_ca', 'duoc_moc', 'linh_chi', 'truc_gia'];
    for (const taskId of dailyTasks) {
      const taskInfo = seedQuest.daily?.[taskId];
      // If task has attempts left or not completed today
      if (!taskInfo || taskInfo.n < 3) {
        try {
          this.client.log('info', `[Nhiệm Vụ Ngày] Thử nhận nhiệm vụ hàng ngày: ${taskId}`);
          const started = await this.client.seedStart(taskId);
          if (!started.ok) continue;
          await this.client.antiDetection.humanDelay(1.5);
          const propId = String((taskInfo as SeedTaskWithProp | undefined)?.propId || taskId);
          const collected = await this.client.seedCollect(propId);
          if (!collected.ok) continue;
          await this.client.seedComplete();
        } catch (_) {}
      }
    }
  }

  /**
   * Try turning in active main quest
   */
  public async tryTurnInMainQuest(): Promise<boolean> {
    if (Date.now() - this.lastMainQuestAttempt < 120000) return false;
    this.lastMainQuestAttempt = Date.now();
    try {
      const ack = await this.client.questTurnIn();
      return ack.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Run cave dungeon run
   */
  public async runCaveDungeon(): Promise<void> {
    if (Date.now() - this.lastCaveTime < 300000) return; // 5 min cooldown
    this.lastCaveTime = Date.now();

    try {
      this.client.log('info', `[Bí Cảnh] Thử thách Bí Cảnh Hang Động...`);
      await this.client.caveStart();
      await this.client.antiDetection.humanDelay(2.0);
      await this.client.caveChest();
    } catch (_) {}
  }
}

interface SeedTaskWithProp {
  propId?: string;
}
