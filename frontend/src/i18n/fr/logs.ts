import type en from "../en/logs"

export default {
  "logs.title": "Journaux d'e-mails",
  "logs.description": "Suivez le statut et l'historique de tous les e-mails envoyés.",
  "logs.searchPlaceholder": "Rechercher par destinataire...",
  "logs.search": "Rechercher",

  // filters
  "logs.filter.statusPlaceholder": "Statut",
  "logs.filter.allStatuses": "Tous les statuts",
  "logs.filter.received": "Reçu",
  "logs.filter.processing": "En cours",
  "logs.filter.cleaned": "Nettoyé",
  "logs.filter.sent": "Envoyé",
  "logs.filter.failed": "Échec",
  "logs.filter.configPlaceholder": "Configuration SMTP",
  "logs.filter.allConfigs": "Toutes les configurations",
  "logs.filter.keyPlaceholder": "Clé API",
  "logs.filter.allKeys": "Toutes les clés API",
  "logs.filter.unknownKey": "Clé inconnue",

  // table
  "logs.table.recipient": "Destinataire",
  "logs.table.subject": "Objet",
  "logs.table.status": "Statut",
  "logs.table.apiKey": "Clé API",
  "logs.table.date": "Date",
  "logs.table.duration": "Durée",
  "logs.table.durationValue": "{ms} ms",
  "logs.table.empty": "Aucun journal d'e-mail trouvé.",

  // sender labels
  "logs.key.deleted": "Clé supprimée",
  "logs.key.unnamed": "Clé sans nom",
  "logs.sender.test": "Test",
  "logs.sender.testWithHost": "Test ({host})",

  // errors
  "logs.error.loadLogs": "Impossible de charger les journaux d'e-mails (HTTP {status})",
  "logs.error.loadConfigs": "Impossible de charger les configurations SMTP (HTTP {status})",
  "logs.error.loadFallback": "Impossible de charger les journaux d'e-mails",

  // drawer
  "logs.detail.sentFrom": "Envoyé depuis",
  "logs.detail.apiKey": "Clé API",
  "logs.detail.duration": "Durée",
  "logs.detail.sentAt": "Envoyé le",
  "logs.detail.queuedAt": "En file d'attente depuis le",
  "logs.detail.timeline": "Chronologie de l'e-mail",
  "logs.detail.attempt": "tentative {count}",

  // statuses (badges)
  "logs.status.received": "reçu",
  "logs.status.processing": "en cours",
  "logs.status.cleaned": "nettoyé",
  "logs.status.sent": "envoyé",
  "logs.status.attemptFailed": "tentative échouée",
  "logs.status.failed": "échec",
  "logs.status.unknown": "inconnu",
} satisfies Record<keyof typeof en, string>
