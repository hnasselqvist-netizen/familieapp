// Kun spor og korte mellom-PR-notater. PR-status kommer alltid fra GitHub.
export const repository = "hnasselqvist-netizen/familieapp";
export const stages = ["Kartlagt", "Designet", "Bygges", "Review", "Klar", "I bruk"];
export const tracks = [
  {
    id: "kjokken",
    name: "Kjøkken / Mat",
    description: "Middagsplan, kokebok, handleliste og matlager",
    issue: 20,
    titlePattern: "kjøkken|\\bmat\\b|middag|kokebok|handleliste|fryser|matlager|variantmodell",
    note: {
      stage: "I bruk",
      now: "Kjøkken v1 er verifisert på iPhone i Firebase production.",
      next: "Videre produktarbeid etter ChatGPT-integrasjon og migrering.",
      source:
        "https://github.com/hnasselqvist-netizen/familieapp/issues/20#issuecomment-5743690985",
      observedComment: 5767993044,
      observedAt: "2026-10-02T12:58:32Z",
    },
  },
  {
    id: "forvaltning",
    name: "Forvaltning",
    description: "Spillerom, budsjett og forsoning",
    issue: 34,
    titlePattern: "forvaltning|forsoning|regelsenter|årsbudsjett|budsjett|spillerom",
    note: {
      stage: "Bygges",
      now: "R1 har klarsignal: RegelSenter og repository med skriving av.",
      next: "Review av R1. Faktisk rules-skriving først ved R3b-cutover.",
      source:
        "https://github.com/hnasselqvist-netizen/familieapp/issues/34#issuecomment-5952884278",
      observedComment: 5952884278,
      observedAt: "2026-10-02T12:58:32Z",
    },
  },
  {
    id: "chatgpt",
    name: "ChatGPT-integrasjon",
    description: "Kontrollert inngang fra ChatGPT til Hverdagsflyt",
    issue: 27,
    titlePattern: "mcp|chatgpt|iam api",
    note: {
      stage: "Klar",
      now: "Handleliste-foundation er merget i #40; ennå ikke aktivert.",
      next: "Auth0/IdP-probe og vurdering av minimumsdeploy.",
      waiting: "Separat beslutning før auth-oppsett, deploy og legacy-cutover.",
      source: "https://github.com/hnasselqvist-netizen/familieapp/pull/40",
      observedComment: 5937759266,
      observedAt: "2026-10-02T12:58:32Z",
    },
  },
  {
    id: "grunnmur",
    name: "Teknisk grunnmur",
    description: "React, designsystem, CI og hosting",
    issue: 20,
    pullNumbers: [1, 21, 22, 29, 30],
    titlePattern: "grunnmur|\\bci\\b|hosting|production|produksjon|cutover|skall",
    note: {
      stage: "I bruk",
      now: "Firebase production-cutover er verifisert og godkjent.",
      next: "Grunnmuren utvides sammen med de neste migreringsskivene.",
      source:
        "https://github.com/hnasselqvist-netizen/familieapp/issues/20#issuecomment-5743690985",
      observedComment: 5767993044,
      observedAt: "2026-10-02T12:58:32Z",
    },
  },
];
