/**
 * Registeret over Hverdagsflyt/Lucide-ikonene som allerede finnes i
 * repoet (repo-rotens `assets/icons/*.svg`, brukt i dag av produksjonens
 * delte `Ikon`-komponent, §index.html linje 1961–1973/2218–2258). Dette
 * er ETT sted, ikke duplisert per ikon — samme prinsipp som produksjonens
 * `.icon-mask`/`Ikon`.
 *
 * Bevisst eksplisitte, statiske imports (ikke `import.meta.glob` eller en
 * kjøretids-strengmal som produksjonens `url(assets/icons/${navn}.svg)`)
 * — §Kontrolltårn-handoff, Issue #20: et ukjent/feilstavet ikonnavn skal
 * ikke kunne snike seg inn via en fri streng. `IconName`-unionen under gir
 * dette som en kompileringsfeil, ikke en runtime-404.
 *
 * Selve SVG-filene forblir den ENE kilden til sannhet i `assets/icons/`
 * (repo-roten, utenfor `web/`) — ingen kopi finnes i `web/src` eller
 * `web/public`. Vite løser den relative importstien direkte og bunter
 * filen inn i build-outputet (hashet filnavn under `dist/assets/`) uten
 * at kildefilen dupliseres i repoet. `vite.config.ts` sin
 * `server.fs.allow` er utvidet til å dekke repo-roten slik at dette også
 * fungerer i `npm run dev`/`vitest` (som ellers ville nektet å servere en
 * fil utenfor `web/`).
 *
 * Design-review runde 2 (§Kontrolltårn-review, PR #26): 20 nye standard
 * Lucide-assets lagt til i `assets/icons/` for å lukke ikonhullene fra
 * PR #25/runde 1 (handlings-/metadata-/kategoriikoner) — hentet fra
 * `lucide-static` (ISC), reformatert til samme enkeltlinje-stil som de
 * eksisterende filene. Fortsatt ingen håndtegnede/uverifiserte SVG-er.
 */
import arrowRight from "../../../assets/icons/arrow-right.svg";
import badgeDollarSign from "../../../assets/icons/badge-dollar-sign.svg";
import beef from "../../../assets/icons/beef.svg";
import bookOpen from "../../../assets/icons/book-open.svg";
import calendar from "../../../assets/icons/calendar.svg";
import calendarDays from "../../../assets/icons/calendar-days.svg";
import chartColumn from "../../../assets/icons/chart-column.svg";
import check from "../../../assets/icons/check.svg";
import chevronDown from "../../../assets/icons/chevron-down.svg";
import chevronRight from "../../../assets/icons/chevron-right.svg";
import chevronUp from "../../../assets/icons/chevron-up.svg";
import circleCheckBig from "../../../assets/icons/circle-check-big.svg";
import circleQuestionMark from "../../../assets/icons/circle-question-mark.svg";
import circleUserRound from "../../../assets/icons/circle-user-round.svg";
import clipboardCheck from "../../../assets/icons/clipboard-check.svg";
import clock from "../../../assets/icons/clock.svg";
import cupSoda from "../../../assets/icons/cup-soda.svg";
import ellipsis from "../../../assets/icons/ellipsis.svg";
import externalLink from "../../../assets/icons/external-link.svg";
import fish from "../../../assets/icons/fish.svg";
import folderOpen from "../../../assets/icons/folder-open.svg";
import heart from "../../../assets/icons/heart.svg";
import house from "../../../assets/icons/house.svg";
import houseHeart from "../../../assets/icons/house-heart.svg";
import landmark from "../../../assets/icons/landmark.svg";
import leaf from "../../../assets/icons/leaf.svg";
import listTodo from "../../../assets/icons/list-todo.svg";
import logOut from "../../../assets/icons/log-out.svg";
import messageCircle from "../../../assets/icons/message-circle.svg";
import milk from "../../../assets/icons/milk.svg";
import packageOpen from "../../../assets/icons/package-open.svg";
import pencil from "../../../assets/icons/pencil.svg";
import piggyBank from "../../../assets/icons/piggy-bank.svg";
import plus from "../../../assets/icons/plus.svg";
import receiptText from "../../../assets/icons/receipt-text.svg";
import sandwich from "../../../assets/icons/sandwich.svg";
import settings from "../../../assets/icons/settings.svg";
import shieldCheck from "../../../assets/icons/shield-check.svg";
import shoppingCart from "../../../assets/icons/shopping-cart.svg";
import snowflake from "../../../assets/icons/snowflake.svg";
import soup from "../../../assets/icons/soup.svg";
import sparkles from "../../../assets/icons/sparkles.svg";
import sprayCan from "../../../assets/icons/spray-can.svg";
import sprout from "../../../assets/icons/sprout.svg";
import trash2 from "../../../assets/icons/trash-2.svg";
import users from "../../../assets/icons/users.svg";
import wheat from "../../../assets/icons/wheat.svg";
import x from "../../../assets/icons/x.svg";

export const ICON_ASSETS = {
  "arrow-right": arrowRight,
  "badge-dollar-sign": badgeDollarSign,
  beef,
  "book-open": bookOpen,
  calendar,
  "calendar-days": calendarDays,
  "chart-column": chartColumn,
  check,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight,
  "chevron-up": chevronUp,
  "circle-check-big": circleCheckBig,
  "circle-question-mark": circleQuestionMark,
  "circle-user-round": circleUserRound,
  "clipboard-check": clipboardCheck,
  clock,
  "cup-soda": cupSoda,
  ellipsis,
  "external-link": externalLink,
  fish,
  "folder-open": folderOpen,
  heart,
  house,
  "house-heart": houseHeart,
  landmark,
  leaf,
  "list-todo": listTodo,
  "log-out": logOut,
  "message-circle": messageCircle,
  milk,
  "package-open": packageOpen,
  pencil,
  "piggy-bank": piggyBank,
  plus,
  "receipt-text": receiptText,
  sandwich,
  settings,
  "shield-check": shieldCheck,
  "shopping-cart": shoppingCart,
  snowflake,
  soup,
  sparkles,
  "spray-can": sprayCan,
  sprout,
  "trash-2": trash2,
  users,
  wheat,
  x,
} as const;

/** Ethvert ikonnavn som faktisk finnes i registeret — TypeScript nekter et navn som ikke er her. */
export type IconName = keyof typeof ICON_ASSETS;
