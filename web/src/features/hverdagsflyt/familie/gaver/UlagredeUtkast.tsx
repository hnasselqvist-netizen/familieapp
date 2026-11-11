import { Card } from "@components/Card";
import { anledningNavn, type Grupper } from "@domain/gaver/gaver";
import type { GaverData, GaverHandlinger } from "@hooks/useGaver";
import { GaveSkjema } from "./GaveListe";
import { BudsjettSkjema } from "./JulPlan";
import { PersonSkjema } from "./Personregister";
import { useUtkastLager } from "./utkast";
import styles from "./Gaver.module.css";

/**
 * Åpne utkast som ikke lenger har en rad å stå i (review 5731615381), for
 * eksempel fordi mottakeren ble fjernet fra årets liste på en annen enhet,
 * eller personen ble arkivert. Utkastet vises med en forklaring; brukeren
 * velger selv å lagre det (mot versjonen hen startet fra, så en konflikt
 * meldes som vanlig) eller forkaste det. Ingenting gjenopprettes eller
 * flyttes automatisk for å redde utkastet.
 */
export function UlagredeUtkast({
  data,
  grupper,
  handlinger,
}: {
  data: GaverData;
  grupper: Grupper;
  handlinger: GaverHandlinger;
}) {
  const { poster, verter } = useUtkastLager();
  const foreldreløse = [...poster.entries()].filter(([n]) => !verter.has(n));
  if (foreldreløse.length === 0) return null;
  const personNavn = (id: string) => data.personer.find((p) => p.id === id)?.navn ?? "en person";

  return (
    <Card>
      <section className={styles.kort} aria-label="Ulagrede utkast">
        <h2 className={styles.kortTittel}>Ulagrede utkast</h2>
        <p className={styles.dempet}>
          Listen er endret mens du skrev, så stedet du skrev på vises ikke lenger. Det du skrev, er
          tatt vare på her. Lagre det (mot versjonen du startet fra) eller forkast det.
        </p>
        {foreldreløse.map(([n, post]) => {
          if (post.art === "person") {
            return (
              <div key={n} className={styles.seksjon}>
                <p className={styles.tekst}>
                  {post.grunn ? `Endring av ${post.grunn.navn}` : "Ny person"}
                </p>
                <PersonSkjema
                  nokkel={n}
                  gjeldende={data.personer.find((p) => p.id === post.id) ?? null}
                  grupper={grupper}
                  handlinger={handlinger}
                />
              </div>
            );
          }
          if (post.art === "gave") {
            const anl = data.anledninger.find((a) => a.id === post.anledningId);
            return (
              <div key={n} className={styles.seksjon}>
                <p className={styles.tekst}>
                  {post.grunn ? "Endring av gave" : "Ny idé eller gave"} til{" "}
                  {personNavn(post.personId)}
                  {anl ? ` (${anledningNavn(anl)})` : " (løpende idé)"}
                  {anl?.mottakere[post.personId]?.fjernet && " — personen er fjernet fra listen"}
                </p>
                <GaveSkjema
                  nokkel={n}
                  gjeldende={data.gaver.find((g) => g.id === post.id) ?? null}
                  handlinger={handlinger}
                />
              </div>
            );
          }
          const anl = data.anledninger.find((a) => a.id === post.grunn.id);
          return (
            <div key={n} className={styles.seksjon}>
              <p className={styles.tekst}>
                Budsjett for {personNavn(post.personId)} ({anledningNavn(post.grunn)})
                {anl?.mottakere[post.personId]?.fjernet && " — personen er fjernet fra listen"}
              </p>
              <BudsjettSkjema nokkel={n} anledning={anl} handlinger={handlinger} />
            </div>
          );
        })}
      </section>
    </Card>
  );
}
