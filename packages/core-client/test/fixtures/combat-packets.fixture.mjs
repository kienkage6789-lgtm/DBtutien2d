// Synthetic fixture only: shaped from vendor gateway.js and the redacted
// evidence key summaries. It contains no captured packet, account, or player ID.
export const combatFixtures = {
  kill: { op: 'kill', id: 'enemy-synthetic-1', exp: 3, by: 'attacker-synthetic' },
  skillRes: { op: 'skill_res', n: 0 },
  down: { op: 'down', left: 60, lostExp: 2 },
  hurt: { op: 'hurt', hp: 40, mp: 12, bp: 8, dmg: 5, mpLoss: 1, byId: 'attacker-synthetic' },
  act: {
    op: 'act',
    k: 'enemy_poison',
    x: 320,
    y: 256,
    dps: 4,
    targets: [{ id: 'target-synthetic', x: 300, y: 250, t: 5 }],
  },
  loot: {
    op: 'loot',
    l: [{ id: 'loot-synthetic-1', item: 'linh_thuy', n: 1, x: 320, y: 256, age: 0 }],
  },
  lootGone: { op: 'loot_gone', id: 'loot-synthetic-1' },
  join: { op: 'join', id: 'remote-synthetic-1', pos: { x: 320, y: 256 } },
  leave: { op: 'leave', id: 'remote-synthetic-1' },
  bosses: { op: 'bosses', boards: [] },
  revived: { op: 'revived', x: 320, y: 256, hp: 60, mp: 40, bp: 10, ep: 1 },
};

export const saveFixture = {
  realm: 'luyen_khi_8',
  bag: {
    bi_tich_loi_chuong: 1,
    bi_tich_hoa_cau: 1,
    bi_tich_phong_nhan: 0,
  },
  bound: {},
  equipment: {},
  flags: {
    phap_thuat_dung: 'hoa_cau',
    chieu_tat: { phong_nhan: 1 },
    chieu_thu_tu: ['hoa_cau', 'loi_chuong'],
  },
};
