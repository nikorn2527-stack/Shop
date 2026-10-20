/** ISO/IEC 7810 ID-1 (credit-card size), millimetres. */
export const MEMBER_CARD_WIDTH_MM = 85.6;
export const MEMBER_CARD_HEIGHT_MM = 53.98;
/** Four artwork pixels per millimetre; exports rasterize this at 4×. */
export const MEMBER_CARD_WIDTH_PX = 342.4;
export const MEMBER_CARD_HEIGHT_PX = 215.92;
export const MEMBER_CARD_IMAGE_WIDTH = Math.round(MEMBER_CARD_WIDTH_PX * 4);
export const MEMBER_CARD_IMAGE_HEIGHT = Math.round(MEMBER_CARD_HEIGHT_PX * 4);
