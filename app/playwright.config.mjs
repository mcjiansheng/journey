import {defineConfig} from '@playwright/test';
import {chromeLaunchOptions,preparePlaywrightTest,isTestDiscovery} from './scripts/browser-runtime.mjs';

// Also protect direct Playwright CLI usage, before it starts any test worker.
preparePlaywrightTest();
const {channel,headless,...launchOptions}=chromeLaunchOptions;

export default defineConfig({
 globalSetup:'./scripts/browser-runtime.mjs',
 testDir:'tests/e2e',timeout:60000,expect:{timeout:12000},workers:1,retries:0,
 // Discovery must not try to overwrite reports in a read-only checkout.
 reporter:isTestDiscovery(process.argv.slice(2))?[['list']]:[['list'],['html',{open:'never'}]],
 use:{
  baseURL:process.env.E2E_URL||'http://127.0.0.1:4177/',
  channel,headless,launchOptions,
  screenshot:'only-on-failure',trace:'retain-on-failure'
 },
 outputDir:'test-results'
});
