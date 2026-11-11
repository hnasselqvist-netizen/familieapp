import { useMellomvaerende } from "@hooks/useMellomvaerende";
import { OppgjorKort } from "./OppgjorKort";

/**
 * Handlingskortene (#95) på Forvaltning-forsiden: ett kort per
 * mellomværende som har en uoppgjort måned (eldste først) eller en
 * ufullført registrering. Ingenting å gjøre → ingenting vises.
 */
export function MellomvaerendeHandlingskort() {
  const mv = useMellomvaerende();
  if (mv.status !== "loaded") return null;
  const aktuelle = mv.data.statuser.filter((s) => !s.kostnadFort || s.forfalte.length > 0);
  if (aktuelle.length === 0) return null;
  return (
    <>
      {aktuelle.map((s) => (
        <OppgjorKort
          key={s.avtale.id}
          status={s}
          onBekreft={(maaned, ore) => mv.handlinger.bekreft(s.avtale, maaned, ore)}
          onFullfor={() => mv.handlinger.fullforRegistrering(s.avtale)}
        />
      ))}
    </>
  );
}
