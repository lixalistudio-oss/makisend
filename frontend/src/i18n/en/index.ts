import common from "./common"
import nav from "./nav"
import home from "./home"
import auth from "./auth"
import dashboard from "./dashboard"
import smtp from "./smtp"
import apiKeys from "./apiKeys"
import logs from "./logs"
import templates from "./templates"
import settings from "./settings"
import updates from "./updates"
import apiDocs from "./apiDocs"
import star from "./star"
import deliverability from "./deliverability"

export default {
  ...common,
  ...nav,
  ...home,
  ...auth,
  ...dashboard,
  ...smtp,
  ...apiKeys,
  ...logs,
  ...templates,
  ...settings,
  ...updates,
  ...apiDocs,
  ...star,
  ...deliverability,
}
