import type en from "../en/updates"

export default {
  // banner
  "updates.banner.available": "MakiSend {version} est disponible",
  "updates.banner.running": "Vous utilisez la version {version}.",
  "updates.banner.whatsNew": "Nouveautés",
  "updates.banner.update": "Mettre à jour",
  "updates.banner.dismiss": "Me le rappeler à la prochaine version",

  // dialog
  "updates.dialog.title": "Mettre à jour vers {version}",
  "updates.dialog.description":
    "Votre instance est déployée depuis votre propre copie du dépôt MakiSend. La mise à jour y fusionne la nouvelle version ; Cloudflare reconstruit ensuite le Worker et applique les migrations de la base de données.",
  "updates.dialog.syncStep1": "Ouvrez le workflow de synchronisation de votre dépôt.",
  "updates.dialog.syncStep2Before": "Sélectionnez ",
  "updates.dialog.syncStep2Action": "Run workflow",
  "updates.dialog.syncStep2After": " et laissez la version vide pour obtenir la dernière version publiée.",
  "updates.dialog.syncStep3": "Attendez la fin du build Cloudflare, puis rechargez cette page.",
  "updates.dialog.manualStep1Before": "Dans votre copie du dépôt, lancez le workflow ",
  "updates.dialog.manualStep1Workflow": "Sync with upstream",
  "updates.dialog.manualStep1After": " (onglet Actions), ou fusionnez la version à la main.",
  "updates.dialog.manualStep2Before": "Définissez ",
  "updates.dialog.manualStep2After": " sur le Worker pour que ce bouton l'ouvre directement.",
  "updates.dialog.guide": "Guide de mise à jour",
  "updates.dialog.openWorkflow": "Ouvrir le workflow de synchronisation",
  "updates.dialog.openRelease": "Ouvrir la version",

  // version card (settings)
  "updates.version.checkFailedToast": "Impossible de vérifier les mises à jour",
  "updates.version.latestToast": "Vous utilisez la dernière version",
  "updates.version.installed": "Installée",
  "updates.version.latest": "Dernière version",
  "updates.version.checkOff": "Vérification désactivée (UPDATE_CHECK=off)",
  "updates.version.noneYet": "Aucune version publiée pour l'instant",
  "updates.version.updateAvailable": "Mise à jour disponible",
  "updates.version.lastCheck": "Dernière vérification",
  "updates.version.lastCheckFailed": "La dernière vérification a échoué : {error}",
  "updates.version.checking": "Vérification",
  "updates.version.checkNow": "Vérifier maintenant",
} satisfies Record<keyof typeof en, string>
