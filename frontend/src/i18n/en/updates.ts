/** Keys are prefixed with the file name: `updates.*`. */
export default {
  // banner
  "updates.banner.available": "MakiSend {version} is available",
  "updates.banner.running": "You run {version}.",
  "updates.banner.whatsNew": "What's new",
  "updates.banner.update": "Update",
  "updates.banner.dismiss": "Remind me at the next release",

  // dialog
  "updates.dialog.title": "Update to {version}",
  "updates.dialog.description":
    "Your instance deploys from your own copy of the MakiSend repository. Updating merges the release into it; Cloudflare then rebuilds the Worker and applies the database migrations.",
  "updates.dialog.syncStep1": "Open the sync workflow of your repository.",
  "updates.dialog.syncStep2Before": "Select ",
  "updates.dialog.syncStep2Action": "Run workflow",
  "updates.dialog.syncStep2After": ", leave the version empty for the latest release.",
  "updates.dialog.syncStep3": "Wait for the Cloudflare build to finish, then reload this page.",
  "updates.dialog.manualStep1Before": "In your copy of the repository, run the ",
  "updates.dialog.manualStep1Workflow": "Sync with upstream",
  "updates.dialog.manualStep1After": " workflow (Actions tab), or merge the release by hand.",
  "updates.dialog.manualStep2Before": "Set ",
  "updates.dialog.manualStep2After": " on the Worker to make this button open it directly.",
  "updates.dialog.guide": "Update guide",
  "updates.dialog.openWorkflow": "Open the sync workflow",
  "updates.dialog.openRelease": "Open the release",

  // version card (settings)
  "updates.version.checkFailedToast": "Could not check for updates",
  "updates.version.latestToast": "You run the latest release",
  "updates.version.installed": "Installed",
  "updates.version.latest": "Latest release",
  "updates.version.checkOff": "Check turned off (UPDATE_CHECK=off)",
  "updates.version.noneYet": "None published yet",
  "updates.version.updateAvailable": "Update available",
  "updates.version.lastCheck": "Last check",
  "updates.version.lastCheckFailed": "Last check failed: {error}",
  "updates.version.checking": "Checking",
  "updates.version.checkNow": "Check now",
}
