/**
 * Display-only fallback for Quest stages because the official client does not
 * expose its private stage table or a public stage hint. Source: docs/RESEARCH_QUEST_CHAIN.md,
 * checked against vendor/tutien2d-public-client/2026-10-06/src/systems/quest.js on 2026-10-13.
 * This table intentionally covers only the researched 0..18 path; later stages
 * keep their live objectives but do not get inferred names or hints here.
 */
export const QUEST_STAGE_GOAL = 18;
export const QUEST_STAGE_COUNT = 34;

export const QUEST_STAGE_DISPLAY: Readonly<Record<number, { name: string; hint: string }>> = {
  0: { name: 'Nhập môn', hint: 'Đọc Bia Đá hoặc hỏi Thầy Ông Nội.' },
  1: { name: 'Lĩnh ngộ cổ pháp', hint: 'Đọc bia hoặc hỏi Đạo Dẫn thuật.' },
  2: { name: 'Hái Tẩy Uế Thảo', hint: 'Hái 3 ngọn Tẩy Uế Thảo ven suối.' },
  3: { name: 'Sắc Tẩy Tuỷ Thang', hint: 'Sắc thuốc ở đan lô trong sân nhà tranh.' },
  4: { name: 'Tẩy Uế Thể Xác', hint: 'Uống thang và đả tọa ở đài đá để lên Luyện Khí 1.' },
  5: { name: 'Dọn yêu thú Rừng Trúc', hint: 'Gặp Huấn Sư Huynh, trang bị Trúc Kiếm và diệt 5 yêu thú.' },
  6: { name: 'Tuần tra Rừng Trúc', hint: 'Diệt thêm 5 yêu thú, tìm 3 manh mối rồi báo lại.' },
  7: { name: 'Bái kiến Đại Phu', hint: 'Đến Thảo Dược Cốc gặp Đại Phu.' },
  8: { name: 'Trồng linh thảo', hint: 'Gieo, chăm sóc và thu hoạch linh thảo trong Vườn Cá Nhân.' },
  9: { name: 'Sắc Linh Dược', hint: 'Sắc Linh Dược ở đan lô trong vườn.' },
  10: { name: 'Dùng dược luyện khí', hint: 'Dùng Linh Dược, tích đủ Đạo Hạnh và phá quan lên Luyện Khí 2.' },
  11: { name: 'Dược Viên có khách lạ', hint: 'Hạ Dược Linh Thú trong vườn để thu Linh Thúy.' },
  12: { name: 'Luyện Tụ Khí Đan', hint: 'Luyện Tụ Khí Đan ở đan lô trong vườn.' },
  13: { name: 'Đột phá Luyện Khí 3', hint: 'Tích đủ Đạo Hạnh, dùng Tụ Khí Đan và phá quan.' },
  14: { name: 'Duyên pháp bí tịch', hint: 'Nhận binh khí, lên Luyện Khí 4 và hoàn thành việc bí tịch.' },
  15: { name: 'Yêu Cốt Miếu Hoang', hint: 'Hạ yêu quái, nhặt 10 Yêu Cốt Vụn rồi báo nhiệm vụ.' },
  16: { name: 'Độc Đằng và Linh Ngư', hint: 'Thu Độc Dịch, câu 1 Linh Ngư và giao cho Đại Phu.' },
  17: { name: 'Hỏi đạo, Tàng Kinh Các', hint: 'Trả lời 5 câu Bách Khoa và rút một bí tịch mới.' },
  18: { name: 'Cửa quan tầng 5 và 6', hint: 'Luyện 3 Luyện Khí Đan và phá quan lên Luyện Khí 7.' },
};
