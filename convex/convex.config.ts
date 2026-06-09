import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config.js";

const app = defineApp();

/**
 * One named aggregate instance: counts contracts grouped by
 * (agencyId namespace, status key).
 *
 * Using a namespace per agency maximises write throughput — each agency's
 * B-tree is isolated, so concurrent mutations from different agencies never
 * contend on the same internal nodes.
 */
app.use(aggregate, { name: "contractsByStatus" });
app.use(aggregate, { name: "contractsByStatusPlatform" });
app.use(aggregate, { name: "ativoInsuredCentsPlatform" });

export default app;
