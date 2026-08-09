import type { OmpExtensionApi } from "./omp/types.ts"
import { installOmpGuardian } from "./omp/runtime.ts"

export default function ompGuardian(pi: OmpExtensionApi): void {
  installOmpGuardian(pi)
}

export { installOmpGuardian, shouldReviewTool } from "./omp/runtime.ts"
export { routeBashCommand, routeToolCall } from "./omp/routing.ts"
export { OmpGuardian } from "./omp/reviewer.ts"
export { OmpProcessReviewerInvoker, parseJsonOutput } from "./omp/invoker.ts"
export { loadOmpConfig, DEFAULT_OMP_CONFIG } from "./omp/config.ts"
export type * from "./omp/types.ts"
