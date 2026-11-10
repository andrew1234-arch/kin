import { Config } from "@remotion/cli/config";

// Playwright's headless Chromium is preinstalled in this environment; Remotion's own download is not needed.
const shell = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? shell);
Config.setVideoImageFormat("png");
Config.setConcurrency(4);
