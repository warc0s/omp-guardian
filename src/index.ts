import type { OmpExtensionApi } from "./omp/types.ts"
import { installOmpApprovalReviewer } from "./omp/runtime.ts"

export default function ompApprovalReviewer(pi: OmpExtensionApi): void {
  installOmpApprovalReviewer(pi)
}

export { installOmpApprovalReviewer, shouldReviewTool } from "./omp/runtime.ts"
export { routeBashCommand, routeToolCall } from "./omp/routing.ts"
export { OmpApprovalReviewer } from "./omp/reviewer.ts"
export { OmpProcessReviewerInvoker, parseJsonOutput } from "./omp/invoker.ts"
export { loadOmpConfig, DEFAULT_OMP_CONFIG } from "./omp/config.ts"
export type * from "./omp/types.ts"
