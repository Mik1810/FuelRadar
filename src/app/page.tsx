import Image from "next/image";

import { SITE_TAGLINE } from "@/config/site";

export default function Home() {
  return (
    <main className="landing-shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="brand-mark">
          <Image
            src="/logo.png"
            alt="Logo FuelRadar"
            width={92}
            height={92}
            priority
          />
        </div>

        <div className="hero-copy">
          <p className="eyebrow">FuelRadar per il web</p>
          <h1 id="hero-title">{SITE_TAGLINE}.</h1>
          <p className="subtitle">
            Stiamo costruendo una nuova esperienza mobile-first basata sui dati
            ufficiali MIMIT.
          </p>
        </div>

        <div className="status-card" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Fondazioni web pronte</strong>
            <p>Il prossimo passo collega dati, ricerca geografica e mappa.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
