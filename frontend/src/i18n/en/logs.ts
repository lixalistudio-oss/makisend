/** Keys are prefixed with the file name: `logs.*`. */
export default {
  "logs.title": "Email logs",
  "logs.description": "Track the status and history of all sent emails.",
  "logs.searchPlaceholder": "Search by recipient...",
  "logs.search": "Search",

  // filters
  "logs.filter.statusPlaceholder": "Status",
  "logs.filter.allStatuses": "All statuses",
  "logs.filter.received": "Received",
  "logs.filter.processing": "Processing",
  "logs.filter.cleaned": "Cleaned",
  "logs.filter.sent": "Sent",
  "logs.filter.failed": "Failed",
  "logs.filter.delivered": "Delivered",
  "logs.filter.deferred": "Delayed",
  "logs.filter.bounced": "Bounced",
  "logs.filter.complained": "Spam complaint",
  "logs.filter.configPlaceholder": "SMTP configuration",
  "logs.filter.allConfigs": "All configs",
  "logs.filter.keyPlaceholder": "API Key",
  "logs.filter.allKeys": "All API keys",
  "logs.filter.unknownKey": "Unknown key",

  // table
  "logs.table.recipient": "Recipient",
  "logs.table.subject": "Subject",
  "logs.table.status": "Status",
  "logs.table.apiKey": "API Key",
  "logs.table.date": "Date",
  "logs.table.duration": "Duration",
  "logs.table.durationValue": "{ms}ms",
  "logs.table.empty": "No email logs found.",

  // sender labels
  "logs.key.deleted": "Deleted key",
  "logs.key.unnamed": "Unnamed key",
  "logs.sender.test": "Test",
  "logs.sender.testWithHost": "Test ({host})",

  // errors
  "logs.error.loadLogs": "Failed to load email logs (HTTP {status})",
  "logs.error.loadConfigs": "Failed to load SMTP configs (HTTP {status})",
  "logs.error.loadFallback": "Failed to load email logs",

  // drawer
  "logs.detail.sentFrom": "Sent from",
  "logs.detail.apiKey": "API Key",
  "logs.detail.duration": "Duration",
  "logs.detail.sentAt": "Sent at",
  "logs.detail.queuedAt": "Queued at",
  "logs.detail.timeline": "Email timeline",
  "logs.detail.attempt": "attempt {count}",

  // statuses (badges)
  "logs.status.received": "received",
  "logs.status.processing": "processing",
  "logs.status.cleaned": "cleaned",
  "logs.status.sent": "sent",
  "logs.status.attemptFailed": "attempt_failed",
  "logs.status.failed": "failed",
  "logs.status.delivered": "delivered",
  "logs.status.deferred": "delayed",
  "logs.status.bounced": "bounced",
  "logs.status.complained": "spam complaint",
  "logs.status.unknown": "unknown",
}
