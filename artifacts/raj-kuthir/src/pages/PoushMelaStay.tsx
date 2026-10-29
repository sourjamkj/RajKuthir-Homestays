import { FestivalStay } from '@/components/FestivalStay';

/**
 * Landing for people looking for somewhere to stay for Poush Mela.
 *
 * Facts about the fair are limited to what is published and stable: Visva-
 * Bharati holds it on the Purbapalli ground, and it traditionally opens on
 * 7 Poush, around 23 December. The year's dates and rules are the
 * university's to announce, and the page says so rather than guessing.
 * Dates, minimum stay and price come from the live rate plan.
 */
export default function PoushMelaStay() {
  return (
    <FestivalStay
      slug="poush-mela"
      festival="Poush Mela"
      peakId="poush-mela"
      documentTitle="Stay for Poush Mela in Shantiniketan | Raj Kuthir"
      eyebrow="The winter fair"
      breadcrumb="Poush Mela stay"
      heading={<>A stay for<br /><em>Poush Mela.</em></>}
      intro={
        <>
          <p>
            Poush Mela is Shantiniketan&rsquo;s winter fair, held by Visva-Bharati on the
            Purbapalli ground and traditionally opening on the seventh day of Poush,
            around 23 December.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Sobuj Potro is a private two-bedroom villa in Bolpur. In the busiest week of
            the year in Santiniketan, you get a whole house to come back to, not a room.
          </p>
        </>
      }
      about={{
        heading: <>The fair, and what<br /><em>to check first.</em></>,
        body: (
          <>
            <p>
              The mela runs for several days: Baul and folk music, handicraft and food
              stalls, and the crowds that come with them. Our peak period runs on through
              Christmas and New Year, when the town stays full.
            </p>
            <p className="border-l-2 border-accent/40 pl-5 text-sm leading-6">
              The university announces the dates and arrangements afresh each year. Check
              its notice before you fix your travel &mdash; we will tell you what we know
              when you enquire, but we would rather not guess on a web page.
            </p>
          </>
        ),
      }}
      ctaHeading={<>Go to the mela.<br /><em>Come back to a whole house.</em></>}
    />
  );
}
