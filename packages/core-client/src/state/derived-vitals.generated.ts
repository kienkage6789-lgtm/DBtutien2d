// Generated from vendor/tutien2d-public-client/2026-10-06/src/core/config.js and systems/items.js.
// Regenerate with: node scripts/gen-derived-vitals.mjs
export const REALM_MAX = {
  "pham_nhan": {
    "hpMax": 100,
    "mpMax": 0
  },
  "luyen_khi_1": {
    "hpMax": 120,
    "mpMax": 100
  },
  "luyen_khi_2": {
    "hpMax": 135,
    "mpMax": 112
  },
  "luyen_khi_3": {
    "hpMax": 150,
    "mpMax": 125
  },
  "luyen_khi_4": {
    "hpMax": 165,
    "mpMax": 138
  },
  "luyen_khi_5": {
    "hpMax": 180,
    "mpMax": 150
  },
  "luyen_khi_6": {
    "hpMax": 195,
    "mpMax": 163
  },
  "luyen_khi_7": {
    "hpMax": 210,
    "mpMax": 175
  },
  "luyen_khi_8": {
    "hpMax": 225,
    "mpMax": 188
  },
  "luyen_khi_9": {
    "hpMax": 240,
    "mpMax": 200
  },
  "luyen_khi_10": {
    "hpMax": 255,
    "mpMax": 213
  },
  "luyen_khi_11": {
    "hpMax": 270,
    "mpMax": 225
  },
  "luyen_khi_12": {
    "hpMax": 285,
    "mpMax": 238
  },
  "luyen_khi_13": {
    "hpMax": 300,
    "mpMax": 250
  },
  "truc_co_1": {
    "hpMax": 420,
    "mpMax": 340
  },
  "truc_co_2": {
    "hpMax": 540,
    "mpMax": 430
  }
} as const;

// Known item IDs distinguish a known item with no HP/MP bonus from an unknown item.
export const KNOWN_ITEM_IDS = [
  "tay_ue_thao",
  "linh_tuyen_thuy",
  "tay_tuy_thang",
  "dan_khi_dan",
  "mang_truc",
  "nam_linh_chi",
  "truc_tam",
  "canh_kho",
  "ca_song",
  "linh_ngu",
  "truc_diep_boi",
  "tu_linh_ngoc_boi",
  "ngung_than_boi",
  "tu_tinh_duong_than_boi",
  "lang_hon_duong_than_boi",
  "truc_kiem",
  "truc_con",
  "luc_tinh_kiem",
  "quat_phong",
  "cung_linh",
  "huyet_ma_liem",
  "thiet_kiem",
  "bang_linh_kiem",
  "huyet_kiem",
  "bich_nguc_ta_dao",
  "thiet_dao",
  "thiet_thuong",
  "thiet_cot_nha_no",
  "luc_doc_cham",
  "phi_dao",
  "sao_ngoc_luu",
  "truc_tieu",
  "xich_viem_song_kich",
  "bach_loi_tien",
  "nhuyen_tien",
  "truc_co_dan",
  "thang_tien_lenh",
  "tui_can_khon",
  "hop_van_bao",
  "tong_mon_lenh",
  "hoa_kim_thuong",
  "hoang_loi_thuong",
  "bat_com_linh_me",
  "dan_ngu_hanh",
  "linh_ke_can",
  "phu_thanh_tam",
  "phu_kim_giap",
  "phu_toc_hanh",
  "phu_han_bang",
  "phu_loi_dong",
  "phu_hoa",
  "phu_tho_don",
  "phu_kim_o",
  "phu_kim_long",
  "tran_ban_liet_hoa",
  "tran_ban_tu_linh",
  "tran_ban_loan_loi_hoa",
  "tran_ban_tu_tuong",
  "tran_ban_dao_gia",
  "linh_thach",
  "thach_giap_tinh_hach",
  "huyen_thiet_khoang",
  "phong_tinh_thach",
  "xuyen_son_giap_phien",
  "phong_linh_thao",
  "han_tinh_thach",
  "tu_tinh_thach",
  "luc_tinh_thach",
  "manh_bi_tich_thuong",
  "manh_bi_tich_ha",
  "yeu_cot",
  "doc_dang_doc_dich",
  "xich_long_huyet",
  "yeu_huyet_cap_4",
  "yeu_huyet_cap_6",
  "yeu_dan_cap_1",
  "yeu_dan_cap_2",
  "yeu_dan_cap_3",
  "yeu_dan_cap_4",
  "yeu_dan_cap_6",
  "phong_song_duc",
  "nanh_ho",
  "nguu_sung",
  "bi_tich_dan_linh",
  "bi_tich_hoa_cau",
  "bi_tich_phong_nhan",
  "bi_tich_bang_thau",
  "bi_tich_dia_thich",
  "bi_tich_so_xich_chan",
  "bi_tich_kim_quang_chao",
  "bi_tich_moc_xuan",
  "bi_tich_tu_linh",
  "bi_tich_ho_tam",
  "bi_tich_phong_hanh",
  "bi_tich_kiem_y",
  "bi_tich_bang_tam",
  "bi_tich_hoa_mach",
  "bi_tich_tho_thuan",
  "bi_tich_moc_sinh",
  "bi_tich_tinh_tam",
  "bi_tich_ma_khi",
  "bi_tich_cat_tuong",
  "bi_tich_thao_duoc",
  "bi_tich_loi_chuong",
  "bi_tich_ngu_kiem_sat",
  "bi_tich_huyet_kiem_tran",
  "bi_tich_cuu_huyet_tran",
  "bi_tich_van_kiem_quy_tong",
  "bi_tich_luc_tinh_truc_kiem",
  "bi_tich_thanh_lam_kiem_tru",
  "bi_tich_kim_thuong_giang_the",
  "bi_tich_loi_thuong_quan_dia",
  "bi_tich_ngu_loi_thuong_vu",
  "bi_tich_anh_ky_phu",
  "bi_tich_bang_kiem_tran",
  "bi_tich_bang_kiem_luan",
  "bi_tich_tien_vu",
  "bi_tich_tram_ma",
  "bi_tich_ma_bao_an",
  "bi_tich_ma_hon_phe",
  "bi_tich_nguyet_quang",
  "bi_tich_kim_quang_cu_kiem",
  "bi_tich_ngu_sac_than_chuong",
  "bi_tich_huyet_buc_chuong",
  "bi_tich_huyet_liem_tram",
  "bi_tich_xich_ma_hoa_than",
  "bi_tich_tu_anh_phuoc_tien",
  "hat_linh_diep",
  "hat_huyet_thao",
  "hat_thanh_tam",
  "linh_diep",
  "huyet_thao",
  "thanh_tam_hoa",
  "hat_linh_ngoc",
  "hat_xich_duong",
  "hat_bich_van",
  "hat_long_huyet",
  "hat_truc_co_thao",
  "hat_dia_linh_qua",
  "hat_ngu_hanh_thao",
  "ngu_hanh_thao",
  "linh_ngoc_diep",
  "xich_duong_thao",
  "bich_van_diep",
  "long_huyet_thao",
  "tu_khi_duoc",
  "hon_phien",
  "pham_hon",
  "oan_hon",
  "tu_si_hon",
  "thu_hon_3",
  "thu_hon_4",
  "thu_hon_6",
  "am_hon",
  "kiem_hap",
  "chinh_khi",
  "hiep_nghia_lenh",
  "tru_ma_lenh",
  "kiem_linh",
  "khoi_loi_bich_moc",
  "khoi_loi_huyen_thiet",
  "khoi_loi_yeu_cot",
  "thi_khoi_thanh",
  "thi_khoi_dong",
  "thi_khoi_bach",
  "linh_thuy",
  "phuong_tu_khi_dan",
  "luyen_khi_dan",
  "tay_tam_dan",
  "pha_canh_dan",
  "tu_khi_dan",
  "non_la",
  "mu_bach_van",
  "mu_tieu_dao",
  "mu_tu_lien",
  "mu_nguyet_bach",
  "lan_thanh_trum_dau",
  "dong_hoang_chung",
  "giap_moc_tam",
  "hoang_lan_giap",
  "thu_tuong_giap",
  "giay_van_bo",
  "giay_lang_phong",
  "nhan_tu_than",
  "nhan_lang_tam",
  "thanh_lam_dao_bao",
  "tong_ngoc_y",
  "bach_nguyet_hong_lien",
  "van_lo_lao_ma_bao",
  "man_ho_tu_bao",
  "chi_ton_kiem_y",
  "thien_luan_kiem_y",
  "tuyet_son_kiem_y",
  "man_ho_tu_y",
  "than_kiem_y",
  "hoang_cuu_bao_y",
  "ta_tu_y",
  "sat_luc_y",
  "tan_mo_y",
  "long_tuong_y",
  "thanh_tam_y",
  "ta_tu_y_xanh",
  "hoat_tu_y",
  "nam_tu_y",
  "lan_thanh_y",
  "vuong_lam_y",
  "bach_y",
  "hac_y",
  "lam_y",
  "tu_quang_y",
  "thanh_y",
  "huyet_anh_y",
  "quan_dui",
  "huyen_cot_y",
  "ma_vuong_bao",
  "bach_kim_an_dien_bao",
  "phi_diep",
  "lam_phi_kiem",
  "xich_phi_kiem",
  "luc_phi_kiem",
  "phong_loi_si",
  "phong_song_si",
  "ngua_hac_tho",
  "hac_tien",
  "duoc_y_boi",
  "quy_dien",
  "hac_phieu",
  "chien_huan",
  "htd_ngoc_phu",
  "huyet_ngoc_chi",
  "ngung_nguyen_dan",
  "so_sach_quy_nha",
  "manh_giay_am_hieu_1",
  "manh_giay_am_hieu_2",
  "manh_giay_am_hieu_3"
] as const;

// Only non-zero HP/MP bonuses are listed.
export const ITEM_BONUS = {
  "tu_linh_ngoc_boi": {
    "mpBonus": 12
  },
  "ngung_than_boi": {
    "mpBonus": 8
  },
  "tu_tinh_duong_than_boi": {
    "mpBonus": 16
  },
  "lang_hon_duong_than_boi": {
    "mpBonus": 20
  },
  "mu_bach_van": {
    "hpBonus": 8,
    "mpBonus": 5
  },
  "mu_tieu_dao": {
    "hpBonus": 8,
    "mpBonus": 5
  },
  "mu_tu_lien": {
    "hpBonus": 8,
    "mpBonus": 5
  },
  "mu_nguyet_bach": {
    "hpBonus": 8,
    "mpBonus": 5
  },
  "lan_thanh_trum_dau": {
    "hpBonus": 18,
    "mpBonus": 22
  },
  "dong_hoang_chung": {
    "hpBonus": 40
  },
  "hoang_lan_giap": {
    "hpBonus": 60
  },
  "thu_tuong_giap": {
    "hpBonus": 55
  }
} as const;
