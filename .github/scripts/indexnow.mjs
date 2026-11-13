#!/usr/bin/env node
// Notifies IndexNow (Bing, Yandex, Seznam, Naver, Yep...) about URLs that
// changed since the last submission. Runs from .github/workflows/indexnow.yml
// after each production deploy and on a schedule.
//
// Change detection, in order:
//   1. MODE=all                      -> every sitemap URL
//   2. a saved state file exists     -> new + removed + lastmod-changed URLs
//   3. SINCE (last successful run)   -> URLs whose <lastmod> is on/after SINCE
//   4. nothing to compare against    -> every sitemap URL (first run)
//
// Env: INDEXNOW_HOST, INDEXNOW_KEY, SITEMAP_URL?, MODE?, SINCE?, STATE_FILE?,
//      DRY_RUN?, GITHUB_STEP_SUMMARY?

import { readFile, writeFile, appendFile } from "node:fs/promises";

const HOST = required("INDEXNOW_HOST");
const KEY = required("INDEXNOW_KEY");
const ORIGIN = `https://${HOST}`;
const KEY_LOCATION = `${ORIGIN}/${KEY}.txt`;
const SITEMAP_URL = process.env.SITEMAP_URL || `${ORIGIN}/sitemap.xml`;
const MODE = (process.env.MODE || "changed").toLowerCase();
const SINCE = process.env.SINCE || "";
const STATE_FILE = process.env.STATE_FILE || ".indexnow-state.json";
const DRY_RUN = process.env.DRY_RUN === "1";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10000;
const UA = "IndexNow-Submitter/1.0 (+https://www.indexnow.org)";

function required(name) {
  const v = (process.env[name] || "").trim();
  if (!v) fail(`${name} is not set`);
  return v;
}

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "cache-control": "no-cache" },
    redirect: "follow",
  });
  return { res, body: await res.text() };
}

// The deploy that triggered this run can take a moment to reach the custom
// domain, so give the key file a few tries before giving up.
async function verifyKeyFile() {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const { res, body } = await get(`${KEY_LOCATION}?t=${Date.now()}`);
    if (res.ok && body.trim() === KEY) return;
    console.log(`key file check ${attempt}/8: HTTP ${res.status}`);
    await sleep(15000);
  }
  fail(`Key file ${KEY_LOCATION} is missing or does not contain the key`);
}

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
};

async function readSitemap(url, seen = new Set()) {
  if (seen.has(url)) return [];
  seen.add(url);
  const { res, body } = await get(url);
  if (!res.ok) fail(`Sitemap ${url} returned HTTP ${res.status}`);
  if (/<sitemapindex[\s>]/i.test(body)) {
    const out = [];
    for (const block of body.match(/<sitemap>[\s\S]*?<\/sitemap>/gi) || []) {
      const loc = tag(block, "loc");
      if (loc) out.push(...(await readSitemap(loc, seen)));
    }
    return out;
  }
  return (body.match(/<url>[\s\S]*?<\/url>/gi) || [])
    .map((block) => ({ loc: tag(block, "loc"), lastmod: tag(block, "lastmod") }))
    .filter((e) => e.loc);
}

const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function changedSince(lastmod, since) {
  if (!lastmod) return false;
  if (isDateOnly(lastmod)) return lastmod >= since.toISOString().slice(0, 10);
  const t = Date.parse(lastmod);
  return Number.isFinite(t) && t >= since.getTime();
}

async function loadState() {
  try {
    const s = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return s && s.host === HOST && s.urls ? s : null;
  } catch {
    return null;
  }
}

async function submit(urls) {
  for (let i = 0; i < urls.length; i += BATCH) {
    const urlList = urls.slice(i, i + BATCH);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "user-agent": UA },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    });
    const text = (await res.text()).slice(0, 300);
    console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs ${text}`);
    if (res.status !== 200 && res.status !== 202) {
      fail(`IndexNow rejected the submission: HTTP ${res.status} ${text}`);
    }
  }
}

async function summary(lines) {
  const out = lines.join("\n");
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${out}\n`);
}

await verifyKeyFile();

const entries = (await readSitemap(SITEMAP_URL)).filter((e) => {
  try {
    return new URL(e.loc).host === HOST;
  } catch {
    return false;
  }
});
if (entries.length === 0) fail(`No ${HOST} URLs found in ${SITEMAP_URL}`);

const current = Object.fromEntries(entries.map((e) => [e.loc, e.lastmod]));
const state = MODE === "all" ? null : await loadState();
const since = SINCE && Number.isFinite(Date.parse(SINCE)) ? new Date(SINCE) : null;

let reason;
let urls;
if (MODE === "all") {
  reason = "full submission requested";
  urls = Object.keys(current);
} else if (state) {
  reason = `diff against state from ${state.submittedAt}`;
  const prev = state.urls;
  const added = Object.keys(current).filter((u) => !(u in prev));
  const removed = Object.keys(prev).filter((u) => !(u in current));
  const updated = Object.keys(current).filter((u) => u in prev && prev[u] !== current[u]);
  urls = [...new Set([...added, ...updated, ...removed])];
} else if (since) {
  reason = `lastmod on/after last successful run (${since.toISOString()})`;
  urls = Object.keys(current).filter((u) => changedSince(current[u], since));
} else {
  reason = "first run, no previous state";
  urls = Object.keys(current);
}

const lines = [
  `### IndexNow — ${HOST}`,
  `- Sitemap URLs: ${entries.length}`,
  `- Selection: ${reason}`,
  `- URLs to submit: ${urls.length}`,
];

if (urls.length === 0) {
  lines.push("- Nothing changed; no submission sent.");
} else if (DRY_RUN) {
  lines.push("- Dry run; no submission sent.", "", ...urls.slice(0, 50).map((u) => `  - ${u}`));
} else {
  await submit(urls);
  lines.push("- Submitted to api.indexnow.org", "", ...urls.slice(0, 50).map((u) => `  - ${u}`));
  if (urls.length > 50) lines.push(`  - …and ${urls.length - 50} more`);
}

if (!DRY_RUN) {
  await writeFile(
    STATE_FILE,
    JSON.stringify({ host: HOST, submittedAt: new Date().toISOString(), urls: current }),
  );
}
await summary(lines);
