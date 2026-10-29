import { FestivalStay } from '@/components/FestivalStay';

/**
 * Landing for people looking for somewhere to stay for Basanta Utsav and Dol.
 *
 * Deliberately candid: in recent years Visva-Bharati has kept its own
 * Basanta Utsav to the campus community, without coloured powder, and in
 * 2025 moved it to a few days before Dol (reported by ETV Bharat, March
 * 2025). A guest who books expecting the old open celebration on campus would
 * be disappointed, so the page says so. Dates, minimum stay and price come
 * from the live rate plan.
 */
export default function BasantaUtsavStay() {
  return (
    <FestivalStay
      slug="basanta-utsav"
      festival="Basanta Utsav"
      peakId="basanta-utsav"
      documentTitle="Stay for Basanta Utsav in Shantiniketan | Raj Kuthir"
      eyebrow="Spring and Dol"
      breadcrumb="Basanta Utsav stay"
      heading={<>Spring in Shantiniketan:<br /><em>Basanta Utsav.</em></>}
      intro={
        <>
          <p>
            Basanta Utsav is the spring festival Rabindranath Tagore began at
            Shantiniketan, celebrated around Dol Purnima in March with songs and dance in
            yellow and saffron.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Sobuj Potro is a private two-bedroom villa in Bolpur &mdash; a whole house to
            come back to in one of the busiest weeks of the year in Santiniketan.
          </p>
        </>
      }
      about={{
        heading: <>Before you plan<br /><em>around it.</em></>,
        body: (
          <>
            <p>
              In recent years Visva-Bharati has held its own Basanta Utsav for the campus
              community rather than for outside visitors, without coloured powder, and in
              2025 on a date a few days before Dol. The university decides afresh each
              year, so check its notice before you book around the campus celebration.
            </p>
            <p>
              Dol itself is celebrated across the town and the villages around it, and
              spring is one of the loveliest times to be here whatever the campus decides.
            </p>
          </>
        ),
      }}
      ctaHeading={<>Come for the spring.<br /><em>Stay in a whole house.</em></>}
    />
  );
}
