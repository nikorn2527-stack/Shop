import { blocker } from "@/components/BlockerAlert";

type NoticeOptions = { description?: string; duration?: number };

/** Decisions, failures and important completed operations need acknowledgement. */
export const notify = {
  error: (title: string, options?: NoticeOptions) => blocker.error(title, options?.description),
  warning: (title: string, options?: NoticeOptions) => blocker.warning(title, options?.description),
  completed: (title: string, options?: NoticeOptions) => blocker.success(options?.description ? title : "ดำเนินการสำเร็จ", options?.description ?? title),
};
