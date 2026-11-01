import { trpc } from "@/lib/trpc";
import type { EditionStatus } from "../../../server/license";
import { EDITION_FEATURES, EDITION_LEVEL, editionHas, type Edition, type EditionFeatureKey } from "@shared/editions";

/** Compatibility contract for existing feature pages; customer delivery has no paid tiers. */
export type EditionStatusPlus = EditionStatus & { has: (feature: EditionFeatureKey) => boolean; atLeast: (edition: Edition) => boolean };
const customerStatus: EditionStatus = {
  edition: "proplus", source: "managed", licensedTo: null, licenseExpiresAt: null,
  licenseState: "none", trialStart: null, trialDaysLeft: null, features: [...EDITION_FEATURES.proplus],
};

export function useEditionStatus() {
  const query = trpc.edition.status.useQuery(undefined);
  // No commercial locks while a query is loading or an old cached response is present.
  const status: EditionStatusPlus = {
    ...customerStatus,
    has: feature => editionHas("proplus", feature),
    atLeast: edition => EDITION_LEVEL.proplus >= EDITION_LEVEL[edition],
  };
  return { status, isLoading: query.isLoading, refetch: query.refetch };
}

// Keep these exports for older feature-page callers without exposing package/key/trial UI.
export function EditionPill(_props: { status: EditionStatusPlus; onClick: () => void }) { return null; }
export function FeatureLockButton(_props: { feature: EditionFeatureKey; onClick: () => void; compact?: boolean }) { return null; }
export function EditionCompareTable(_props: { current: Edition }) { return null; }
export function DevKeygenTool() { return null; }
export function EditionUpgradeModal(_props: { open: boolean; onClose: () => void; status: EditionStatusPlus | null; focusFeature?: EditionFeatureKey | null; onApplied?: (next: EditionStatus) => void }) { return null; }
