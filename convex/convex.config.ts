import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";

const app = defineApp();

app.use(migrations);

/**
 * Per-agency aggregate: counts guarantees grouped by
 * (agencyId namespace, state key).
 *
 * Using a namespace per agency maximises write throughput — each agency's
 * B-tree is isolated, so concurrent mutations from different agencies never
 * contend on the same internal nodes.
 */
app.use(aggregate, { name: "guaranteesByState" });
app.use(aggregate, { name: "guaranteesByStatePlatform" });
app.use(aggregate, { name: "insuredCentsPlatform" });

export default app;
