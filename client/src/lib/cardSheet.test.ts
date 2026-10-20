import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_PROFILES, loadCardSheetProfile, saveCardSheetProfile, slotPositions } from "@shared/cardSheet";

afterEach(() => vi.unstubAllGlobals());
describe("credit-card sheet profiles", () => {
  it("migrates saved business-card sizes without discarding printer calibration", () => {
    const values = new Map<string, string>([["card-sheet-profile-v1", JSON.stringify({id:"a4-10",cardWmm:90,cardHmm:55,marginLeftMm:16,marginTopMm:6,gapXMm:1,gapYMm:2,offsetXMm:-0.7,offsetYMm:0.4})]]);
    vi.stubGlobal("localStorage", {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
    const profile = loadCardSheetProfile();
    expect(profile).toMatchObject({cardWmm:85.6,cardHmm:53.98,marginLeftMm:16,marginTopMm:6,gapXMm:1,gapYMm:2,offsetXMm:-0.7,offsetYMm:0.4});
    saveCardSheetProfile({...profile,offsetXMm:1.2});
    expect(loadCardSheetProfile().offsetXMm).toBe(1.2);
    expect(values.has("card-sheet-profile-v2")).toBe(true);
  });
  it("fits all preset slots on A4 with the new card dimensions", () => {
    for(const profile of BUILT_IN_PROFILES) for(const position of slotPositions(profile)) {
      expect(position.left).toBeGreaterThanOrEqual(0);
      expect(position.top).toBeGreaterThanOrEqual(0);
      expect(position.left+profile.cardWmm).toBeLessThanOrEqual(210);
      expect(position.top+profile.cardHmm).toBeLessThanOrEqual(297);
    }
  });
});
