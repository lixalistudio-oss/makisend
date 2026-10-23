import type en from "../en/dashboard"

export default {
  // section-cards
  "dashboard.cards.totalSent": "Total des e-mails envoyés",
  "dashboard.cards.totalSentDescription": "Depuis le début",
  "dashboard.cards.delivered": "Délivrés",
  "dashboard.cards.deliveredDescription": "Envoyés avec succès",
  "dashboard.cards.failed": "Échecs",
  "dashboard.cards.failedDescription": "Erreurs de distribution",
  "dashboard.cards.rate": "Taux de distribution",
  "dashboard.cards.rateDescription": "Pourcentage de réussite",
  "dashboard.cards.rateValue": "{rate} %",

  // chart-area-interactive
  "dashboard.chart.title": "E-mails envoyés",
  "dashboard.chart.description": "Volume d'e-mails au fil du temps",
  "dashboard.chart.descriptionShort": "Volume d'e-mails",
  "dashboard.chart.last3Months": "3 derniers mois",
  "dashboard.chart.last30Days": "30 derniers jours",
  "dashboard.chart.last7Days": "7 derniers jours",
  "dashboard.chart.rangeLabel": "Choisir une période",
  "dashboard.chart.sent": "Envoyés",
  "dashboard.chart.failed": "Échecs",

  // errors-card
  "dashboard.errors.description": "Erreurs de distribution",
  "dashboard.errors.title": "Principales erreurs sur l'ensemble des envois",
  "dashboard.errors.last7Days": "7 derniers jours",
  "dashboard.errors.last30Days": "30 derniers jours",
  "dashboard.errors.last90Days": "90 derniers jours",
  "dashboard.errors.loading": "Chargement des erreurs...",
  "dashboard.errors.empty": "Aucune erreur de distribution sur cette période.",

  // data-table
  "dashboard.table.loading": "Chargement des journaux d'e-mails...",
  "dashboard.table.empty": "Aucun e-mail envoyé pour l'instant.",
  "dashboard.table.recipient": "Destinataire",
  "dashboard.table.subject": "Objet",
  "dashboard.table.status": "Statut",
  "dashboard.table.date": "Date",
  "dashboard.table.duration": "Durée",
  "dashboard.table.durationValue": "{ms} ms",
  "dashboard.status.received": "reçu",
  "dashboard.status.processing": "en cours",
  "dashboard.status.cleaned": "nettoyé",
  "dashboard.status.sent": "envoyé",
  "dashboard.status.delivered": "délivré",
  "dashboard.status.attemptFailed": "tentative échouée",
  "dashboard.status.failed": "échec",
  "dashboard.status.unknown": "inconnu",
} satisfies Record<keyof typeof en, string>
