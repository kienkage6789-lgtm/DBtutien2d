// Generated from vendor/tutien2d-public-client/2026-10-06/src/entities/enemy.js, world/mapdata.js, world/map_*.js, and world/tilemap.js.
// Regenerate with: node scripts/gen-walk-grids.mjs
// Static aggregate of TileMap.enemySpawns after vendor load, including client-generated extras.
export interface MapSpawnPoint {
  readonly id: string;
  readonly tx: number;
  readonly ty: number;
  readonly x: number;
  readonly y: number;
  readonly walkable: boolean;
}
export interface MapSpawnRow {
  readonly mapId: string;
  readonly enemyType: string;
  readonly count: number;
  readonly wanderRadius: number | null;
  readonly leashRange: number | null;
  readonly respawnSec: number | null;
  readonly spawns: readonly MapSpawnPoint[];
}
export const MAP_SPAWN_MAP_IDS = [
  "mieu_hoang",
  "tan_vien",
  "thanh_truc_lam",
  "duoc_vien",
  "vuon_ca_nhan",
  "long_uyen",
  "hang_dong_co",
  "bai_da_hang_gio",
  "dong_mach_ngam",
  "mo_linh_thach",
  "thach_phong_thung_lung",
  "bat_quai_thach_phan",
  "thien_dao_khuyet",
  "u_uynh_vuc",
  "hac_phong_linh",
  "hac_thi"
] as const;
export const MAP_SPAWNS = [
  {
    "mapId": "mieu_hoang",
    "enemyType": "yeu_quai_ha_pham",
    "count": 12,
    "wanderRadius": 24,
    "leashRange": 260,
    "respawnSec": 30,
    "spawns": [
      {
        "id": "yqhp_1",
        "tx": 14,
        "ty": 3,
        "x": 464,
        "y": 128,
        "walkable": true
      },
      {
        "id": "yqhp_1_x2",
        "tx": 13,
        "ty": 2,
        "x": 432,
        "y": 96,
        "walkable": true
      },
      {
        "id": "yqhp_1_x3",
        "tx": 14,
        "ty": 2,
        "x": 464,
        "y": 96,
        "walkable": true
      },
      {
        "id": "yqhp_2",
        "tx": 16,
        "ty": 8,
        "x": 528,
        "y": 288,
        "walkable": true
      },
      {
        "id": "yqhp_2_x2",
        "tx": 15,
        "ty": 7,
        "x": 496,
        "y": 256,
        "walkable": true
      },
      {
        "id": "yqhp_2_x3",
        "tx": 16,
        "ty": 7,
        "x": 528,
        "y": 256,
        "walkable": true
      },
      {
        "id": "yqhp_3",
        "tx": 13,
        "ty": 11,
        "x": 432,
        "y": 384,
        "walkable": true
      },
      {
        "id": "yqhp_3_x2",
        "tx": 12,
        "ty": 10,
        "x": 400,
        "y": 352,
        "walkable": true
      },
      {
        "id": "yqhp_3_x3",
        "tx": 13,
        "ty": 10,
        "x": 432,
        "y": 352,
        "walkable": true
      },
      {
        "id": "yqhp_4",
        "tx": 6,
        "ty": 11,
        "x": 208,
        "y": 384,
        "walkable": true
      },
      {
        "id": "yqhp_4_x2",
        "tx": 5,
        "ty": 10,
        "x": 176,
        "y": 352,
        "walkable": true
      },
      {
        "id": "yqhp_4_x3",
        "tx": 6,
        "ty": 10,
        "x": 208,
        "y": 352,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thanh_truc_lam",
    "enemyType": "sau_truc",
    "count": 27,
    "wanderRadius": 10,
    "leashRange": 260,
    "respawnSec": 12,
    "spawns": [
      {
        "id": "st_1",
        "tx": 5,
        "ty": 6,
        "x": 176,
        "y": 224,
        "walkable": true
      },
      {
        "id": "st_1_x2",
        "tx": 6,
        "ty": 6,
        "x": 208,
        "y": 224,
        "walkable": true
      },
      {
        "id": "st_1_x3",
        "tx": 5,
        "ty": 7,
        "x": 176,
        "y": 256,
        "walkable": true
      },
      {
        "id": "st_2",
        "tx": 30,
        "ty": 7,
        "x": 976,
        "y": 256,
        "walkable": true
      },
      {
        "id": "st_2_x2",
        "tx": 29,
        "ty": 7,
        "x": 944,
        "y": 256,
        "walkable": true
      },
      {
        "id": "st_2_x3",
        "tx": 31,
        "ty": 7,
        "x": 1008,
        "y": 256,
        "walkable": true
      },
      {
        "id": "st_3",
        "tx": 6,
        "ty": 24,
        "x": 208,
        "y": 800,
        "walkable": true
      },
      {
        "id": "st_3_x2",
        "tx": 5,
        "ty": 23,
        "x": 176,
        "y": 768,
        "walkable": true
      },
      {
        "id": "st_3_x3",
        "tx": 6,
        "ty": 23,
        "x": 208,
        "y": 768,
        "walkable": true
      },
      {
        "id": "st_4",
        "tx": 10,
        "ty": 3,
        "x": 336,
        "y": 128,
        "walkable": true
      },
      {
        "id": "st_4_x2",
        "tx": 9,
        "ty": 2,
        "x": 304,
        "y": 96,
        "walkable": true
      },
      {
        "id": "st_4_x3",
        "tx": 10,
        "ty": 2,
        "x": 336,
        "y": 96,
        "walkable": true
      },
      {
        "id": "st_5",
        "tx": 26,
        "ty": 4,
        "x": 848,
        "y": 160,
        "walkable": true
      },
      {
        "id": "st_5_x2",
        "tx": 25,
        "ty": 3,
        "x": 816,
        "y": 128,
        "walkable": true
      },
      {
        "id": "st_5_x3",
        "tx": 26,
        "ty": 3,
        "x": 848,
        "y": 128,
        "walkable": true
      },
      {
        "id": "st_6",
        "tx": 13,
        "ty": 9,
        "x": 432,
        "y": 320,
        "walkable": true
      },
      {
        "id": "st_6_x2",
        "tx": 12,
        "ty": 8,
        "x": 400,
        "y": 288,
        "walkable": true
      },
      {
        "id": "st_6_x3",
        "tx": 13,
        "ty": 8,
        "x": 432,
        "y": 288,
        "walkable": true
      },
      {
        "id": "st_7",
        "tx": 5,
        "ty": 15,
        "x": 176,
        "y": 512,
        "walkable": true
      },
      {
        "id": "st_7_x2",
        "tx": 4,
        "ty": 14,
        "x": 144,
        "y": 480,
        "walkable": true
      },
      {
        "id": "st_7_x3",
        "tx": 5,
        "ty": 14,
        "x": 176,
        "y": 480,
        "walkable": true
      },
      {
        "id": "st_8",
        "tx": 27,
        "ty": 22,
        "x": 880,
        "y": 736,
        "walkable": true
      },
      {
        "id": "st_8_x2",
        "tx": 26,
        "ty": 21,
        "x": 848,
        "y": 704,
        "walkable": true
      },
      {
        "id": "st_8_x3",
        "tx": 27,
        "ty": 21,
        "x": 880,
        "y": 704,
        "walkable": true
      },
      {
        "id": "st_9",
        "tx": 15,
        "ty": 23,
        "x": 496,
        "y": 768,
        "walkable": true
      },
      {
        "id": "st_9_x2",
        "tx": 14,
        "ty": 22,
        "x": 464,
        "y": 736,
        "walkable": true
      },
      {
        "id": "st_9_x3",
        "tx": 15,
        "ty": 22,
        "x": 496,
        "y": 736,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thanh_truc_lam",
    "enemyType": "son_chuot",
    "count": 27,
    "wanderRadius": 26,
    "leashRange": 260,
    "respawnSec": 12,
    "spawns": [
      {
        "id": "sc_1",
        "tx": 16,
        "ty": 3,
        "x": 528,
        "y": 128,
        "walkable": true
      },
      {
        "id": "sc_1_x2",
        "tx": 17,
        "ty": 3,
        "x": 560,
        "y": 128,
        "walkable": true
      },
      {
        "id": "sc_1_x3",
        "tx": 17,
        "ty": 4,
        "x": 560,
        "y": 160,
        "walkable": true
      },
      {
        "id": "sc_2",
        "tx": 33,
        "ty": 20,
        "x": 1072,
        "y": 672,
        "walkable": true
      },
      {
        "id": "sc_2_x2",
        "tx": 32,
        "ty": 19,
        "x": 1040,
        "y": 640,
        "walkable": true
      },
      {
        "id": "sc_2_x3",
        "tx": 33,
        "ty": 19,
        "x": 1072,
        "y": 640,
        "walkable": true
      },
      {
        "id": "sc_3",
        "tx": 17,
        "ty": 27,
        "x": 560,
        "y": 896,
        "walkable": true
      },
      {
        "id": "sc_3_x2",
        "tx": 16,
        "ty": 26,
        "x": 528,
        "y": 864,
        "walkable": true
      },
      {
        "id": "sc_3_x3",
        "tx": 17,
        "ty": 26,
        "x": 560,
        "y": 864,
        "walkable": true
      },
      {
        "id": "sc_4",
        "tx": 33,
        "ty": 9,
        "x": 1072,
        "y": 320,
        "walkable": true
      },
      {
        "id": "sc_4_x2",
        "tx": 32,
        "ty": 8,
        "x": 1040,
        "y": 288,
        "walkable": true
      },
      {
        "id": "sc_4_x3",
        "tx": 33,
        "ty": 8,
        "x": 1072,
        "y": 288,
        "walkable": true
      },
      {
        "id": "sc_5",
        "tx": 10,
        "ty": 11,
        "x": 336,
        "y": 384,
        "walkable": true
      },
      {
        "id": "sc_5_x2",
        "tx": 9,
        "ty": 10,
        "x": 304,
        "y": 352,
        "walkable": true
      },
      {
        "id": "sc_5_x3",
        "tx": 10,
        "ty": 10,
        "x": 336,
        "y": 352,
        "walkable": true
      },
      {
        "id": "sc_6",
        "tx": 9,
        "ty": 19,
        "x": 304,
        "y": 640,
        "walkable": true
      },
      {
        "id": "sc_6_x2",
        "tx": 8,
        "ty": 18,
        "x": 272,
        "y": 608,
        "walkable": true
      },
      {
        "id": "sc_6_x3",
        "tx": 9,
        "ty": 18,
        "x": 304,
        "y": 608,
        "walkable": true
      },
      {
        "id": "sc_7",
        "tx": 19,
        "ty": 20,
        "x": 624,
        "y": 672,
        "walkable": true
      },
      {
        "id": "sc_7_x2",
        "tx": 18,
        "ty": 19,
        "x": 592,
        "y": 640,
        "walkable": true
      },
      {
        "id": "sc_7_x3",
        "tx": 19,
        "ty": 19,
        "x": 624,
        "y": 640,
        "walkable": true
      },
      {
        "id": "sc_8",
        "tx": 31,
        "ty": 17,
        "x": 1008,
        "y": 576,
        "walkable": true
      },
      {
        "id": "sc_8_x2",
        "tx": 30,
        "ty": 16,
        "x": 976,
        "y": 544,
        "walkable": true
      },
      {
        "id": "sc_8_x3",
        "tx": 31,
        "ty": 16,
        "x": 1008,
        "y": 544,
        "walkable": true
      },
      {
        "id": "sc_9",
        "tx": 29,
        "ty": 25,
        "x": 944,
        "y": 832,
        "walkable": true
      },
      {
        "id": "sc_9_x2",
        "tx": 28,
        "ty": 24,
        "x": 912,
        "y": 800,
        "walkable": true
      },
      {
        "id": "sc_9_x3",
        "tx": 29,
        "ty": 24,
        "x": 944,
        "y": 800,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thanh_truc_lam",
    "enemyType": "tieu_phu",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "pn_tp_1",
        "tx": 12,
        "ty": 18,
        "x": 400,
        "y": 608,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thanh_truc_lam",
    "enemyType": "thuong_nhan",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_tn_1",
        "tx": 14,
        "ty": 10,
        "x": 464,
        "y": 352,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thanh_truc_lam",
    "enemyType": "tieu_su",
    "count": 2,
    "wanderRadius": 40,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_ts_1",
        "tx": 13,
        "ty": 10,
        "x": 432,
        "y": 352,
        "walkable": true
      },
      {
        "id": "td_ts_2",
        "tx": 15,
        "ty": 10,
        "x": 496,
        "y": 352,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thanh_truc_lam",
    "enemyType": "son_tac",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "sot_3",
        "tx": 31,
        "ty": 14,
        "x": 1008,
        "y": 480,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thanh_truc_lam",
    "enemyType": "kiep_tac",
    "count": 3,
    "wanderRadius": 40,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_kt_1",
        "tx": 13,
        "ty": 12,
        "x": 432,
        "y": 416,
        "walkable": true
      },
      {
        "id": "td_kt_2",
        "tx": 14,
        "ty": 12,
        "x": 464,
        "y": 416,
        "walkable": true
      },
      {
        "id": "td_kt_3",
        "tx": 15,
        "ty": 12,
        "x": 496,
        "y": 416,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "duoc_vien",
    "enemyType": "doc_dang_yeu",
    "count": 18,
    "wanderRadius": 22,
    "leashRange": 260,
    "respawnSec": 12,
    "spawns": [
      {
        "id": "ddy_1",
        "tx": 20,
        "ty": 5,
        "x": 656,
        "y": 192,
        "walkable": true
      },
      {
        "id": "ddy_1_x2",
        "tx": 19,
        "ty": 4,
        "x": 624,
        "y": 160,
        "walkable": true
      },
      {
        "id": "ddy_1_x3",
        "tx": 20,
        "ty": 4,
        "x": 656,
        "y": 160,
        "walkable": true
      },
      {
        "id": "ddy_2",
        "tx": 27,
        "ty": 7,
        "x": 880,
        "y": 256,
        "walkable": true
      },
      {
        "id": "ddy_2_x2",
        "tx": 27,
        "ty": 6,
        "x": 880,
        "y": 224,
        "walkable": true
      },
      {
        "id": "ddy_2_x3",
        "tx": 28,
        "ty": 6,
        "x": 912,
        "y": 224,
        "walkable": true
      },
      {
        "id": "ddy_3",
        "tx": 29,
        "ty": 11,
        "x": 944,
        "y": 384,
        "walkable": true
      },
      {
        "id": "ddy_3_x2",
        "tx": 28,
        "ty": 10,
        "x": 912,
        "y": 352,
        "walkable": true
      },
      {
        "id": "ddy_3_x3",
        "tx": 29,
        "ty": 10,
        "x": 944,
        "y": 352,
        "walkable": true
      },
      {
        "id": "ddy_4",
        "tx": 19,
        "ty": 13,
        "x": 624,
        "y": 448,
        "walkable": true
      },
      {
        "id": "ddy_4_x2",
        "tx": 18,
        "ty": 12,
        "x": 592,
        "y": 416,
        "walkable": true
      },
      {
        "id": "ddy_4_x3",
        "tx": 19,
        "ty": 12,
        "x": 624,
        "y": 416,
        "walkable": true
      },
      {
        "id": "ddy_5",
        "tx": 10,
        "ty": 22,
        "x": 336,
        "y": 736,
        "walkable": true
      },
      {
        "id": "ddy_5_x2",
        "tx": 9,
        "ty": 21,
        "x": 304,
        "y": 704,
        "walkable": true
      },
      {
        "id": "ddy_5_x3",
        "tx": 10,
        "ty": 21,
        "x": 336,
        "y": 704,
        "walkable": true
      },
      {
        "id": "ddy_6",
        "tx": 16,
        "ty": 24,
        "x": 528,
        "y": 800,
        "walkable": true
      },
      {
        "id": "ddy_6_x2",
        "tx": 15,
        "ty": 23,
        "x": 496,
        "y": 768,
        "walkable": true
      },
      {
        "id": "ddy_6_x3",
        "tx": 15,
        "ty": 24,
        "x": 496,
        "y": 800,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "duoc_vien",
    "enemyType": "nong_phu",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "pn_np_1",
        "tx": 14,
        "ty": 12,
        "x": 464,
        "y": 416,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "duoc_vien",
    "enemyType": "thuong_nhan",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_tn_2",
        "tx": 12,
        "ty": 15,
        "x": 400,
        "y": 512,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "duoc_vien",
    "enemyType": "tieu_su",
    "count": 2,
    "wanderRadius": 40,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_ts_3",
        "tx": 11,
        "ty": 15,
        "x": 368,
        "y": 512,
        "walkable": true
      },
      {
        "id": "td_ts_4",
        "tx": 13,
        "ty": 15,
        "x": 432,
        "y": 512,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "duoc_vien",
    "enemyType": "son_tac",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "sot_6",
        "tx": 23,
        "ty": 12,
        "x": 752,
        "y": 416,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "duoc_vien",
    "enemyType": "kiep_tac",
    "count": 3,
    "wanderRadius": 40,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_kt_4",
        "tx": 11,
        "ty": 17,
        "x": 368,
        "y": 576,
        "walkable": true
      },
      {
        "id": "td_kt_5",
        "tx": 12,
        "ty": 17,
        "x": 400,
        "y": 576,
        "walkable": true
      },
      {
        "id": "td_kt_6",
        "tx": 13,
        "ty": 17,
        "x": 432,
        "y": 576,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "vuon_ca_nhan",
    "enemyType": "duoc_linh_thu",
    "count": 2,
    "wanderRadius": 30,
    "leashRange": 260,
    "respawnSec": 12,
    "spawns": [
      {
        "id": "dlt_1",
        "tx": 9,
        "ty": 2,
        "x": 304,
        "y": 96,
        "walkable": true
      },
      {
        "id": "dlt_2",
        "tx": 10,
        "ty": 5,
        "x": 336,
        "y": 192,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "long_uyen",
    "enemyType": "than_thu_xich_long",
    "count": 1,
    "wanderRadius": 40,
    "leashRange": 300,
    "respawnSec": 10800,
    "spawns": [
      {
        "id": "ttxl_1",
        "tx": 27,
        "ty": 14,
        "x": 880,
        "y": 480,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "long_uyen",
    "enemyType": "xich_nhan_nguu",
    "count": 3,
    "wanderRadius": 34,
    "leashRange": 260,
    "respawnSec": 10800,
    "spawns": [
      {
        "id": "xich_nhan_nguu_1",
        "tx": 24,
        "ty": 16,
        "x": 784,
        "y": 544,
        "walkable": true
      },
      {
        "id": "xich_nhan_nguu_2",
        "tx": 29,
        "ty": 17,
        "x": 944,
        "y": 576,
        "walkable": true
      },
      {
        "id": "xich_nhan_nguu_3",
        "tx": 31,
        "ty": 12,
        "x": 1008,
        "y": 416,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "hang_dong_co",
    "enemyType": "thach_giap_yeu",
    "count": 1,
    "wanderRadius": 20,
    "leashRange": 260,
    "respawnSec": 30,
    "spawns": [
      {
        "id": "thach_giap_yeu_hang_co",
        "tx": 14,
        "ty": 8,
        "x": 464,
        "y": 288,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "hang_dong_co",
    "enemyType": "thach_yeu",
    "count": 15,
    "wanderRadius": 26,
    "leashRange": 260,
    "respawnSec": 30,
    "spawns": [
      {
        "id": "thach_yeu_1",
        "tx": 10,
        "ty": 6,
        "x": 336,
        "y": 224,
        "walkable": true
      },
      {
        "id": "thach_yeu_2",
        "tx": 19,
        "ty": 7,
        "x": 624,
        "y": 256,
        "walkable": true
      },
      {
        "id": "thach_yeu_3",
        "tx": 7,
        "ty": 11,
        "x": 240,
        "y": 384,
        "walkable": true
      },
      {
        "id": "thach_yeu_4",
        "tx": 21,
        "ty": 11,
        "x": 688,
        "y": 384,
        "walkable": true
      },
      {
        "id": "thach_yeu_5",
        "tx": 14,
        "ty": 9,
        "x": 464,
        "y": 320,
        "walkable": true
      },
      {
        "id": "thach_yeu_6",
        "tx": 7,
        "ty": 4,
        "x": 240,
        "y": 160,
        "walkable": true
      },
      {
        "id": "thach_yeu_7",
        "tx": 17,
        "ty": 4,
        "x": 560,
        "y": 160,
        "walkable": true
      },
      {
        "id": "thach_yeu_8",
        "tx": 11,
        "ty": 5,
        "x": 368,
        "y": 192,
        "walkable": true
      },
      {
        "id": "thach_yeu_9",
        "tx": 21,
        "ty": 6,
        "x": 688,
        "y": 224,
        "walkable": true
      },
      {
        "id": "thach_yeu_10",
        "tx": 6,
        "ty": 8,
        "x": 208,
        "y": 288,
        "walkable": true
      },
      {
        "id": "thach_yeu_11",
        "tx": 24,
        "ty": 8,
        "x": 784,
        "y": 288,
        "walkable": true
      },
      {
        "id": "thach_yeu_12",
        "tx": 11,
        "ty": 9,
        "x": 368,
        "y": 320,
        "walkable": true
      },
      {
        "id": "thach_yeu_13",
        "tx": 19,
        "ty": 9,
        "x": 624,
        "y": 320,
        "walkable": true
      },
      {
        "id": "thach_yeu_14",
        "tx": 9,
        "ty": 13,
        "x": 304,
        "y": 448,
        "walkable": true
      },
      {
        "id": "thach_yeu_15",
        "tx": 18,
        "ty": 13,
        "x": 592,
        "y": 448,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "bai_da_hang_gio",
    "enemyType": "xuyen_son_giap",
    "count": 15,
    "wanderRadius": 30,
    "leashRange": 260,
    "respawnSec": 40,
    "spawns": [
      {
        "id": "xsg_1",
        "tx": 5,
        "ty": 22,
        "x": 176,
        "y": 736,
        "walkable": true
      },
      {
        "id": "xsg_1_x2",
        "tx": 4,
        "ty": 21,
        "x": 144,
        "y": 704,
        "walkable": true
      },
      {
        "id": "xsg_1_x3",
        "tx": 4,
        "ty": 22,
        "x": 144,
        "y": 736,
        "walkable": true
      },
      {
        "id": "xsg_2",
        "tx": 15,
        "ty": 22,
        "x": 496,
        "y": 736,
        "walkable": true
      },
      {
        "id": "xsg_2_x2",
        "tx": 14,
        "ty": 21,
        "x": 464,
        "y": 704,
        "walkable": true
      },
      {
        "id": "xsg_2_x3",
        "tx": 15,
        "ty": 21,
        "x": 496,
        "y": 704,
        "walkable": true
      },
      {
        "id": "xsg_3",
        "tx": 8,
        "ty": 14,
        "x": 272,
        "y": 480,
        "walkable": true
      },
      {
        "id": "xsg_3_x2",
        "tx": 7,
        "ty": 13,
        "x": 240,
        "y": 448,
        "walkable": true
      },
      {
        "id": "xsg_3_x3",
        "tx": 8,
        "ty": 13,
        "x": 272,
        "y": 448,
        "walkable": true
      },
      {
        "id": "xsg_4",
        "tx": 28,
        "ty": 15,
        "x": 912,
        "y": 512,
        "walkable": true
      },
      {
        "id": "xsg_4_x2",
        "tx": 27,
        "ty": 14,
        "x": 880,
        "y": 480,
        "walkable": true
      },
      {
        "id": "xsg_4_x3",
        "tx": 28,
        "ty": 14,
        "x": 912,
        "y": 480,
        "walkable": true
      },
      {
        "id": "xsg_5",
        "tx": 32,
        "ty": 10,
        "x": 1040,
        "y": 352,
        "walkable": true
      },
      {
        "id": "xsg_5_x2",
        "tx": 32,
        "ty": 9,
        "x": 1040,
        "y": 320,
        "walkable": true
      },
      {
        "id": "xsg_5_x3",
        "tx": 33,
        "ty": 9,
        "x": 1072,
        "y": 320,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "bai_da_hang_gio",
    "enemyType": "duoc_nong",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "pn_dn_2",
        "tx": 22,
        "ty": 17,
        "x": 720,
        "y": 576,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "bai_da_hang_gio",
    "enemyType": "thuong_nhan",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_tn_3",
        "tx": 21,
        "ty": 12,
        "x": 688,
        "y": 416,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "bai_da_hang_gio",
    "enemyType": "tieu_su",
    "count": 2,
    "wanderRadius": 40,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_ts_5",
        "tx": 20,
        "ty": 12,
        "x": 656,
        "y": 416,
        "walkable": true
      },
      {
        "id": "td_ts_6",
        "tx": 22,
        "ty": 12,
        "x": 720,
        "y": 416,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "bai_da_hang_gio",
    "enemyType": "son_tac",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "sot_9",
        "tx": 10,
        "ty": 25,
        "x": 336,
        "y": 832,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "bai_da_hang_gio",
    "enemyType": "kiep_tac",
    "count": 3,
    "wanderRadius": 40,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "td_kt_7",
        "tx": 20,
        "ty": 14,
        "x": 656,
        "y": 480,
        "walkable": true
      },
      {
        "id": "td_kt_8",
        "tx": 21,
        "ty": 14,
        "x": 688,
        "y": 480,
        "walkable": true
      },
      {
        "id": "td_kt_9",
        "tx": 22,
        "ty": 14,
        "x": 720,
        "y": 480,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "bai_da_hang_gio",
    "enemyType": "hac_y_ta_tu_3",
    "count": 1,
    "wanderRadius": 60,
    "leashRange": 260,
    "respawnSec": 60,
    "spawns": [
      {
        "id": "hac_y_ta_tu_3",
        "tx": 36,
        "ty": 15,
        "x": 1168,
        "y": 512,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "dong_mach_ngam",
    "enemyType": "thu_sinh",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "pn_ts_1",
        "tx": 5,
        "ty": 17,
        "x": 176,
        "y": 576,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "dong_mach_ngam",
    "enemyType": "son_tac",
    "count": 1,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 300,
    "spawns": [
      {
        "id": "sot_10",
        "tx": 24,
        "ty": 22,
        "x": 784,
        "y": 736,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "mo_linh_thach",
    "enemyType": "thach_ma",
    "count": 18,
    "wanderRadius": 28,
    "leashRange": 260,
    "respawnSec": 35,
    "spawns": [
      {
        "id": "thach_ma_cua_tay",
        "tx": 2,
        "ty": 11,
        "x": 80,
        "y": 384,
        "walkable": true
      },
      {
        "id": "thach_ma_cua_tay_x2",
        "tx": 3,
        "ty": 10,
        "x": 112,
        "y": 352,
        "walkable": true
      },
      {
        "id": "thach_ma_cua_tay_x3",
        "tx": 3,
        "ty": 11,
        "x": 112,
        "y": 384,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_thuong",
        "tx": 13,
        "ty": 7,
        "x": 432,
        "y": 256,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_thuong_x2",
        "tx": 12,
        "ty": 6,
        "x": 400,
        "y": 224,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_thuong_x3",
        "tx": 13,
        "ty": 6,
        "x": 432,
        "y": 224,
        "walkable": true
      },
      {
        "id": "thach_ma_san_goong",
        "tx": 14,
        "ty": 16,
        "x": 464,
        "y": 544,
        "walkable": true
      },
      {
        "id": "thach_ma_san_goong_x2",
        "tx": 13,
        "ty": 15,
        "x": 432,
        "y": 512,
        "walkable": true
      },
      {
        "id": "thach_ma_san_goong_x3",
        "tx": 14,
        "ty": 15,
        "x": 464,
        "y": 512,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_sau",
        "tx": 20,
        "ty": 25,
        "x": 656,
        "y": 832,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_sau_x2",
        "tx": 21,
        "ty": 24,
        "x": 688,
        "y": 800,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_sau_x3",
        "tx": 19,
        "ty": 25,
        "x": 624,
        "y": 832,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_dong",
        "tx": 28,
        "ty": 9,
        "x": 912,
        "y": 320,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_dong_x2",
        "tx": 27,
        "ty": 8,
        "x": 880,
        "y": 288,
        "walkable": true
      },
      {
        "id": "thach_ma_tang_dong_x3",
        "tx": 28,
        "ty": 8,
        "x": 912,
        "y": 288,
        "walkable": true
      },
      {
        "id": "thach_ma_cua_dong",
        "tx": 33,
        "ty": 16,
        "x": 1072,
        "y": 544,
        "walkable": true
      },
      {
        "id": "thach_ma_cua_dong_x2",
        "tx": 32,
        "ty": 15,
        "x": 1040,
        "y": 512,
        "walkable": true
      },
      {
        "id": "thach_ma_cua_dong_x3",
        "tx": 33,
        "ty": 15,
        "x": 1072,
        "y": 512,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "mo_linh_thach",
    "enemyType": "song_duc_ma_bao",
    "count": 1,
    "wanderRadius": 40,
    "leashRange": 2000,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "boss_song_duc_ma_bao",
        "tx": 20,
        "ty": 26,
        "x": 656,
        "y": 864,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "mo_linh_thach",
    "enemyType": "ngan_mao_hong",
    "count": 3,
    "wanderRadius": 34,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "ho_phap_ma_bao_1",
        "tx": 17,
        "ty": 25,
        "x": 560,
        "y": 832,
        "walkable": true
      },
      {
        "id": "ho_phap_ma_bao_2",
        "tx": 23,
        "ty": 25,
        "x": 752,
        "y": 832,
        "walkable": true
      },
      {
        "id": "ho_phap_ma_bao_3",
        "tx": 20,
        "ty": 24,
        "x": 656,
        "y": 800,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "mo_linh_thach",
    "enemyType": "tm_tru",
    "count": 1,
    "wanderRadius": 0,
    "leashRange": 260,
    "respawnSec": 0,
    "spawns": [
      {
        "id": "tm_tru",
        "tx": 22,
        "ty": 14,
        "x": 720,
        "y": 480,
        "walkable": false
      }
    ]
  },
  {
    "mapId": "thach_phong_thung_lung",
    "enemyType": "linh_ho_tran_son",
    "count": 1,
    "wanderRadius": 38,
    "leashRange": 2000,
    "respawnSec": 18000,
    "spawns": [
      {
        "id": "boss_linh_ho_tran_son",
        "tx": 30,
        "ty": 8,
        "x": 976,
        "y": 288,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "thach_phong_thung_lung",
    "enemyType": "bach_ho_tuyet",
    "count": 3,
    "wanderRadius": 34,
    "leashRange": 260,
    "respawnSec": 18000,
    "spawns": [
      {
        "id": "bach_ho_tuyet_1",
        "tx": 27,
        "ty": 8,
        "x": 880,
        "y": 288,
        "walkable": true
      },
      {
        "id": "bach_ho_tuyet_2",
        "tx": 33,
        "ty": 8,
        "x": 1072,
        "y": 288,
        "walkable": true
      },
      {
        "id": "bach_ho_tuyet_3",
        "tx": 30,
        "ty": 10,
        "x": 976,
        "y": 352,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "hac_phong_linh",
    "enemyType": "hac_phong_ta_tu",
    "count": 6,
    "wanderRadius": 70,
    "leashRange": 260,
    "respawnSec": 75,
    "spawns": [
      {
        "id": "hpl_ta_tu_1",
        "tx": 16,
        "ty": 6,
        "x": 528,
        "y": 224,
        "walkable": true
      },
      {
        "id": "hpl_ta_tu_2",
        "tx": 24,
        "ty": 9,
        "x": 784,
        "y": 320,
        "walkable": true
      },
      {
        "id": "hpl_ta_tu_3",
        "tx": 12,
        "ty": 18,
        "x": 400,
        "y": 608,
        "walkable": true
      },
      {
        "id": "hpl_ta_tu_4",
        "tx": 29,
        "ty": 14,
        "x": 944,
        "y": 480,
        "walkable": true
      },
      {
        "id": "hpl_ta_tu_5",
        "tx": 58,
        "ty": 8,
        "x": 1872,
        "y": 288,
        "walkable": true
      },
      {
        "id": "hpl_ta_tu_6",
        "tx": 59,
        "ty": 14,
        "x": 1904,
        "y": 480,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "hac_phong_linh",
    "enemyType": "phuc_kich_ta_tu",
    "count": 3,
    "wanderRadius": 50,
    "leashRange": 260,
    "respawnSec": 40,
    "spawns": [
      {
        "id": "hpl_phuc_kich_1",
        "tx": 34,
        "ty": 10,
        "x": 1104,
        "y": 352,
        "walkable": true
      },
      {
        "id": "hpl_phuc_kich_2",
        "tx": 35,
        "ty": 13,
        "x": 1136,
        "y": 448,
        "walkable": true
      },
      {
        "id": "hpl_phuc_kich_3",
        "tx": 33,
        "ty": 12,
        "x": 1072,
        "y": 416,
        "walkable": true
      }
    ]
  },
  {
    "mapId": "hac_phong_linh",
    "enemyType": "chap_phap_tuan_ve",
    "count": 3,
    "wanderRadius": 90,
    "leashRange": 260,
    "respawnSec": 90,
    "spawns": [
      {
        "id": "hpl_tuan_ve_1",
        "tx": 45,
        "ty": 4,
        "x": 1456,
        "y": 160,
        "walkable": true
      },
      {
        "id": "hpl_tuan_ve_2",
        "tx": 50,
        "ty": 5,
        "x": 1616,
        "y": 192,
        "walkable": true
      },
      {
        "id": "hpl_tuan_ve_3",
        "tx": 53,
        "ty": 4,
        "x": 1712,
        "y": 160,
        "walkable": true
      }
    ]
  }
] as const satisfies readonly MapSpawnRow[];
