#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const mode = process.argv[2] ?? "--preflight";
const validModes = new Set(["--preflight", "--handoff"]);

if (!validModes.has(mode)) {
  fail(`Unknown mode "${mode}". Use --preflight or --handoff.`);
}

const branch = git(["branch", "--show-current"]);
const allowMainBranch = process.env.ALLOW_MAIN_BRANCH === "true";

if ((branch === "main" || branch === "master") && !allowMainBranch) {
  fail(
    "Current branch is main. Create a short-lived feature/fix branch before non-trivial work, or set ALLOW_MAIN_BRANCH=true only when the user explicitly approves direct main work.",
  );
}

if (mode === "--handoff") {
  const todo = readFileSync("TODO.md", "utf8");
  const milestoneNumber = currentMilestoneNumber(todo);
  const milestoneSection = currentMilestoneSection(todo, milestoneNumber);

  if (!milestoneSection.includes("- [x]")) {
    fail(
      `Milestone ${milestoneNumber} has no checked checklist items. Update TODO.md before handoff so completed work is visible in the milestone checklist.`,
    );
  }

  if (!todo.includes("### Verification Status")) {
    fail("TODO.md is missing the Verification Status section.");
  }
}

console.log(
  `Session harness ${mode.replace("--", "")} check passed on ${branch}.`,
);

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function currentMilestoneNumber(todo) {
  const match = todo.match(/- Current milestone: Milestone\s+(\d+)/i);

  if (!match?.[1]) {
    fail("TODO.md does not declare the current milestone in Current Status.");
  }

  return match[1];
}

function currentMilestoneSection(todo, milestoneNumber) {
  const heading = `## Milestone ${milestoneNumber}:`;
  const start = todo.indexOf(heading);

  if (start === -1) {
    fail(`TODO.md does not contain a section for ${heading}`);
  }

  const nextMilestone = todo.indexOf("\n## Milestone ", start + heading.length);
  return nextMilestone === -1
    ? todo.slice(start)
    : todo.slice(start, nextMilestone);
}

function fail(message) {
  console.error(`Session harness check failed: ${message}`);
  process.exit(1);
}
