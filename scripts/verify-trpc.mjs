#!/usr/bin/env node

const baseUrl = (process.argv[2] || process.env.REELIO_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

const checks = [
  {
    name: "system.health",
    path: "/api/trpc/system.health",
    input: { timestamp: Date.now() },
    expected: [200],
  },
  {
    name: "auth.me",
    path: "/api/trpc/auth.me",
    input: null,
    expected: [200],
  },
  {
    name: "project.list unauthenticated guard",
    path: "/api/trpc/project.list",
    input: null,
    expected: [401, 403],
  },
];

let failed = false;

for (const check of checks) {
  const url = new URL(`${baseUrl}${check.path}`);
  url.searchParams.set("input", JSON.stringify({ json: check.input }));

  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const body = await response.text();
    const ok = check.expected.includes(response.status);
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name}: HTTP ${response.status}`);
    if (!ok) {
      console.log(`  response=${body.slice(0, 300)}`);
      failed = true;
    }
  } catch (error) {
    console.log(`FAIL ${check.name}: ${error instanceof Error ? error.message : "request failed"}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`All local tRPC checks passed against ${baseUrl}`);
}
