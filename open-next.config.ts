import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No incremental-cache override configured — this deployment doesn't rely on ISR/on-demand
// revalidation (client-side storage mode, mostly dynamically rendered), so OpenNext's default
// in-memory cache is enough. Add an R2-backed incremental cache here later if that changes.
export default defineCloudflareConfig({});
